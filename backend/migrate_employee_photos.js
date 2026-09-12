/* ── Fetch the employee photos that were never brought over ─────────────────
 *  52 of the 57 active people have no photo at all — not a broken link, not a
 *  stale URL: the column is empty. The migration brought names, attendance and
 *  leave across and left the faces behind, which is why nearly every avatar in
 *  the product is a grey silhouette.
 *
 *      node migrate_employee_photos.js --probe     what Zoho actually answers
 *      node migrate_employee_photos.js             dry run: who would change
 *      node migrate_employee_photos.js --apply     fetch and write
 *      node migrate_employee_photos.js --apply --limit 5
 *
 *  NO PER-PERSON SEARCH. `forms/employee/getRecords` with a searchParams
 *  filter is refused by this tenant — it answers "Error occurred" for every
 *  code — while the very same endpoint without a filter returns records
 *  happily. So the whole roster is paged once and matched on Employee_ID in
 *  memory: one or two calls instead of fifty-odd, and it uses only the call
 *  that is known to work here.
 *
 *  Three things this refuses to do:
 *
 *    Write anything that is not an image. An expired token answers 200 with a
 *    login page; the magic bytes are checked before the filesystem or the
 *    database is touched, so a redirect can never become somebody's face.
 *
 *    Treat a refusal as "no photo". Zoho answers a refusal with HTTP 200 and
 *    an envelope carrying no `result` key at all. Reading `result || []` there
 *    is the mistake that once had an importer delete 43 people's leave — an
 *    error is not an empty list, and it is reported, never skipped past.
 *
 *    Overwrite a photo somebody already has.
 * ────────────────────────────────────────────────────────────────────────── */

require('dotenv').config();
const fs = require('fs');
const crypto = require('crypto');
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

/* Zoho rate-limits the TOKEN endpoint separately from the API and reports it
 * as a 400 rather than a 429, so a tight loop reads as bad credentials. The
 * token is cached on disk between runs; this only spaces the calls out. */
const breathe = (ms = 400) => new Promise(r => setTimeout(r, ms));

/* The whole roster, keyed by employee code. Throws rather than returning a
 * short list: a half-read roster would look exactly like "these people have no
 * photo", and the caller would then skip them for good. */
async function loadZohoRoster() {
  const byCode = new Map();
  let pages = 0;
  for (let sIndex = 1; sIndex <= 5000; sIndex += 200) {
    const json = await zohoApi(`forms/employee/getRecords?sIndex=${sIndex}&limit=200`);
    const resp = json && json.response;
    if (!resp || typeof resp !== 'object') throw new Error('Zoho returned no response object');
    if (!('result' in resp)) {
      throw new Error(String(resp.message || JSON.stringify(resp.errors || resp.error || {})).slice(0, 120));
    }
    const rows = Array.isArray(resp.result) ? resp.result : [];
    pages++;
    for (const row of rows) {
      const recordId = Object.keys(row)[0];
      const fields = Array.isArray(row[recordId]) ? row[recordId][0] : row[recordId];
      if (!fields || typeof fields !== 'object') continue;
      // Zoho spells it Employee_ID here, but tenants rename fields; accept the
      // obvious variants rather than silently matching nobody.
      const code = fields.Employee_ID || fields.EmployeeID || fields['Employee ID'] || fields.Employee_Id;
      if (code) byCode.set(String(code).trim(), { recordId, fields });
    }
    if (rows.length < 200) break;
    await breathe(250);
  }
  return { byCode, pages };
}

/* Anything in the record that looks like it points at an image, plus Zoho
 * People's own photo routes for that record. */
/* The Photo field is the route that works on this tenant, and it comes with
 * `fs=thumb` — a thumbnail, around 2KB. Ask for the full-size image first and
 * keep the thumbnail as the fallback, because an avatar that is upscaled later
 * (a profile header, a print) should not be stuck at thumbnail resolution. */
function sizeVariants(url) {
  if (!/[?&]fs=/.test(url)) return [url];
  return [url.replace(/([?&])fs=[^&]*/, '$1fs=originalsize'), url];
}

