/* ── Whose leave will Zoho actually hand over? ──────────────────────────────
 *  The importer asks for one person's leave by searching the leave form for
 *  their code. For some people Zoho answers that search with HTTP 200 and an
 *  error envelope — no records, no explanation beyond "Error occurred".
 *
 *  Until the guard was added, that refusal read as an empty list, and those
 *  people imported as having taken no leave in four years. Alagulakshmi C:
 *  676 working days, zero leave. The guard now stops the import, but it stops
 *  it on the FIRST refusal, so running the importer tells you about one person
 *  at a time and nothing about the scale.
 *
 *  This asks for everybody, in one pass, and does not stop. For each person:
 *
 *    ok        the search answered — and how many records it holds
 *    REFUSED   Zoho returned an error envelope for this person
 *
 *  Then, for everyone refused, it tries the other way round: read the whole
 *  leave form unfiltered and group the records by employee. If that works, the
 *  refusal is in the SEARCH and not in the records, and the importer has a way
 *  to reach them.
 *
 *  Read-only in both directions. Every Zoho call is a GET, the database
 *  refuses anything that is not a SELECT and proves it on startup, and the
 *  mail transport throws if touched.
 *
 *    docker compose exec backend node check_leave_reads.js
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'silent';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('this script does not send mail'); },
  verify: async () => { throw new Error('this script does not send mail'); },
});

const pool = require('./db');
const { zohoApi } = require('./utils/zoho');

const realQuery = pool.query.bind(pool);
let refusedWrites = 0;
pool.query = (text, params) => {
  const sql = String(typeof text === 'string' ? text : text?.text || '');
  const first = sql.trim().replace(/^\(*\s*/, '').slice(0, 12).toUpperCase();
  if (/^(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|GRANT)/.test(first)) {
    refusedWrites++;
    return Promise.reject(new Error('this script is read-only; that write was refused'));
  }
  return realQuery(text, params);
};

const pad = (s, n) => String(s ?? '').padEnd(n);

