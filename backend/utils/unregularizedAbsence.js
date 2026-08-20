/**
 * utils/unregularizedAbsence.js
 *
 * How many unmarked absences an employee let the window close on.
 *
 * This is a strict subset of the "Unmarked absence" figure beside it in the
 * Loss of Pay report: the same days, narrowed to the ones whose regularization
 * deadline has passed with nothing raised. It is never added to that figure —
 * a day counted in both columns and then summed is how a total quietly doubles.
 *
 * It deducts nothing. The point is to show HR who is letting days lapse, not to
 * charge anybody for them; the payable total is computed without it.
 *
 * Returns 0 while the rule is not in force, which is also what it returns for
 * any day before the effective date. Nobody accrues a figure for a deadline
 * that did not exist yet.
 */
const pool = require('../db');
const logger = require('../logger');
const { isNonWorkingDay } = require('./workingDays');
const { deadlineFor, effectiveFrom, todayYmd } = require('./regularizationWindow');

const ymd = (d) => {
  const x = d instanceof Date ? d : new Date(`${String(d).slice(0, 10)}T00:00:00`);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

/**
 * Days in [start, end] that are unmarked absences AND past their deadline.
 * @returns {Promise<number>}
 */
async function unregularizedDaysForRange(employeeId, startDate, endDate) {
  const from = await effectiveFrom();
  if (!from) return 0;

  const start = ymd(startDate);
  const end = ymd(endDate);
  const today = todayYmd();
  // Nothing before the rule came in, and nothing in the future.
  const lo = start > from ? start : from;
  const hi = end < today ? end : today;
  if (lo > hi) return 0;

  const r = await pool.query(
    `WITH days AS (SELECT d::date AS day FROM generate_series($2::date, $3::date, '1 day') d)
     SELECT to_char(days.day, 'YYYY-MM-DD') AS day
       FROM days
       LEFT JOIN attendance a
         ON a.employee_id = $1 AND a.date = days.day
       LEFT JOIN leaves l
         ON l.employee_id = $1 AND l.status = 'approved'
        AND l.start_date <= days.day AND l.end_date >= days.day
       LEFT JOIN on_duty_requests o
         ON o.employee_id = $1 AND o.status = 'approved'
        AND o.start_date <= days.day AND COALESCE(o.end_date, o.start_date) >= days.day
       LEFT JOIN attendance_regularizations g
         ON g.employee_id = $1 AND g.date = days.day
        AND g.status IN ('pending', 'approved')
      WHERE l.employee_id IS NULL AND o.employee_id IS NULL AND g.employee_id IS NULL
        AND (a.employee_id IS NULL OR a.check_in IS NULL OR a.check_out IS NULL)
        AND COALESCE(a.status, '') <> 'on_duty'
      ORDER BY days.day`,
    [employeeId, lo, hi]
  ).catch(err => {
    logger.warn({ err: err.message, employeeId }, '[unregularizedAbsence] lookup failed');
    return { rows: [] };
  });

  let count = 0;
  for (const row of r.rows) {
    // Weekend rules are evaluated in JS, not SQL, so the calendar filter cannot
    // live in the query above.
    if (await isNonWorkingDay(new Date(`${row.day}T00:00:00`))) continue;
    const due = await deadlineFor(employeeId, row.day);
    if (today > due) count += 1;
  }
  return count;
}

module.exports = { unregularizedDaysForRange };
