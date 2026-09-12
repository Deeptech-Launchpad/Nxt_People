/* ── Bring the employee photos over from Zoho ───────────────────────────────
 *  Every photo_url in this database is a HOTLINK into Zoho's CDN:
 *
 *      https://contacts.zoho.in/file?ID=60014837174&fs=thumb
 *
 *  The migration copied the addresses and never the images. Those URLs need a
 *  Zoho session, which a NxtPeople browser does not have, so every <img> fails
 *  and every avatar in the product falls back to a grey silhouette — the org
 *  chart, the topbar, the directory, all of it.
 *
 *  This downloads each photo through the authenticated Zoho API, stores it the
 *  same way an uploaded photo is stored (uploads/photos, served publicly at
 *  /uploads/photos/<file>), and repoints photo_url at the local copy.
 *
 *  Three modes, and the destructive one is never the default:
 *
 *      node migrate_employee_photos.js --probe          which endpoint works
 *      node migrate_employee_photos.js                  dry run: who would change
 *      node migrate_employee_photos.js --apply          download and write
 *      node migrate_employee_photos.js --apply --limit 5
 *
 *  Start with --probe. Zoho does not document one photo endpoint that is true
 *  for every tenant, so rather than guess and write 148 broken files this
 *  tries the candidates against ONE employee and reports what came back.
 *
 *  Two safeguards worth knowing about:
 *
 *    Nothing is saved unless the bytes really are an image. An expired token
 *    or a login redirect answers 200 with HTML, and writing that to disk would
 *    replace every working avatar with a broken one. The magic bytes are
 *    checked before anything touches the filesystem or the database.
 *
 *    The old value is kept. photo_url only moves to the local path once the
 *    file is on disk, and the Zoho URL is recorded in the run log printed at
 *    the end, so a bad run can be put back.
 * ────────────────────────────────────────────────────────────────────────── */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./db');
const { getAccessToken } = require('./utils/zoho');

const APPLY = process.argv.includes('--apply');
const PROBE = process.argv.includes('--probe');
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  return i > -1 ? Math.max(1, parseInt(process.argv[i + 1], 10) || 0) : 0;
})();

const PHOTO_DIR = path.join(__dirname, 'uploads', 'photos');

/* Real image or a login page? Content-type lies often enough (Zoho answers
 * text/html for an expired session while still saying 200) that the bytes get
 * the final word. */
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

const domain = () => (process.env.ZOHO_API_DOMAIN || '').replace(/\/$/, '');

/* The candidates, cheapest and most likely first. `stored` is the URL already
 * in our own column; the rest are Zoho People's own photo routes, which need
 * the record id rather than the contacts id the stored URL carries. */
function candidatesFor({ storedUrl, recordId, employeeCode }) {
  const out = [];
  if (storedUrl) {
    out.push({ name: 'stored URL + oauth', url: storedUrl, auth: true });
    out.push({ name: 'stored URL, no auth', url: storedUrl, auth: false });
  }
  if (domain() && recordId) {
    out.push({ name: 'people v2 photo',  url: `${domain()}/people/api/v2/employee/${encodeURIComponent(recordId)}/photo`, auth: true });
    out.push({ name: 'people getImage',  url: `${domain()}/people/api/forms/employee/getImage?recordId=${encodeURIComponent(recordId)}&fs=thumb`, auth: true });
  }
  if (domain() && employeeCode) {
    out.push({ name: 'people photo by code', url: `${domain()}/people/api/person/photo?encapiKey=&employeeId=${encodeURIComponent(employeeCode)}`, auth: true });
  }
  return out;
}

async function attempt(c, token) {
  try {
    const r = await fetch(c.url, c.auth ? { headers: { Authorization: `Zoho-oauthtoken ${token}` } } : {});
    const buf = Buffer.from(await r.arrayBuffer());
    return { ok: r.ok, status: r.status, type: r.headers.get('content-type') || '', bytes: buf.length, kind: imageKind(buf), buf };
  } catch (err) {
    return { ok: false, status: 0, type: '', bytes: 0, kind: null, error: err.message };
  }
}

/* Zoho rate-limits the TOKEN endpoint separately from the API and reports it
 * as a 400, not a 429 — so a tight loop looks like a credentials failure. The
 * token is cached on disk between runs; this only spaces out the downloads. */
const breathe = () => new Promise(r => setTimeout(r, 250));

