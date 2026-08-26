/* ── What a bulk restage would actually do ──────────────────────────────────
 *  Balaji and Shivanie were done one pair at a time, with a dry run read by a
 *  person before each apply. That does not scale to a whole company, and the
 *  answer is not to stop looking — it is to look at everybody at once, before
 *  anything is written.
 *
 *  So this asks, for every employee it is given:
 *
 *    does Zoho have them at all, under the same code
 *    does their attendance answer, and how many days does it hold
 *    how much leave is there
 *    what does this system hold for them now, which is what a restage DELETES
 *
 *  and then totals it, so the size of the operation is a number somebody can
 *  agree to rather than a guess.
 *
 *  Read-only in both directions. Every Zoho call is a GET, the database refuses
 *  anything that is not a SELECT and proves it on startup, and the mail
 *  transport throws if touched.
 *
 *  It is deliberately unhurried — a short pause between people — because a few
 *  hundred calls fired as fast as possible is how an account gets throttled
 *  halfway through and the report comes back half true.
 *
 *    docker compose exec backend node zoho_preflight.js 2026-01-01 2026-08-31
 *    docker compose exec backend node zoho_preflight.js 2026-01-01 2026-08-31 --all
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'silent';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('zoho_preflight.js does not send mail'); },
  verify: async () => { throw new Error('zoho_preflight.js does not send mail'); },
});

const pool = require('./db');
const realQuery = pool.query.bind(pool);
let refused = 0;
pool.query = (text, params) => {
  const sql = String(typeof text === 'string' ? text : text?.text || '');
  const first = sql.trim().replace(/^\(*\s*/, '').slice(0, 12).toUpperCase();
  if (/^(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|GRANT)/.test(first)) {
    refused++;
    return Promise.reject(new Error('zoho_preflight.js is read-only; that write was refused'));
  }
  return realQuery(text, params);
};

const { zohoApi } = require('./utils/zoho');

const START = process.argv[2];
const END = process.argv[3];
const ALL = process.argv.includes('--all');

const pad = (s, n) => String(s ?? '').padEnd(n);
const lpad = (s, n) => String(s ?? '').padStart(n);
const zohoDMY = iso => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const fromZohoDate = (s) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(s || ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

/* Zoho throttles. A 429 partway through a few hundred calls would otherwise
 * turn into "this person has no attendance", which is the most dangerous
 * possible wrong answer here — it reads as nothing to import rather than as a
 * failure to ask. */
async function patiently(fn, label) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { return { ok: true, value: await fn() }; }
    catch (err) {
      const msg = String(err.message);
      const code = (msg.match(/\((\d{3})\)/) || [])[1];
      if (code === '429' || code === '503') { await sleep(attempt * 4000); continue; }
      return { ok: false, code: code || '?', why: msg.slice(0, 90) };
    }
  }
  return { ok: false, code: '429', why: 'still throttled after three tries' };
}

const attendanceOf = (code) => patiently(async () => {
  const json = await zohoApi(
    `attendance/getUserReport?empId=${encodeURIComponent(code)}`
    + `&sdate=${encodeURIComponent(zohoDMY(START))}&edate=${encodeURIComponent(zohoDMY(END))}`
    + `&dateFormat=dd-MM-yyyy`);
  const body = json?.response?.result ?? json?.response ?? json;
  if (!body || typeof body !== 'object' || 'error' in body || 'errors' in body) throw new Error('(200) error envelope');
  const days = Object.entries(body).filter(([k]) => /^\d{4}-\d{2}-\d{2}$/.test(k));
  const punched = days.filter(([, v]) => v?.FirstIn && v.FirstIn !== '-').length;
  const absent = days.filter(([, v]) => !(v?.FirstIn && v.FirstIn !== '-')
    && /\babsent\b/i.test(String(v?.Status ?? ''))).length;
  return { days: days.length, punched, absent };
}, `attendance ${code}`);

const leaveOf = (code) => patiently(async () => {
  const search = encodeURIComponent(JSON.stringify({
    searchField: 'Employee_ID', searchOperator: 'Contains', searchText: code,
  }));
  const out = [];
  for (let i = 1; i <= 1000; i += 200) {
    const json = await zohoApi(`forms/leave/getRecords?sIndex=${i}&limit=200&searchParams=${search}`);
    const rows = json?.response?.result;
    if (!Array.isArray(rows) || !rows.length) break;
    for (const w of rows) { const r = Object.values(w)[0]?.[0]; if (r) out.push(r); }
    if (rows.length < 200) break;
  }
  /* Zoho's only search operator here is Contains, and Employee_ID reads
   * "Balaji D ANXT2600149" — so a short code matches as a substring of longer
   * ones. The employee whose code is "1" came back with sixty-six leave
   * records belonging to other people. Match the code as a whole word in the
   * field, which is how it is actually written. */
  return out.filter(r => {
    const f = fromZohoDate(r.From);
    if (!f || f < START || f > END) return false;
    return String(r.Employee_ID ?? '').split(/\s+/).includes(code);
  }).length;
}, `leave ${code}`);

