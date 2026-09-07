/**
 * utils/reportEmailSchedule.js
 *
 * When each scheduled report is due, and what date range it covers. Pure
 * date logic, no mail, no DB rows beyond the holiday/weekend calendar
 * everything else already reads through isNonWorkingDay() — so this agrees
 * with the rest of the app about what a working day is, by construction.
 *
 * Three cadences:
 *
 *   daily    due on any working day. Skipped entirely on a weekend or
 *            holiday — there is nothing to report about a day nobody was
 *            expected in. Content is the most recent working day before
 *            today — not literally calendar-yesterday, which on a Monday is
 *            Sunday (nobody expected in, everyone reads as "absent") and
 *            which, by the time it IS a working day again, has already
 *            moved past Friday without ever reporting on it.
 *
 *   weekly   due on the first working day on/after the Monday that starts
 *            THIS week — Monday normally, walked forward a day at a time
 *            if Monday (and, in principle, the days after it) are holidays.
 *            Content is the week that just closed: the Monday-to-Sunday
 *            immediately before this week's Monday.
 *
 *   monthly  due on the 26th of the month; if the 26th is a non-working day,
 *            the 27th; if that is ALSO non-working, the 28th regardless —
 *            a hard three-step cap, not an open walk, because payroll's own
 *            cutoff cannot drift arbitrarily late. Content is the 1st of the
 *            month through the cutoff day itself — the pay period closing,
 *            not the calendar month, which is why this fires before the
 *            month is over rather than after.
 *
 * All dates are 'YYYY-MM-DD' strings in Asia/Kolkata, matching every other
 * date-window util in this codebase (regularizationWindow.js, in particular
 * — its addDays/ymd/todayYmd/TZ are reused here rather than redefined).
 */
const { addDays, ymd, todayYmd, TZ } = require('./regularizationWindow');
const { isNonWorkingDay } = require('./workingDays');

const parseYmd = (s) => new Date(`${String(s).slice(0, 10)}T00:00:00`);
const isWorkingDay = async (dateYmd) => !(await isNonWorkingDay(parseYmd(dateYmd)));

/** Monday that starts the week containing `dateYmd` (Monday returns itself). */
function mondayOfWeek(dateYmd) {
  const dow = parseYmd(dateYmd).getDay(); // 0 Sun .. 6 Sat
  const backToMonday = (dow + 6) % 7;
  return addDays(dateYmd, -backToMonday);
}

/** Is today the day the Daily Attendance report goes out?
 *  includeNonWorkingDays: some companies want a daily report even on a
 *  weekend or holiday — an explicit, per-report override, off by default. */
async function isDailyDue(dateYmd, { includeNonWorkingDays = false } = {}) {
  return includeNonWorkingDays || isWorkingDay(dateYmd);
}

/** Is today the day the weekly-cadence reports (Weekly Attendance, Onboarding,
 *  Muster Roll) go out? With the override, always Monday, holiday or not —
 *  without it, walked forward past a holiday Monday same as before. */
async function isWeeklyDue(dateYmd, { includeNonWorkingDays = false } = {}) {
  const monday = mondayOfWeek(dateYmd);
  if (includeNonWorkingDays) return dateYmd === monday;
  let d = monday;
  for (let i = 0; i < 7; i++) {           // guards against an all-holiday week
    if (await isWorkingDay(d)) return d === dateYmd;
    d = addDays(d, 1);
  }
  return false;
}

/** Generic monthly cadence for reports with NO payroll-cutoff relationship
 *  (Headcount, Attrition Trend, etc.) — first working day of the month
 *  (or the literal 1st, with the override), reporting the FULL prior
 *  calendar month. Deliberately separate from monthlyCutoffDate(), which is
 *  a business rule about payroll timing, not a generic "once a month". */
