/* READ ONLY. Writes nothing, changes nothing.
 *
 * Why this exists: on the Expected vs Worked screen our payable hours differed
 * from the reference's for the same person and the same month — August by
 * exactly 8:00 (one shift day), July by 2:00. Expected hours agreed to the
 * minute, so the disagreement is in what we count as WORKED, not in what we
 * think is owed. That is a question about the rows, not about the arithmetic,
 * and it cannot be answered from a screenshot.
 *
 * Three things it looks for, in the order they are worth suspecting:
 *
 *   1. An APPROVED regularization whose day does not match it. Approving one
 *      is supposed to write the corrected times back to the attendance row.
 *      Where it did not, the day still counts whatever it counted before —
 *      which for a "Forgot to check-out" is usually nothing.
 *   2. A day whose stored working_hours disagrees with its own punches.
 *   3. Days open but never closed, which contribute nothing to payable.
 *
 * Usage (inside the container, so it reads the live database):
 *     docker compose -f docker-compose.prod.yml exec -T backend \
 *       node < inspect_payable_gap.js
 *
 * Narrow it with EMP and MONTHS if you want one person:
 *     EMP=ANXT2600149 MONTHS=2026-07,2026-08 docker compose ... node < inspect_payable_gap.js
 */
require('dotenv').config();
process.env.LOG_LEVEL = 'silent';
const pool = require('./db');

const EMP = process.env.EMP || null;
const MONTHS = (process.env.MONTHS || '').split(',').filter(Boolean);

