/* ── Does the Loss of Pay agree with the attendance beside it? ──────────────
 *  A hundred and fifteen leave records went in as unpaid because Zoho gave
 *  them no type at all. Unpaid is Loss of Pay, so if any of those were really
 *  paid leave whose type Zoho later deleted, somebody loses a day's money for
 *  a day they were entitled to.
 *
 *  The attendance row for the same date is the corroboration:
 *
 *    the day says ABSENT           consistent — they were not here and were
 *                                  not paid for it
 *    the day says PRESENT or LATE  a contradiction. They worked, and there is
 *                                  a Loss of Pay record against the same day
 *    no attendance row at all      nothing to check it against
 *
 *  Read-only, and it names the days rather than counting them, because the
 *  question this answers is "which ones" and not "how many".
 *
 *    docker compose exec backend node check_unpaid_leave.js 2022-01-01 2026-08-31
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
const realQuery = pool.query.bind(pool);
let refused = 0;
pool.query = (text, params) => {
  const sql = String(typeof text === 'string' ? text : text?.text || '');
  const first = sql.trim().replace(/^\(*\s*/, '').slice(0, 12).toUpperCase();
  if (/^(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|GRANT)/.test(first)) {
    refused++;
    return Promise.reject(new Error('this script is read-only; that write was refused'));
  }
  return realQuery(text, params);
};

const START = process.argv[2] || '2022-01-01';
const END = process.argv[3] || '2026-12-31';
const pad = (s, n) => String(s ?? '').padEnd(n);

(async () => {
  try {
    await pool.query(`UPDATE settings SET timezone = timezone`);
    console.log('\n  !!  the read-only guard did NOT hold — stopping\n');
    process.exit(1);
  } catch { /* as intended */ }

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  Loss of Pay against the attendance for the same day');
  console.log(`  ${START} to ${END}   READ ONLY`);
  console.log('══════════════════════════════════════════════════════════\n');
  console.log('  ok    a deliberate write attempt was refused\n');

  /* Every unpaid leave day, with what the attendance row for that day says.
   * A multi-day record is expanded, because a two-day Loss of Pay covering one
   * worked day and one absent day is exactly the case a per-record count would
   * hide. */
  const rows = (await pool.query(
    `SELECT e.employee_id AS code,
            TRIM(CONCAT(e.first_name,' ',e.last_name)) AS name,
            d::date::text AS day,
            l.total_days, l.is_half_day, l.reason, l.status AS leave_status,
            a.status AS att_status,
            a.working_hours::float AS hours
       FROM leaves l
       JOIN employees e ON e.id = l.employee_id
       CROSS JOIN LATERAL generate_series(l.start_date, l.end_date, INTERVAL '1 day') AS d
       LEFT JOIN attendance a
              ON a.employee_id = l.employee_id AND a.date = d::date
      WHERE l.leave_type = 'unpaid'
        AND l.status = 'approved'
        AND l.start_date BETWEEN $1::date AND $2::date
      ORDER BY e.employee_id, d`, [START, END])).rows;

  /* A HALF day of Loss of Pay against a day the attendance calls a half day is
   * not a contradiction — it is the two halves of one day agreeing with each
   * other. The first version of this check counted those as "worked while on
   * LOP" and reported forty-two problems where about a dozen were real. The
   * reasons on them said so plainly: "Went to Family Function", four to seven
   * hours worked. Half the day off, half the day in.
   *
   * What remains a contradiction is a FULL day of Loss of Pay against a day
   * they were here for full hours. */
  const halfAgainstHalf = r => r.is_half_day === true && r.att_status === 'half-day';
  const consistentHalf = rows.filter(halfAgainstHalf);
  const worked = rows.filter(r =>
    ['present', 'late', 'half-day'].includes(r.att_status) && !halfAgainstHalf(r));
  const absent = rows.filter(r => r.att_status === 'absent');
  const noRow = rows.filter(r => !r.att_status);
  const other = rows.filter(r =>
    r.att_status && !['present', 'late', 'half-day', 'absent'].includes(r.att_status));

  console.log(`  ${rows.length} day(s) covered by an approved Loss of Pay record.\n`);
  console.log(`    ${pad(absent.length, 6)}the attendance also says absent — consistent`);
  console.log(`    ${pad(consistentHalf.length, 6)}half a day of LOP against a half day worked — consistent`);
  console.log(`    ${pad(noRow.length, 6)}no attendance row — nothing to check against`);
  console.log(`    ${pad(other.length, 6)}some other status`);
  console.log(`    ${pad(worked.length, 6)}the attendance says they WORKED`
    + `${worked.length ? '   ← look at these' : ''}\n`);

  if (worked.length) {
    console.log('──────────────────────────────────────────────────────────');
    console.log('  Loss of Pay on a day the attendance says was worked');
    console.log('──────────────────────────────────────────────────────────\n');
    console.log('  Either the leave record is wrong, or the attendance is. One of');
    console.log('  the two is costing somebody a day of pay for a day they were here.');
    console.log('  Half-day LOP beside a half day worked is NOT listed here — that');
    console.log('  pair agrees with itself.\n');
    console.log(`  ${pad('code', 14)}${pad('who', 24)}${pad('day', 12)}`
      + `${pad('attendance', 12)}${pad('hours', 8)}reason`);
    for (const r of worked.slice(0, 60)) {
      console.log(`  ${pad(r.code, 14)}${pad(r.name.slice(0, 22), 24)}${pad(r.day, 12)}`
        + `${pad(r.att_status, 12)}${pad(Number(r.hours).toFixed(2), 8)}`
        + `${String(r.reason || '').slice(0, 40)}`);
    }
    if (worked.length > 60) console.log(`  … and ${worked.length - 60} more`);
    console.log('');
  }

  // Who carries the most of it — a company-wide count says nothing about
  // whether it is spread evenly or sitting on three people.
  const byPerson = new Map();
  for (const r of rows) {
    const k = `${r.code}|${r.name}`;
    byPerson.set(k, (byPerson.get(k) || 0) + 1);
  }
  const worst = [...byPerson].sort((a, b) => b[1] - a[1]).slice(0, 12);
  if (worst.length) {
    console.log('──────────────────────────────────────────────────────────');
    console.log('  Most Loss of Pay days');
    console.log('──────────────────────────────────────────────────────────\n');
    for (const [k, n] of worst) {
      const [code, name] = k.split('|');
      console.log(`    ${pad(code, 14)}${pad(name.slice(0, 24), 26)}${n} day(s)`);
    }
    console.log('');
  }

  console.log('══════════════════════════════════════════════════════════');
  console.log(`  Nothing was written. ${refused} write attempt(s) refused`);
  console.log('  (1 of them this script testing its own guard).');
  console.log('══════════════════════════════════════════════════════════\n');

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