function candidatesFor(recordId, fields = {}) {
  const out = [];
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === 'string' && /^https?:\/\//.test(v) && /photo|image|picture/i.test(k)) {
      sizeVariants(v).forEach((u, i) => out.push({ name: `field ${k}${i ? ' (thumb)' : ''}`, url: u }));
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

  let roster;
  try {
    roster = await loadZohoRoster();
    console.log(`  Zoho roster           : ${roster.byCode.size} employees over ${roster.pages} page(s)\n`);
  } catch (err) {
    console.error(`  Could not read the Zoho roster: ${err.message}\n`);
    process.exitCode = 1;
    return;
  }

  const matched = rows.filter(r => roster.byCode.has(r.code));
  const missing = rows.filter(r => !roster.byCode.has(r.code));
  console.log(`  matched to a Zoho record: ${matched.length}`);
  if (missing.length) console.log(`  not in Zoho             : ${missing.length}  (${missing.slice(0, 5).map(m => m.code).join(', ')}${missing.length > 5 ? ', …' : ''})`);
  console.log('');

  if (PROBE) {
    if (!matched.length) {
      console.log('  Nobody matched, so the codes in Zoho are spelled differently from ours.');
      console.log(`  A Zoho code looks like: ${[...roster.byCode.keys()].slice(0, 5).join(', ')}\n`);
      return;
    }
    const s = matched[0];
    const { recordId, fields } = roster.byCode.get(s.code);
    console.log(`  Probing with ${s.code} ${s.name}`);
    console.log(`  record id: ${recordId}\n`);

    const photoish = Object.keys(fields).filter(k => /photo|image|picture|avatar/i.test(k));
    console.log('  fields mentioning a photo:');
    if (photoish.length) photoish.forEach(k => console.log(`    ${k} = ${String(fields[k]).slice(0, 100)}`));
    else console.log('    (none — so it must come from one of the routes below)');
    console.log('');

    for (const c of candidatesFor(recordId, fields)) {
      const r = await attempt(c.url, token);
      const verdict = r.kind ? `IMAGE (${r.kind})` : r.status ? 'not an image' : `failed: ${r.error || ''}`;
      console.log(`  ${c.name.padEnd(22)} ${String(r.status).padEnd(4)} ${String(r.type).slice(0, 24).padEnd(26)} ${String(r.bytes).padStart(7)}b  ${verdict}`);
      await breathe();
    }
    console.log('\n  Any line reading IMAGE is a working route. Send this over and I will pin');
    console.log('  the fetch to it; if none work, the photos have to come from a Zoho export.\n');
    return;
  }

  const work = LIMIT ? matched.slice(0, LIMIT) : matched;
  if (!APPLY) {
    console.log('  DRY RUN — nothing is fetched or written. Add --apply to run it.\n');
    work.slice(0, 12).forEach(r => console.log(`    ${r.code.padEnd(14)} ${r.name}`));
    if (work.length > 12) console.log(`    … and ${work.length - 12} more`);
    console.log(`\n  ${work.length} photo(s) would be fetched and stored.\n`);
    return;
  }

  fs.mkdirSync(PHOTO_DIR, { recursive: true });

  /* Fetch everything first, write nothing yet.
   *
   * Zoho hands back a generic avatar for people who never uploaded one, and it
   * answers 200 with a perfectly valid PNG — so "is this an image" cannot tell
   * a face from a placeholder. What does tell them apart is that the
   * placeholder is byte-identical every time. So the bytes are hashed, and any
   * image that turns up for more than one person is treated as the stand-in it
   * is and skipped. Saving it would give a dozen colleagues the same face,
   * which is worse than the silhouette it replaced. */
  const fetched = [];
  let noPhoto = 0;
  const log = [];

  for (const r of work) {
    const { recordId, fields } = roster.byCode.get(r.code);
    let got = null, via = null;
    for (const c of candidatesFor(recordId, fields)) {
      const a = await attempt(c.url, token);
      if (a.kind) { got = a; via = c.name; break; }
    }
    if (got) fetched.push({ r, got, via, hash: crypto.createHash('sha1').update(got.buf).digest('hex') });
    else { noPhoto++; log.push({ code: r.code, outcome: 'no image from any route' }); }
    await breathe();
  }

  const seen = new Map();
  fetched.forEach(f => seen.set(f.hash, (seen.get(f.hash) || 0) + 1));
  const shared = new Set([...seen.entries()].filter(([, n]) => n > 1).map(([h]) => h));

  let saved = 0, placeholder = 0;
  for (const f of fetched) {
    if (shared.has(f.hash)) {
      placeholder++;
      log.push({ code: f.r.code, outcome: 'skipped — same image as other employees (Zoho default avatar)' });
      continue;
    }
    const file = `zoho-${f.r.code}-${Date.now()}.${f.got.kind}`;
    fs.writeFileSync(path.join(PHOTO_DIR, file), f.got.buf);
    await pool.query(`UPDATE employees SET photo_url = $1, updated_at = NOW() WHERE id = $2`,
      [`/uploads/photos/${file}`, f.r.id]);
    log.push({ code: f.r.code, outcome: 'saved', via: f.via, file, bytes: f.got.bytes });
    saved++;
  }

  console.log(`  saved                 ${saved}`);
  console.log(`  default avatar, skipped ${placeholder}`);
  console.log(`  no photo in Zoho      ${noPhoto}`);
  console.log(`  not in Zoho           ${missing.length}\n`);
  if (placeholder) {
    console.log(`  ${placeholder} people share one identical image in Zoho — that is its stand-in`);
    console.log('  avatar, not their face, so they keep the silhouette.\n');
  }
  const out = path.join(__dirname, `photo_fetch_${Date.now()}.json`);
  fs.writeFileSync(out, JSON.stringify(log, null, 2));
  console.log(`  Per-person outcome in ${path.basename(out)}.\n`);
}

main()
  .catch(err => { console.error(`\n  Fatal: ${err.message}\n`); process.exitCode = 1; })
  .finally(() => pool.end());
