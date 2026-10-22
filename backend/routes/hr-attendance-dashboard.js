/**
 * routes/hr-attendance-dashboard.js
 *
 * Read-only "HR Attendance Dashboard" — one aggregate endpoint (GET /) backing
 * the frontend page of the same name, plus one read-only export endpoint
 * (GET /export) that builds an .xlsx or .csv of a single chart's numbers.
 * Admin/Director/HR-admin see the whole company; Manager sees DIRECT reports
 * only — the same reportsScope() default (scope='direct') that GET
 * /team/leave-requests uses for the Leave Tracker's Team > Leave Requests
 * page, so the two screens agree on who is "in scope" for a manager. No
 * table here is ever written to; every number is a read, including exports.
 *
 * Deliberately its own router/file rather than an addition to dashboard.js —
 * the brief was "do not change any existing page, route, or feature", and a
 * brand-new, separately-mounted router is the only way to add this without
 * touching code that already ships.
 */
const express = require('express');
const router = express.Router();
const XLSX = require('xlsx');
const pool = require('../db');
const { protect } = require('../middleware/auth');
const { reportsScope } = require('../utils/roles');
const { countWorkingDays } = require('../utils/workingDays');
const { config: geofenceConfig } = require('../utils/geofence');
const { serverError } = require('../utils/serverError');

router.use(protect);

// Spec: "Visible and accessible ONLY to Admin and Manager roles." Enforced
// here directly rather than through the shared authorize() middleware, which
// only recognises a few fixed role-set "shapes" tied to the existing
// permission matrix (none of which is exactly {admin, manager}) — adding a
// new shape there would mean editing shared RBAC config for one page. A
// literal allow-list is the smallest, most isolated way to satisfy the spec.
// Applies to BOTH routes below (GET / and GET /export) since it's mounted
// before either with router.use — an Employee gets the same 403 from the
// export endpoint as from the dashboard itself.
const DASHBOARD_ROLES = ['admin', 'manager'];
router.use((req, res, next) => {
  if (!DASHBOARD_ROLES.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'You do not have access to the HR Attendance Dashboard.' });
  }
  next();
});

const ymd = (d) => (d instanceof Date ? d.toLocaleDateString('en-CA') : String(d).slice(0, 10));
const firstOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const lastOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const round1 = (n) => Math.round(n * 10) / 10;
const monthLabel = (d) => d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
const fullName = (r) => `${r.firstName || ''} ${r.lastName || ''}`.trim();

// reportsScope() hands back a clause referencing a single $N placeholder
// (used once or twice in the SQL, but only one value) plus that one param, if
// any. Layering an optional department filter on top means tracking how many
// param slots reportsScope actually used before assigning the next one.
// No 4th arg → reportsScope's default ('direct'), matching /team/leave-requests.
function scopeAndDept(user, alias, startIndex, department) {
  const scope = reportsScope(user, alias, startIndex);
  let clause = scope.clause;
  const params = [...scope.params];
  if (department) {
    params.push(department);
    clause += ` AND ${alias}.department = $${startIndex + params.length - 1}`;
  }
  return { clause, params };
}

// ── "Total Experience" parsing ────────────────────────────────────────────
// employees.total_experience is free text carried over from the Zoho import
// (migrate_fixes.js: VARCHAR(100)), rendered as-is on My Space > Profile >
// Work Information — e.g. "8 month(s)" or "9 year(s) 1 month(s)". There is no
// numeric column anywhere for current employees (routes/team.js's ex-employees
// endpoint computes tenure from dates instead, but explicitly because it
// considers this column unreliable for THAT purpose — the brief here asks for
// this field specifically, so it's used as asked). Parsed by pulling out a
// "N year" and/or "N month" figure; anything that matches neither is treated
// as missing rather than guessed at.
function parseExperienceToMonths(text) {
  if (!text) return null;
  const s = String(text).toLowerCase();
  const yearMatch = s.match(/(\d+(?:\.\d+)?)\s*year/);
  const monthMatch = s.match(/(\d+(?:\.\d+)?)\s*month/);
  if (!yearMatch && !monthMatch) return null;
  const years = yearMatch ? parseFloat(yearMatch[1]) : 0;
  const months = monthMatch ? parseFloat(monthMatch[1]) : 0;
  return years * 12 + months;
}

// Employee Productivity — isolated so the eventual real formula (still to be
// given by the product owner) replaces exactly this one function and nothing
// else. Behavior/value unchanged from before this refactor: total worked
// hours vs. expected hours for the scoped headcount over the range's working
// days, hidden (null) only when there is genuinely nothing to divide by.
// TODO: formula to be provided by the product owner.
function calculateEmployeeProductivity({ workedHours, expectedHoursPerDay, workingDaysInRange, totalEmployees }) {
  const expectedHoursTotal = workingDaysInRange * expectedHoursPerDay * totalEmployees;
  if (expectedHoursTotal <= 0) return null;
  return Math.min(100, round1((workedHours / expectedHoursTotal) * 100));
}

// ── Leave reason grouping ──────────────────────────────────────────────────
// Kept as one editable config object, as asked. Order matters: the first
// group whose keyword appears (as a whole word) in the normalized reason
// wins. Add/edit groups here only — nothing else needs to change.
const REASON_GROUPS = [
  { label: 'Sick Leave', keywords: ['sick', 'fever', 'cold', 'cough', 'flu', 'ill', 'illness', 'headache', 'doctor', 'hospital', 'medical', 'health', 'stomach', 'pain', 'ache', 'vomiting', 'nausea', 'infection'] },
  // Checked before 'Personal' and 'Family' so "personal function"/"family function"
  // match 'function' here rather than falling into those broader groups — and so
  // "marriage"/"wedding" (e.g. "Marriage Function") always land here, never as
  // their own title-cased bucket or under Family.
  { label: 'Function Leave', keywords: ['marriage', 'wedding', 'function'] },
  { label: 'Temple Visit', keywords: ['temple', 'religious', 'pooja', 'puja', 'pilgrimage'] },
  { label: 'Personal', keywords: ['personal'] },
  { label: 'Family', keywords: ['family', 'funeral', 'relative', 'anniversary'] },
  { label: 'Travel', keywords: ['travel', 'trip', 'vacation', 'holiday', 'outstation'] },
  { label: 'Emergency', keywords: ['emergency', 'urgent'] },
];
const normalizeReason = (text) => String(text || '').trim().toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
const titleCase = (s) => s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));
function groupOf(normalized) {
  for (const g of REASON_GROUPS) {
    if (g.keywords.some((kw) => new RegExp(`\\b${kw}\\b`).test(normalized))) return g.label;
  }
  return titleCase(normalized);
}

