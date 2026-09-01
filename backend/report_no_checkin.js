/* ── Who has not checked in, and on how many days ───────────────────────────
 *  A tally per person over a date range: total days with no check-in, how many
 *  separate stretches, and the longest one.
 *
 *  It does NOT count its own days. It asks the Consecutive Absences report —
 *  the same one the Reports screen draws — for every run of absence with no
 *  minimum, then adds them up. So these figures agree with what the screen
 *  shows, by construction rather than by coincidence. Counting independently
 *  would eventually disagree with the UI, and then neither number is trusted.
 *
 *  What already does not count as an absence, because that report says so:
 *    · weekends and holidays, per the working-day rules
 *    · approved leave of any kind — on leave is not absent
 *    · on-duty days
 *    · days before someone joined or after they left
 *    · today, and anything in the future — nobody has failed to attend until
 *      the day is over
 *    · anyone with attendance_tracked = FALSE — a login that exists, but that
 *      attendance simply does not apply to (the Founder, a Super Admin)
 *
 *  Read-only. Writes nothing, sends no mail.
 *
 *    docker compose exec backend node report_no_checkin.js
 *    docker compose exec backend node report_no_checkin.js --from 2026-07-01
 *    docker compose exec backend node report_no_checkin.js --from 2026-07-01 --csv
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'silent';

const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('this report does not send mail'); },
  verify: async () => { throw new Error('this report does not send mail'); },
});

const jwt = require('jsonwebtoken');
const pool = require('./db');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1] : fallback;
};
const AS_CSV = process.argv.includes('--csv');
const pad = (s, n) => String(s ?? '').padEnd(n);
const lpad = (s, n) => String(s ?? '').padStart(n);

(async () => {
  const today = new Date().toLocaleDateString('en-CA');
  const from = arg('--from', `${today.slice(0, 4)}-07-01`);
  const to = arg('--to', today);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    console.log('\n  Dates must look like 2026-07-01\n');
    await pool.end();
    process.exit(1);
  }

  const actor = (await pool.query(
    `SELECT id, email FROM employees
      WHERE role IN ('admin','director') AND status = 'active' AND deleted_at IS NULL
      ORDER BY CASE WHEN role = 'admin' THEN 0 ELSE 1 END LIMIT 1`)).rows[0];
  if (!actor) { console.log('\n  No admin to run this as.\n'); await pool.end(); return; }

  const token = jwt.sign({ id: actor.id }, process.env.JWT_SECRET, { expiresIn: '10m' });
  const app = require('./app');
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  // minDays=0 means every run, however short — the report's threshold is
  // exclusive, so this is "count > 0".
  const res = await fetch(
    `${base}/api/reports/attendance/consecutive-absences?startDate=${from}&endDate=${to}&minDays=0`,
    { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json();
  server.close();

  if (!res.ok || !body?.success) {
    console.log(`\n  The report refused (${res.status}): ${body?.message || 'no message'}\n`);
    await pool.end();
    process.exit(1);
  }

  const runs = Array.isArray(body.data) ? body.data : (body.data?.rows || []);

  /* Staff whose attendance is marked by hand cannot check in at all, so an
   * absence count for them measures nothing but the marking not being set up.
   * They are listed apart rather than dropped, because a housekeeper with no
   * marked days is still something somebody should see. */
  const manual = new Set((await pool.query(
    `SELECT DISTINCT employee_id FROM manual_attendance_assignments`)).rows.map(r => r.employee_id));

  /* Employee Profiles — Manage Accounts → Users → Employee Profiles — are
   * records rather than people who sign in and punch. Counting their missing
   * check-ins is counting something that was never going to happen. Excluded
   * here by reading the flag directly, rather than trusting the report to have
   * filtered them, because they turned up in it once already.
   *
   * The same applies to anyone marked attendance_tracked = FALSE — a login
   * that exists (the Founder, a Super Admin) but that attendance simply does
   * not apply to. They are on record, not on this list. */
  const profiles = new Map((await pool.query(
    `SELECT id, TRIM(CONCAT(first_name, ' ', COALESCE(last_name, ''))) AS name, employee_id AS code
       FROM employees WHERE deleted_at IS NULL AND (is_user = FALSE OR attendance_tracked = FALSE)`)).rows.map(r => [r.id, r]));

  const byEmployee = new Map();
  for (const r of runs) {
    if (!byEmployee.has(r._id)) {
      byEmployee.set(r._id, {
        id: r._id,
        code: r.employeeCode || '—',
        name: `${r.firstName || ''} ${r.lastName || ''}`.trim(),
        department: r.department || '',
        exitDate: r.exitDate,
        total: 0, stretches: 0, longest: 0, first: null, last: null,
      });
    }
    const e = byEmployee.get(r._id);
    e.total += r.count;
    e.stretches += 1;
    e.longest = Math.max(e.longest, r.count);
    if (!e.first || r.startDate < e.first) e.first = r.startDate;
    if (!e.last || r.endDate > e.last) e.last = r.endDate;
  }

  const everyone = [...byEmployee.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const excluded = everyone.filter(e => profiles.has(e.id));
  const all = everyone.filter(e => !profiles.has(e.id));
  const punching = all.filter(e => !manual.has(e.id));
  const marked = all.filter(e => manual.has(e.id));

  if (AS_CSV) {
    console.log('Employee ID,Name,Department,Days without check-in,Separate stretches,Longest stretch,First,Last,Marked manually');
    for (const e of all) {
      const cell = v => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
      console.log([e.code, e.name, e.department, e.total, e.stretches, e.longest, e.first, e.last,
        manual.has(e.id) ? 'yes' : 'no'].map(cell).join(','));
    }
    await pool.end();
    return;
  }

  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log(`  Days without a check-in — ${from} to ${to}`);
  console.log('══════════════════════════════════════════════════════════════════════\n');
  console.log('  Weekends, holidays, approved leave, on-duty days and today are');
  console.log('  already excluded. These are working days the person simply did not');
  console.log('  attend, as the Consecutive Absences report counts them.\n');

  /* Said out loud, because the failure is silent otherwise: with no active
   * weekend rule every Sunday counts as an absence and these totals are
   * roughly double what they should be, while looking perfectly ordinary. */
  const activeRules = (await pool.query(
    'SELECT count(*)::int AS n FROM weekend_rules WHERE is_active = TRUE')).rows[0].n;
  if (!activeRules) {
    console.log('  !  No weekend rule is switched on, so every day of the week is being');
    console.log('     counted as a working day. Sundays are showing as absences and these');
    console.log('     figures are roughly double. Check Settings -> Attendance -> Weekend');
    console.log('     rules before relying on this.\n');
  }

  const table = (rows) => {
    console.log(`  ${pad('Employee ID', 15)}${pad('Name', 26)}${lpad('Days', 5)}${lpad('Runs', 6)}${lpad('Longest', 9)}   Range`);
    console.log(`  ${'─'.repeat(90)}`);
    for (const e of rows) {
      console.log(`  ${pad(e.code, 15)}${pad(e.name.slice(0, 25), 26)}${lpad(e.total, 5)}${lpad(e.stretches, 6)}${lpad(e.longest, 9)}   ${e.first} → ${e.last}`);
    }
  };

  if (punching.length) {
    table(punching);
    console.log(`  ${'─'.repeat(90)}`);
    console.log(`  ${punching.length} people · ${punching.reduce((n, e) => n + e.total, 0)} days in total\n`);
  } else {
    console.log('  Nobody missed a working day in this range.\n');
  }

  if (marked.length) {
    console.log('  ── Staff whose attendance is marked by hand ─────────────────────────');
    console.log('  They cannot check in, so these counts reflect the marking not being');
    console.log('  done rather than anybody being absent.\n');
    table(marked);
    console.log('');
  }

  const notSetUp = (await pool.query(
    `SELECT count(*)::int AS n FROM employees e
      WHERE e.status = 'active' AND e.deleted_at IS NULL AND e.is_user = TRUE
        AND e.attendance_tracked = TRUE
        AND NOT EXISTS (SELECT 1 FROM manual_attendance_assignments m WHERE m.employee_id = e.id)
        AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.employee_id = e.id AND a.date BETWEEN $1::date AND $2::date)`,
    [from, to])).rows[0].n;
  if (notSetUp) {
    console.log(`  ${notSetUp} active employee(s) have NO attendance row at all in this range.`);
    console.log('  Either they never came in, or they are somebody who does not punch and');
    console.log('  has not been set up on Attendance Marking.\n');
  }

  if (excluded.length) {
    console.log(`  ${excluded.length} left out — an Employee Profile, or attendance not tracked for them:`);
    console.log(`    ${excluded.map(e => `${e.name} (${e.code})`).join(', ')}
`);
  }

  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('  Add --csv to get this as a spreadsheet.');
  console.log('══════════════════════════════════════════════════════════════════════\n');

  await pool.end();
})().catch(async e => { console.error('\n  failed —', e.message, '\n'); try { await pool.end(); } catch {} process.exit(1); });