const hm = (h) => {
  if (h === null || h === undefined) return '  --  ';
  const neg = Number(h) < 0;
  const t = Math.round(Math.abs(Number(h)) * 60);
  return `${neg ? '-' : ' '}${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};
const line = (n = 78) => console.log('  ' + '-'.repeat(n));

(async () => {
  const who = EMP
    ? await pool.query(
        `SELECT id, employee_id AS code, first_name AS "firstName", last_name AS "lastName"
           FROM employees WHERE employee_id = $1 AND deleted_at IS NULL`, [EMP])
    : await pool.query(
        `SELECT id, employee_id AS code, first_name AS "firstName", last_name AS "lastName"
           FROM employees WHERE deleted_at IS NULL AND status='active' ORDER BY employee_id`);

  if (!who.rows.length) { console.log('\n  No such employee.\n'); await pool.end(); return; }

  const monthClause = MONTHS.length
    ? `AND to_char(a.date, 'YYYY-MM') = ANY($2::text[])`
    : `AND a.date >= (CURRENT_DATE - INTERVAL '6 months')`;
  const monthArgs = MONTHS.length ? [MONTHS] : [];

  console.log('\n  PAYABLE HOURS — where our figure could differ from the reference');
  console.log('  read only; nothing below changes any row\n');

  /* 1 — approved regularizations the attendance row does not reflect. */
  console.log('  1. Approved regularizations whose day was NOT updated');
  line();
  const stale = await pool.query(
    `SELECT e.employee_id AS code, e.first_name AS "firstName",
            to_char(r.date, 'YYYY-MM-DD') AS date,
            r.check_in AS "wantIn", r.check_out AS "wantOut", r.reason,
            a.working_hours AS "hours", a.status,
            to_char(a.check_in AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS "gotIn",
            to_char(a.check_out AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS "gotOut"
       FROM attendance_regularizations r
       JOIN employees e ON e.id = r.employee_id
       LEFT JOIN attendance a ON a.employee_id = r.employee_id AND a.date = r.date
      WHERE r.status = 'approved'
        ${EMP ? 'AND e.employee_id = $1' : ''}
        AND (a.id IS NULL OR COALESCE(a.working_hours, 0) = 0)
        AND r.date >= (CURRENT_DATE - INTERVAL '12 months')
      ORDER BY r.date DESC LIMIT 60`,
    EMP ? [EMP] : []);

  if (!stale.rows.length) {
    console.log('     none — every approved correction is reflected in its day');
  } else {
    console.log('     these days were approved as worked but still count zero:');
    stale.rows.forEach(r => console.log(
      `     ${r.date}  ${String(r.code).padEnd(14)} asked ${r.wantIn || '--'}-${r.wantOut || '--'}` +
      `  row says ${r.gotIn || '--'}-${r.gotOut || '--'} (${hm(r.hours)})  ${r.reason || ''}`));
    console.log(`\n     ${stale.rows.length} day(s). Each is roughly one shift of payable hours missing.`);
  }

  /* 2 — stored hours that disagree with the day's own punches. */
  /* This compared working_hours against last-out minus first-in, which is
   * simply the wrong comparison: working_hours is the SUM OF SESSIONS, so
   * anybody who checks out for lunch and back in legitimately banks less than
   * the span of their day. The first run of this script flagged forty such
   * days as suspect; every one of them was a person taking a break.
   *
   * Compared against the sessions now, which is what the number actually is.
   * A day with no sessions falls back to the span. */
  console.log('\n  2. Days whose stored hours disagree with their own sessions (> 5 min out)');
  console.log('     (measured against summed sessions, not first-in-to-last-out —');
  console.log('      a day with a lunch break banks less than its span, correctly)');
  line();
  const drift = await pool.query(
    `WITH sess AS (
       SELECT employee_id, date, SUM(COALESCE(session_hours, 0)) AS hours, COUNT(*)::int AS n
         FROM attendance_sessions GROUP BY 1, 2)
     SELECT e.employee_id AS code, to_char(a.date, 'YYYY-MM-DD') AS date,
            a.working_hours AS stored, s.hours AS "sessionHours", s.n AS sessions,
            EXTRACT(EPOCH FROM (a.check_out - a.check_in))/3600 AS span
       FROM attendance a
       JOIN employees e ON e.id = a.employee_id
       LEFT JOIN sess s ON s.employee_id = a.employee_id AND s.date = a.date
      WHERE a.check_in IS NOT NULL AND a.check_out IS NOT NULL
        ${EMP ? 'AND e.employee_id = $1' : ''}
        ${monthClause.replace('$2', EMP ? '$2' : '$1')}
        AND ABS(COALESCE(a.working_hours, 0)
                - COALESCE(s.hours, EXTRACT(EPOCH FROM (a.check_out - a.check_in))/3600)) > 0.084
      ORDER BY a.date DESC LIMIT 40`,
    EMP ? [EMP, ...monthArgs] : monthArgs);

  if (!drift.rows.length) console.log('     none');
  else drift.rows.forEach(r => console.log(
    `     ${r.date}  ${String(r.code).padEnd(14)} stored ${hm(r.stored)}` +
    `  sessions ${hm(r.sessionHours)} (${r.sessions || 0})  span ${hm(r.span)}`));

  /* Two faults wearing the same shape, and conflating them nearly caused a
   * bad repair: a first pass at this asked for check_out <= check_in and
   * proposed adding twelve hours to all 102 matches. A hundred of them had
   * check_out EQUAL to check_in, and would have been given a fabricated
   * 12:00 day. They are counted separately now. */
  console.log('\n  2b. Days whose check-out is genuinely EARLIER than their check-in');
  line();
  const inverted = await pool.query(
    `SELECT e.employee_id AS code, to_char(a.date, 'YYYY-MM-DD') AS date,
            a.working_hours AS stored, a.status,
            to_char(a.check_in AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS "in",
            to_char(a.check_out AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS "out"
       FROM attendance a JOIN employees e ON e.id = a.employee_id
      WHERE a.check_in IS NOT NULL AND a.check_out IS NOT NULL
        AND a.check_out < a.check_in
        ${EMP ? 'AND e.employee_id = $1' : ''}
      ORDER BY a.date DESC LIMIT 40`,
    EMP ? [EMP] : []);
  if (!inverted.rows.length) console.log('     none');
  else {
    inverted.rows.forEach(r => console.log(
      `     ${r.date}  ${String(r.code).padEnd(14)} in ${r['in']} out ${r.out}  stored ${hm(r.stored)}  ${r.status}`));
    console.log(`\n     ${inverted.rows.length} day(s) — a 6 PM typed as 06:00, unless the shift runs`);
    console.log('     through midnight. repair_inverted_days.js reads the approved request');
    console.log('     for the intended times rather than guessing at them.');
  }

  /* The hundred. One punch in both columns. */
  console.log('\n  2c. Days where the check-out is IDENTICAL to the check-in');
  line();
  const same = await pool.query(
    `WITH sess AS (
       SELECT employee_id, date, COUNT(*)::int AS n,
              MAX(check_out) AS "lastOut", SUM(COALESCE(session_hours,0)) AS hours
         FROM attendance_sessions GROUP BY 1,2)
     SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE s."lastOut" IS NOT NULL AND s."lastOut" > a.check_in)::int AS recoverable,
            MIN(to_char(a.date,'YYYY-MM-DD')) AS first,
            MAX(to_char(a.date,'YYYY-MM-DD')) AS last,
            COUNT(DISTINCT a.employee_id)::int AS people
       FROM attendance a
       LEFT JOIN sess s ON s.employee_id = a.employee_id AND s.date = a.date
      WHERE a.check_in IS NOT NULL AND a.check_out IS NOT NULL
        AND a.check_out = a.check_in`);
  const s = same.rows[0];
  if (!s || !s.total) console.log('     none');
  else {
    console.log(`     ${s.total} day(s) across ${s.people} people, ${s.first} to ${s.last}.`);
    console.log('     A single punch written into both columns — the migration\'s doing, by the');
    console.log('     span of dates. Each pays nothing.');
    console.log(`\n     Of those, ${s.recoverable} have a session row carrying a LATER check-out,`);
    console.log('     which is the only honest source for repairing them. The rest have no');
    console.log('     second punch anywhere and cannot be reconstructed — only regularized');
    console.log('     by the person who was there.');
  }

  /* 3 — open days: checked in, never checked out. */
  console.log('\n  3. Days checked in but never checked out (they pay nothing)');
  line();
  const open = await pool.query(
    `SELECT e.employee_id AS code, e.first_name AS "firstName",
            COUNT(*)::int AS days, MIN(to_char(a.date,'YYYY-MM-DD')) AS first, MAX(to_char(a.date,'YYYY-MM-DD')) AS last
       FROM attendance a JOIN employees e ON e.id = a.employee_id
      WHERE a.check_in IS NOT NULL AND a.check_out IS NULL
        AND a.date < CURRENT_DATE
        ${EMP ? 'AND e.employee_id = $1' : ''}
      GROUP BY 1,2 ORDER BY days DESC LIMIT 20`,
    EMP ? [EMP] : []);
  if (!open.rows.length) console.log('     none');
  else open.rows.forEach(r => console.log(
    `     ${String(r.code).padEnd(14)} ${String(r.days).padStart(4)} day(s)   ${r.first} .. ${r.last}   ${r.firstName}`));

  /* 4 — on-duty rows per month, to check what actually migrated. */
  console.log('\n  4. On-duty requests per month (the screen showed 1 where the reference showed 6)');
  line();
  const od = await pool.query(
    `SELECT to_char(o.start_date, 'YYYY-MM') AS month, o.status, COUNT(*)::int AS n
       FROM on_duty_requests o JOIN employees e ON e.id = o.employee_id
      WHERE o.start_date >= (CURRENT_DATE - INTERVAL '12 months')
        ${EMP ? 'AND e.employee_id = $1' : ''}
      GROUP BY 1,2 ORDER BY 1 DESC, 2`,
    EMP ? [EMP] : []);
  if (!od.rows.length) console.log('     none in the last 12 months');
  else od.rows.forEach(r => console.log(`     ${r.month}  ${String(r.status).padEnd(12)} ${String(r.n).padStart(4)}`));

  console.log('\n  Nothing was changed. If section 1 has rows, that is the payable gap:');
  console.log('  the approval was recorded but the day it was meant to correct was not.\n');
  await pool.end();
})().catch(async e => { console.error(e.message); await pool.end().catch(() => {}); });
