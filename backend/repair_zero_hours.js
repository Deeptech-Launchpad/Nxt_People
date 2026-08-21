/* ── Days somebody worked that are recorded as zero hours ──────────────────
 *  A chain of two things put these here.
 *
 *  The nightly job at server.js:485 closes off any past day with a check-in and
 *  no check-out: status 'absent', working_hours 0. That is deliberate — a
 *  forgotten check-out is not a worked day until somebody says what happened.
 *
 *  Then a regularization was approved, which wrote the check-out. It should
 *  have written the hours with it, and did not: `${reg.date}` renders a JS Date
 *  as "Mon Jul 20 2026 00:00:00 GMT+0530 (India Standard Time)", so building a
 *  time from it produced Invalid Date and every figure came out NaN. That bug
 *  is fixed; these are the rows it already wrote.
 *
 *  The evidence, in the order it is trusted:
 *
 *    Sessions, when the day has them — the sum of what was actually recorded.
 *    An approved regularization, otherwise — the hours the employee claimed
 *    and an approver accepted, which is a stated figure rather than a guess.
 *
 *  The punch span is deliberately NOT used. It includes lunch, and on a day
 *  from before session recording there is no way to tell a break from work.
 *  Paying somebody for their lunch break is not a repair.
 *
 *    docker compose exec backend node repair_zero_hours.js
 *    docker compose exec backend node repair_zero_hours.js --apply
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();

const pool = require('./db');
const APPLY = process.argv.includes('--apply');
const TZ = 'Asia/Kolkata';

const pad = (s, n) => String(s).padEnd(n);
const h2 = n => `${Number(n).toFixed(2)}h`;

(async () => {
  console.log(`\n  Worked days stored as zero hours — ${APPLY ? 'APPLYING' : 'DRY RUN, nothing will be written'}\n`);

  const { rows } = await pool.query(`
    SELECT a.id, a.date::text AS d, a.status,
           e.employee_id AS code,
           TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS name,
           to_char(a.check_in  AT TIME ZONE 'UTC' AT TIME ZONE $1, 'HH24:MI') AS ci,
           to_char(a.check_out AT TIME ZONE 'UTC' AT TIME ZONE $1, 'HH24:MI') AS co,
           ROUND(EXTRACT(EPOCH FROM (a.check_out - a.check_in))/3600.0, 4) AS span,
           (SELECT ROUND(SUM(s.session_hours)::numeric, 8) FROM attendance_sessions s
             WHERE s.employee_id = a.employee_id AND s.date = a.date
               AND s.session_hours IS NOT NULL) AS session_hours,
           (SELECT COUNT(*) FROM attendance_sessions s
             WHERE s.employee_id = a.employee_id AND s.date = a.date) AS session_count,
           (SELECT ROUND(EXTRACT(EPOCH FROM (r.check_out::time - r.check_in::time))/3600.0, 8)
              FROM attendance_regularizations r
             WHERE r.employee_id = a.employee_id AND r.date = a.date
               AND r.status = 'approved' AND r.check_in IS NOT NULL AND r.check_out IS NOT NULL
             ORDER BY r.approved_at DESC NULLS LAST LIMIT 1) AS reg_hours,
           (SELECT to_char(r.check_in, 'HH24:MI') || '-' || to_char(r.check_out, 'HH24:MI')
              FROM attendance_regularizations r
             WHERE r.employee_id = a.employee_id AND r.date = a.date
               AND r.status = 'approved' AND r.check_in IS NOT NULL AND r.check_out IS NOT NULL
             ORDER BY r.approved_at DESC NULLS LAST LIMIT 1) AS reg_window,
           COALESCE((SELECT half_day_hours FROM settings LIMIT 1), 4) AS half_day,
           COALESCE((SELECT full_day_hours FROM settings LIMIT 1), 7.5) AS full_day,
           COALESCE(a.late_minutes, 0) AS late_minutes,
           COALESCE(sh.grace_minutes, 15) AS grace
      FROM attendance a
      JOIN employees e ON e.id = a.employee_id
      LEFT JOIN shifts sh ON sh.id = e.shift_id
     WHERE a.check_in IS NOT NULL AND a.check_out IS NOT NULL
       AND COALESCE(a.working_hours, 0) < 0.05
       AND EXTRACT(EPOCH FROM (a.check_out - a.check_in))/3600.0 > 0.5
       AND e.deleted_at IS NULL
     ORDER BY a.date, e.employee_id`, [TZ]);

  if (!rows.length) {
    console.log('  No day with a real span is recorded as zero hours.\n');
    await pool.end();
    return;
  }

  const fixable = [];
  const unprovable = [];
  for (const r of rows) {
    const sess = r.session_hours === null ? null : Number(r.session_hours);
    const reg = r.reg_hours === null ? null : Number(r.reg_hours);
    if (sess !== null && sess > 0.05) fixable.push({ ...r, hours: sess, from: `${r.session_count} session(s)` });
    else if (reg !== null && reg > 0.05) fixable.push({ ...r, hours: reg, from: `regularized ${r.reg_window}` });
    else unprovable.push(r);
  }

  console.log(`  ${fixable.length} row(s) with evidence of what was actually worked:\n`);

  let repaired = 0;
  for (const r of fixable) {
    const hours = Math.round(r.hours * 100000000) / 100000000;
    const half = Number(r.half_day), full = Number(r.full_day);
    const status = hours < half ? 'absent' : hours < full ? 'half-day'
      : (Number(r.late_minutes) > Number(r.grace) ? 'late' : 'present');

    console.log(`    ${pad(r.code, 14)} ${r.d}   ${r.ci}-${r.co}   0h -> ${h2(hours)}   from ${r.from}`);
    if (status !== r.status) console.log(`${' '.repeat(20)}status ${r.status} -> ${status}`);

    if (APPLY) {
      await pool.query(
        `UPDATE attendance SET working_hours = $2, status = $3, updated_at = NOW() WHERE id = $1`,
        [r.id, hours, status]);
      repaired++;
    }
  }

  if (unprovable.length) {
    console.log(`\n  ${unprovable.length} row(s) left alone — no sessions and no approved`);
    console.log('  regularization, so the only figure available is the punch span,');
    console.log('  which includes lunch. Paying for a break is not a repair:\n');
    for (const r of unprovable) {
      console.log(`    ${pad(r.code, 14)} ${r.d}   ${r.ci}-${r.co}   span ${h2(r.span)}, unprovable`);
    }
    console.log('\n  These need a regularization from the person who was there.');
  }

  console.log(APPLY
    ? `\n  ${repaired} row(s) repaired. Punches were not touched.\n`
    : '\n  Nothing was written. Re-run with --apply to make these changes.\n');

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
