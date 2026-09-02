/* Operations -> Employee Information -> Insights.
 *
 * Headcount, joiners and leavers, plus the distribution charts. Every number
 * is derived from the employees table at query time; nothing is precomputed,
 * because a stored headcount is wrong the moment somebody is added and there
 * is no job here to recalculate it.
 *
 * Two definitions worth stating, because they decide every figure below:
 *
 *   - HEADCOUNT AS AT a date means: joined on or before it, and either still
 *     here or exited after it. Counting `status = 'active'` instead would give
 *     today's headcount for every month in the chart — a flat line that looks
 *     like data.
 *   - Growth is against the same month a year earlier (YOY), which is what the
 *     reference's second column shows.
 *
 * Only full access may read this. It is the whole organisation's shape,
 * including attrition, and a manager's reporting line is not a reason to see it.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { serverError } = require('../utils/serverError');

router.use(protect);
router.use(authorize('admin', 'director', 'hr_admin'));

// Real people only: Employee Profiles and soft-deleted rows are not headcount.
const REAL = `e.deleted_at IS NULL`;

const pct = (now, then) => {
  if (!then) return now ? 100 : 0;          // 0 -> n is 100% growth, not Infinity
  return Math.round(((now - then) / then) * 1000) / 10;
};

/* Headcount as at the last day of a given year/month. */
async function headcountAt(year, month) {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS n FROM employees e
      WHERE ${REAL}
        AND COALESCE(e.date_of_joining, e.joining_date) <= (make_date($1,$2,1) + INTERVAL '1 month - 1 day')::date
        AND (e.exit_date IS NULL
             OR e.exit_date > (make_date($1,$2,1) + INTERVAL '1 month - 1 day')::date)`,
    [year, month]);
  return r.rows[0].n;
}

async function joinersIn(year, month) {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS n FROM employees e
      WHERE ${REAL}
        AND date_trunc('month', COALESCE(e.date_of_joining, e.joining_date)) = make_date($1,$2,1)`,
    [year, month]);
  return r.rows[0].n;
}

async function leaversIn(year, month) {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS n FROM employees e
      WHERE ${REAL} AND e.exit_date IS NOT NULL
        AND date_trunc('month', e.exit_date) = make_date($1,$2,1)`,
    [year, month]);
  return r.rows[0].n;
}

/* A distribution over one column, top N, with everything else summed into
 * "Others" so the percentages still add to 100. */
async function distribution(column, limit = 10) {
  const r = await pool.query(
    `SELECT COALESCE(NULLIF(TRIM(${column}), ''), 'Not set') AS label, COUNT(*)::int AS count
       FROM employees e
      WHERE ${REAL} AND e.status = 'active'
      GROUP BY 1 ORDER BY count DESC`);
  const rows = r.rows;
  const total = rows.reduce((n, x) => n + x.count, 0);
  const top = rows.slice(0, limit);
  const rest = rows.slice(limit).reduce((n, x) => n + x.count, 0);
  const out = rest ? [...top, { label: 'Others', count: rest }] : top;
  return out.map(x => ({ ...x, percent: total ? Math.round((x.count / total) * 1000) / 10 : 0 }));
}

/* Age and experience are banded rather than raw, matching the reference's
 * buckets. Both are derived from a date, so somebody with no date of birth on
 * file lands in 'Not set' rather than being silently counted as a newborn. */
async function ageBands() {
  const r = await pool.query(
    `SELECT CASE
              WHEN e.date_of_birth IS NULL THEN 'Not set'
              WHEN age_years < 21 THEN 'Under 21'
              WHEN age_years <= 23 THEN '21-23'
              WHEN age_years <= 26 THEN '24-26'
              WHEN age_years <= 29 THEN '27-29'
              WHEN age_years <= 32 THEN '30-32'
              WHEN age_years <= 36 THEN '33-36'
              WHEN age_years <= 40 THEN '37-40'
              WHEN age_years <= 44 THEN '41-44'
              WHEN age_years <= 48 THEN '45-48'
              ELSE '49+'
            END AS label, COUNT(*)::int AS count
       FROM (SELECT e.*, EXTRACT(YEAR FROM AGE(e.date_of_birth))::int AS age_years
               FROM employees e WHERE ${REAL} AND e.status = 'active') e
      GROUP BY 1 ORDER BY 1`);
  const total = r.rows.reduce((n, x) => n + x.count, 0);
  return r.rows.map(x => ({ ...x, percent: total ? Math.round((x.count / total) * 1000) / 10 : 0 }));
}

async function experienceBands() {
  const r = await pool.query(
    `SELECT CASE
              WHEN yrs IS NULL THEN 'Not set'
              WHEN yrs < 1 THEN '<1'
              WHEN yrs < 2 THEN '1'
              WHEN yrs < 3 THEN '2'
              WHEN yrs < 4 THEN '3'
              WHEN yrs <= 5 THEN '4-5'
              ELSE '5+'
            END AS label, COUNT(*)::int AS count
       FROM (SELECT EXTRACT(YEAR FROM AGE(COALESCE(e.exit_date, CURRENT_DATE),
                                          COALESCE(e.date_of_joining, e.joining_date)))::int AS yrs
               FROM employees e WHERE ${REAL} AND e.status = 'active') t
      GROUP BY 1 ORDER BY 1`);
  const total = r.rows.reduce((n, x) => n + x.count, 0);
  return r.rows.map(x => ({ ...x, percent: total ? Math.round((x.count / total) * 1000) / 10 : 0 }));
}

router.get('/', async (req, res) => {
  try {
    const now = new Date();
    const year = parseInt(req.query.year, 10) || now.getFullYear();
    const month = parseInt(req.query.month, 10) || (now.getMonth() + 1);
    const prev = year - 1;

    const [
      headNow, headPrev, joinNow, joinPrev, leaveNow, leavePrev,
    ] = await Promise.all([
      headcountAt(year, month), headcountAt(prev, month),
      joinersIn(year, month),   joinersIn(prev, month),
      leaversIn(year, month),   leaversIn(prev, month),
    ]);

    /* Six months back from the selected month, oldest first, so the charts read
     * left to right the way the reference draws them. */
    const trend = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(year, month - 1 - i, 1);
      const y = d.getFullYear(), m = d.getMonth() + 1;
      const [added, exited, base] = await Promise.all([
        joinersIn(y, m), leaversIn(y, m), headcountAt(y, m),
      ]);
      trend.push({
        year: y, month: m,
        label: d.toLocaleDateString('en-GB', { month: 'long' }),
        added, exited, headcount: base,
        // Against the month's own headcount, which is what makes a month with
        // 3 joiners out of 60 read as 5%.
        addedPercent:  base ? Math.round((added / base) * 1000) / 10 : 0,
        exitedPercent: base ? Math.round((exited / base) * 1000) / 10 : 0,
      });
    }

    const [designations, departments, locations, gender, age, experience] = await Promise.all([
      distribution('e.designation'), distribution('e.department'),
      distribution('e.work_location'), distribution('e.gender', 5),
      ageBands(), experienceBands(),
    ]);

    res.json({
      success: true,
      data: {
        asAt: { year, month },
        headcount: { current: headNow, previous: headPrev, growth: pct(headNow, headPrev) },
        additions: { current: joinNow, previous: joinPrev, growth: pct(joinNow, joinPrev) },
        attrition: { current: leaveNow, previous: leavePrev, growth: pct(leaveNow, leavePrev) },
        trend,
        designations, departments, locations, gender, age, experience,
      },
    });
  } catch (err) { serverError(res, err); }
});

module.exports = router;
