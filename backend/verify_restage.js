/* ── Read back what the restage wrote ───────────────────────────────────────
 *  The import reported success, which only means the INSERTs did not error.
 *  What matters is whether a day reads back as the day Zoho described, and the
 *  one thing that could still be wrong end to end is the clock: check_in holds
 *  a UTC wall time, and every report renders it through
 *  AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata'. If the conversion on the way
 *  in were wrong, the numbers would still look plausible — just five and a half
 *  hours out, and nobody notices a 3 AM start until payroll.
 *
 *  So this renders the stored rows exactly as the reports do, and checks the
 *  arithmetic holds: check-out minus check-in against the hours on the row.
 *
 *  Read-only. Every statement is a SELECT and the guard proves it on startup.
 *
 *    docker compose exec backend node verify_restage.js ANXT2600149 2026-01-01 2026-08-31
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('verify_restage.js does not send mail'); },
  verify: async () => { throw new Error('verify_restage.js does not send mail'); },
});

const pool = require('./db');
const realQuery = pool.query.bind(pool);
let refused = 0;
pool.query = (text, params) => {
  const sql = String(typeof text === 'string' ? text : text?.text || '');
  const first = sql.trim().replace(/^\(*\s*/, '').slice(0, 12).toUpperCase();
  if (/^(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|GRANT)/.test(first)) {
    refused++;
    return Promise.reject(new Error('verify_restage.js is read-only; this write was refused'));
  }
  return realQuery(text, params);
};

const CODES = String(process.argv[2] || '').split(/[,\s]+/).filter(Boolean);
const START = process.argv[3];
const END = process.argv[4];
const TZ = 'Asia/Kolkata';

const pad = (s, n) => String(s ?? '-').padEnd(n);

