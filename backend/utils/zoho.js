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

const logger = require('../logger');

let cached = { token: null, expiresAt: 0 };

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
    throw new Error(`Zoho token refresh failed (${r.status}): ${text}`);
  }
  const body = await r.json();
  if (!body.access_token) {
    throw new Error(`Zoho token refresh succeeded but returned no access_token: ${JSON.stringify(body)}`);
  }

  // Zoho's expires_in is in seconds. Cache for 55 min to leave headroom.
  const ttlMs = (body.expires_in ? body.expires_in - 300 : 55 * 60) * 1000;
  cached = { token: body.access_token, expiresAt: Date.now() + ttlMs };
  logger.info({ ttlMs }, 'Zoho access token refreshed');
  return cached.token;
}

async function getAccessToken() {
  if (cached.token && cached.expiresAt > Date.now()) return cached.token;
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
    // Stale token — drop the cache and try once more.
    cached = { token: null, expiresAt: 0 };
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

module.exports = { getAccessToken, refreshAccessToken, zohoApi, iterateEmployees };