// Leave types this org actually has, read from leave_types (not hardcoded) —
// used for Leave Type Distribution's labels/pie and for the Monthly Absence
// Trend's absence-type matching. leave_types.code spells Compensatory Off
// "compoff" (no underscore); leaves.leave_type spells it "comp_off" — the
// same translation used everywhere else on this page.
async function getLeaveTypeNames() {
  const r = await pool.query(`SELECT code, name FROM leave_types`);
  const nameByCode = new Map(r.rows.map(x => [x.code === 'compoff' ? 'comp_off' : x.code, x.name]));
  return { rows: r.rows, nameByCode };
}

// ── Scope: who is in this request's view ───────────────────────────────────
// Shared by both GET / and GET /export, so a manager's export can never see
// more than their own dashboard already shows them.
async function getScope(req) {
  const department = req.query.department && req.query.department !== 'All' ? String(req.query.department).trim() : null;
  const unfiltered = scopeAndDept(req.user, 'e', 1, null);
  const empRes = await pool.query(
    // joiningDate prefers date_of_joining (what the bulk employee importer
    // writes) over joining_date (a separate column that defaults to the row's
    // creation time when nothing sets it) — getAttendanceByDepartment() uses
    // this to cap a mid-range joiner's working-day count correctly even for
    // employees whose joining_date is unset/stale.
    `SELECT id, employee_id AS "employeeCode", first_name AS "firstName", last_name AS "lastName",
            department, COALESCE(date_of_joining, joining_date) AS "joiningDate", total_experience AS "totalExperience"
       FROM employees e
      WHERE e.status = 'active' AND e.deleted_at IS NULL${unfiltered.clause}`,
    unfiltered.params
  );
  const allScopedEmployees = empRes.rows;
  const departmentsInScope = [...new Set(allScopedEmployees.map(e => e.department).filter(Boolean))].sort();
  const scopedEmployees = department ? allScopedEmployees.filter(e => e.department === department) : allScopedEmployees;
  const employeeById = new Map(allScopedEmployees.map(e => [e.id, e]));

  const allEmployeeIdsParam = allScopedEmployees.length ? allScopedEmployees.map(e => e.id) : ['00000000-0000-0000-0000-000000000000'];
  const yearsRes = await pool.query(
    `SELECT DISTINCT EXTRACT(YEAR FROM start_date)::int AS y FROM leaves WHERE employee_id = ANY($1::uuid[]) ORDER BY y`,
    [allEmployeeIdsParam]
  );
  const yearsWithData = yearsRes.rows.map(r => r.y);

  const idsParam = scopedEmployees.length ? scopedEmployees.map(e => e.id) : ['00000000-0000-0000-0000-000000000000'];
  return { department, allScopedEmployees, scopedEmployees, employeeById, departmentsInScope, yearsWithData, idsParam, totalEmployees: scopedEmployees.length };
}

// ── Date range: shared parsing + validation for both routes. ───────────────
function getRange(req) {
  const today = new Date();
  const to = req.query.to ? new Date(`${req.query.to}T00:00:00`) : today;
  const from = req.query.from ? new Date(`${req.query.from}T00:00:00`) : firstOfMonth(today);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return null;
  return { from, to, fromStr: ymd(from), toStr: ymd(to) };
}

// ── Leaves "in range" — ONE rule, used by every leave-based card and every
// export on this page: a request belongs to the range if its OWN leave dates
// (start_date..end_date) overlap [from, to]. This used to also pull in a
// request if it was merely APPLIED inside the window regardless of which
// dates it actually covered (e.g. filed on the 10th for leave entirely in a
// different month) — dropped, because that is exactly the "wrong month"
// symptom: a request for leave in a different month, or even a different
// year, would still show up under the month it happened to be filed in. Pure
// date-overlap is the one rule now. No leave_type filter, same as the Leave
// Tracker's Team > Leave Requests page. Status compared case-insensitively.
// Joined to employees so this one query can feed both the dashboard's
// aggregates and an export's Details rows without a second round trip. ─────
async function getInRangeLeaves(idsParam, fromStr, toStr) {
  const r = await pool.query(
    `SELECT l.id, l.employee_id AS "employeeId", e.employee_id AS "employeeCode",
            e.first_name AS "firstName", e.last_name AS "lastName", e.department,
            l.leave_type AS "leaveType", LOWER(l.status) AS status,
            l.start_date AS "startDate", l.end_date AS "endDate",
            l.total_days AS "totalDays", l.hours, l.reason,
            l.is_half_day AS "isHalfDay", l.half_day_type AS "halfDayType"
       FROM leaves l JOIN employees e ON e.id = l.employee_id
      WHERE l.employee_id = ANY($1::uuid[])
        AND l.start_date <= $3::date AND l.end_date >= $2::date`,
    [idsParam, fromStr, toStr]
  );
  return r.rows;
}

// ── Monthly Leave Pattern — the full calendar month of the applied END date
// (`to`), one point per day, each point the number of DISTINCT employees on
// an approved-or-pending leave that day. Pending + Approved only — a
// rejected or cancelled request never became a day anyone was actually away.
// Returns both the chart's points AND the raw per-request rows (with
// employee join info), so GET /export can build its Details sheet from the
// exact same data the chart itself is drawn from. ──────────────────────────
async function getMonthlyLeavePattern(idsParam, to) {
  const monthStart = firstOfMonth(to), monthEnd = lastOfMonth(to);
  const r = await pool.query(
    `SELECT l.employee_id AS "employeeId", e.employee_id AS "employeeCode",
            e.first_name AS "firstName", e.last_name AS "lastName", e.department,
            l.leave_type AS "leaveType", LOWER(l.status) AS status,
            l.start_date AS "startDate", l.end_date AS "endDate",
            l.is_half_day AS "isHalfDay", l.half_day_type AS "halfDayType", l.reason
       FROM leaves l JOIN employees e ON e.id = l.employee_id
      WHERE l.employee_id = ANY($1::uuid[])
        AND LOWER(l.status) IN ('pending', 'approved')
        AND l.start_date <= $3::date AND l.end_date >= $2::date`,
    [idsParam, ymd(monthStart), ymd(monthEnd)]
  );
  const dayEmployees = new Map(); // dateStr -> Set(employeeId)
  const dayRows = new Map(); // dateStr -> [detail row, ...]
  for (const l of r.rows) {
    const leaveStart = new Date(`${ymd(new Date(l.startDate))}T00:00:00`);
    const leaveEnd = new Date(`${ymd(new Date(l.endDate))}T00:00:00`);
    const segStart = leaveStart > monthStart ? leaveStart : monthStart;
    const segEnd = leaveEnd < monthEnd ? leaveEnd : monthEnd;
    for (let d = new Date(segStart); d <= segEnd; d.setDate(d.getDate() + 1)) {
      const key = ymd(d);
      if (!dayEmployees.has(key)) { dayEmployees.set(key, new Set()); dayRows.set(key, []); }
      dayEmployees.get(key).add(l.employeeId);
      dayRows.get(key).push(l);
    }
  }
  const points = [];
  for (let d = new Date(monthStart); d <= monthEnd; d.setDate(d.getDate() + 1)) {
    const key = ymd(d);
    points.push({ date: key, day: d.getDate(), count: dayEmployees.get(key)?.size || 0 });
  }
  return { points, monthStart, monthEnd, label: monthLabel(to), dayRows };
}

