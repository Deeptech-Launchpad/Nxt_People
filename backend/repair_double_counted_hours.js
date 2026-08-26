/* ── Days charged twice for the same stretch ────────────────────────────────
 *  Re-checking in left check_in at the day's arrival, and check-out then
 *  computed the session as `now - check_in` and ADDED it to the hours already
 *  banked. So the first stretch was charged again on every later check-out:
 *
 *    in 10:00, out 11:00        1h banked, correct
 *    in 11:01, out 12:00        1 + (12:00 - 10:00) = 3h, for two hours worked
 *
 *  The handler is fixed. This repairs what it already wrote, which the fix
 *  cannot: those rows are closed and nothing recomputes them.
 *
 *  Where the true figure comes from:
 *
 *    sessions   attendance_sessions holds one row per stretch, each with its
 *               OWN check_in and check_out. Those timestamps were always
 *               right — only the session_hours written beside them carried the
 *               bad sum — so the day is the sum of the spans.
 *
 *  A row is only repaired when the recomputed figure is LOWER. This bug adds
 *  hours; a day that would gain them is not this bug and is left alone and
 *  reported, because something else is going on there.
 *
 *  The status is recomputed too. A day inflated to 8:39 was very likely
 *  recorded as a full day when five hours were worked, and correcting the
 *  hours while leaving that behind fixes the number nobody reads and leaves
 *  the word everybody does.
 *
 *    docker compose exec backend node repair_double_counted_hours.js
 *    docker compose exec backend node repair_double_counted_hours.js --apply
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
const { classifyDay } = require('./utils/attendanceRule');

const APPLY = process.argv.includes('--apply');
const pad = (s, n) => String(s ?? '').padEnd(n);
/* Round to whole minutes FIRST, then split.
 * Flooring the hours and rounding the remainder separately printed 9.9958
 * hours as "09:60" — not a time, in a report about time being wrong. */
