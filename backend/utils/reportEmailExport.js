/**
 * utils/reportEmailExport.js
 *
 * The real Excel attachment for a scheduled report email — one row per
 * employee (or per record), not the counts-only summary the email body
 * shows. Same library (`xlsx`) and the same book_new/json_to_sheet/write
 * pattern payroll.js's own template export already uses, so this behaves
 * identically to every other server-generated spreadsheet in this app.
 *
 * Column names are chosen to read naturally in Excel — they don't have to
 * match a live report page's export column-for-column, but they cover the
 * same underlying data a recipient opening that page would see.
 *
 * regularizationReminder has no export: its content already IS a short,
 * complete list in the email body, and it differs per recipient rather than
 * being one report-wide dataset.
 */
const pool = require('../db');
const xlsx = require('xlsx');

function toXlsxBuffer(rows, sheetName) {
  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.json_to_sheet(rows.length ? rows : [{ 'No data': 'Nothing to report for this period' }]);
  xlsx.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31)); // Excel's own 31-char sheet-name limit
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/* ── Daily Attendance — one row per active employee for the report date ── */
async function dailyAttendanceRows(reportDate) {
  const r = await pool.query(
    `SELECT e.employee_id AS "Code", e.first_name || ' ' || COALESCE(e.last_name,'') AS "Name",
            e.department AS "Department",
            CASE
              WHEN a.check_in IS NOT NULL AND a.status = 'late' THEN 'Late'
              WHEN a.check_in IS NOT NULL THEN 'Present'
              WHEN l.id IS NOT NULL THEN 'On Leave'
              WHEN o.id IS NOT NULL THEN 'On Duty'
              ELSE 'Absent'
            END AS "Status",
            a.check_in::text AS "Check-in", a.check_out::text AS "Check-out",
            a.working_hours AS "Working Hours"
       FROM employees e
       LEFT JOIN attendance a ON a.employee_id = e.id AND a.date = $1::date
       LEFT JOIN leaves l ON l.employee_id = e.id AND l.status='approved'
                          AND l.start_date <= $1::date AND l.end_date >= $1::date
       LEFT JOIN on_duty_requests o ON o.employee_id = e.id AND o.status='approved'
                          AND o.start_date <= $1::date AND COALESCE(o.end_date, o.start_date) >= $1::date
      WHERE e.status='active' AND e.deleted_at IS NULL AND e.is_user=TRUE
      ORDER BY e.employee_id`,
    [reportDate]);
  return r.rows;
}

/* ── Weekly Attendance — one row per employee, per day in the week ──────── */
async function weeklyAttendanceRows(start, end) {
  const r = await pool.query(
    `SELECT e.employee_id AS "Code", e.first_name || ' ' || COALESCE(e.last_name,'') AS "Name",
            d.day::text AS "Date",
            CASE
              WHEN a.check_in IS NOT NULL AND a.status = 'late' THEN 'Late'
              WHEN a.check_in IS NOT NULL THEN 'Present'
              WHEN l.id IS NOT NULL THEN 'On Leave'
              WHEN o.id IS NOT NULL THEN 'On Duty'
              ELSE 'Absent'
            END AS "Status"
       FROM employees e
       CROSS JOIN generate_series($1::date, $2::date, '1 day') AS d(day)
       LEFT JOIN attendance a ON a.employee_id = e.id AND a.date = d.day
       LEFT JOIN leaves l ON l.employee_id = e.id AND l.status='approved'
                          AND l.start_date <= d.day AND l.end_date >= d.day
       LEFT JOIN on_duty_requests o ON o.employee_id = e.id AND o.status='approved'
                          AND o.start_date <= d.day AND COALESCE(o.end_date, o.start_date) >= d.day
      WHERE e.status='active' AND e.deleted_at IS NULL AND e.is_user=TRUE
      ORDER BY e.employee_id, d.day`,
    [start, end]);
  return r.rows;
}