// ── Monthly Absence Trend — always the last 3 calendar months ending at
// `to`'s month, independent of the from/to filter. Each point is absence
// DAYS in that month, from the SAME source and rules as the KPI cards: the
// `leaves` table only, Pending + Approved only (excluding Rejected and
// Cancelled), same role/department scope, working days only, half-day
// leaves counted as 0.5. The current (3rd) month is capped at the applied
// `to` date — the two earlier months are always complete calendar months,
// since `to` only ever falls within the 3rd month's range. Returns rich
// per-month data (day total, distinct request count, distinct employee
// count, and the raw detail rows with their per-month day split) so the
// dashboard's simple {month,label,count} points and an export's full
// Summary+Details sheets both come from exactly one computation — never
// two that could drift. ─────────────────────────────────────────────────
async function getAbsenceTrendByMonth(idsParam, to, typeNamesRes) {
  const m2 = firstOfMonth(to), m1 = addMonths(to, -1), m0 = addMonths(to, -2);
  const trendStart = m0, trendEnd = to < lastOfMonth(m2) ? to : lastOfMonth(m2);

  // Absence-day types for this chart only — Casual Leave, Leave Without Pay,
  // Compensatory Off. Permission is deliberately excluded: it is hourly, and
  // no other card on this dashboard expresses permission as a day-equivalent
  // — crediting a fraction of a day for it here would be a new rule, not an
  // existing card's rule, so none is invented.
  const ABSENCE_LEAVE_TYPE_NAMES = new Set(['casual leave', 'leave without pay', 'compensatory off']);
  const absenceTypeCodes = new Set(
    typeNamesRes.rows
      .filter(r => ABSENCE_LEAVE_TYPE_NAMES.has(String(r.name || '').trim().toLowerCase()))
      .map(r => (r.code === 'compoff' ? 'comp_off' : r.code))
  );

  const trendLeavesRes = await pool.query(
    `SELECT l.id, l.employee_id AS "employeeId", e.employee_id AS "employeeCode",
            e.first_name AS "firstName", e.last_name AS "lastName", e.department,
            l.leave_type AS "leaveType", LOWER(l.status) AS status,
            l.start_date::text AS "startDate", l.end_date::text AS "endDate", l.reason,
            l.is_half_day AS "isHalfDay", l.half_day_type AS "halfDayType"
       FROM leaves l JOIN employees e ON e.id = l.employee_id
      WHERE l.employee_id = ANY($1::uuid[])
        AND LOWER(l.status) IN ('pending', 'approved')
        AND l.start_date <= $3::date AND l.end_date >= $2::date`,
    [idsParam, ymd(trendStart), ymd(trendEnd)]
  );

  const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const months = [m0, m1, m2];
  const byMonth = new Map(months.map(m => [monthKey(m), {
    date: m, label: monthLabel(m), absenceDays: 0, requestIds: new Set(), employeeIds: new Set(), details: [],
  }]));

  for (const l of trendLeavesRes.rows) {
    if (!absenceTypeCodes.has(l.leaveType)) continue;
    const leaveStart = new Date(`${l.startDate}T00:00:00`);
    const leaveEnd = new Date(`${l.endDate}T00:00:00`);
    for (const m of months) {
      // The current (3rd) month is capped at the applied end date, so a
      // leave day after it is never counted; the two earlier months are
      // always complete, since `to` can't fall inside them.
      const mEnd = m === m2 ? trendEnd : lastOfMonth(m);
      const segStart = leaveStart > m ? leaveStart : m;
      const segEnd = leaveEnd < mEnd ? leaveEnd : mEnd;
      if (segStart > segEnd) continue;
      // Working days only, via the same countWorkingDays() the rest of the
      // dashboard (and leaves.js itself) already uses. A half-day leave
      // counts as half a day, same as a half-day holiday already does
      // inside countWorkingDays() itself.
      const workingDays = await countWorkingDays(segStart, segEnd);
      const segDays = l.isHalfDay ? workingDays * 0.5 : workingDays;
      const bucket = byMonth.get(monthKey(m));
      if (segDays > 0) {
        bucket.absenceDays += segDays;
        bucket.requestIds.add(l.id);
        bucket.employeeIds.add(l.employeeId);
        bucket.details.push({ ...l, daysInMonth: segDays, segStart: ymd(segStart), segEnd: ymd(segEnd) });
      }
    }
  }

  return { months, byMonth, monthKey };
}