// The same envelope rule the importer uses: a 200 carrying no `result` key is
// a refusal, whatever the transport says about it.
const envelopeOf = (json) => {
  const resp = json?.response;
  if (!resp || typeof resp !== 'object' || Array.isArray(resp)) return 'no response object';
  if ('result' in resp) return null;
  if ('errors' in resp || 'error' in resp || 'message' in resp) {
    return String(resp.message || JSON.stringify(resp.error || resp.errors || {})).slice(0, 80);
  }
  return 'no result and no error — Zoho said nothing';
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** One page, retried — a throttle is not an answer. */
async function page(url, tries = 3) {
  for (let i = 1; ; i++) {
    try { return await zohoApi(url); }
    catch (e) { if (i >= tries) throw e; await sleep(1500 * i); }
  }
}

/** Leave for one person, the way the importer asks for it. */
async function searchFor(code) {
  const search = encodeURIComponent(JSON.stringify({
    searchField: 'Employee_ID', searchOperator: 'Contains', searchText: code,
  }));
  let total = 0;
  for (let i = 1; i <= 2000; i += 200) {
    const json = await page(`forms/leave/getRecords?sIndex=${i}&limit=200&searchParams=${search}`);
    const why = envelopeOf(json);
    if (why) return { ok: false, why };
    const rows = json?.response?.result || [];
    if (!Array.isArray(rows) || !rows.length) break;
    total += rows.length;
    if (rows.length < 200) break;
  }
  return { ok: true, total };
}

/** Every leave record in the form, unfiltered, grouped by the employee string. */
async function sweep() {
  const byCode = new Map();
  let read = 0;
  for (let i = 1; i <= 40000; i += 200) {
    const json = await page(`forms/leave/getRecords?sIndex=${i}&limit=200`);
    const why = envelopeOf(json);
    if (why) return { ok: false, why, read };
    const rows = json?.response?.result || [];
    if (!Array.isArray(rows) || !rows.length) break;
    for (const w of rows) {
      const rec = Object.values(w)[0]?.[0];
      if (!rec) continue;
      read++;
      const m = /\b(ANXT\w+)\b/.exec(String(rec.Employee_ID || ''));
      if (m) byCode.set(m[1], (byCode.get(m[1]) || 0) + 1);
    }
    if (rows.length < 200) break;
  }
  return { ok: true, byCode, read };
}

(async () => {
  try {
    await pool.query(`UPDATE settings SET timezone = timezone`);
    console.log('\n  !!  the read-only guard did NOT hold — stopping\n');
    process.exit(1);
  } catch { /* as intended */ }

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  Whose leave will Zoho hand over?   READ ONLY');
  console.log('══════════════════════════════════════════════════════════\n');
  console.log('  ok    a deliberate write attempt was refused\n');

  const people = (await pool.query(
    `SELECT employee_id AS code, TRIM(CONCAT(first_name,' ',last_name)) AS name, status
       FROM employees
      WHERE deleted_at IS NULL AND employee_id ~ '^ANXT'
      ORDER BY employee_id`)).rows;

  console.log(`  ${people.length} employee(s) to ask about.\n`);

  const refused = [];
  const answered = [];
  for (const p of people) {
    let r;
    try { r = await searchFor(p.code); }
    catch (e) { r = { ok: false, why: String(e.message).slice(0, 80) }; }
    if (r.ok) answered.push({ ...p, total: r.total });
    else {
      refused.push({ ...p, why: r.why });
      console.log(`  REFUSED  ${pad(p.code, 14)}${pad(p.name.slice(0, 26), 28)}${r.why}`);
    }
  }

  console.log('');
  console.log(`  ${answered.length} answered, ${refused.length} refused.\n`);

  const zeros = answered.filter(a => a.total === 0);
  if (zeros.length) {
    console.log('──────────────────────────────────────────────────────────');
    console.log(`  ${zeros.length} answered with genuinely no leave`);
    console.log('──────────────────────────────────────────────────────────\n');
    for (const z of zeros) console.log(`    ${pad(z.code, 14)}${pad(z.name.slice(0, 26), 28)}${z.status}`);
    console.log('');
  }

  if (!refused.length) {
    console.log('══════════════════════════════════════════════════════════');
    console.log(`  Nothing was written. ${refusedWrites} write attempt(s) refused.`);
    console.log('══════════════════════════════════════════════════════════\n');
    await pool.end();
    return;
  }

  console.log('──────────────────────────────────────────────────────────');
  console.log('  Can the whole form be read instead of searched?');
  console.log('──────────────────────────────────────────────────────────\n');

  let s;
  try { s = await sweep(); }
  catch (e) { s = { ok: false, why: String(e.message).slice(0, 100), read: 0 }; }

  if (!s.ok) {
    console.log(`  No — the unfiltered read was refused too: ${s.why}`);
    console.log(`  (it had read ${s.read} record(s) before that)\n`);
    console.log('  So these people cannot be reached through this form at all,');
    console.log('  and their leave has to come from somewhere else.\n');
  } else {
    console.log(`  Yes — ${s.read} leave record(s) read without a search filter.\n`);
    console.log(`  ${pad('code', 14)}${pad('who', 28)}records the sweep found`);
    let recoverable = 0;
    for (const r of refused) {
      const n = s.byCode.get(r.code) || 0;
      recoverable += n;
      console.log(`    ${pad(r.code, 14)}${pad(r.name.slice(0, 26), 28)}${n}`);
    }
    console.log('');
    console.log(`  ${recoverable} record(s) are reachable this way that the search refuses.`);
    console.log('  The importer should fall back to the sweep for these people.\n');
  }

  console.log('══════════════════════════════════════════════════════════');
  console.log(`  Nothing was written. ${refusedWrites} write attempt(s) refused`);
  console.log('  (1 of them this script testing its own guard).');
  console.log('══════════════════════════════════════════════════════════\n');

  await pool.end();
})().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
