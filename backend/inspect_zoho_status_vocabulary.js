#!/usr/bin/env node
/* Every distinct status Zoho uses on an attendance day, how often, and what
 * this system holds for those same days.
 *
 * READ ONLY. Nothing here writes.
 *
 * A day-level diff found Zoho marking days "Client visit" — its on-duty
 * equivalent — where this system has no attendance row at all and therefore
 * counts an absence. zoho_survey.js had already reported on-duty as "table
 * exists, nothing reads Zoho", so these days were never going to arrive.
 *
 * Before deciding what to import, this asks what the full vocabulary
 * actually is: statuses this system has no equivalent for are the work,
 * and guessing at them from two examples is how the last three rounds of
 * this went wrong.
 *
 *   node inspect_zoho_status_vocabulary.js 2026-01-01 2026-09-07
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('this script does not send mail'); },
  verify: async () => { throw new Error('this script does not send mail'); },
});

const pool = require('./db');
const { zohoApi } = require('./utils/zoho');

const START = process.argv[2];
const END = process.argv[3];
if (!/^\d{4}-\d{2}-\d{2}$/.test(START || '') || !/^\d{4}-\d{2}-\d{2}$/.test(END || '')) {
  console.log('\n  usage: node inspect_zoho_status_vocabulary.js <START> <END>\n');
  process.exit(1);
}

const zohoDMY = iso => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
const notDash = v => (v === '-' || v === '' || v === null || v === undefined) ? null : v;

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function patiently(fn) {
  let last;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try { return await fn(); }
    catch (err) {
      last = err;
      const code = (String(err.message).match(/\((\d{3})\)/) || [])[1];
      if (code !== '429' && code !== '503' && code !== '502') throw err;
      await sleep(attempt * 5000);
    }
  }
  throw last;
}

(async () => {
  console.log(`\n=== Zoho attendance status vocabulary, ${START} to ${END} ===\n`);

  const emps = (await pool.query(
    `SELECT id, employee_id AS code, TRIM(CONCAT(first_name,' ',last_name)) AS name,
            date_of_joining::text AS joined, exit_date::text AS exited
       FROM employees WHERE employee_id ~ '^ANXT' AND status = 'active' ORDER BY employee_id`)).rows;
  console.log(`Checking ${emps.length} active employee(s), one Zoho call each...\n`);

  // status -> { days, noRowHere, withPunch, sample: [{code, date}] }
  const vocab = new Map();
  let checked = 0;

  for (const emp of emps) {
    checked++;
    if (checked % 20 === 0) console.log(`  ...${checked}/${emps.length}`);

    let zohoAtt;
    try {
      const json = await patiently(() => zohoApi(
        `attendance/getUserReport?empId=${encodeURIComponent(emp.code)}`
        + `&sdate=${encodeURIComponent(zohoDMY(START))}&edate=${encodeURIComponent(zohoDMY(END))}`
        + `&dateFormat=dd-MM-yyyy`));
      zohoAtt = json?.response?.result ?? json?.response ?? json;
    } catch { continue; }
    if (!zohoAtt || typeof zohoAtt !== 'object' || 'error' in zohoAtt || 'errors' in zohoAtt) continue;

    const hereDates = new Set((await pool.query(
      `SELECT date::text AS date FROM attendance
        WHERE employee_id = $1 AND date BETWEEN $2::date AND $3::date`,
      [emp.id, START, END])).rows.map(r => r.date));

    for (const [iso, rec] of Object.entries(zohoAtt)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || iso < START || iso > END) continue;
      if (emp.joined && iso < emp.joined) continue;
      if (emp.exited && iso > emp.exited) continue;

      const status = String(rec.Status ?? '').trim() || '(empty)';
      if (!vocab.has(status)) vocab.set(status, { days: 0, noRowHere: 0, withPunch: 0, sample: [] });
      const v = vocab.get(status);
      v.days++;
      if (notDash(rec.FirstIn)) v.withPunch++;
      if (!hereDates.has(iso)) {
        v.noRowHere++;
        if (v.sample.length < 3) v.sample.push(`${emp.code} ${iso}`);
      }
    }
  }

  const rows = [...vocab.entries()].sort((a, b) => b[1].days - a[1].days);
  console.log(`\n${'status'.padEnd(46)}${'days'.padEnd(8)}${'no row here'.padEnd(13)}with punch`);
  console.log('─'.repeat(84));
  for (const [status, v] of rows) {
    console.log(`${status.slice(0, 45).padEnd(46)}${String(v.days).padEnd(8)}${String(v.noRowHere).padEnd(13)}${v.withPunch}`);
  }

  console.log('\n\nStatuses with days that have NO attendance row here — these count as absence:\n');
  for (const [status, v] of rows) {
    if (!v.noRowHere) continue;
    console.log(`  ${status}`);
    console.log(`      ${v.noRowHere} day(s) with no row here, e.g. ${v.sample.join(', ')}\n`);
  }

  await pool.end();
})().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
