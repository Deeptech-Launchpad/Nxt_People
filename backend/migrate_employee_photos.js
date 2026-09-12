/* ── Fetch the employee photos that were never brought over ─────────────────
 *  52 of the 57 active people have no photo at all — not a broken link, not a
 *  stale URL: the column is empty. The migration brought names, attendance and
 *  leave across and left the faces behind, which is why every avatar in the
 *  product is a grey silhouette.
 *
 *  So there is no URL to repair. Each person is looked up in Zoho by their
 *  employee code, and their photo is pulled from the record that comes back,
 *  stored the way an uploaded photo is stored (uploads/photos, served at
 *  /uploads/photos/<file>) and written to photo_url.
 *
 *      node migrate_employee_photos.js --probe     what Zoho actually answers
 *      node migrate_employee_photos.js             dry run: who would change
 *      node migrate_employee_photos.js --apply     fetch and write
 *      node migrate_employee_photos.js --apply --limit 5
 *
 *  START WITH --probe. Zoho documents no one photo route that holds for every
 *  tenant, so it dumps the fields of a real record and tries each candidate,
 *  reporting what came back rather than guessing and writing 52 broken files.
 *
 *  Three things this refuses to do:
 *
 *    Write anything that is not an image. An expired token answers 200 with a
 *    login page; the magic bytes are checked before the filesystem or the
 *    database is touched, so a redirect can never become somebody's face.
 *
 *    Treat a refusal as "no photo". Zoho answers a refusal with HTTP 200 and
 *    an envelope carrying no `result` key at all. Reading `result || []` there
 *    is the same mistake that once had an importer delete 43 people's leave —
 *    an error is not an empty list, and it is reported, not skipped over.
 *
 *    Overwrite a photo somebody already has. Only rows with no local photo are
 *    considered.
 * ────────────────────────────────────────────────────────────────────────── */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./db');
const { getAccessToken, zohoApi } = require('./utils/zoho');

const APPLY = process.argv.includes('--apply');
const PROBE = process.argv.includes('--probe');
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  return i > -1 ? Math.max(1, parseInt(process.argv[i + 1], 10) || 0) : 0;
})();

const PHOTO_DIR = path.join(__dirname, 'uploads', 'photos');
const domain = () => (process.env.ZOHO_API_DOMAIN || '').replace(/\/$/, '');

/* Content-type lies often enough — Zoho answers text/html for an expired
 * session while still saying 200 — that the bytes get the final word. */
const SIGNATURES = [
  { ext: 'jpg',  test: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png',  test: b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: 'gif',  test: b => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 },
  { ext: 'webp', test: b => b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP' },
  { ext: 'bmp',  test: b => b[0] === 0x42 && b[1] === 0x4d },
];
const imageKind = (buf) => {
  if (!buf || buf.length < 12) return null;
  return (SIGNATURES.find(s => s.test(buf)) || {}).ext || null;
};

/* One employee record from Zoho, by the code we hold. Returns
 * { recordId, fields } or { error } — never an empty object standing in for a
 * refusal. */
async function findZohoEmployee(code) {
  const search = encodeURIComponent(JSON.stringify({
    searchField: 'Employee_ID', searchOperator: 'Contains', searchText: code,
  }));
  let json;
  try {
    json = await zohoApi(`forms/employee/getRecords?sIndex=1&limit=5&searchParams=${search}`);
  } catch (err) {
    return { error: err.message };
  }
  const resp = json && json.response;
  if (!resp || typeof resp !== 'object') return { error: 'no response object' };
  if (!('result' in resp)) {
    return { error: String(resp.message || JSON.stringify(resp.errors || resp.error || {})).slice(0, 90) };
  }
  const rows = Array.isArray(resp.result) ? resp.result : [];
  for (const row of rows) {
    const recordId = Object.keys(row)[0];
    const fields = Array.isArray(row[recordId]) ? row[recordId][0] : row[recordId];
    if (fields && String(fields.Employee_ID || '').trim() === String(code).trim()) {
      return { recordId, fields };
    }
  }
  return { error: rows.length ? 'no exact code match' : 'not found in Zoho' };
}

/* Anything in the record that looks like it points at an image, plus Zoho
 * People's own photo routes for that record. */
function candidatesFor(recordId, fields = {}) {
  const out = [];
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === 'string' && /^https?:\/\//.test(v) && /photo|image|picture/i.test(k)) {
      out.push({ name: `field ${k}`, url: v });
    }
  }
  if (domain() && recordId) {
    out.push({ name: 'v2 employee photo', url: `${domain()}/people/api/v2/employee/${encodeURIComponent(recordId)}/photo` });
    out.push({ name: 'forms getImage',    url: `${domain()}/people/api/forms/employee/getImage?recordId=${encodeURIComponent(recordId)}` });
    out.push({ name: 'viewEmployeePhoto', url: `${domain()}/api/viewEmployeePhoto?filename=${encodeURIComponent(recordId)}` });
  }
  return out;
}