async function main() {
  const rows = (await pool.query(
    `SELECT id, employee_id AS code, first_name AS first, last_name AS last, photo_url AS url
       FROM employees
      WHERE deleted_at IS NULL
        AND photo_url IS NOT NULL AND photo_url <> ''
        AND photo_url NOT LIKE '/uploads/%'
        -- ID=-1 is Zoho's "this person has no photo" sentinel, not an address.
        -- Fetching it returns a placeholder or a 404; either way it is not
        -- their face, so these keep their silhouette.
        AND photo_url NOT LIKE '%ID=-1%'
      ORDER BY employee_id`
  )).rows;

  const local = (await pool.query(
    `SELECT COUNT(*)::int n FROM employees WHERE deleted_at IS NULL AND photo_url LIKE '/uploads/%'`
  )).rows[0].n;

  console.log(`\n  external (Zoho) photo links : ${rows.length}`);
  console.log(`  already stored locally      : ${local}\n`);
  if (!rows.length) { console.log('  Nothing to migrate.\n'); return; }

  let token = null;
  try {
    token = await getAccessToken();
  } catch (err) {
    console.error(`  Cannot reach Zoho: ${err.message}`);
    console.error('  Check ZOHO_* variables in the ROOT .env and that they are listed in docker-compose.\n');
    process.exitCode = 1;
    return;
  }

  if (PROBE) {
    const s = rows[0];
    console.log(`  Probing with ${s.code} ${s.first} ${s.last}`);
    console.log(`  stored: ${s.url}\n`);
    for (const c of candidatesFor({ storedUrl: s.url, recordId: null, employeeCode: s.code })) {
      const r = await attempt(c, token);
      const verdict = r.kind ? `IMAGE (${r.kind})` : r.ok ? 'not an image' : 'failed';
      console.log(`  ${String(c.name).padEnd(22)} ${String(r.status).padEnd(4)} ${String(r.type).slice(0, 28).padEnd(30)} ${String(r.bytes).padStart(7)}b  ${verdict}`);
      await breathe();
    }
    console.log('\n  Any line saying IMAGE is a working route — tell me which and I will');
    console.log('  wire the migration to it. If none work, the photos have to come from');
    console.log('  a Zoho export instead of the API.\n');
    return;
  }

  const work = LIMIT ? rows.slice(0, LIMIT) : rows;
  if (!APPLY) {
    console.log('  DRY RUN — nothing will be downloaded or written. Add --apply to run it.\n');
    work.slice(0, 10).forEach(r => console.log(`    ${r.code.padEnd(14)} ${`${r.first} ${r.last}`.padEnd(28)} ${r.url}`));
    if (work.length > 10) console.log(`    … and ${work.length - 10} more`);
    console.log(`\n  ${work.length} photo(s) would be fetched into uploads/photos and repointed.\n`);
    return;
  }

  fs.mkdirSync(PHOTO_DIR, { recursive: true });
  let saved = 0, failed = 0;
  const log = [];

  for (const r of work) {
    let done = false;
    for (const c of candidatesFor({ storedUrl: r.url, recordId: null, employeeCode: r.code })) {
      const got = await attempt(c, token);
      if (!got.kind) continue;

      const file = `zoho-${r.code}-${Date.now()}.${got.kind}`;
      fs.writeFileSync(path.join(PHOTO_DIR, file), got.buf);
      await pool.query(`UPDATE employees SET photo_url = $1, updated_at = NOW() WHERE id = $2`,
        [`/uploads/photos/${file}`, r.id]);
      log.push({ code: r.code, was: r.url, now: `/uploads/photos/${file}`, via: c.name, bytes: got.bytes });
      saved++; done = true;
      break;
    }
    if (!done) { failed++; log.push({ code: r.code, was: r.url, now: null, via: null }); }
    await breathe();
  }

  console.log(`  saved   ${saved}`);
  console.log(`  failed  ${failed}\n`);
  if (saved) {
    const out = path.join(__dirname, `photo_migration_${Date.now()}.json`);
    fs.writeFileSync(out, JSON.stringify(log, null, 2));
    console.log(`  Every old URL recorded in ${path.basename(out)} — keep it, it is how this run gets undone.\n`);
  }
  if (failed) console.log('  Run with --probe to see what the failing downloads answered.\n');
}

main()
  .catch(err => { console.error(`\n  Fatal: ${err.message}\n`); process.exitCode = 1; })
  .finally(() => pool.end());