/* ── Onboarding Data — one row per new joiner ────────────────────────────── */
async function onboardingRows(start, end) {
  const r = await pool.query(
    `SELECT employee_id AS "Code", first_name || ' ' || COALESCE(last_name,'') AS "Name",
            department AS "Department", designation AS "Designation",
            date_of_joining::text AS "Joined", email AS "Email"
       FROM employees
      WHERE date_of_joining BETWEEN $1::date AND $2::date AND deleted_at IS NULL
      ORDER BY date_of_joining`,
    [start, end]);
  return r.rows;
}

/* ── Muster Roll — one row per employee, totals for the week ─────────────── */
async function musterRollRows(start, end) {
  const r = await pool.query(
    `SELECT e.employee_id AS "Code", e.first_name || ' ' || COALESCE(e.last_name,'') AS "Name",
            e.department AS "Department",
            COUNT(*) FILTER (WHERE a.check_in IS NOT NULL) AS "Present Days",
            COUNT(DISTINCT l.id) AS "Leave Records"
       FROM employees e
       LEFT JOIN attendance a ON a.employee_id = e.id AND a.date BETWEEN $1::date AND $2::date
       LEFT JOIN leaves l ON l.employee_id = e.id AND l.status='approved'
                          AND l.start_date <= $2::date AND l.end_date >= $1::date
      WHERE e.status='active' AND e.deleted_at IS NULL AND e.is_user=TRUE
      GROUP BY e.id, e.employee_id, e.first_name, e.last_name, e.department
      ORDER BY e.employee_id`,
    [start, end]);
  return r.rows;
}

/* ── Monthly Attendance — one row per employee, totals for the period ────── */
async function monthlyAttendanceRows(start, end) {
  const r = await pool.query(
    `SELECT e.employee_id AS "Code", e.first_name || ' ' || COALESCE(e.last_name,'') AS "Name",
            e.department AS "Department",
            COUNT(*) FILTER (WHERE a.check_in IS NOT NULL) AS "Present Days",
            COUNT(DISTINCT l.id) AS "Leave Records",
            COUNT(DISTINCT reg.id) AS "Regularizations Approved"
       FROM employees e
       LEFT JOIN attendance a ON a.employee_id = e.id AND a.date BETWEEN $1::date AND $2::date
       LEFT JOIN leaves l ON l.employee_id = e.id AND l.status='approved'
                          AND l.start_date <= $2::date AND l.end_date >= $1::date
       LEFT JOIN attendance_regularizations reg ON reg.employee_id = e.id AND reg.status='approved'
                          AND reg.date BETWEEN $1::date AND $2::date
      WHERE e.status='active' AND e.deleted_at IS NULL AND e.is_user=TRUE
      GROUP BY e.id, e.employee_id, e.first_name, e.last_name, e.department
      ORDER BY e.employee_id`,
    [start, end]);
  return r.rows;
}

/* Shared LOP row source for Payroll Feed and LOP Data — same numbers,
 * same call payroll.js itself makes, exported as full rows this time. */
async function lopRows(start, end) {
  const { loadHolidaysAndRules, lopDaysForRange } = require('../routes/payroll');
  const d = new Date(`${start}T00:00:00`);
  const { holMap, rules } = await loadHolidaysAndRules(d.getMonth() + 1, d.getFullYear());
  const emps = (await pool.query(
    `SELECT id, employee_id AS code, first_name || ' ' || COALESCE(last_name,'') AS name, department
       FROM employees WHERE status='active' AND deleted_at IS NULL AND is_user=TRUE ORDER BY employee_id`)).rows;
  const out = [];
  for (const e of emps) {
    const days = await lopDaysForRange(e.id, start, end, holMap, rules);
    if (days > 0) out.push({ 'Code': e.code, 'Name': e.name.trim(), 'Department': e.department || '', 'LOP Days': days });
  }
  return out;
}