// ── Attendance Rate by Department ───────────────────────────────────────────
// Formula (changed 2026-10-22, Option A — hours-based, full target kept
// regardless of leave):
//
//   Attendance % = (Actual Worked Hours / Expected Working Hours) × 100
//
// Actual Worked Hours, PER EMPLOYEE: the sum of attendance.working_hours
// across every attendance row in [effectiveStart, appliedTo] — the exact
// same column, summed the exact same way, that Employee Productivity
// already uses on this same dashboard (see workedHours above). A day with
// no attendance row contributes 0, same as it already does there — never
// invented, never inferred from a leave or permission record. No row is
// ever read twice: one row per employee per date is already guaranteed by
// the table's own UNIQUE(employee_id, date) constraint.
//
// Expected Working Hours, PER EMPLOYEE: Applicable Working Days × 8.5 — the
// standard 8-hour-30-minute working day specified for THIS chart. This is a
// deliberately separate figure from settings.expected_hours_per_day (used
// by Employee Productivity, currently 8.00 in this database) — the brief
// for this chart names 8.5 explicitly, with its own worked example, so it's
// a fixed constant here rather than reading that other, differently-valued
// setting.
//
// Applicable Working Days: countWorkingDays() — the same existing utility
// (utils/workingDays.js) Monthly Absence Trend and Employee Productivity
// already use, over [max(appliedFrom, employee's own joining date),
// appliedTo]. Unchanged from the previous version of this function.
//
// Option A — leave/permission/LOP do NOT reduce the expected-hours target.
// A Casual Leave, LOP, half-day leave, or Permission day still demands its
// full 8.5 hours; nothing here reads the leaves table at all any more, so
// there is nothing to double-count against attendance rows either. An
// Absent-status row is never read as evidence of leave — it simply
// contributes whatever its own working_hours value is (0, if none was
// recorded), like any other day.
//
// Percentage is NOT capped at 100 — if a department's or employee's actual
// hours exceed their expected target, that is shown as-is (see the PATCH
// NOTES in my reply for what this round's real data showed and why).
//
// Joining date: COALESCE(date_of_joining, joining_date) — see getScope().
async function getAttendanceByDepartment(idsParam, fromStr, toStr, scope) {
  const STANDARD_HOURS_PER_DAY = 8.5;
  const rangeFrom = new Date(`${fromStr}T00:00:00`);
  const rangeTo = new Date(`${toStr}T00:00:00`);

  // Expected Hours only ever counts COMPLETED working days. When the applied
  // range reaches into today (or beyond — a future-dated custom range), the
  // working-day count that feeds Expected Hours is capped at yesterday;
  // today isn't over yet, so it can't be a completed day no matter what time
  // it currently is. `ymd()` + the 'T00:00:00' re-parse is the same
  // local-calendar-day pattern already used everywhere else in this file
  // (e.g. the leave-date handling above) — it reads "today" in the server's
  // own local timezone, not UTC, avoiding the day-early shift a bare
  // `new Date()`/`toISOString()` would risk east of Greenwich.
  //
  // Actual Worked Hours is NOT affected — it still reads every attendance
  // row through the real, un-capped rangeTo (see rowsInRange below), so any
  // hours an employee has already logged today are still credited; only the
  // denominator excludes the incomplete day.
  const todayMidnight = new Date(`${ymd(new Date())}T00:00:00`);
  const yesterday = new Date(todayMidnight);
  yesterday.setDate(yesterday.getDate() - 1);
  const expectedHoursRangeTo = rangeTo >= todayMidnight ? yesterday : rangeTo;

  const attRes = await pool.query(
    `SELECT employee_id AS "employeeId", date::text AS date, COALESCE(working_hours, 0) AS "workingHours"
       FROM attendance
      WHERE employee_id = ANY($1::uuid[]) AND date BETWEEN $2::date AND $3::date`,
    [idsParam, fromStr, toStr]
  );
  const attendanceByEmployee = new Map();
  for (const r of attRes.rows) {
    if (!attendanceByEmployee.has(r.employeeId)) attendanceByEmployee.set(r.employeeId, []);
    attendanceByEmployee.get(r.employeeId).push(r);
  }

  const employees = idsParam
    .map(id => scope.employeeById.get(id))
    .filter(e => e && e.department);

  const byEmployee = [];
  const deptTotals = new Map(); // department -> { employees, actualHours, expectedHours }

  for (const emp of employees) {
    const joinDate = emp.joiningDate ? new Date(emp.joiningDate) : null;
    const effectiveStart = joinDate && joinDate > rangeFrom ? joinDate : rangeFrom;

    const applicableWorkingDays = effectiveStart <= expectedHoursRangeTo ? await countWorkingDays(effectiveStart, expectedHoursRangeTo) : 0;
    const expectedHours = round1(applicableWorkingDays * STANDARD_HOURS_PER_DAY);

    const rowsInRange = (attendanceByEmployee.get(emp.id) || [])
      .filter(r => r.date >= ymd(effectiveStart) && r.date <= ymd(rangeTo));
    const actualHours = round1(rowsInRange.reduce((sum, r) => sum + (parseFloat(r.workingHours) || 0), 0));

    const pct = expectedHours > 0 ? round1((actualHours / expectedHours) * 100) : 0;

    byEmployee.push({
      employeeCode: emp.employeeCode, name: fullName(emp), department: emp.department,
      actualHours, expectedHours, applicableWorkingDays: round1(applicableWorkingDays), pct,
    });

    if (!deptTotals.has(emp.department)) deptTotals.set(emp.department, { employees: 0, actualHours: 0, expectedHours: 0 });
    const dt = deptTotals.get(emp.department);
    dt.employees += 1;
    dt.actualHours += actualHours;
    dt.expectedHours += expectedHours;
  }

  const byDepartment = [...deptTotals.entries()]
    .map(([department, t]) => ({
      department, employees: t.employees,
      actualHours: round1(t.actualHours), expectedHours: round1(t.expectedHours),
      pct: t.expectedHours > 0 ? round1((t.actualHours / t.expectedHours) * 100) : 0,
    }))
    .sort((a, b) => b.pct - a.pct);

  return { byDepartment, byEmployee };
}

