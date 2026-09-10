/**
 * Thin Zoho People client.
 *
 * Reads ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, ZOHO_API_DOMAIN,
 * ZOHO_AUTH_URL from process.env. Exchanges the long-lived refresh token for
 * a short-lived access token (cached in memory for ~55 min) and exposes:
 *
 *   await zohoApi('forms/employee/getRecords?sIndex=1&rec_limit=200')
 *
 * Returns the parsed JSON body. Throws on non-2xx.
 *
 * On a 401 we drop the cached access token and retry once — covers the
 * race where Zoho rotates the access token before our cache expires.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const logger = require('../logger');

let cached = { token: null, expiresAt: 0 };

/* The in-memory cache above is per PROCESS, and that is the whole problem for
 * the CLI tools.
 *
 * The server holds one process for days, so it exchanges the refresh token
 * roughly once an hour and nobody notices. Every `docker compose exec backend
 * node some_script.js` is a brand new process with an empty cache, so it burns
 * a refresh on startup no matter how small the job. A morning of reconcile and
 * restage runs is thirty-odd refreshes, and Zoho rate-limits the refresh
 * endpoint separately from the API:
 *
 *   Zoho token refresh failed (400): "You have made too many requests
 *   continuously. Please try again after some time."
 *
 * It arrives as a 400, so the 429/503/502 backoff in the inspect scripts never
 * fires, and a read-only script that would have been free dies outright.
 *
 * So the token is also cached on disk, beside the process that fetched it, and
 * shared by every later CLI run until it expires. Same TTL, same token, one
 * refresh instead of thirty. Written 0600 -- it is a one-hour credential
 * sitting in the same container as the refresh token that mints it, which is
 * the stronger secret by far. */
const TOKEN_CACHE = process.env.ZOHO_TOKEN_CACHE
  || path.join(os.tmpdir(), 'nxtpeople-zoho-token.json');

function readDiskToken() {
  try {
    const raw = fs.readFileSync(TOKEN_CACHE, 'utf8');
    const j = JSON.parse(raw);
    if (j && typeof j.token === 'string' && typeof j.expiresAt === 'number'
        && j.expiresAt > Date.now()) {
      return { token: j.token, expiresAt: j.expiresAt };
    }
  } catch { /* absent, unreadable or stale — mint a new one, that is not an error */ }
  return null;
}

function writeDiskToken(entry) {
  try {
    fs.writeFileSync(TOKEN_CACHE, JSON.stringify(entry), { mode: 0o600 });
  } catch (err) {
    // A token we could not cache still works; only the next process pays.
    logger.warn({ err: String(err.message) }, 'Could not persist Zoho access token');
  }
}

