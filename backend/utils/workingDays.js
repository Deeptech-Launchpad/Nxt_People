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
    // Holiday override beats everything else.
    const h = await pool.query(`SELECT type FROM holidays WHERE date = $1::date`, [ymd]);
    if (h.rows.length > 0) {
      return h.rows[0].type !== 'working_day';   // explicit override → working day
    }
    // No holiday row — fall back to the active weekend rules.
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

module.exports = { isNonWorkingDay, ruleMatchesDate };
