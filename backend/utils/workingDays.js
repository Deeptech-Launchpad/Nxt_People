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

/* Does this holiday apply to this person?
 *
 * Some holidays are for the office and not for WFH, so a holiday carries a set
 * of locations and a set of shifts it is for.
 *
 * NO SCOPE MEANS EVERYONE. That is not a convenience default — it is what
 * makes this safe to introduce. Four years of attendance were judged against a
 * calendar where every holiday was company-wide, and every one of those rows
 * has no scope, so every one of them still applies to everybody and no day
 * already recorded is re-judged. Narrowing happens only where somebody chose it.
 *
 * The two kinds are independent and both must pass: a holiday for the office,
 * general shift only, does not apply to somebody at the office on nights.
 *
 * @param {object} holiday   { locationIds?: [], shiftIds?: [] }
 * @param {object} employee  { workLocationId, shiftId }
 */
function holidayAppliesTo(holiday, employee = {}) {
  const locations = holiday?.locationIds || [];
  const shifts = holiday?.shiftIds || [];

  if (locations.length) {
    // Somebody with no location recorded is not excluded by a location scope
    // they cannot be matched against — silently dropping a holiday because a
    // field is blank would mark them absent on a day the office was shut.
    if (employee.workLocationId && !locations.map(String).includes(String(employee.workLocationId))) {
      return false;
    }
  }
  if (shifts.length) {
    if (employee.shiftId && !shifts.map(String).includes(String(employee.shiftId))) {
      return false;
    }
  }
  return true;
}

/* The holiday type in force on a date FOR THIS PERSON.
 *
 * holMap holds an ARRAY per date, because a date can now carry more than one
 * holiday scoped to different people: the office shuts for one thing while WFH
 * does not. This picks the one that applies to the person asking.
 *
 * When several apply, a closure wins over a working-day exception. Both are
 * deliberate statements and neither is obviously stronger, but the errors are
 * not equal: marking somebody absent on a day they were told not to come in is
 * worse than counting a day they did come in as a holiday.
 *
 * `employee` may be undefined. Everything then applies, which is exactly how
 * this behaved before scopes existed — so a caller that has not been taught
 * about them degrades to the old answer rather than to a wrong one.
 */
function holidayTypeFor(holMap, key, employee) {
  const rows = holMap?.get(key);
  if (!rows) return undefined;
  // Tolerate the old shape, so a map built somewhere this refactor missed
  // still answers instead of silently reading as "no holiday" — which would
  // mark a whole company absent on Deepavali.
  if (typeof rows === 'string') return rows;

  const mine = rows.filter(h => holidayAppliesTo(h, employee));
  if (!mine.length) return undefined;
  const closing = mine.find(h => holidayClosesOffice(h.type));
  if (closing) return closing.type;
  return mine[0].type;
}

/** True when this holiday closes the office FOR THIS PERSON. */
function holidayClosesFor(holiday, employee) {
  return holidayClosesOffice(holiday?.type) && holidayAppliesTo(holiday, employee);
}

function atMidnight(d) {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

// 'YYYY-MM-DD' from a date's LOCAL parts.
//
// toISOString() was used here and it converts to UTC first, so anywhere east of
// Greenwich a date built at local midnight is the previous evening in UTC and
// every string came back a day early: asked for 2026-01-01, told 2025-12-31.
// The holiday lookups below compare against date::text straight out of
// Postgres, which is the true calendar day, so the two disagreed by one day
// for every row and every query.
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
  const day = ymd(atMidnight(date));
  try {
    // A closure or an explicit working-day override beats everything else.
    const h = await pool.query(`SELECT type FROM holidays WHERE date = $1::date`, [day]);
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

  const startYmd = ymd(start);
  const endYmd   = ymd(end);

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
    const holType = holidayMap.get(ymd(cur));
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

/**
 * Returns an isWeekend(date) predicate for the whole app.
 *
 * Weekend rules win when any exist — they are the richer source, able to say
 * "the 1st and 3rd Saturday". With none configured, the fallback is the work
 * calendar's work week: any day outside work_week_start..work_week_end.
 *
 * That fallback used to be a hardcoded Mon-Fri, which is wrong here — this
 * organisation works Mon-Sat, so every Saturday was silently counted as a
 * weekend and dropped out of working-day totals wherever the fallback applied.
 *
 * Falls back to "Sunday only" if neither source is readable, which is the
 * safer error: it over-counts working days rather than quietly losing a sixth
 * of the working week.
 */
async function loadWeekendResolver() {
  let rules = [];
  let workWeek = null;
  try {
    const [r, c] = await Promise.all([
      pool.query(
        `SELECT days_of_week, weeks_of_month, interval_weeks, start_date, end_type, end_date, end_count
           FROM weekend_rules WHERE is_active = TRUE`
      ),
      // The Default calendar (no location) is the org-wide work week.
      pool.query(
        `SELECT work_week_start, work_week_end FROM work_calendars
          WHERE location IS NULL AND is_active = TRUE LIMIT 1`
      ),
    ]);
    rules = r.rows;
    workWeek = c.rows[0] || null;
  } catch (err) { /* tables may not exist yet — fall through to Sunday-only */ }

  const start = workWeek ? Number(workWeek.work_week_start) : 1;
  const end = workWeek ? Number(workWeek.work_week_end) : 6;

  // A work week can wrap the week boundary (e.g. Saturday through Wednesday),
  // so membership is a range test in both directions rather than start <= d <= end.
  const isWorkDay = dow => (start <= end ? dow >= start && dow <= end : dow >= start || dow <= end);

  return {
    hasRules: rules.length > 0,
    isWeekend(date) {
      if (rules.length > 0) return rules.some(rule => ruleMatchesDate(rule, date));
      return !isWorkDay(date.getDay());
    },
  };
}

module.exports = {
  holidayAppliesTo,
  holidayTypeFor,
  holidayClosesFor, isNonWorkingDay, ruleMatchesDate, countWorkingDays, holidayClosesOffice, loadWeekendResolver };