async function attempt(url, token) {
  try {
    const r = await fetch(url, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
    const buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, type: r.headers.get('content-type') || '', bytes: buf.length, kind: imageKind(buf), buf };
  } catch (err) {
    return { status: 0, type: '', bytes: 0, kind: null, error: err.message };
  }
}

/* Zoho rate-limits the TOKEN endpoint separately from the API and reports it
 * as a 400 rather than a 429, so a tight loop reads as bad credentials. The
 * token itself is cached on disk between runs; this spaces out the calls. */
const breathe = () => new Promise(r => setTimeout(r, 400));

async function main() {
  const rows = (await pool.query(
    `SELECT id, employee_id AS code, TRIM(CONCAT(first_name, ' ', last_name)) AS name
       FROM employees
      WHERE deleted_at IS NULL AND status = 'active'
        AND employee_id IS NOT NULL AND employee_id <> ''
        AND (photo_url IS NULL OR photo_url = '' OR photo_url NOT LIKE '/uploads/%')
        -- Rows the migration and the demo data left behind. They exist in no
        -- Zoho record, so every lookup for them fails, and that failure reads
        -- exactly like a real one.
        AND employee_id <> '1'
        AND employee_id NOT LIKE 'ADMIN-%'
        AND employee_id NOT LIKE 'NXT-TEST-%'
      ORDER BY employee_id`
  )).rows;
  const have = (await pool.query(
    `SELECT COUNT(*)::int n FROM employees
      WHERE deleted_at IS NULL AND status='active' AND photo_url LIKE '/uploads/%'`)).rows[0].n;

  console.log(`\n  without a local photo : ${rows.length}`);
  console.log(`  already have one      : ${have}\n`);
  if (!rows.length) { console.log('  Nothing to fetch.\n'); return; }

  let token;
  try { token = await getAccessToken(); }
  catch (err) {
    console.error(`  Cannot reach Zoho: ${err.message}`);
    console.error('  Check the ZOHO_* variables in the ROOT .env and that docker-compose passes them through.\n');
    process.exitCode = 1;
    return;
  }

  if (PROBE) {
    /* Can the employee form be read at all? Asking for one record with no
       search separates "this token cannot see the employee form" from "the
       search was rejected". Zoho reports both through the same error
       envelope, and they want completely different fixes. */
    try {
      const bare = await zohoApi('forms/employee/getRecords?sIndex=1&limit=1');
      const ok = bare && bare.response && 'result' in bare.response;
      console.log(`  employee form readable : ${ok ? 'yes' : 'NO — ' + String((bare && bare.response && bare.response.message) || JSON.stringify((bare && bare.response) || {})).slice(0, 90)}`);
      if (ok) {
        const first = Array.isArray(bare.response.result) ? bare.response.result[0] : null;
        const rid = first && Object.keys(first)[0];
        const f = first && (Array.isArray(first[rid]) ? first[rid][0] : first[rid]);
        if (f) console.log(`  a real record          : ${rid} (${Object.keys(f).length} fields)`);
      }
    } catch (err) {
      console.log(`  employee form readable : threw — ${err.message}`);
    }
    console.log('');

    /* Try a few real people rather than only the first row: one code that
       happens to be missing from Zoho would otherwise be reported as the
       whole integration being broken. */
    let s = null;
    let found = null;
    for (const cand of rows.slice(0, 3)) {
      console.log(`  looking up ${cand.code} ${cand.name}`);
      const got = await findZohoEmployee(cand.code);
      if (!got.error) { s = cand; found = got; break; }
      console.log(`    -> ${got.error}`);
      await breathe();
    }
    if (!found) {
      console.log('');
      console.log('  None of them resolved to a Zoho record. If the line above says the');
      console.log('  employee form is NOT readable, the integration is missing the employee');
      console.log('  module in its scope — no photo can be reached until that is granted.');
      console.log('');
      return;
    }
    console.log('');
    console.log(`  record id: ${found.recordId}`);
    const keys = Object.keys(found.fields || {});
    console.log(`  ${keys.length} fields; ones that mention a photo:`);
    const photoish = keys.filter(k => /photo|image|picture/i.test(k));
    if (photoish.length) photoish.forEach(k => console.log(`    ${k} = ${String(found.fields[k]).slice(0, 90)}`));
    else console.log('    (none — the photo is not a field, so it has to come from a route below)');

    console.log('');
    for (const c of candidatesFor(found.recordId, found.fields)) {
      const r = await attempt(c.url, token);
      const verdict = r.kind ? `IMAGE (${r.kind})` : r.status ? 'not an image' : `failed: ${r.error || ''}`;
      console.log(`  ${c.name.padEnd(20)} ${String(r.status).padEnd(4)} ${String(r.type).slice(0, 26).padEnd(28)} ${String(r.bytes).padStart(7)}b  ${verdict}`);
      await breathe();
    }
    console.log('\n  Any line reading IMAGE is a working route. Send me this output and I will');
    console.log('  pin the fetch to it. If none work, the photos have to come out of a Zoho');
    console.log('  export instead of the API.\n');
    return;
  }

  const work = LIMIT ? rows.slice(0, LIMIT) : rows;
  if (!APPLY) {
    console.log('  DRY RUN — nothing is fetched or written. Add --apply to run it.\n');
    work.slice(0, 12).forEach(r => console.log(`    ${r.code.padEnd(14)} ${r.name}`));
    if (work.length > 12) console.log(`    … and ${work.length - 12} more`);
    console.log(`\n  ${work.length} employee(s) would be looked up in Zoho and their photo stored.\n`);
    return;
  }

  fs.mkdirSync(PHOTO_DIR, { recursive: true });
  let saved = 0, noPhoto = 0, failed = 0;
  const log = [];

  for (const r of work) {
    const found = await findZohoEmployee(r.code);
    if (found.error) {
      failed++; log.push({ code: r.code, outcome: `lookup failed: ${found.error}` });
      await breathe();
      continue;
    }
    let done = false;
    for (const c of candidatesFor(found.recordId, found.fields)) {
      const got = await attempt(c.url, token);
      if (!got.kind) continue;
      const file = `zoho-${r.code}-${Date.now()}.${got.kind}`;
      fs.writeFileSync(path.join(PHOTO_DIR, file), got.buf);
      await pool.query(`UPDATE employees SET photo_url = $1, updated_at = NOW() WHERE id = $2`,
        [`/uploads/photos/${file}`, r.id]);
      log.push({ code: r.code, outcome: 'saved', via: c.name, file, bytes: got.bytes });
      saved++; done = true;
      break;
    }
    if (!done) { noPhoto++; log.push({ code: r.code, outcome: 'no image from any route' }); }
    await breathe();
  }

  console.log(`  saved            ${saved}`);
  console.log(`  no photo in Zoho ${noPhoto}`);
  console.log(`  lookup failed    ${failed}\n`);
  const out = path.join(__dirname, `photo_fetch_${Date.now()}.json`);
  fs.writeFileSync(out, JSON.stringify(log, null, 2));
  console.log(`  Full per-person outcome in ${path.basename(out)}.\n`);
  if (noPhoto || failed) console.log('  Re-run with --probe to see what the failures answered.\n');
}

main()
  .catch(err => { console.error(`\n  Fatal: ${err.message}\n`); process.exitCode = 1; })
  .finally(() => pool.end());
