/**
 * utils/regularizationWindow.js
 *
 * How long somebody has to regularize an unmarked absence, and when they are
 * chased about it.
 *
 * The rule, in one line: every unmarked absence in a week must be regularized
 * by the end of Monday of the following week — so a Monday absence has seven
 * days and a Saturday absence has two.
 *
 * That Monday moves for two independent reasons, and both have to be applied:
 *
 *   org-wide    the Monday is a public holiday, so nobody could have acted.
 *               Moves to the next working day for everybody.
 *   per person  that employee could not act that day. Moves to their first day
 *               back, with no cap — somebody returning from a month away has
 *               not lost the chance.
 *
 * "Could not act" is approved leave, an on-duty request, or a non-working day.
 * It is deliberately NOT working from home: they are sitting at a system and
 * can raise the request. It is deliberately NOT being absent again either, or
 * an employee could extend their own deadline by staying away.
 *
 * On-duty is the awkward one. The configured type list ships with both "Client
 * visit" and "Work from home", so an on-duty request can itself mean somebody
 * is at a desk. Rather than hardcode which spellings mean "away from a system",
 * the types that do NOT extend a deadline are a setting — otherwise the first
 * person to add "Client site (no laptop)" silently gets the wrong answer.
 *
 * Nothing here deducts pay. A missed deadline closes the day to the employee
 * and shows up in one report column; the payable total is untouched.
 */
const pool = require('../db');
const { isNonWorkingDay } = require('./workingDays');
const logger = require('../logger');

const TZ = 'Asia/Kolkata';

const ymd = (d) => {
  const x = d instanceof Date ? d : new Date(`${String(d).slice(0, 10)}T00:00:00`);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const parse = (s) => new Date(`${String(s).slice(0, 10)}T00:00:00`);
const addDays = (s, n) => { const x = parse(s); x.setDate(x.getDate() + n); return ymd(x); };
const todayYmd = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });

// Guards every "walk forward until" loop below. A misconfigured calendar that
// marked every day non-working would otherwise spin forever.
const MAX_WALK = 400;

/** The Monday on or after `date`. A Monday returns itself. */
function mondayOnOrAfter(date) {
  const d = parse(date);
  const shift = (8 - d.getDay()) % 7;   // getDay(): 0 Sun, 1 Mon
  d.setDate(d.getDate() + (shift === 0 && d.getDay() === 1 ? 0 : shift));
  return ymd(d);
}

/**
 * The base deadline for an absence: the Monday of the FOLLOWING week, then
 * pushed past any public holiday. Org-wide, identical for everybody.
 */
async function baseDeadline(absenceDate) {
  // The Monday that starts the week containing the absence, then a week on.
  const d = parse(absenceDate);
  const backToMonday = (d.getDay() + 6) % 7;          // days since Monday
  const weekStart = addDays(absenceDate, -backToMonday);
  let deadline = addDays(weekStart, 7);

  for (let i = 0; i < MAX_WALK; i++) {
    if (!(await isNonWorkingDay(parse(deadline)))) return deadline;
    deadline = addDays(deadline, 1);
  }
  return deadline;
}

/** Which on-duty request types leave somebody able to regularize anyway. */
async function availableOnDutyTypes() {
  try {
    const r = await pool.query(`SELECT regularization_config AS c FROM settings LIMIT 1`);
    const list = r.rows[0]?.c?.deadlineIgnoresOnDutyTypes;
    if (Array.isArray(list)) return list.map(s => String(s).toLowerCase());
  } catch (_) { /* fall through to the default */ }
  // Working from home is the one shipped type that means "at a system".
  return ['work from home'];
}

/**
 * Could this employee have raised a regularization on this date?
 * Non-working days, approved leave and on-duty say no. WFH says yes.
 */
async function canActOn(employeeId, date) {
  if (await isNonWorkingDay(parse(date))) return false;

  const leave = await pool.query(
    `SELECT 1 FROM leaves
      WHERE employee_id = $1 AND status = 'approved'
        AND start_date <= $2::date AND end_date >= $2::date LIMIT 1`,
    [employeeId, date]);
  if (leave.rows.length) return false;

  const ignore = await availableOnDutyTypes();
  const od = await pool.query(
    `SELECT COALESCE(request_type, '') AS t FROM on_duty_requests
      WHERE employee_id = $1 AND status = 'approved'
        AND start_date <= $2::date AND COALESCE(end_date, start_date) >= $2::date`,
    [employeeId, date]).catch(() => ({ rows: [] }));
  // Away only if at least one on-duty that day is of a type not on the
  // "still at a system" list. A day covered solely by a WFH-style on-duty
  // leaves them perfectly able to act.
  if (od.rows.some(r => !ignore.includes(String(r.t).toLowerCase()))) return false;

  return true;
}

/**
 * The date by which THIS employee must regularize THIS absence.
 * Base deadline, then walked forward to their first day back.
 */
async function deadlineFor(employeeId, absenceDate) {
  let d = await baseDeadline(absenceDate);
  for (let i = 0; i < MAX_WALK; i++) {
    if (await canActOn(employeeId, d)) return d;
    d = addDays(d, 1);
  }
  logger.warn({ employeeId, absenceDate },
    '[regularizationWindow] no reachable deadline found; falling back to the base date');
  return await baseDeadline(absenceDate);
}

/** True once the deadline has passed — the day is closed to the employee. */
async function isClosed(employeeId, absenceDate, now = todayYmd()) {
  const deadline = await deadlineFor(employeeId, absenceDate);
  return now > deadline;
}

/**
 * The last working day of the week containing `date` — the day the warning
 * goes out. Friday in a week whose Saturday is a weekend, Saturday otherwise,
 * read from the calendar rather than assumed.
 */
async function lastWorkingDayOfWeek(date) {
  const d = parse(date);
  const backToMonday = (d.getDay() + 6) % 7;
  const weekStart = addDays(date, -backToMonday);
  let last = null;
  for (let i = 0; i < 6; i++) {                 // Monday through Saturday
    const day = addDays(weekStart, i);
    if (!(await isNonWorkingDay(parse(day)))) last = day;
  }
  return last || addDays(weekStart, 4);
}

module.exports = {
  deadlineFor, isClosed, baseDeadline, canActOn, lastWorkingDayOfWeek,
  mondayOnOrAfter, availableOnDutyTypes, ymd, addDays, todayYmd, TZ,
};
