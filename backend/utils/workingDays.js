/**
 * Server-side mirror of the frontend weekend-rule evaluator.
 * Used by cron jobs and any other backend code that needs to know
 * "should today's reminder/payroll/etc. fire?"
 *
 * A date is a non-working day if any of the following is true:
 *   1. A holidays row exists with type ≠ 'working_day' on that date.
 *   2. Any active weekend_rule matches that date.
 *
 * A holidays row with type='working_day' is a positive override: even if a
 * weekend rule would mark the day as a weekend, the exception wins.
 */
const pool = require('../db');

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// Not every holidays row closes the office.
//   working_day  a positive override — a working day even if a weekend rule
//                would otherwise match it
//   restricted   an optional holiday: offered to employees to take if they
//                want it, not imposed on everyone. The Holidays screen has
//                always offered this type, but every consumer read "any type
//                other than working_day" as a company-wide closure, which
//                made choosing it silently shut the office. The day stays an
//                ordinary working day for anyone who hasn't taken it.
// Anything else (company, national, …) is a closure.
const NON_CLOSING_HOLIDAY_TYPES = new Set(['working_day', 'restricted']);

/** True when a holidays row of this type closes the office for everyone. */
function holidayClosesOffice(type) {
  return !!type && !NON_CLOSING_HOLIDAY_TYPES.has(type);
}

function atMidnight(d) {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}
function daysBetween(a, b) {
  return Math.round((atMidnight(b) - atMidnight(a)) / 86_400_000);
}
function weekOfMonthForWeekday(d) {
  return Math.floor((d.getDate() - 1) / 7) + 1;
}

/** Single-rule check — same semantics as the frontend helper. */
function ruleMatchesDate(rule, date) {
  if (!rule || rule.is_active === false) return false;
  const d = atMidnight(date);

  const start = rule.start_date ? atMidnight(new Date(rule.start_date)) : null;
  if (start && d < start) return false;

  if (rule.end_type === 'on' && rule.end_date) {
    const end = atMidnight(new Date(rule.end_date));
    if (d > end) return false;
  }
  if (rule.end_type === 'after' && start && rule.end_count) {
    const weeksSince = Math.floor(daysBetween(start, d) / 7);
    const occurrence = Math.floor(weeksSince / Math.max(1, rule.interval_weeks || 1)) + 1;
    if (occurrence > rule.end_count) return false;
  }

  const dow = DAYS[d.getDay()];
  const daysOfWeek = Array.isArray(rule.days_of_week) ? rule.days_of_week : [];
  if (!daysOfWeek.includes(dow)) return false;

  const weeksOfMonth = Array.isArray(rule.weeks_of_month) ? rule.weeks_of_month : [];
  if (weeksOfMonth.length > 0 && !weeksOfMonth.includes(weekOfMonthForWeekday(d))) return false;

  const interval = Math.max(1, rule.interval_weeks || 1);
  if (interval > 1 && start) {
    if (Math.floor(daysBetween(start, d) / 7) % interval !== 0) return false;
  }
  return true;
}

/**
 * Returns true if `date` is a non-working day per the current weekend rules
 * + holidays table. Pulls rules and holidays in one trip each.
 *
 * Falls back to "not a weekend / not a holiday" on DB errors so the caller
 * (typically a cron job) doesn't accidentally skip every day.
 */
async function isNonWorkingDay(date = new Date()) {
  const ymd = atMidnight(date).toISOString().slice(0, 10);
  try {
    // A closure or an explicit working-day override beats everything else.
    const h = await pool.query(`SELECT type FROM holidays WHERE date = $1::date`, [ymd]);
    const holType = h.rows[0]?.type;
    if (holidayClosesOffice(holType)) return true;
    if (holType === 'working_day') return false;
    // No holiday row, or an optional one — fall back to the weekend rules.
    const r = await pool.query(
      `SELECT days_of_week, weeks_of_month, interval_weeks, start_date, end_type, end_date, end_count, is_active
       FROM weekend_rules WHERE is_active = TRUE`
    );
    return r.rows.some((rule) => ruleMatchesDate(rule, date));
  } catch (err) {
    // Tables may not exist yet — be conservative and let the caller proceed.
    return false;
  }
}

/**
 * Counts working days in [startDate, endDate] inclusive, honouring
 * weekend_rules and the holidays table. Used by leave apply so the
 * total_days figure matches what the company actually considers a
 * working day — not a hardcoded Mon-Fri.
 *
 * A day is a working day if:
 *   - No holidays row exists OR the holidays row has type='working_day'
 *   - AND no active weekend_rule matches it (unless overridden above)
 */
async function countWorkingDays(startDate, endDate) {
  const start = atMidnight(new Date(startDate));
  const end   = atMidnight(new Date(endDate));
  if (end < start) return 0;

  const startYmd = start.toISOString().slice(0, 10);
  const endYmd   = end.toISOString().slice(0, 10);

  let rules = [];
  let holidayMap = new Map();
  try {
    const [rulesRes, holRes] = await Promise.all([
      pool.query(
        `SELECT days_of_week, weeks_of_month, interval_weeks, start_date, end_type, end_date, end_count, is_active
         FROM weekend_rules WHERE is_active = TRUE`
      ),
      pool.query(
        `SELECT date::text as ymd, type FROM holidays WHERE date BETWEEN $1::date AND $2::date`,
        [startYmd, endYmd]
      ),
    ]);
    rules = rulesRes.rows;
    holRes.rows.forEach(h => holidayMap.set(h.ymd, h.type));
  } catch (_) {
    // Tables missing → fall back to "weekday only" so we still return something sane.
    let count = 0;
    const cur = new Date(start);
    while (cur <= end) {
      const d = cur.getDay();
      if (d !== 0 && d !== 6) count++;
      cur.setDate(cur.getDate() + 1);
    }
    return count;
  }

  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const ymd = cur.toISOString().slice(0, 10);
    const holType = holidayMap.get(ymd);
    let isWorkingDay;
    if (holidayClosesOffice(holType)) {
      isWorkingDay = false;
    } else if (holType === 'working_day') {
      isWorkingDay = true;
    } else {
      const isWeekend = rules.some(rule => ruleMatchesDate(rule, cur));
      isWorkingDay = !isWeekend;
    }
    if (isWorkingDay) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

module.exports = { isNonWorkingDay, ruleMatchesDate, countWorkingDays, holidayClosesOffice };