const hhmm = (h) => {
  const total = Math.round(h * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

(async () => {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  Days charged twice for the same stretch — ${APPLY ? 'APPLYING' : 'DRY RUN'}`);
  console.log('══════════════════════════════════════════════════════════\n');

  /* Only days with more than one stretch can have this fault, and only those
   * where every stretch is closed can be recomputed — an open one has no end
   * to measure to. */
  const rows = (await pool.query(
    `SELECT a.id, a.employee_id, a.date::text AS d, a.status,
            a.working_hours::float AS stored, a.late_minutes,
            e.employee_id AS code, TRIM(CONCAT(e.first_name,' ',e.last_name)) AS name,
            s.n_sessions, s.open_sessions, s.true_hours,
            EXTRACT(EPOCH FROM (a.check_out - a.check_in))/3600.0 AS span
       FROM attendance a
       JOIN employees e ON e.id = a.employee_id
       JOIN (SELECT attendance_id,
                    COUNT(*)::int AS n_sessions,
                    COUNT(*) FILTER (WHERE check_out IS NULL)::int AS open_sessions,
                    SUM(EXTRACT(EPOCH FROM (check_out - check_in))/3600.0) AS true_hours
               FROM attendance_sessions GROUP BY attendance_id) s
         ON s.attendance_id = a.id
      WHERE a.check_out IS NOT NULL
        AND s.n_sessions > 1
        AND s.open_sessions = 0
      ORDER BY a.date DESC, e.employee_id`)).rows;

  const inflated = [], odd = [];
  for (const r of rows) {
    const truth = Number(r.true_hours);
    if (!isFinite(truth)) continue;
    const diff = Number(r.stored) - truth;
    if (diff > 0.02) inflated.push({ ...r, truth, diff });
    else if (diff < -0.02) odd.push({ ...r, truth, diff });
  }

  console.log(`  ${rows.length} day(s) had more than one stretch and are fully closed.`);
  console.log(`  ${inflated.length} of them store more hours than the stretches add up to.\n`);

  if (odd.length) {
    console.log(`  ${odd.length} store FEWER hours than their stretches — not this bug,`);
    console.log('  left alone. Something else is happening on these:\n');
    for (const r of odd.slice(0, 10)) {
      console.log(`    ${pad(r.d, 12)}${pad(r.code, 14)}stored ${hhmm(r.stored)}`
        + `   stretches ${hhmm(r.truth)}`);
    }
    console.log('');
  }

  if (!inflated.length) {
    console.log('══════════════════════════════════════════════════════════');
    console.log('  Nothing to repair.');
    console.log('══════════════════════════════════════════════════════════\n');
    await pool.end();
    return;
  }

  // The policy, so the corrected status is decided the same way check-out and
  // the reports decide it, rather than by a fourth opinion living here.
  const cfg = (await pool.query(
    `SELECT attendance_policy_config AS c FROM settings LIMIT 1`)).rows[0]?.c || {};

  console.log(`  ${pad('date', 12)}${pad('who', 20)}${pad('stored', 9)}${pad('really', 9)}`
    + `${pad('lost', 8)}${pad('stretches', 11)}status`);
  console.log('');

  const plan = [];
  for (const r of inflated) {
    const facts = (await pool.query(
      `SELECT COALESCE((SELECT MAX(CASE WHEN l.is_half_day THEN 0.5 ELSE 1 END) FROM leaves l
                 WHERE l.employee_id=$1 AND l.status='approved' AND l.leave_type<>'permission'
                   AND $2::date BETWEEN l.start_date AND l.end_date), 0) AS leave_portion,
              COALESCE((SELECT SUM(COALESCE(l.hours,0)) FROM leaves l
                 WHERE l.employee_id=$1 AND l.status='approved' AND l.leave_type='permission'
                   AND $2::date BETWEEN l.start_date AND l.end_date), 0) AS permission_hours,
              EXISTS (SELECT 1 FROM on_duty_requests o
                 WHERE o.employee_id=$1 AND o.status='approved'
                   AND $2::date BETWEEN o.start_date AND o.end_date) AS on_duty,
              (SELECT EXTRACT(EPOCH FROM (sh.end_time::time - sh.start_time::time))/3600.0
                 FROM employees e LEFT JOIN shifts sh ON sh.id=e.shift_id WHERE e.id=$1) AS shift_hours,
              (SELECT COALESCE(sh.grace_minutes,15)
                 FROM employees e LEFT JOIN shifts sh ON sh.id=e.shift_id WHERE e.id=$1) AS grace`,
      [r.employee_id, r.d])).rows[0];

    const status = classifyDay({
      workedHours: r.truth, hasPunch: true,
      leavePortion: Number(facts.leave_portion) || 0,
      permissionHours: Number(facts.permission_hours) || 0,
      onDuty: facts.on_duty === true,
      lateMinutes: Number(r.late_minutes) || 0,
      graceMinutes: Number(facts.grace) || 0,
      cfg,
      shiftHours: facts.shift_hours == null ? null : Number(facts.shift_hours),
    }).status;

    console.log(`  ${pad(r.d, 12)}${pad(r.name.slice(0, 18), 20)}${pad(hhmm(r.stored), 9)}`
      + `${pad(hhmm(r.truth), 9)}${pad(hhmm(r.diff), 8)}${pad(r.n_sessions, 11)}`
      + `${r.status}${status !== r.status ? ` → ${status}` : ''}`);

    plan.push({ id: r.id, hours: Number(r.truth.toFixed(2)), status, was: r.status });
  }

  const totalLost = inflated.reduce((s, r) => s + r.diff, 0);
  const statusChanges = plan.filter(p => p.status !== p.was).length;
  console.log(`\n  ${hhmm(totalLost)} of hours that were never worked, across ${inflated.length} day(s).`);
  console.log(`  ${statusChanges} day(s) would also be re-labelled.\n`);

  if (!APPLY) {
    console.log('══════════════════════════════════════════════════════════');
    console.log('  Nothing was written. Re-run with --apply.');
    console.log('══════════════════════════════════════════════════════════\n');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const p of plan) {
      // Only ever downward, and only if the row still holds what was read.
      const r = await client.query(
        `UPDATE attendance SET working_hours = $2, status = $3, updated_at = NOW()
          WHERE id = $1 AND working_hours > $2`, [p.id, p.hours, p.status]);
      if (r.rowCount !== 1) throw new Error(`row ${p.id} changed underneath this run`);
    }
    // The per-session figures carried the same bad sum. Put them right too, or
    // the next thing to read them reintroduces the fault.
    const s = await client.query(
      `UPDATE attendance_sessions
          SET session_hours = ROUND((EXTRACT(EPOCH FROM (check_out - check_in))/3600.0)::numeric, 2)
        WHERE attendance_id = ANY($1::uuid[]) AND check_out IS NOT NULL`,
      [plan.map(p => p.id)]);
    await client.query('COMMIT');
    console.log(`  ${plan.length} day(s) repaired, ${s.rowCount} session row(s) recomputed.\n`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.log(`\n  Stopped and rolled back: ${err.message}\n`);
    process.exitCode = 1;
  } finally { client.release(); }

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