(async () => {
  if (!CODES.length || !START || !END) {
    console.log('\n  usage: node verify_restage.js <CODE[,CODE...]> <START> <END>\n');
    process.exit(1);
  }

  try {
    await pool.query(`UPDATE settings SET timezone = timezone`);
    console.log('\n  !!  the read-only guard did NOT hold — stopping\n');
    process.exit(1);
  } catch { /* as intended */ }

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  What is actually in the database now — READ ONLY');
  console.log(`  ${CODES.join(', ')}   ${START} to ${END}`);
  console.log('══════════════════════════════════════════════════════════\n');
  console.log('  ok    a deliberate write attempt was refused\n');

  let problems = 0;

  for (const code of CODES) {
    const emp = (await pool.query(
      `SELECT id, TRIM(CONCAT(first_name,' ',last_name)) AS name
         FROM employees WHERE employee_id = $1 AND deleted_at IS NULL`, [code])).rows[0];
    if (!emp) { console.log(`  ${code} is not here.\n`); continue; }

    console.log('──────────────────────────────────────────────────────────');
    console.log(`  ${emp.name}   ${code}`);
    console.log('──────────────────────────────────────────────────────────\n');

    const byStatus = (await pool.query(
      `SELECT status, COUNT(*)::int n FROM attendance
        WHERE employee_id = $1 AND date BETWEEN $2::date AND $3::date
        GROUP BY status ORDER BY n DESC`, [emp.id, START, END])).rows;
    console.log('    attendance by status:\n');
    for (const r of byStatus) console.log(`      ${pad(r.status, 14)}${r.n}`);

    const leave = (await pool.query(
      `SELECT leave_type, status, COUNT(*)::int n,
              COUNT(*) FILTER (WHERE is_half_day)::int halves
         FROM leaves WHERE employee_id = $1 AND start_date BETWEEN $2::date AND $3::date
        GROUP BY leave_type, status ORDER BY n DESC`, [emp.id, START, END])).rows;
    console.log('\n    leave:\n');
    for (const r of leave) {
      console.log(`      ${pad(r.leave_type, 14)}${pad(r.status, 12)}${r.n}`
        + `${r.halves ? `   (${r.halves} half day)` : ''}`);
    }

    // Rendered the way every report renders it. A wrong conversion on the way
    // in shows up here as a working day that starts before dawn.
    const sample = (await pool.query(
      `SELECT date::text AS d, status, working_hours AS hours, late_minutes AS late,
              to_char(check_in  AT TIME ZONE 'UTC' AT TIME ZONE $4, 'HH24:MI') AS in_ist,
              to_char(check_out AT TIME ZONE 'UTC' AT TIME ZONE $4, 'HH24:MI') AS out_ist
         FROM attendance
        WHERE employee_id = $1 AND date BETWEEN $2::date AND $3::date AND check_in IS NOT NULL
        ORDER BY date LIMIT 8`, [emp.id, START, END, TZ])).rows;
    console.log('\n    as the reports will show them, in local time:\n');
    for (const r of sample) {
      console.log(`      ${r.d}   in ${pad(r.in_ist, 8)}out ${pad(r.out_ist, 8)}`
        + `${pad(Number(r.hours).toFixed(2) + 'h', 9)}${pad(r.status, 10)}late ${r.late} min`);
    }

    // Nobody starts work at 3 AM. If the timezone conversion had been skipped,
    // every one of these would sit in the small hours and still look tidy.
    const odd = (await pool.query(
      `SELECT COUNT(*)::int n FROM attendance
        WHERE employee_id = $1 AND date BETWEEN $2::date AND $3::date
          AND check_in IS NOT NULL
          AND EXTRACT(HOUR FROM (check_in AT TIME ZONE 'UTC' AT TIME ZONE $4)) < 5`,
      [emp.id, START, END, TZ])).rows[0].n;
    console.log(`\n    days starting before 5 AM local: ${odd}`
      + `${odd ? '   ← the timezone conversion is wrong' : '   (as expected)'}`);
    if (odd) problems++;

    /* check-out minus check-in against the hours on the row — but the two
     * directions mean completely different things, and treating them alike
     * reported five perfectly good days as faults.
     *
     * Zoho's TotalHours sums EACH in/out pair, so a lunch break is excluded.
     * check_in and check_out hold only the first and the last. So on any day
     * somebody punched out mid-day, the span is legitimately LONGER than the
     * hours worked, and the hours are the truer figure — which is also what
     * this org's policy asks for (calculateHoursFrom 'every', and reports.js
     * reads working_hours directly in that mode).
     *
     * Stored longer than the span is the impossible one: nobody works more
     * hours than elapsed between arriving and leaving. */
    const rows = (await pool.query(
      `SELECT date::text AS d, working_hours AS stored,
              ROUND(EXTRACT(EPOCH FROM (check_out - check_in))/3600.0, 2) AS spanned
         FROM attendance
        WHERE employee_id = $1 AND date BETWEEN $2::date AND $3::date
          AND check_in IS NOT NULL AND check_out IS NOT NULL
          AND ABS(EXTRACT(EPOCH FROM (check_out - check_in))/3600.0 - working_hours) > 0.02
        ORDER BY date`, [emp.id, START, END])).rows;
    const impossible = rows.filter(r => Number(r.stored) > Number(r.spanned));
    const breaks = rows.filter(r => Number(r.stored) <= Number(r.spanned));

    console.log(`    rows claiming more hours than the day is long: ${impossible.length}`
      + `${impossible.length ? '   ← these cannot be right' : '   (as expected)'}`);
    for (const r of impossible.slice(0, 10)) {
      console.log(`      ${r.d}   stored ${r.stored}h   punches span only ${r.spanned}h`);
    }
    if (impossible.length) problems++;

    if (breaks.length) {
      console.log(`    rows where the day spans longer than the hours worked: ${breaks.length}`);
      console.log('      (mid-day punch-outs — the gap is a break, and the hours are right)');
      for (const r of breaks.slice(0, 5)) {
        console.log(`      ${r.d}   worked ${r.stored}h   present ${r.spanned}h`);
      }
      // Only the first and last punch were imported, so a switch to
      // 'first_last' would recompute these days from a span that includes the
      // break and hand back hours nobody worked.
      console.log('      NOTE: switching the policy to first_last would count'
        + ' those breaks as worked time.');
    }

    const nulls = (await pool.query(
      `SELECT COUNT(*)::int n FROM attendance
        WHERE employee_id = $1 AND date BETWEEN $2::date AND $3::date
          AND (working_hours IS NULL OR status IS NULL)`, [emp.id, START, END])).rows[0].n;
    console.log(`    rows with no hours or no status: ${nulls}${nulls ? '' : '   (as expected)'}\n`);
    if (nulls) problems++;
  }

  console.log('══════════════════════════════════════════════════════════');
  console.log(problems
    ? `  ${problems} thing(s) above need looking at.`
    : '  Everything reads back as it should.');
  console.log(`  Nothing was written. ${refused} write attempt(s) refused`);
  console.log('  (1 of them this script testing its own guard).');
  console.log('══════════════════════════════════════════════════════════\n');

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