async function genericMonthlyDueDate(dateYmd, { includeNonWorkingDays = false } = {}) {
  const d = parseYmd(dateYmd);
  const first = ymd(new Date(d.getFullYear(), d.getMonth(), 1));
  if (includeNonWorkingDays) return first;
  let day = first;
  for (let i = 0; i < 10; i++) {
    if (await isWorkingDay(day)) return day;
    day = addDays(day, 1);
  }
  return first;
}
function priorMonthRange(dateYmd) {
  const d = parseYmd(dateYmd);
  const start = ymd(new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const end = ymd(new Date(d.getFullYear(), d.getMonth(), 0)); // last day of prior month
  return { start, end };
}

/** The most recent working day strictly before `dateYmd` — what "yesterday"
 *  actually means for a report whose whole point is a working day's
 *  attendance. Plain calendar-yesterday reported Sunday's attendance every
 *  Monday (everyone "absent" because nobody was expected in), and would have
 *  reported Friday's attendance NEVER — by Monday, calendar-yesterday has
 *  already moved past it to Sunday. Walking back to the last real working
 *  day fixes both: Monday's report covers Friday, and every working day is
 *  reported on exactly once, on the next working day after it. */
async function lastWorkingDayBefore(dateYmd, { includeNonWorkingDays = false } = {}) {
  if (includeNonWorkingDays) return addDays(dateYmd, -1);
  let d = addDays(dateYmd, -1);
  for (let i = 0; i < 10; i++) {
    if (await isWorkingDay(d)) return d;
    d = addDays(d, -1);
  }
  return addDays(dateYmd, -1); // guards against a misconfigured all-holiday calendar
}

/** One entry point for any report's cadence, fixed or admin-chosen:
 *  'daily' | 'weekly' | 'monthly'. Used by the widened catalog (Headcount,
 *  Addition Trend, Attrition Trend, Experience & Exit), whose cadence is a
 *  per-report setting rather than baked into the report's identity. */
async function isDueForCadence(cadence, dateYmd, opts = {}) {
  if (cadence === 'daily') return isDailyDue(dateYmd, opts);
  if (cadence === 'weekly') return isWeeklyDue(dateYmd, opts);
  if (cadence === 'monthly') return dateYmd === (await genericMonthlyDueDate(dateYmd, opts));
  return false;
}
async function rangeForCadence(cadence, dateYmd, opts = {}) {
  if (cadence === 'daily') {
    const day = await lastWorkingDayBefore(dateYmd, opts);
    return { start: day, end: day };
  }
  if (cadence === 'weekly') return weekJustClosedRange(dateYmd);
  if (cadence === 'monthly') return priorMonthRange(dateYmd);
  return { start: dateYmd, end: dateYmd };
}

/** Monday-to-Sunday range of the week that closed just before this one. */
function weekJustClosedRange(dateYmd) {
  const thisMonday = mondayOfWeek(dateYmd);
  const end = addDays(thisMonday, -1);    // last Sunday
  const start = addDays(end, -6);         // the Monday before that
  return { start, end };
}

/** Is today the monthly cutoff — the 26th, else 27th, else 28th? */
async function isMonthlyCutoffDue(dateYmd) {
  return dateYmd === (await monthlyCutoffDate(dateYmd));
}

/** The resolved cutoff date for the month `dateYmd` falls in. */
async function monthlyCutoffDate(dateYmd) {
  const d = parseYmd(dateYmd);
  const y = d.getFullYear(), m = d.getMonth();
  const day26 = ymd(new Date(y, m, 26));
  const day27 = ymd(new Date(y, m, 27));
  const day28 = ymd(new Date(y, m, 28));
  if (await isWorkingDay(day26)) return day26;
  if (await isWorkingDay(day27)) return day27;
  return day28; // hard cap — payroll cannot wait indefinitely for a working day
}

/** 1st of the month through the cutoff day itself — the closing pay period. */
function monthToCutoffRange(dateYmd) {
  const d = parseYmd(dateYmd);
  const start = ymd(new Date(d.getFullYear(), d.getMonth(), 1));
  return { start, end: dateYmd };
}

/** Every holiday that fell inside a date range, for "mention the holiday in
 *  the week" — reads the same holiday table isNonWorkingDay itself reads. */
async function holidaysInRange(start, end) {
  const pool = require('../db');
  const r = await pool.query(
    `SELECT date::text AS date, name FROM holidays
      WHERE date BETWEEN $1::date AND $2::date
      ORDER BY date`,
    [start, end]).catch(() => ({ rows: [] }));
  return r.rows;
}

module.exports = {
  isDailyDue, isWeeklyDue, isMonthlyCutoffDue,
  mondayOfWeek, weekJustClosedRange, monthlyCutoffDate, monthToCutoffRange,
  holidaysInRange, isWorkingDay, todayYmd, TZ,
  isDueForCadence, rangeForCadence, genericMonthlyDueDate, priorMonthRange,
  lastWorkingDayBefore,
};