router.get('/', async (req, res) => {
  try {
    const range = getRange(req);
    if (!range) return res.status(400).json({ success: false, message: 'Invalid date range.' });
    const { from, to, fromStr, toStr } = range;
    const scope = await getScope(req);
    const { idsParam, scopedEmployees, departmentsInScope, yearsWithData, totalEmployees } = scope;

    const inRangeLeaves = await getInRangeLeaves(idsParam, fromStr, toStr);

    // Total Leave Requests = all requests in range, excluding Cancelled.
    const nonCancelled = inRangeLeaves.filter(l => l.status !== 'cancelled');
    const totalLeaveRequests = nonCancelled.length;
    const approvedCount = nonCancelled.filter(l => l.status === 'approved').length;
    const rejectedCount = nonCancelled.filter(l => l.status === 'rejected').length;
    const pendingCount = nonCancelled.filter(l => l.status === 'pending').length;
    const leaveApprovalRate = (approvedCount + rejectedCount) > 0
      ? Math.round((approvedCount / (approvedCount + rejectedCount)) * 100)
      : null;
    const leaveApprovalRateSub = `${approvedCount} approved · ${rejectedCount} rejected · ${pendingCount} pending`;

    const typeNamesRes = await getLeaveTypeNames();

    // ── Leave type distribution — same nonCancelled set as the KPIs above,
    // so the dashboard agrees with itself. Built purely from leave_type
    // values that actually appear on a leaves row in range, so a configured
    // type with zero requests (or one this org has never had, like Sick)
    // simply never appears — nothing here is a hardcoded placeholder list. ─
    const typeCounts = new Map(); // code -> { count, days }
    for (const l of nonCancelled) {
      if (!typeCounts.has(l.leaveType)) typeCounts.set(l.leaveType, { count: 0, days: 0 });
      const t = typeCounts.get(l.leaveType);
      t.count++;
      t.days += parseFloat(l.totalDays) || 0;
    }
    const leaveTypeDistribution = [...typeCounts.entries()].map(([code, t]) => ({
      code,
      label: typeNamesRes.nameByCode.get(code) || (code.charAt(0).toUpperCase() + code.slice(1).replace('_', ' ')),
      count: t.count,
      days: round1(t.days),
      pct: nonCancelled.length ? round1((t.count / nonCancelled.length) * 100) : 0,
    })).sort((a, b) => b.count - a.count);

    // ── Top Leave Reasons — grouped from the free-text Reason field of the
    // same nonCancelled set. ───────────────────────────────────────────────
    const reasonGroups = new Map(); // label -> { count, examples: Set }
    let withReasonCount = 0;
    for (const l of nonCancelled) {
      const normalized = normalizeReason(l.reason);
      if (!normalized) continue;
      withReasonCount++;
      const label = groupOf(normalized);
      if (!reasonGroups.has(label)) reasonGroups.set(label, { count: 0, examples: new Set() });
      const g = reasonGroups.get(label);
      g.count++;
      g.examples.add(String(l.reason).trim());
    }
    let reasonList = [...reasonGroups.entries()]
      .map(([label, g]) => ({ label, count: g.count, examples: [...g.examples].slice(0, 6) }))
      .sort((a, b) => b.count - a.count);
    if (reasonList.length > 6) {
      const top = reasonList.slice(0, 6);
      const rest = reasonList.slice(6);
      const otherCount = rest.reduce((s, r) => s + r.count, 0);
      const otherExamples = rest.flatMap(r => r.examples).slice(0, 6);
      reasonList = [...top, { label: 'Other', count: otherCount, examples: otherExamples }];
    }
    const topLeaveReasons = {
      groups: reasonList.map(r => ({
        label: r.label, count: r.count, examples: r.examples,
        pct: nonCancelled.length ? round1((r.count / nonCancelled.length) * 100) : 0,
      })),
      hasAnyReason: withReasonCount > 0,
      insight: reasonList.length
        ? `Most leaves this period are for ${reasonList[0].label} (${nonCancelled.length ? round1((reasonList[0].count / nonCancelled.length) * 100) : 0}%).`
        : null,
    };

    // ── Monthly Leave Pattern — see getMonthlyLeavePattern() above. Fixed:
    // this used to always show the calendar month BEFORE `to`'s month,
    // completely ignoring the applied `from` — e.g. applying "September
    // 2026" showed August. It also counted leave REQUESTS per day rather
    // than distinct EMPLOYEES, and included Rejected requests (anything
    // "not cancelled" rather than "pending or approved"). All three are
    // fixed here: see the PATCH NOTES in my reply for the before/after
    // numbers checked against the database. ────────────────────────────────
    const pattern = await getMonthlyLeavePattern(idsParam, to);
    const monthlyLeavePattern = pattern.points;
    const monthlyLeavePatternLabel = pattern.label;

    // ── Experience groups — from employees.total_experience (free text),
    // NOT date of joining (that field exists, so the brief says to use it).
    // Current workforce only — ignores the date range on purpose. ─────────
    const BUCKETS = [
      { label: '0-1', max: 12 }, { label: '1-3', max: 36 }, { label: '3-5', max: 60 },
      { label: '5-10', max: 120 }, { label: '10+', max: Infinity },
    ];
    const bucketCounts = Object.fromEntries(BUCKETS.map(b => [b.label, 0]));
    let experienceNoDataCount = 0;
    for (const e of scopedEmployees) {
      const months = parseExperienceToMonths(e.totalExperience);
      if (months === null || months < 0) { experienceNoDataCount++; continue; }
      const bucket = BUCKETS.find(b => months < b.max) || BUCKETS[BUCKETS.length - 1];
      bucketCounts[bucket.label]++;
    }
    const experienceGroups = BUCKETS.map(b => ({ label: b.label, count: bucketCounts[b.label] }));

    // ── Workforce Overview + Employee Productivity (attendance rows in
    // [from, to]). Attendance rows in this app are only ever created for
    // days the employee was expected to work (confirmed from the existing
    // department-attendance query in routes/dashboard.js, which applies no
    // separate weekend/holiday filter) — so no extra working-day filter is
    // applied here either, to stay consistent with that precedent. ────────
    const attRes = await pool.query(
      `SELECT status, COALESCE(working_hours, 0) AS "workingHours", work_mode AS "workMode", date
         FROM attendance
        WHERE employee_id = ANY($1::uuid[]) AND date BETWEEN $2::date AND $3::date`,
      [idsParam, fromStr, toStr]
    );
    const attendanceRows = attRes.rows;
    const presentCount = attendanceRows.filter(r => r.status === 'present' || r.status === 'late').length;
    const absentCount = attendanceRows.filter(r => r.status === 'absent').length;
    const presentAbsentTotal = presentCount + absentCount;
    const workforceOverview = presentAbsentTotal > 0
      ? { attendancePct: round1((presentCount / presentAbsentTotal) * 100), absencePct: round1((absentCount / presentAbsentTotal) * 100) }
      : { attendancePct: null, absencePct: null };

    // Productivity: see calculateEmployeeProductivity() above — on hold,
    // formula unchanged, just isolated into one function.
    const workedHours = attendanceRows.reduce((sum, r) => sum + (parseFloat(r.workingHours) || 0), 0);
    const settingsRes = await pool.query(`SELECT expected_hours_per_day AS hours FROM settings LIMIT 1`);
    const expectedHoursPerDay = parseFloat(settingsRes.rows[0]?.hours) || 8;
    const workingDaysInRange = await countWorkingDays(from, to);
    const employeeProductivity = calculateEmployeeProductivity({
      workedHours, expectedHoursPerDay, workingDaysInRange, totalEmployees,
    });

    // ── Work mode (WFO/WFH) — per-day classification can be switched off
    // company-wide (Settings → Attendance → Geofencing); when it is, every
    // attendance row's work_mode is null, so the chart would misleadingly
    // read "0 / 0" instead of explaining why. ─────────────────────────────
    const geoCfg = await geofenceConfig().catch(() => ({ classifyEnabled: false }));
    const classifyEnabled = !!geoCfg.classifyEnabled;
    let workMode = { classifyEnabled, totals: { wfo: 0, wfh: 0 }, trend: [] };
    if (classifyEnabled) {
      const byDate = new Map();
      for (const r of attendanceRows) {
        if (r.workMode !== 'office' && r.workMode !== 'wfh') continue;
        const key = ymd(new Date(r.date));
        if (!byDate.has(key)) byDate.set(key, { wfo: 0, wfh: 0 });
        byDate.get(key)[r.workMode === 'office' ? 'wfo' : 'wfh']++;
      }
      const days = [...byDate.keys()].sort();
      const totals = days.reduce((acc, d) => ({ wfo: acc.wfo + byDate.get(d).wfo, wfh: acc.wfh + byDate.get(d).wfh }), { wfo: 0, wfh: 0 });
      const rangeDays = Math.round((to - from) / 86400000) + 1;
      let trend;
      if (rangeDays <= 31) {
        trend = days.map(d => ({ label: d.slice(5), ...byDate.get(d) }));
      } else {
        const byMonth = new Map();
        for (const d of days) {
          const mKey = d.slice(0, 7);
          if (!byMonth.has(mKey)) byMonth.set(mKey, { wfo: 0, wfh: 0 });
          byMonth.get(mKey).wfo += byDate.get(d).wfo;
          byMonth.get(mKey).wfh += byDate.get(d).wfh;
        }
        trend = [...byMonth.keys()].sort().map(m => ({ label: m, ...byMonth.get(m) }));
      }
      workMode = { classifyEnabled, totals, trend, rangeDays };
    }

    const trend = await getAbsenceTrendByMonth(idsParam, to, typeNamesRes);
    const absenceTrend = trend.months.map(m => {
      const b = trend.byMonth.get(trend.monthKey(m));
      return { month: trend.monthKey(m), label: b.label, count: round1(b.absenceDays) };
    });

    const dept = await getAttendanceByDepartment(idsParam, fromStr, toStr, scope);
    const attendanceByDepartment = dept.byDepartment;

    res.json({
      success: true,
      range: { from: fromStr, to: toStr },
      scope: { departmentsInScope, yearsWithData },
      kpis: {
        totalEmployees,
        totalLeaveRequests,
        leaveApprovalRate,
        leaveApprovalRateSub,
        employeeProductivity,
      },
      workforceOverview,
      workMode,
      absenceTrend,
      leaveTypeDistribution,
      topLeaveReasons,
      monthlyLeavePattern,
      monthlyLeavePatternLabel,
      experienceGroups,
      experienceNoDataCount,
      attendanceByDepartment,
    });
  } catch (err) {
    serverError(res, err);
  }
});