/* ── Headcount — one row per department ──────────────────────────────────── */
async function headcountRows() {
  const r = await pool.query(
    `SELECT COALESCE(department, 'Unassigned') AS "Department", COUNT(*) AS "Active Headcount"
       FROM employees WHERE status='active' AND deleted_at IS NULL
      GROUP BY department ORDER BY "Active Headcount" DESC`);
  return r.rows;
}

/* ── Addition Trend — one row per joiner ─────────────────────────────────── */
async function additionTrendRows(start, end) {
  return onboardingRows(start, end);
}

/* ── Attrition Trend — one row per exit ──────────────────────────────────── */
async function attritionTrendRows(start, end) {
  const r = await pool.query(
    `SELECT employee_id AS "Code", first_name || ' ' || COALESCE(last_name,'') AS "Name",
            department AS "Department", designation AS "Designation", exit_date::text AS "Exit Date"
       FROM employees
      WHERE exit_date BETWEEN $1::date AND $2::date
      ORDER BY exit_date`,
    [start, end]);
  return r.rows;
}

/* ── Experience & Exit — one row per exit, with tenure ───────────────────── */
async function experienceExitRows(start, end) {
  const r = await pool.query(
    `SELECT employee_id AS code, first_name || ' ' || COALESCE(last_name,'') AS name,
            department, date_of_joining::text AS doj, exit_date::text AS exit_date,
            AGE(exit_date, date_of_joining) AS tenure
       FROM employees
      WHERE exit_date BETWEEN $1::date AND $2::date
      ORDER BY exit_date`,
    [start, end]);
  return r.rows.map(e => ({
    'Code': e.code, 'Name': e.name.trim(), 'Department': e.department || '',
    'Joined': e.doj, 'Exited': e.exit_date,
    'Tenure': e.tenure ? `${e.tenure.years || 0}y ${e.tenure.months || 0}m` : '',
  }));
}

const ROW_SOURCES = {
  dailyAttendance: (range) => dailyAttendanceRows(range.end),
  weeklyAttendance: (range) => weeklyAttendanceRows(range.start, range.end),
  onboardingData: (range) => onboardingRows(range.start, range.end),
  musterRoll: (range) => musterRollRows(range.start, range.end),
  monthlyAttendance: (range) => monthlyAttendanceRows(range.start, range.end),
  payrollFeed: (range) => lopRows(range.start, range.end),
  lopData: (range) => lopRows(range.start, range.end),
  headcount: () => headcountRows(),
  additionTrend: (range) => additionTrendRows(range.start, range.end),
  attritionTrend: (range) => attritionTrendRows(range.start, range.end),
  experienceExit: (range) => experienceExitRows(range.start, range.end),
};

const SHEET_NAMES = {
  dailyAttendance: 'Daily Attendance', weeklyAttendance: 'Weekly Attendance',
  onboardingData: 'Onboarding Data', musterRoll: 'Muster Roll',
  monthlyAttendance: 'Monthly Attendance', payrollFeed: 'Payroll Feed', lopData: 'LOP Data',
  headcount: 'Headcount', additionTrend: 'Addition Trend',
  attritionTrend: 'Attrition Trend', experienceExit: 'Experience & Exit',
};

/** Builds { filename, buffer } for a report's real Excel export, or null for
 *  a key with no export (the regularization reminder). `range` is whatever
 *  reportEmailSender's cadence resolution already produced for this send —
 *  callers pass the exact same range the email body itself used. */
async function buildExport(key, range) {
  const source = ROW_SOURCES[key];
  if (!source) return null;
  const rows = await source(range);
  const buffer = toXlsxBuffer(rows, SHEET_NAMES[key] || key);
  return { filename: `${SHEET_NAMES[key] || key}.xlsx`, buffer };
}

module.exports = { buildExport, toXlsxBuffer, ROW_SOURCES };