(async () => {
  if (!START || !END) {
    console.log('\n  usage: node zoho_preflight.js <START> <END> [--all]\n');
    console.log('  Only active employees by default. --all includes everybody.\n');
    process.exit(1);
  }
  for (const [label, v] of [['start', START], ['end', END]]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      console.log(`\n  The ${label} date "${v}" is not a full date (YYYY-MM-DD).\n`);
      process.exit(1);
    }
  }

  try {
    await pool.query(`UPDATE settings SET timezone = timezone`);
    console.log('\n  !!  the read-only guard did NOT hold — stopping\n');
    process.exit(1);
  } catch { /* as intended */ }

  const people = (await pool.query(
    `SELECT id, employee_id AS code, TRIM(CONCAT(first_name,' ',last_name)) AS name,
            status, joining_date::date::text AS joined, exit_date::date::text AS exited
       FROM employees
      WHERE deleted_at IS NULL
        AND COALESCE(employment_type, '') <> 'Employee Profile'
        ${ALL ? '' : "AND status = 'active'"}
      ORDER BY employee_id`)).rows;

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  What a bulk restage would do — READ ONLY, nothing written');
  console.log(`  ${people.length} ${ALL ? 'employee(s)' : 'ACTIVE employee(s)'}   ${START} to ${END}`);
  console.log('══════════════════════════════════════════════════════════\n');
  console.log('  ok    a deliberate write attempt was refused');
  console.log(`  This makes about ${people.length * 2} calls to Zoho and pauses between`);
  console.log('  people, so it takes a few minutes. That is deliberate.\n');

  console.log(`  ${pad('code', 14)}${pad('who', 22)}${lpad('zoho days', 10)}${lpad('punched', 9)}`
    + `${lpad('leave', 7)}${lpad('here now', 10)}   note`);
  console.log('');

  const rows = [];
  for (const p of people) {
    const att = await attendanceOf(p.code);
    await sleep(250);
    const lv = await leaveOf(p.code);
    await sleep(250);

    const here = (await pool.query(
      `SELECT COUNT(*)::int n FROM attendance
        WHERE employee_id = $1 AND date BETWEEN $2::date AND $3::date`,
      [p.id, START, END])).rows[0].n;
    const hereLeave = (await pool.query(
      `SELECT COUNT(*)::int n FROM leaves
        WHERE employee_id = $1 AND start_date BETWEEN $2::date AND $3::date`,
      [p.id, START, END])).rows[0].n;

    const note = !att.ok
      ? (att.code === '429' ? 'THROTTLED — rerun' : `no attendance (${att.code})`)
      : att.value.punched === 0 ? 'nothing to import' : '';

    console.log(`  ${pad(p.code, 14)}${pad(p.name.slice(0, 20), 22)}`
      + `${lpad(att.ok ? att.value.days : '—', 10)}${lpad(att.ok ? att.value.punched : '—', 9)}`
      + `${lpad(lv.ok ? lv.value : '—', 7)}${lpad(here, 10)}   ${note}`);

    rows.push({ ...p, att, lv, here, hereLeave });
  }

  // ── The totals somebody has to agree to ──────────────────────────────────
  const found = rows.filter(r => r.att.ok);
  const missing = rows.filter(r => !r.att.ok && r.att.code !== '429');
  const throttled = rows.filter(r => !r.att.ok && r.att.code === '429');
  const empty = found.filter(r => r.att.value.punched === 0);
  const wouldImport = found.reduce((s, r) => s + r.att.value.punched + r.att.value.absent, 0);
  const wouldDelete = rows.reduce((s, r) => s + r.here, 0);
  const leaveIn = rows.reduce((s, r) => s + (r.lv.ok ? r.lv.value : 0), 0);
  const leaveOut = rows.reduce((s, r) => s + r.hereLeave, 0);

  console.log('\n──────────────────────────────────────────────────────────');
  console.log('  Totals');
  console.log('──────────────────────────────────────────────────────────\n');
  console.log(`    people asked about            ${people.length}`);
  console.log(`    Zoho answered for             ${found.length}`);
  console.log(`    Zoho has no attendance for    ${missing.length}`);
  if (throttled.length) console.log(`    throttled, unknown            ${throttled.length}   ← rerun before deciding`);
  console.log(`    answered but nothing to take  ${empty.length}\n`);
  console.log(`    attendance rows to be DELETED ${wouldDelete}`);
  console.log(`    attendance days to be created ${wouldImport}`);
  console.log(`    leave records to be DELETED   ${leaveOut}`);
  console.log(`    leave records to be created   ${leaveIn}\n`);

  if (missing.length) {
    console.log('  Zoho has no attendance for these. A restage would delete what this');
    console.log('  system holds for them and import nothing, so they must be excluded:\n');
    for (const r of missing.slice(0, 40)) {
      console.log(`    ${pad(r.code, 14)}${pad(r.name.slice(0, 24), 26)}`
        + `${lpad(r.here, 5)} row(s) here   ${r.att.why || ''}`.slice(0, 80));
    }
    if (missing.length > 40) console.log(`    … and ${missing.length - 40} more`);
    console.log('');
  }

  if (throttled.length) {
    console.log('  Zoho throttled these and the answer is unknown — NOT the same as');
    console.log('  "no data". Re-run before deciding anything about them.\n');
  }

  const ready = found.filter(r => r.att.value.punched > 0).map(r => r.code);
  console.log('──────────────────────────────────────────────────────────');
  console.log(`  ${ready.length} employee(s) have data and are safe to restage`);
  console.log('──────────────────────────────────────────────────────────\n');
  console.log(`  ${ready.join(',')}\n`);

  console.log('══════════════════════════════════════════════════════════');
  console.log(`  Nothing was written. ${refused} write attempt(s) refused`);
  console.log('  (1 of them this script testing its own guard).');
  console.log('══════════════════════════════════════════════════════════\n');

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