function envOrThrow(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

/**
 * Mint a fresh Zoho access token. Cached for slightly less than the 1-hour TTL.
 */
async function refreshAccessToken() {
  const url = envOrThrow('ZOHO_AUTH_URL');
  const params = new URLSearchParams({
    refresh_token: envOrThrow('ZOHO_REFRESH_TOKEN'),
    client_id:     envOrThrow('ZOHO_CLIENT_ID'),
    client_secret: envOrThrow('ZOHO_CLIENT_SECRET'),
    grant_type:    'refresh_token',
  });

  const r = await fetch(`${url}?${params.toString()}`, { method: 'POST' });
  if (!r.ok) {
    const text = await r.text();
    // Zoho reports refresh-endpoint throttling as a 400, not a 429, so say
    // what it is -- "failed (400)" reads like bad credentials and sends people
    // looking for a revoked token that is fine.
    if (/too many requests/i.test(text)) {
      throw new Error(
        `Zoho is throttling the token refresh endpoint (${r.status}). The credentials are `
        + `fine; too many separate processes asked for a token. Wait, then retry -- the `
        + `access token is cached at ${TOKEN_CACHE}, so later runs share one refresh.`);
    }
    throw new Error(`Zoho token refresh failed (${r.status}): ${text}`);
  }
  const body = await r.json();
  if (!body.access_token) {
    throw new Error(`Zoho token refresh succeeded but returned no access_token: ${JSON.stringify(body)}`);
  }

  // Zoho's expires_in is in seconds. Cache for 55 min to leave headroom.
  const ttlMs = (body.expires_in ? body.expires_in - 300 : 55 * 60) * 1000;
  cached = { token: body.access_token, expiresAt: Date.now() + ttlMs };
  writeDiskToken(cached);
  logger.info({ ttlMs }, 'Zoho access token refreshed');
  return cached.token;
}

async function getAccessToken() {
  if (cached.token && cached.expiresAt > Date.now()) return cached.token;
  const onDisk = readDiskToken();
  if (onDisk) { cached = onDisk; return cached.token; }
  return refreshAccessToken();
}

/**
 * GET an endpoint under the configured Zoho API domain.
 *   endpoint — path beneath `/people/api/`, e.g. 'forms/employee/getRecords?sIndex=1'
 */
async function zohoApi(endpoint) {
  const domain = envOrThrow('ZOHO_API_DOMAIN');                 // e.g. https://people.zoho.in
  const url    = `${domain.replace(/\/$/, '')}/people/api/${endpoint.replace(/^\//, '')}`;

  const fire = async () => {
    const token = await getAccessToken();
    const r = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
    return r;
  };

  let r = await fire();
  if (r.status === 401) {
    // Stale token — drop BOTH caches and try once more. Clearing only the
    // in-memory one would read the same dead token straight back off disk.
    cached = { token: null, expiresAt: 0 };
    try { fs.unlinkSync(TOKEN_CACHE); } catch { /* nothing cached, fine */ }
    r = await fire();
  }
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Zoho API ${endpoint} failed (${r.status}): ${text.slice(0, 300)}`);
  }
  return r.json();
}

/**
 * Iterate every employee record in Zoho People. Pages through `forms/employee/getRecords`
 * 200 at a time. Yields one already-flattened employee object per record.
 *
 * Zoho's response shape is irregular:
 *   { response: { result: [ { "<recordId>": [ { ...fields... } ] }, ... ] } }
 * — we unwrap it here so callers see a flat array.
 */
async function* iterateEmployees({ pageSize = 200 } = {}) {
  let sIndex = 1;
  for (;;) {
    const body = await zohoApi(`forms/employee/getRecords?sIndex=${sIndex}&rec_limit=${pageSize}`);
    const result = body?.response?.result;
    if (!Array.isArray(result) || result.length === 0) return;

    for (const row of result) {
      // Each row is { "<id>": [ { ...fields } ] }
      const id = Object.keys(row)[0];
      const fields = Array.isArray(row[id]) ? row[id][0] : row[id];
      if (fields && typeof fields === 'object') yield fields;
    }
    if (result.length < pageSize) return;
    sIndex += pageSize;
  }
}

/**
 * Iterate Zoho People Payroll form records. Same shape as iterateEmployees
 * but the form name comes from ZOHO_PAYROLL_FORM (defaults to 'payroll').
 *
 * Best-effort: if the org doesn't have the form (404) or the subscription
 * doesn't include Payroll (403), this yields nothing instead of throwing.
 * Callers can rely on the sync still succeeding for orgs that don't have
 * Zoho Payroll.
 */
async function* iteratePayroll({ pageSize = 200 } = {}) {
  const formName = process.env.ZOHO_PAYROLL_FORM || 'payroll';
  let sIndex = 1;
  try {
    for (;;) {
      const body = await zohoApi(`forms/${formName}/getRecords?sIndex=${sIndex}&rec_limit=${pageSize}`);
      const result = body?.response?.result;
      if (!Array.isArray(result) || result.length === 0) return;
      for (const row of result) {
        const id = Object.keys(row)[0];
        const fields = Array.isArray(row[id]) ? row[id][0] : row[id];
        if (fields && typeof fields === 'object') yield fields;
      }
      if (result.length < pageSize) return;
      sIndex += pageSize;
    }
  } catch (err) {
    logger.warn({ formName, msg: err.message }, 'Zoho Payroll iterate failed (subscription or form-name missing) — skipping');
  }
}

/**
 * List file attachments for one Zoho People employee record. Returns
 * an array of { fileName, fileId, fileSize, fileType } objects.
 * Empty array if the employee has no files, or if the API call fails.
 */
// Silent on per-employee failures — the caller aggregates a count and reports
// it in the sync stats. Logging every failure floods the console without
// adding information.
async function listEmployeeFiles(recordId) {
  try {
    const body = await zohoApi(`forms/employee/getRecordAttachments?recordId=${encodeURIComponent(recordId)}`);
    const list = body?.response?.result || body?.result || [];
    return Array.isArray(list)
      ? list.map(f => ({
          fileName: f.fileName || f.attachmentName || f.name,
          fileId:   f.fileId   || f.id            || f.attachmentId,
          fileSize: f.fileSize || f.size,
          fileType: f.fileType || f.mimeType,
        })).filter(f => f.fileId)
      : [];
  } catch {
    return [];
  }
}

/**
 * Download one Zoho People file as a Buffer. Returns null on any failure
 * (network, auth, not-found) so callers can continue with other files.
 */
async function downloadFile(recordId, fileId) {
  const domain = process.env.ZOHO_API_DOMAIN || '';
  if (!domain) return null;
  const url = `${domain.replace(/\/$/, '')}/people/api/forms/employee/${encodeURIComponent(recordId)}/${encodeURIComponent(fileId)}/getFile`;
  try {
    const token = await getAccessToken();
    const r = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
    if (!r.ok) {
      logger.warn({ url, status: r.status }, 'Zoho file download failed');
      return null;
    }
    return Buffer.from(await r.arrayBuffer());
  } catch (err) {
    logger.warn({ url, msg: err.message }, 'Zoho file download threw');
    return null;
  }
}

module.exports = { getAccessToken, refreshAccessToken, zohoApi, iterateEmployees, iteratePayroll, listEmployeeFiles, downloadFile };