// ════════════════════════════════════════════════════════════════════════
//  EXPORT — GET /export?chart=&format=&from=&to=&department=
//  Read-only. Builds the SAME numbers as the dashboard (reusing the exact
//  same scope/range/query helpers above) into an .xlsx (Summary + Details)
//  or .csv (Summary only). PNG is not handled here — the brief has that made
//  client-side from the chart itself.
// ════════════════════════════════════════════════════════════════════════

// Any string cell starting with =, +, - or @ is prefixed with an apostrophe
// so Excel/Sheets can never interpret a leave reason (or anything else an
// employee typed) as a formula when the file is opened.
function safeText(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /^[=+\-@]/.test(s) ? `'${s}` : s;
}
const dmy = (d) => {
  const dt = d instanceof Date ? d : new Date(`${String(d).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return '';
  return `${String(dt.getDate()).padStart(2, '0')}-${String(dt.getMonth() + 1).padStart(2, '0')}-${dt.getFullYear()}`;
};
const halfDayLabel = (l) => !l.isHalfDay ? 'Full Day' : (l.halfDayType === 'first_half' ? 'First Half' : 'Second Half');

// Builds one worksheet: a title block, then a header row, then data rows.
// dateCols/pctCols are 0-based column indexes to apply DD-MM-YYYY / 0.0%
// number formats to (real Date objects / fractions go in those columns).
function buildSheet(titleLines, headers, rows, { dateCols = [], pctCols = [] } = {}) {
  const data = [...titleLines.map(t => [t]), [], headers, ...rows];
  const headerRowIndex = titleLines.length + 1;
  const ws = XLSX.utils.aoa_to_sheet(data);
  if (rows.length) {
    const range = { s: { r: headerRowIndex + 1, c: 0 }, e: { r: headerRowIndex + rows.length, c: headers.length - 1 } };
    for (let r = range.s.r; r <= range.e.r; r++) {
      // aoa_to_sheet turns a JS Date into a NUMERIC cell (t:'n', the Excel
      // date serial) with its own default format, not a 'd'-typed cell — so
      // this only checks the cell exists, not its type, or the format would
      // silently never apply.
      for (const c of dateCols) {
        const ref = XLSX.utils.encode_cell({ r, c });
        if (ws[ref]) ws[ref].z = 'dd-mm-yyyy';
      }
      for (const c of pctCols) {
        const ref = XLSX.utils.encode_cell({ r, c });
        if (ws[ref]) ws[ref].z = '0.0%';
      }
    }
  }
  ws['!cols'] = headers.map((h) => ({ wch: Math.max(14, String(h).length + 4) }));
  const headerRef = XLSX.utils.encode_cell({ r: headerRowIndex, c: 0 });
  const lastCellRef = XLSX.utils.encode_cell({ r: headerRowIndex + rows.length, c: headers.length - 1 });
  ws['!autofilter'] = { ref: `${headerRef}:${lastCellRef}` };
  return ws;
}

function periodLabel(from, to) {
  const isWholeMonth = ymd(from) === ymd(firstOfMonth(from)) && ymd(to) === ymd(lastOfMonth(from))
    && from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear();
  if (isWholeMonth) return monthLabel(from);
  return `${dmy(from)} to ${dmy(to)}`;
}
function periodFileLabel(from, to) {
  const isWholeMonth = ymd(from) === ymd(firstOfMonth(from)) && ymd(to) === ymd(lastOfMonth(from))
    && from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear();
  if (isWholeMonth) return from.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }).replace(' ', '-');
  return `${dmy(from)}_to_${dmy(to)}`.replace(/-/g, '');
}

const CHART_FILE_NAMES = {
  workMode: 'Work-Mode', absenceTrend: 'Monthly-Absence-Trend', leaveTypeDistribution: 'Leave-Type-Distribution',
  monthlyLeavePattern: 'Monthly-Leave-Pattern', experienceGroups: 'Experience-Groups',
  attendanceByDepartment: 'Attendance-by-Department', topLeaveReasons: 'Top-Leave-Reasons',
};
const CHART_TITLES = {
  workMode: 'Employee Count by Work Mode', absenceTrend: 'Monthly Absence Trend — Last 3 Months',
  leaveTypeDistribution: 'Leave Type Distribution', monthlyLeavePattern: 'Monthly Leave Pattern',
  experienceGroups: 'Employees by Experience Group', attendanceByDepartment: 'Attendance Rate by Department',
  topLeaveReasons: 'Top Leave Reasons',
};

router.get('/export', async (req, res) => {
  try {
    const chart = String(req.query.chart || '');
    const format = String(req.query.format || 'xlsx').toLowerCase();
    if (!CHART_TITLES[chart]) return res.status(400).json({ success: false, message: 'Unknown chart.' });
    if (!['xlsx', 'csv'].includes(format)) return res.status(400).json({ success: false, message: 'Unknown format.' });

    const range = getRange(req);
    if (!range) return res.status(400).json({ success: false, message: 'Invalid date range.' });
    const { from, to, fromStr, toStr } = range;
    const scope = await getScope(req);
    const { idsParam } = scope;
    const period = periodLabel(from, to);
    const deptLabel = scope.department || 'All';
    const exportedAt = new Date();
    const titleLines = [
      `${CHART_TITLES[chart]} — HR Attendance Dashboard`,
      `Period: ${period}    Department: ${deptLabel}    Exported: ${dmy(exportedAt)} ${exportedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`,
    ];

    let summaryHeaders, summaryRows, summaryOpts = {};
    let detailsHeaders = null, detailsRows = null, detailsOpts = {};

    if (chart === 'leaveTypeDistribution' || chart === 'topLeaveReasons') {
      var inRangeLeaves = await getInRangeLeaves(idsParam, fromStr, toStr);
      var nonCancelled = inRangeLeaves.filter(l => l.status !== 'cancelled');
    }

    if (chart === 'workMode') {
      const attRes = await pool.query(
        `SELECT a.date::text AS date, a.employee_id AS "employeeId", e.employee_id AS "employeeCode",
                e.first_name AS "firstName", e.last_name AS "lastName", e.department, a.work_mode AS "workMode"
           FROM attendance a JOIN employees e ON e.id = a.employee_id
          WHERE a.employee_id = ANY($1::uuid[]) AND a.date BETWEEN $2::date AND $3::date
            AND a.work_mode IN ('office','wfh')
          ORDER BY a.date`,
        [idsParam, fromStr, toStr]
      );
      const wfo = attRes.rows.filter(r => r.workMode === 'office').length;
      const wfh = attRes.rows.filter(r => r.workMode === 'wfh').length;
      summaryHeaders = ['Work Mode', 'Person-Days'];
      summaryRows = [['Work From Office', wfo], ['Work From Home', wfh]];
      detailsHeaders = ['Date', 'Employee ID', 'Employee Name', 'Department', 'Work Mode'];
      detailsRows = attRes.rows.map(r => [
        new Date(`${r.date}T00:00:00`), safeText(r.employeeCode), safeText(fullName(r)), safeText(r.department),
        r.workMode === 'office' ? 'Work From Office' : 'Work From Home',
      ]);
      detailsOpts = { dateCols: [0] };
    }

    if (chart === 'absenceTrend') {
      const typeNamesRes = await getLeaveTypeNames();
      const trend = await getAbsenceTrendByMonth(idsParam, to, typeNamesRes);
      summaryHeaders = ['Month', 'Absence Days', 'Leave Requests', 'Employees on Leave'];
      summaryRows = trend.months.map(m => {
        const b = trend.byMonth.get(trend.monthKey(m));
        return [b.label, round1(b.absenceDays), b.requestIds.size, b.employeeIds.size];
      });
      detailsHeaders = ['Month', 'Employee ID', 'Employee Name', 'Department', 'Leave Type', 'From', 'To', 'Days (in month)', 'Status', 'Reason'];
      detailsRows = [];
      for (const m of trend.months) {
        const b = trend.byMonth.get(trend.monthKey(m));
        for (const l of b.details) {
          detailsRows.push([
            b.label, safeText(l.employeeCode), safeText(fullName(l)), safeText(l.department),
            safeText(typeNamesRes.nameByCode.get(l.leaveType) || l.leaveType),
            new Date(`${l.startDate}T00:00:00`), new Date(`${l.endDate}T00:00:00`), l.daysInMonth,
            titleCase(l.status), safeText(l.reason),
          ]);
        }
      }
      detailsOpts = { dateCols: [5, 6] };
    }

    if (chart === 'leaveTypeDistribution') {
      const typeNamesRes = await getLeaveTypeNames();
      const typeCounts = new Map();
      for (const l of nonCancelled) {
        if (!typeCounts.has(l.leaveType)) typeCounts.set(l.leaveType, { count: 0, days: 0 });
        const t = typeCounts.get(l.leaveType);
        t.count++; t.days += parseFloat(l.totalDays) || 0;
      }
      summaryHeaders = ['Leave Type', 'Requests', 'Days', 'Share (%)'];
      summaryRows = [...typeCounts.entries()].map(([code, t]) => [
        typeNamesRes.nameByCode.get(code) || code, t.count, round1(t.days),
        nonCancelled.length ? t.count / nonCancelled.length : 0,
      ]).sort((a, b) => b[1] - a[1]);
      summaryOpts = { pctCols: [3] };
      detailsHeaders = ['Month', 'Employee ID', 'Employee Name', 'Department', 'Leave Type', 'From', 'To', 'Days', 'Status', 'Reason'];
      detailsRows = nonCancelled.map(l => [
        monthLabel(new Date(`${ymd(new Date(l.startDate))}T00:00:00`)), safeText(l.employeeCode), safeText(fullName(l)), safeText(l.department),
        safeText(typeNamesRes.nameByCode.get(l.leaveType) || l.leaveType),
        new Date(`${ymd(new Date(l.startDate))}T00:00:00`), new Date(`${ymd(new Date(l.endDate))}T00:00:00`),
        round1(parseFloat(l.totalDays) || 0), titleCase(l.status), safeText(l.reason),
      ]);
      detailsOpts = { dateCols: [5, 6] };
    }

    if (chart === 'monthlyLeavePattern') {
      const pattern = await getMonthlyLeavePattern(idsParam, to);
      summaryHeaders = ['Date', 'Day', 'Employees on Leave'];
      summaryRows = pattern.points.map(p => [
        new Date(`${p.date}T00:00:00`),
        new Date(`${p.date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short' }),
        p.count,
      ]);
      summaryOpts = { dateCols: [0] };
      detailsHeaders = ['Date', 'Employee ID', 'Employee Name', 'Department', 'Leave Type', 'Day Type', 'Status', 'Reason'];
      const typeNamesRes = await getLeaveTypeNames();
      detailsRows = [];
      for (const [dateKey, rows] of pattern.dayRows.entries()) {
        for (const l of rows) {
          detailsRows.push([
            new Date(`${dateKey}T00:00:00`), safeText(l.employeeCode), safeText(fullName(l)), safeText(l.department),
            safeText(typeNamesRes.nameByCode.get(l.leaveType) || l.leaveType), halfDayLabel(l), titleCase(l.status), safeText(l.reason),
          ]);
        }
      }
      detailsRows.sort((a, b) => a[0] - b[0]);
      detailsOpts = { dateCols: [0] };
      titleLines[1] = `Period: ${pattern.label}    Department: ${deptLabel}    Exported: ${dmy(exportedAt)} ${exportedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
    }

    if (chart === 'experienceGroups') {
      const BUCKETS = [
        { label: '0-1', max: 12 }, { label: '1-3', max: 36 }, { label: '3-5', max: 60 },
        { label: '5-10', max: 120 }, { label: '10+', max: Infinity },
      ];
      const bucketCounts = Object.fromEntries(BUCKETS.map(b => [b.label, 0]));
      const detailLines = [];
      let noData = 0;
      for (const e of scope.scopedEmployees) {
        const months = parseExperienceToMonths(e.totalExperience);
        if (months === null || months < 0) { noData++; detailLines.push([safeText(e.employeeCode), safeText(fullName(e)), safeText(e.department), safeText(e.totalExperience || ''), 'No data']); continue; }
        const bucket = BUCKETS.find(b => months < b.max) || BUCKETS[BUCKETS.length - 1];
        bucketCounts[bucket.label]++;
        detailLines.push([safeText(e.employeeCode), safeText(fullName(e)), safeText(e.department), safeText(e.totalExperience || ''), bucket.label]);
      }
      summaryHeaders = ['Experience Group (Years)', 'Employees'];
      summaryRows = [...BUCKETS.map(b => [b.label, bucketCounts[b.label]]), ['No experience data', noData]];
      detailsHeaders = ['Employee ID', 'Employee Name', 'Department', 'Total Experience', 'Group'];
      detailsRows = detailLines;
    }

    if (chart === 'attendanceByDepartment') {
      const dept = await getAttendanceByDepartment(idsParam, fromStr, toStr, scope);
      // Hours-based (Option A): Expected Hours = Applicable Working Days ×
      // 8.5, never reduced for leave/permission/LOP — see
      // getAttendanceByDepartment() for the full rule. Percentage is not
      // capped at 100 here either, for the same reason it isn't on screen.
      summaryHeaders = ['Department', 'Employees', 'Expected Hours', 'Actual Worked Hours', 'Attendance (%)'];
      summaryRows = dept.byDepartment.map(d => [
        d.department, d.employees, d.expectedHours, d.actualHours, d.pct / 100,
      ]);
      summaryOpts = { pctCols: [4] };
      detailsHeaders = ['Employee ID', 'Employee Name', 'Department', 'Applicable Working Days', 'Expected Hours', 'Actual Worked Hours', 'Attendance (%)'];
      detailsRows = dept.byEmployee.map(r => [
        safeText(r.employeeCode), safeText(r.name), safeText(r.department),
        r.applicableWorkingDays, r.expectedHours, r.actualHours, r.pct / 100,
      ]);
      detailsOpts = { pctCols: [6] };
    }

    if (chart === 'topLeaveReasons') {
      const reasonGroups = new Map();
      let withReasonCount = 0;
      const detailLines = [];
      for (const l of nonCancelled) {
        const normalized = normalizeReason(l.reason);
        if (!normalized) continue;
        withReasonCount++;
        const label = groupOf(normalized);
        if (!reasonGroups.has(label)) reasonGroups.set(label, 0);
        reasonGroups.set(label, reasonGroups.get(label) + 1);
        detailLines.push([safeText(l.employeeCode), safeText(fullName(l)), safeText(l.department),
          new Date(`${ymd(new Date(l.startDate))}T00:00:00`), safeText(l.reason), label]);
      }
      summaryHeaders = ['Reason Group', 'Requests', 'Share (%)'];
      summaryRows = [...reasonGroups.entries()]
        .map(([label, count]) => [label, count, withReasonCount ? count / withReasonCount : 0])
        .sort((a, b) => b[1] - a[1]);
      summaryOpts = { pctCols: [2] };
      detailsHeaders = ['Employee ID', 'Employee Name', 'Department', 'Date', 'Original Reason', 'Reason Group'];
      detailsRows = detailLines;
      detailsOpts = { dateCols: [3] };
    }

    const fileBase = `HR-Dashboard_${CHART_FILE_NAMES[chart]}_${periodFileLabel(from, to)}`;

    if (format === 'csv') {
      const csvLines = [
        ...titleLines.map(t => `"${t.replace(/"/g, '""')}"`),
        '',
        summaryHeaders.map(h => `"${h}"`).join(','),
        ...summaryRows.map(row => row.map((cell, i) => {
          if (summaryOpts.dateCols?.includes(i) && cell instanceof Date) return `"${dmy(cell)}"`;
          if (summaryOpts.pctCols?.includes(i)) return `${round1((Number(cell) || 0) * 100)}%`;
          return `"${String(safeText(cell)).replace(/"/g, '""')}"`;
        }).join(',')),
      ];
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.csv"`);
      return res.send('﻿' + csvLines.join('\r\n'));
    }

    const wb = XLSX.utils.book_new();
    const summaryWs = buildSheet(titleLines, summaryHeaders, summaryRows, summaryOpts);
    XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');
    if (detailsHeaders) {
      const detailsWs = buildSheet(titleLines, detailsHeaders, detailsRows, detailsOpts);
      XLSX.utils.book_append_sheet(wb, detailsWs, 'Details');
    }
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.xlsx"`);
    res.send(buf);
  } catch (err) {
    serverError(res, err);
  }
});

module.exports = router;
