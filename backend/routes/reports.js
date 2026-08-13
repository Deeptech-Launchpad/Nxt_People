const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { isFullAccess, isManager, reportsScope } = require('../utils/roles');
const { countWorkingDays, ruleMatchesDate, holidayClosesOffice } = require('../utils/workingDays');
const { lopDaysForRange, listWorkingDays, loadHolidaysAndRules } = require('./payroll');
const { getLeavePolicies, accrualEvents, grantedToDate, entitlementStart, round2 } = require('../utils/leavePolicy');
router.use(protect);

// Sentinel for the "Not Specified" filter option. Deliberately not a value any
// column could hold, so it can never collide with a real department or role.
const NOT_SPECIFIED = '__not_specified__';

// Merges loadHolidaysAndRules() across every month a [startDate, endDate]
// range touches — the payroll version only loads one month at a time
// (payroll always operates on a single pay-month), but these reports let
// the user pick an arbitrary custom range that can cross month boundaries.
async function loadHolidaysAndRulesRange(startDate, endDate) {
  const start = new Date(startDate), end = new Date(endDate);
  const holMap = new Map();
  let rules = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor <= end) {
    const monthData = await loadHolidaysAndRules(cursor.getMonth() + 1, cursor.getFullYear());
    monthData.holMap.forEach((v, k) => holMap.set(k, v));
    rules = monthData.rules; // the active weekend-rule set isn't month-specific
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return { holMap, rules };
}

// Employee Status filter shared by every Leave Tracker table endpoint below
// — mirrors Zoho's Active/Ex-Employee filter chip. 'active'/'exited' are
// the only two real distinctions this schema can make (there's no separate
// "Active Non-User" or "Login Disabled" concept here) — anything else (or
// omitted) means no filter, matching this app's previous default behavior.
function employeeStatusClause(req, alias = 'e') {
  const status = req.query.employeeStatus;
  if (status === 'active') return ` AND ${alias}.exit_date IS NULL`;
  if (status === 'exited') return ` AND ${alias}.exit_date IS NOT NULL`;
  return '';
}

// "Show only direct reportees" toggle — Zoho lets even full-access roles
// (admin/hr/director) voluntarily narrow a report to just their own direct
// reports, on top of reportsScope()'s automatic manager-only scoping. This
// is a separate, opt-in clause rather than a reportsScope() change, since
// reportsScope() intentionally never restricts full-access roles by default.
function directReportsClause(req, alias, paramIndex) {
  if (req.query.directReportsOnly !== 'true') return { clause: '', params: [] };
  return { clause: ` AND ${alias}.reporting_manager_id = $${paramIndex}`, params: [req.user._id] };
}

// Employee narrowing filter for the multi-employee table reports — Booked &
// Balance, Leave Type Summary, LOP, Payroll export.
//
// Accepts one id or many: the chip is a multi-select, and a repeated query
// parameter arrives as an array. Ids are uuids, so the array is cast rather
// than compared as text, which also rejects a malformed id at the database
// instead of silently matching nothing.
function employeeIdClause(req, alias, paramIndex) {
  const ids = [].concat(req.query.employeeId || [])
    .filter(v => v !== '' && v !== undefined && v !== null);
  if (!ids.length) return { clause: '', params: [] };
  return { clause: ` AND ${alias}.id = ANY($${paramIndex}::uuid[])`, params: [ids] };
}

// Composes the full standard employee-narrowing filter set (Employee
// Status + dimension filters + direct-reports toggle + single-employee
// filter + role scope) shared by every Leave Tracker table report, using
// the running-index pattern so callers never hand-compute $N positions.
// Returns {clause, params, nextIndex} — nextIndex is the first free $N
// for anything the caller still needs to add after this.
function standardEmployeeFilters(req, alias, startIndex) {
  let idx = startIndex;
  const extra = extraEmployeeFilters(req.query, alias, idx); idx += extra.params.length;
  const directReports = directReportsClause(req, alias, idx); idx += directReports.params.length;
  const employeeId = employeeIdClause(req, alias, idx); idx += employeeId.params.length;
  const scope = reportsScope(req.user, alias, idx); idx += scope.params.length;
  return {
    clause: `${employeeStatusClause(req, alias)}${extra.clause}${directReports.clause}${employeeId.clause}${scope.clause}`,
    params: [...extra.params, ...directReports.params, ...employeeId.params, ...scope.params],
    nextIndex: idx,
  };
}

// Bug #10 fix: single JOIN+GROUP BY query instead of N+1 loop
// Bug #20 fix: summary now accepts startDate/endDate OR month/year params
router.get('/attendance', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const { startDate, endDate, department, employeeId } = req.query;
    const start = startDate ? startDate : new Date(new Date().setDate(1)).toLocaleDateString('en-CA');
    const end = endDate ? endDate : new Date().toLocaleDateString('en-CA');

    let empQuery = 'WHERE 1=1';
    let empParams = [];
    let empIdx = 1;

    if (department) { empQuery += ` AND department = $${empIdx++}`; empParams.push(department); }
    if (employeeId) { empQuery += ` AND id = $${empIdx++}`; empParams.push(employeeId); }

    // Visibility scope: full-access sees everyone; managers only their direct
    // reports; a plain employee only themselves. This both restricts the data
    // and stands in for a role guard (the route is otherwise protect-only).
    if (!isFullAccess(req.user.role)) {
      if (isManager(req.user.role)) {
        empQuery += ` AND (reporting_manager_id = $${empIdx} OR approving_authority_id = $${empIdx})`;
        empParams.push(req.user._id); empIdx++;
      } else {
        empQuery += ` AND id = $${empIdx++}`; empParams.push(req.user._id);
      }
    }

    const employeesRes = await pool.query(
      `SELECT id as "_id", first_name as "firstName", last_name as "lastName", department, employee_id as "employeeId" FROM employees ${empQuery}`,
      empParams
    );

    if (employeesRes.rows.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const ids = employeesRes.rows.map(e => e._id);
    const empMap = new Map(employeesRes.rows.map(e => [e._id, e]));

    const attRes = await pool.query(
      `SELECT a.id as "_id", a.date, a.check_in as "checkIn", a.check_out as "checkOut", a.working_hours as "workingHours",
              a.status, a.late_minutes as "lateMinutes", s.end_time as "shiftEnd",
       json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name, 'department', e.department, 'employeeId', e.employee_id) as employee
       FROM attendance a
       JOIN employees e ON a.employee_id = e.id
       LEFT JOIN shifts s ON a.shift_id = s.id
       WHERE a.employee_id = ANY($1) AND a.date >= $2::date AND a.date <= $3::date
       ORDER BY a.date DESC`,
      [ids, start, end]
    );

    // Attendance rows never carry status='leave' (see attendance.js:726) — approved
    // leave days have to be pulled from the leaves table and merged in as synthetic
    // rows so the Detailed Report can show "Leave" for days with no attendance record.
    const covered = new Set(attRes.rows.map(r => `${r.employee._id}_${new Date(r.date).toDateString()}`));
    const leaveRes = await pool.query(
      `SELECT employee_id, start_date, end_date
         FROM leaves
        WHERE employee_id = ANY($1) AND status = 'approved' AND start_date <= $3::date AND end_date >= $2::date`,
      [ids, start, end]
    );

    const leaveRows = [];
    for (const l of leaveRes.rows) {
      const emp = empMap.get(l.employee_id);
      if (!emp) continue;
      const rangeStart = new Date(Math.max(new Date(l.start_date), new Date(start)));
      const rangeEnd = new Date(Math.min(new Date(l.end_date), new Date(end)));
      for (let d = new Date(rangeStart); d <= rangeEnd; d.setDate(d.getDate() + 1)) {
        const key = `${l.employee_id}_${d.toDateString()}`;
        if (covered.has(key)) continue;
        covered.add(key);
        leaveRows.push({
          _id: `leave-${l.employee_id}-${d.toISOString().slice(0, 10)}`,
          date: new Date(d), checkIn: null, checkOut: null, workingHours: 0,
          status: 'leave', lateMinutes: null, shiftEnd: null,
          employee: { _id: emp._id, firstName: emp.firstName, lastName: emp.lastName, department: emp.department, employeeId: emp.employeeId },
        });
      }
    }

    const data = [...attRes.rows, ...leaveRows].sort((a, b) => new Date(b.date) - new Date(a.date));
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// Bug #10 + #20 fix: single aggregation query, also accepts startDate/endDate
router.get('/summary', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const { month, year, startDate, endDate } = req.query;
    let start, end;

    if (startDate && endDate) {
      start = startDate;
      end = endDate;
    } else {
      const now = new Date();
      const m = month ? parseInt(month) - 1 : now.getMonth();
      const y = parseInt(year) || now.getFullYear();
      start = new Date(y, m, 1).toLocaleDateString('en-CA');
      end = new Date(y, m + 1, 0).toLocaleDateString('en-CA');
    }

    // Single query with GROUP BY instead of N+1 loop
    const result = await pool.query(
      `SELECT
        e.id as "_id",
        e.first_name as "firstName",
        e.last_name as "lastName",
        e.department,
        COUNT(CASE WHEN a.status IN ('present', 'late') THEN 1 END)::int AS present,
        COUNT(CASE WHEN a.status = 'absent' THEN 1 END)::int AS absent,
        COUNT(CASE WHEN a.status = 'late' THEN 1 END)::int AS late,
        ROUND(COALESCE(SUM(a.working_hours), 0)::numeric, 2) AS "totalHours",
        COALESCE(MAX(perm.permission_hours), 0) AS "permissionHours"
       FROM employees e
       LEFT JOIN attendance a ON a.employee_id = e.id AND a.date >= $1::date AND a.date <= $2::date
       LEFT JOIN (
         SELECT employee_id, SUM(hours) AS permission_hours
           FROM leaves
          WHERE leave_type = 'permission' AND status = 'approved'
            AND start_date >= $1::date AND start_date <= $2::date
          GROUP BY employee_id
       ) perm ON perm.employee_id = e.id
       WHERE e.status = 'active'${reportsScope(req.user, 'e', 3).clause}
       GROUP BY e.id, e.first_name, e.last_name, e.department
       ORDER BY e.first_name ASC`,
      [start, end, ...reportsScope(req.user, 'e', 3).params]
    );

    const results = result.rows.map(r => ({
      employee: { _id: r._id, firstName: r.firstName, lastName: r.lastName, department: r.department },
      present: r.present,
      absent: r.absent,
      late: r.late,
      totalHours: parseFloat(r.totalHours),
      permissionHours: parseFloat(r.permissionHours) || 0
    }));

    // Attendance % needs one shared denominator (actual working days that
    // have elapsed so far), not each employee's own present+absent count —
    // otherwise two people with a different number of recorded days can
    // both land on "100%". Reuses the same weekend-rules/holidays-aware
    // working-day calendar Payroll's LOP calculation already relies on.
    const today = new Date().toLocaleDateString('en-CA');
    const elapsedEnd = end < today ? end : today;
    const [totalWorkingDays, elapsedWorkingDays] = await Promise.all([
      countWorkingDays(start, end),
      start <= elapsedEnd ? countWorkingDays(start, elapsedEnd) : Promise.resolve(0),
    ]);

    res.json({ success: true, data: results, workingDays: { total: totalWorkingDays, elapsed: elapsedWorkingDays } });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// Single-day snapshot for the Daily Report pie chart: how many employees are
// present (broken down into currently checked-in vs. already checked out),
// absent, or on approved leave for one specific date.
router.get('/daily', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const date = req.query.date || new Date().toLocaleDateString('en-CA');
    const { department } = req.query;

    let empQuery = "WHERE e.status = 'active'";
    let empParams = [];
    let empIdx = 1;
    if (department) { empQuery += ` AND e.department = $${empIdx++}`; empParams.push(department); }
    if (!isFullAccess(req.user.role)) {
      if (isManager(req.user.role)) {
        empQuery += ` AND (e.reporting_manager_id = $${empIdx} OR e.approving_authority_id = $${empIdx})`;
        empParams.push(req.user._id); empIdx++;
      } else {
        empQuery += ` AND e.id = $${empIdx++}`; empParams.push(req.user._id);
      }
    }
    const dateIdx = empIdx;

    const r = await pool.query(
      `SELECT e.id as "_id", e.first_name as "firstName", e.last_name as "lastName", e.department,
              a.status as "attStatus", a.check_in as "checkIn", a.check_out as "checkOut",
              l.id as "leaveId"
         FROM employees e
         LEFT JOIN attendance a ON a.employee_id = e.id AND a.date = $${dateIdx}::date
         LEFT JOIN leaves l ON l.employee_id = e.id AND l.status = 'approved'
                            AND l.start_date <= $${dateIdx}::date AND l.end_date >= $${dateIdx}::date
         ${empQuery}
        ORDER BY e.employee_id`,
      [...empParams, date]
    );

    // A day that hasn't ended yet (today or a future date) can't have real
    // "absents" — nobody with no record on file has failed to show up, they
    // just haven't checked in yet. Only a past date's no-record employees
    // are counted as Absent.
    const isOpenDay = date >= new Date().toLocaleDateString('en-CA');

    const counts = { checkedIn: 0, checkedOut: 0, leave: 0, absent: 0, yetToCheckIn: 0 };
    const data = r.rows.map(row => {
      let status;
      if (row.leaveId) { status = 'leave'; counts.leave++; }
      else if (row.attStatus === 'absent') { status = 'absent'; counts.absent++; }
      else if (row.checkIn && !row.checkOut) { status = 'checked-in'; counts.checkedIn++; }
      else if (row.checkIn && row.checkOut) { status = 'checked-out'; counts.checkedOut++; }
      else if (isOpenDay) { status = 'yet-to-check-in'; counts.yetToCheckIn++; }
      // Past date, no attendance row and no leave on file — same "absent"
      // convention the dashboard headcount widget already uses
      // (dashboard.js: a.id IS NULL).
      else { status = 'absent'; counts.absent++; }
      return { _id: row._id, firstName: row.firstName, lastName: row.lastName, department: row.department, status, checkIn: row.checkIn, checkOut: row.checkOut };
    });

    res.json({ success: true, date, counts, data });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// ══════════════════════ Employee Information reports ══════════════════════

// null-safe % growth — avoids Infinity/NaN when the baseline is 0.
const pctGrowth = (curr, prev) => (prev ? parseFloat((((curr - prev) / prev) * 100).toFixed(2)) : null);

router.get('/employee/dashboard', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toLocaleDateString('en-CA');
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toLocaleDateString('en-CA');
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toLocaleDateString('en-CA');
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0).toLocaleDateString('en-CA');
    const sameMonthLastYearStart = new Date(now.getFullYear() - 1, now.getMonth(), 1).toLocaleDateString('en-CA');
    const sameMonthLastYearEnd = new Date(now.getFullYear() - 1, now.getMonth() + 1, 0).toLocaleDateString('en-CA');
    const sameDayLastYear = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).toLocaleDateString('en-CA');
    // Extra two periods needed for the "Last Year" row of the dashboard's
    // 2-year comparison table: last year's same month needs its own MoM
    // baseline (the month before it, in that same year), and its own YoY
    // baseline (the same month two years ago).
    const prevYearPrevMonthStart = new Date(now.getFullYear() - 1, now.getMonth() - 1, 1).toLocaleDateString('en-CA');
    const prevYearPrevMonthEnd = new Date(now.getFullYear() - 1, now.getMonth(), 0).toLocaleDateString('en-CA');
    const twoYearsAgoSameMonthStart = new Date(now.getFullYear() - 2, now.getMonth(), 1).toLocaleDateString('en-CA');
    const twoYearsAgoSameMonthEnd = new Date(now.getFullYear() - 2, now.getMonth() + 1, 0).toLocaleDateString('en-CA');
    const sameDayTwoYearsAgo = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate()).toLocaleDateString('en-CA');

    const statsParams = [
      monthStart, monthEnd, prevMonthStart, prevMonthEnd, sameMonthLastYearStart, sameMonthLastYearEnd, sameDayLastYear,
      prevYearPrevMonthStart, prevYearPrevMonthEnd, twoYearsAgoSameMonthStart, twoYearsAgoSameMonthEnd, sameDayTwoYearsAgo,
    ];

    const [statsRes, deptRes, designationRes, locationRes, genderRes, additionSeries, attritionSeries, ageRows, experienceRows, experienceExitRes] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE e.status='active')::int AS active,
           COUNT(*) FILTER (WHERE e.status != 'active')::int AS inactive,
           COUNT(*) FILTER (WHERE e.status='active' AND e.joining_date >= $1::date AND e.joining_date <= $2::date)::int AS "newThisMonth",
           COUNT(*) FILTER (WHERE e.exit_date >= $1::date AND e.exit_date <= $2::date)::int AS "exitsThisMonth",
           COUNT(*) FILTER (WHERE e.status='active' AND e.joining_date >= $3::date AND e.joining_date <= $4::date)::int AS "newLastMonth",
           COUNT(*) FILTER (WHERE e.exit_date >= $3::date AND e.exit_date <= $4::date)::int AS "exitsLastMonth",
           COUNT(*) FILTER (WHERE e.status='active' AND e.joining_date >= $5::date AND e.joining_date <= $6::date)::int AS "newSameMonthLastYear",
           COUNT(*) FILTER (WHERE e.exit_date >= $5::date AND e.exit_date <= $6::date)::int AS "exitsSameMonthLastYear",
           COUNT(*) FILTER (WHERE e.joining_date <= $4::date AND (e.exit_date IS NULL OR e.exit_date > $4::date))::int AS "headcountLastMonth",
           COUNT(*) FILTER (WHERE e.joining_date <= $7::date AND (e.exit_date IS NULL OR e.exit_date > $7::date))::int AS "headcountSameMonthLastYear",
           COUNT(*) FILTER (WHERE e.status='active' AND e.joining_date >= $8::date AND e.joining_date <= $9::date)::int AS "newPrevYearPrevMonth",
           COUNT(*) FILTER (WHERE e.exit_date >= $8::date AND e.exit_date <= $9::date)::int AS "exitsPrevYearPrevMonth",
           COUNT(*) FILTER (WHERE e.status='active' AND e.joining_date >= $10::date AND e.joining_date <= $11::date)::int AS "newTwoYearsAgoSameMonth",
           COUNT(*) FILTER (WHERE e.exit_date >= $10::date AND e.exit_date <= $11::date)::int AS "exitsTwoYearsAgoSameMonth",
           COUNT(*) FILTER (WHERE e.joining_date <= $9::date AND (e.exit_date IS NULL OR e.exit_date > $9::date))::int AS "headcountPrevYearPrevMonth",
           COUNT(*) FILTER (WHERE e.joining_date <= $12::date AND (e.exit_date IS NULL OR e.exit_date > $12::date))::int AS "headcountTwoYearsAgoSameMonth"
         FROM employees e WHERE 1=1${reportsScope(req.user, 'e', 13).clause}`,
        [...statsParams, ...reportsScope(req.user, 'e', 13).params]
      ),
      pool.query(
        `SELECT COALESCE(e.department,'Unassigned') AS label, COUNT(*)::int AS count
           FROM employees e WHERE e.status='active'${reportsScope(req.user, 'e', 1).clause}
          GROUP BY e.department ORDER BY count DESC LIMIT 10`,
        reportsScope(req.user, 'e', 1).params
      ),
      pool.query(
        `SELECT COALESCE(e.designation,'Unassigned') AS label, COUNT(*)::int AS count
           FROM employees e WHERE e.status='active'${reportsScope(req.user, 'e', 1).clause}
          GROUP BY e.designation ORDER BY count DESC LIMIT 10`,
        reportsScope(req.user, 'e', 1).params
      ),
      pool.query(
        `SELECT COALESCE(e.work_location,'Unassigned') AS label, COUNT(*)::int AS count
           FROM employees e WHERE e.status='active'${reportsScope(req.user, 'e', 1).clause}
          GROUP BY e.work_location ORDER BY count DESC LIMIT 10`,
        reportsScope(req.user, 'e', 1).params
      ),
      pool.query(
        `SELECT COALESCE(e.gender,'Unspecified') AS label, COUNT(*)::int AS count
           FROM employees e WHERE e.status='active'${reportsScope(req.user, 'e', 1).clause}
          GROUP BY e.gender ORDER BY count DESC`,
        reportsScope(req.user, 'e', 1).params
      ),
      // Last 6 months addition/attrition, with month-over-month growth —
      // feeds the two mini combo charts, which deep-link to the full
      // Addition/Attrition Trend reports.
      monthlySeriesWithGrowth('joining_date', 5, req.user),
      monthlySeriesWithGrowth('exit_date', 5, req.user),
      ageOrTenureBuckets('date_of_birth', req.user),
      experienceTenureBuckets(req.user),
      experienceExitBuckets(req.user),
    ]);

    const s = statsRes.rows[0];
    // Each metric's dashboard card is a 2-row (This Year / Last Year) x
    // 2-col (Month(<current month>) / YoY) table, matching Zoho's structure.
    // "Month" = that year's value for the current month, with growth vs the
    // month before it (within that same year). "YoY" = the same month one
    // year before that row's year, with growth vs the row's own value.
    const metricTable = (thisMonth, lastMonth, sameMonthLastYear, prevYearPrevMonth, twoYearsAgoSameMonth) => ({
      thisYear: {
        year: now.getFullYear(),
        month: { value: thisMonth, growth: pctGrowth(thisMonth, lastMonth) },
        yoy: { value: sameMonthLastYear, growth: pctGrowth(thisMonth, sameMonthLastYear) },
      },
      lastYear: {
        year: now.getFullYear() - 1,
        month: { value: sameMonthLastYear, growth: pctGrowth(sameMonthLastYear, prevYearPrevMonth) },
        yoy: { value: twoYearsAgoSameMonth, growth: pctGrowth(sameMonthLastYear, twoYearsAgoSameMonth) },
      },
    });

    // Addition and attrition cards show a RATE — the month's count as a share
    // of the headcount at that point — not a month-over-month delta, matching
    // the Percentage series on the trend charts. The delta form turned an
    // empty month into "-100%", which read as a catastrophic drop when it
    // only ever meant "nobody joined/left". Headcount keeps the delta, since
    // there "growth rate" genuinely is the change in the count.
    const rate = (count, headcount) =>
      headcount ? parseFloat(((count / headcount) * 100).toFixed(2)) : 0;
    const rateTable = (thisMonth, sameMonthLastYear, twoYearsAgoSameMonth, hcNow, hcLastYear, hcTwoYearsAgo) => ({
      thisYear: {
        year: now.getFullYear(),
        month: { value: thisMonth, growth: rate(thisMonth, hcNow) },
        yoy: { value: sameMonthLastYear, growth: rate(sameMonthLastYear, hcLastYear) },
      },
      lastYear: {
        year: now.getFullYear() - 1,
        month: { value: sameMonthLastYear, growth: rate(sameMonthLastYear, hcLastYear) },
        yoy: { value: twoYearsAgoSameMonth, growth: rate(twoYearsAgoSameMonth, hcTwoYearsAgo) },
      },
    });

    res.json({
      success: true,
      data: {
        ...s,
        totalActive: s.active,
        headcount: metricTable(s.active, s.headcountLastMonth, s.headcountSameMonthLastYear, s.headcountPrevYearPrevMonth, s.headcountTwoYearsAgoSameMonth),
        addition: rateTable(s.newThisMonth, s.newSameMonthLastYear, s.newTwoYearsAgoSameMonth, s.active, s.headcountSameMonthLastYear, s.headcountTwoYearsAgoSameMonth),
        attrition: rateTable(s.exitsThisMonth, s.exitsSameMonthLastYear, s.exitsTwoYearsAgoSameMonth, s.active, s.headcountSameMonthLastYear, s.headcountTwoYearsAgoSameMonth),
        byDepartment: deptRes.rows,
        byDesignation: designationRes.rows,
        byLocation: locationRes.rows,
        byGender: genderRes.rows,
        byAge: ageRows,
        byExperience: experienceRows,
        experienceExit: experienceExitRes,
        last6MonthsAddition: additionSeries,
        last6MonthsAttrition: attritionSeries,
      },
    });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// Year-over-year headcount trend: how many employees were active as of the
// end of each year (or "as of today" for the current year), plus % growth
// vs. the prior year. Point-in-time reconstruction — an employee counts for
// year Y if they'd joined by then and hadn't exited yet — not just today's
// active count repeated across years.
// Distinct values for the secondary filter row (used by both Employee
// Information and Leave Tracker pages) — Department, Designation, Company,
// Division, Location, Employment Type, Role. Scoped the same way as
// everything else in this file (a manager only sees values that exist
// among their own reports).
router.get('/employee/filter-options', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const scope = reportsScope(req.user, 'e', 1);
    // A blank value is offered as "Not Specified" rather than dropped. Without
    // it the employees carrying that gap are unreachable from the filter row —
    // they match no option, so no combination of filters can surface them, and
    // the gap stays invisible. The reference lists it the same way.
    const distinctCol = async (col) => {
      const r = await pool.query(
        `SELECT DISTINCT e.${col} AS v FROM employees e WHERE e.${col} IS NOT NULL AND e.${col} != ''${scope.clause} ORDER BY v`,
        scope.params
      );
      const values = r.rows.map(row => row.v);
      const blanks = await pool.query(
        `SELECT 1 FROM employees e WHERE (e.${col} IS NULL OR e.${col} = '')${scope.clause} LIMIT 1`,
        scope.params
      );
      return blanks.rows.length ? [...values, { value: NOT_SPECIFIED, label: 'Not Specified' }] : values;
    };
    const [department, designation, company, division, workLocation, employmentType, role, gender, shiftRes, expRes] = await Promise.all([
      distinctCol('department'), distinctCol('designation'), distinctCol('company'),
      distinctCol('division'), distinctCol('work_location'), distinctCol('employment_type'), distinctCol('role'),
      distinctCol('gender'),
      // Shifts come from their own table, so they're {value: id, label: name}
      // objects rather than bare strings — the filter has to send shift_id.
      pool.query('SELECT id, name FROM shifts ORDER BY name'),
      // Experience is a tenure band rather than a column, so its options are
      // the bands that actually have people in them.
      pool.query(
        `SELECT DISTINCT
            CASE WHEN yrs < 1 THEN '<1' WHEN yrs <= 3 THEN yrs::text
                 WHEN yrs <= 5 THEN '4-5' WHEN yrs <= 7 THEN '6-7'
                 WHEN yrs <= 9 THEN '8-9' ELSE '10+' END AS label,
            CASE WHEN yrs < 1 THEN 0 WHEN yrs <= 3 THEN yrs
                 WHEN yrs <= 5 THEN 4 WHEN yrs <= 7 THEN 6
                 WHEN yrs <= 9 THEN 8 ELSE 10 END AS sort_key
           FROM (SELECT FLOOR(EXTRACT(YEAR FROM AGE(CURRENT_DATE, e.joining_date)))::int AS yrs
                   FROM employees e WHERE e.joining_date IS NOT NULL${scope.clause}) t
          ORDER BY sort_key`,
        scope.params
      ),
    ]);
    const shiftId = shiftRes.rows.map(r => ({ value: r.id, label: r.name }));
    const experience = expRes.rows.map(r => r.label);
    // Business Unit is in Zoho's filter row but has no column in this schema,
    // so it's returned empty rather than omitted — the chip renders, and its
    // list is empty exactly as Zoho shows it when none are configured.
    res.json({
      success: true,
      data: { department, designation, company, division, workLocation, employmentType, role, gender, shiftId, experience, businessUnit: [] },
    });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.get('/employee/headcount-trend', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const yearsBack = Math.min(15, Math.max(1, parseInt(req.query.years, 10) || 10));
    const currentYear = new Date().getFullYear();
    const startYear = currentYear - yearsBack + 1;
    const today = new Date().toLocaleDateString('en-CA');

    const extra = extraEmployeeFilters(req.query, 'e', 2);
    const scope = reportsScope(req.user, 'e', 2 + extra.params.length);

    const counts = [];
    for (let y = startYear; y <= currentYear; y++) {
      const asOf = y === currentYear ? today : `${y}-12-31`;
      // eslint-disable-next-line no-await-in-loop
      const r = await pool.query(
        `SELECT COUNT(*)::int AS count FROM employees e
          WHERE e.joining_date <= $1::date AND (e.exit_date IS NULL OR e.exit_date > $1::date)${extra.clause}${scope.clause}`,
        [asOf, ...extra.params, ...scope.params]
      );
      counts.push({ year: y, count: r.rows[0].count });
    }

    const data = counts.map((row, i) => {
      const prev = i > 0 ? counts[i - 1].count : null;
      const growth = prev ? parseFloat((((row.count - prev) / prev) * 100).toFixed(2)) : null;
      return { ...row, growth };
    });
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// Dense month-by-month series (zero-count months included, matching Zoho's
// continuous axis) with month-over-month % growth. Fetches one extra
// leading month purely as the growth baseline for the first displayed bar,
// then drops it from the returned series. dateColumn is always a fixed
// literal from this file, never user input. employmentType (optional) is
// only ever passed by Attrition Trend, matching Zoho — Addition Trend has
// no such filter in Zoho's own UI either.
// `query` (optional) is the raw req.query, so the dimension filter chips
// narrow both the monthly counts and the headcount denominator identically.
async function monthlySeriesWithGrowth(dateColumn, months, user, employmentType, query = {}) {
  const dims = extraEmployeeFilters({ ...query, employmentType: employmentType || query.employmentType }, 'e', 2);
  const params = [months + 1, ...dims.params];
  const extraClause = dims.clause;
  const scope = reportsScope(user, 'e', params.length + 1);
  const r = await pool.query(
    `SELECT to_char(date_trunc('month', e.${dateColumn}), 'YYYY-MM') AS ym, COUNT(*)::int AS count
       FROM employees e
      WHERE e.${dateColumn} >= (date_trunc('month', CURRENT_DATE) - ($1 || ' months')::interval)${extraClause}${scope.clause}
      GROUP BY 1`,
    [...params, ...scope.params]
  );
  const countMap = new Map(r.rows.map(row => [row.ym, row.count]));
  const now = new Date();
  const today = now.toLocaleDateString('en-CA');
  const series = [];
  for (let i = months; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const asOf = i === 0 ? today : new Date(d.getFullYear(), d.getMonth() + 1, 0).toLocaleDateString('en-CA');
    series.push({ year: d.getFullYear(), month: d.toLocaleDateString('en-US', { month: 'short' }), count: countMap.get(ym) || 0, asOf });
  }

  // Percentage = this month's count as a share of the active headcount at
  // that month's end (point-in-time reconstruction, same technique as
  // /employee/headcount-trend) — matches Zoho's "Percentage" series, which
  // is an addition/attrition RATE, not a month-over-month change in the
  // raw count. A month-over-month delta is wildly unstable on small counts
  // (one extra hire on a base of 1 reads as "1000%"), which is why the
  // line used to look like it was jumping around independent of the data.
  const hcDims = extraEmployeeFilters({ ...query, employmentType: employmentType || query.employmentType }, 'e', 2);
  const hcParams = hcDims.params;
  const hcClause = hcDims.clause;
  const hcScope = reportsScope(user, 'e', hcParams.length + 2);

  const withPercentage = [];
  for (const row of series.slice(1)) {
    // eslint-disable-next-line no-await-in-loop
    const hcRes = await pool.query(
      `SELECT COUNT(*)::int AS count FROM employees e
        WHERE e.joining_date <= $1::date AND (e.exit_date IS NULL OR e.exit_date > $1::date)${hcClause}${hcScope.clause}`,
      [row.asOf, ...hcParams, ...hcScope.params]
    );
    const headcount = hcRes.rows[0].count;
    const growth = headcount > 0 ? parseFloat(((row.count / headcount) * 100).toFixed(2)) : null;
    withPercentage.push({ month: row.month, year: row.year, count: row.count, growth });
  }
  return withPercentage;
}

// Shared narrowing filters for the secondary filter row — Department,
// Designation, Company, Division, Location, Employment Type, Role. All
// seven are real, populated columns on `employees`. Business Unit has no
// equivalent column in this schema, so it's deliberately not offered here
// (see catalogData.js / the frontend filter row for the same note) rather
// than wired up to nothing. Returns {clause, params} in the same shape
// reportsScope() uses.
// Each dimension accepts MULTIPLE values (Zoho's filter chips are
// checkbox lists, not single-select), so every clause is `= ANY($n)` over a
// text[]. A query string can deliver one value as a bare string and several
// as an array, so both shapes are normalised to an array here.
function extraEmployeeFilters(query, alias, paramIndex) {
  const FIELDS = [
    ['department', 'department'], ['designation', 'designation'], ['company', 'company'],
    ['division', 'division'], ['workLocation', 'work_location'], ['employmentType', 'employment_type'],
    ['role', 'role'], ['shiftId', 'shift_id'], ['gender', 'gender'],
  ];
  let clause = '';
  const params = [];
  let idx = paramIndex;
  for (const [q, col] of FIELDS) {
    const all = [].concat(query[q] || []).filter(v => v !== '' && v !== undefined && v !== null);
    if (!all.length) continue;
    // "Not Specified" is a sentinel, not a stored value — it has to become an
    // IS NULL test. Ticking it alongside real values means "these, or blank",
    // so the two halves are OR'd inside one bracket rather than AND'd.
    const wantsBlank = all.includes(NOT_SPECIFIED);
    const values = all.filter(v => v !== NOT_SPECIFIED);
    // shift_id is a uuid column — the text[] has to be cast to match it.
    const cast = col === 'shift_id' ? '::uuid[]' : '';

    const parts = [];
    if (values.length) {
      parts.push(`${alias}.${col} = ANY($${idx}${cast})`);
      params.push(values);
      idx++;
    }
    if (wantsBlank) parts.push(`(${alias}.${col} IS NULL OR ${alias}.${col}::text = '')`);
    if (parts.length) clause += ` AND (${parts.join(' OR ')})`;
  }

  // Experience is a numeric comparator, not a band list: Zoho's chip reads
  // "Experience : Greater than 3 Year(s)". Bands are how the chart groups
  // people; the filter works on raw years, so a threshold doesn't have to
  // land on a band boundary. Operator is whitelisted — it reaches SQL.
  const OPS = { is: '=', lt: '<', gt: '>' };
  const expOp = query.experienceOp;
  const expFrom = query.experienceFrom;
  if ((OPS[expOp] || expOp === 'between') && expFrom !== undefined && expFrom !== '') {
    const yrsExpr = `FLOOR(EXTRACT(YEAR FROM AGE(CURRENT_DATE, ${alias}.joining_date)))`;
    if (expOp === 'between') {
      const expTo = query.experienceTo;
      if (expTo !== undefined && expTo !== '') {
        clause += ` AND ${yrsExpr} BETWEEN $${idx} AND $${idx + 1}`;
        params.push(Number(expFrom), Number(expTo));
        idx += 2;
      }
    } else {
      clause += ` AND ${yrsExpr} ${OPS[expOp]} $${idx}`;
      params.push(Number(expFrom));
      idx++;
    }
  }

  return { clause, params };
}

router.get('/employee/addition-trend', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const months = Math.min(24, Math.max(1, parseInt(req.query.months, 10) || 12));
    const data = await monthlySeriesWithGrowth('joining_date', months, req.user, null, req.query);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.get('/employee/attrition-trend', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const months = Math.min(24, Math.max(1, parseInt(req.query.months, 10) || 12));
    const data = await monthlySeriesWithGrowth('exit_date', months, req.user, req.query.employmentType, req.query);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.get('/employee/distribution', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    // Whitelisted before interpolation — never accept the column name straight from req.query.
    const col = req.query.by === 'designation' ? 'e.designation' : req.query.by === 'location' ? 'e.work_location' : 'e.department';
    const extra = extraEmployeeFilters(req.query, 'e', 1);
    const scope = reportsScope(req.user, 'e', 1 + extra.params.length);
    // Employees with the field blank are reported separately as "Employees
    // without <dimension>" (as Zoho does) rather than folded into the chart
    // as an "Unassigned" slice — otherwise they inflate "Total no. of
    // Departments" by one for a category that isn't a real department.
    const r = await pool.query(
      `SELECT ${col} AS label, COUNT(*)::int AS count
         FROM employees e
        WHERE e.status='active' AND ${col} IS NOT NULL AND ${col} != ''${extra.clause}${scope.clause}
        GROUP BY ${col} ORDER BY count DESC`,
      [...extra.params, ...scope.params]
    );
    const totalRes = await pool.query(
      `SELECT COUNT(*)::int AS count FROM employees e
        WHERE e.status='active'${extra.clause}${scope.clause}`,
      [...extra.params, ...scope.params]
    );
    const totalActive = totalRes.rows[0]?.count || 0;
    const assigned = r.rows.reduce((s, row) => s + row.count, 0);
    res.json({ success: true, data: r.rows, totalActive, without: totalActive - assigned });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// Employees behind one slice of a Distribution/Diversity chart — clicking a
// slice should answer "who are these three people?", which the chart alone
// can't. Only plain columns are drillable; the age and tenure charts group by
// a computed band, so a value there wouldn't map back to a column.
const DRILL_COLUMNS = {
  department: 'e.department',
  designation: 'e.designation',
  location: 'e.work_location',
  gender: 'e.gender',
};

router.get('/employee/drilldown', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const col = DRILL_COLUMNS[req.query.by];
    if (!col) return res.status(400).json({ success: false, message: 'Unsupported drilldown dimension' });
    const value = req.query.value;
    if (!value) return res.status(400).json({ success: false, message: 'value is required' });

    const extra = extraEmployeeFilters(req.query, 'e', 2);
    const scope = reportsScope(req.user, 'e', 2 + extra.params.length);
    const r = await pool.query(
      `SELECT e.id AS "_id", e.first_name AS "firstName", e.last_name AS "lastName",
              e.employee_id AS "employeeCode", e.email, e.department, e.designation,
              e.employment_type AS "employmentType", e.work_location AS "workLocation"
         FROM employees e
        WHERE e.status='active' AND ${col} = $1${extra.clause}${scope.clause}
        ORDER BY e.employee_id`,
      [value, ...extra.params, ...scope.params]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// 5-year-wide buckets for age (date_of_birth) or current tenure
// (joining_date) among active employees. Shared by /employee/diversity's
// age/experience types and the Dashboard's mini widgets, so both always
// agree on the same bucketing. `extra` (optional) is the same
// {clause, params} shape extraEmployeeFilters() returns.
async function ageOrTenureBuckets(dateColumn, user, extra = { clause: '', params: [] }) {
  const scope = reportsScope(user, 'e', 1 + extra.params.length);
  const r = await pool.query(
    `SELECT (FLOOR(EXTRACT(YEAR FROM AGE(CURRENT_DATE, e.${dateColumn})) / 5) * 5)::int AS bucket_start, COUNT(*)::int AS count
       FROM employees e
      WHERE e.status='active' AND e.${dateColumn} IS NOT NULL${extra.clause}${scope.clause}
      GROUP BY bucket_start ORDER BY bucket_start`,
    [...extra.params, ...scope.params]
  );
  return r.rows.map(row => ({ label: `${row.bucket_start}-${row.bucket_start + 4}`, count: row.count }));
}

// Per-year tenure buckets (<1, 1, 2, 3, ... 10+) for active employees —
// gives meaningful diversity breakdown for experience even in young
// companies where everyone has < 5 years tenure. Used by Diversity
// (type=experience) and the Dashboard's Experience mini-donut.
async function experienceTenureBuckets(user, extra = { clause: '', params: [] }) {
  const scope = reportsScope(user, 'e', 1 + extra.params.length);
  const r = await pool.query(
    `SELECT
       -- Single years up to 3, then two-year bands, matching Zoho's tenure
       -- banding (its chart reads "<1, 1, 2, 3, 4-5"). Banding the tail keeps
       -- a handful of long tenures from producing dozens of empty buckets.
       CASE
         WHEN yrs < 1 THEN '<1'
         WHEN yrs <= 3 THEN yrs::text
         WHEN yrs <= 5 THEN '4-5'
         WHEN yrs <= 7 THEN '6-7'
         WHEN yrs <= 9 THEN '8-9'
         ELSE '10+'
       END AS label,
       -- Sort by the band's first year, not the raw year: otherwise 4 and 5
       -- keep distinct sort keys and GROUP BY emits "4-5" twice.
       CASE
         WHEN yrs < 1 THEN 0
         WHEN yrs <= 3 THEN yrs
         WHEN yrs <= 5 THEN 4
         WHEN yrs <= 7 THEN 6
         WHEN yrs <= 9 THEN 8
         ELSE 10
       END AS sort_key,
       COUNT(*)::int AS count
      FROM (
        SELECT FLOOR(EXTRACT(YEAR FROM AGE(CURRENT_DATE, e.joining_date)))::int AS yrs
          FROM employees e
         WHERE e.status='active' AND e.joining_date IS NOT NULL${extra.clause}${scope.clause}
      ) ranked
     GROUP BY label, sort_key
     ORDER BY sort_key`,
    [...extra.params, ...scope.params]
  );
  return r.rows.map(({ label, count }) => ({ label, count }));
}

// Diversity covers three switchable views, matching Zoho's "Type" selector:
// gender (default), age (date_of_birth), and experience (current tenure).
router.get('/employee/diversity', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const type = ['age', 'experience'].includes(req.query.type) ? req.query.type : 'gender';
    const extra = extraEmployeeFilters(req.query, 'e', 1);
    if (type === 'age' || type === 'experience') {
      const scope = reportsScope(req.user, 'e', 1 + extra.params.length);
      const totalRes = await pool.query(
        `SELECT COUNT(*)::int AS count FROM employees e WHERE e.status='active'${extra.clause}${scope.clause}`,
        [...extra.params, ...scope.params]
      );
      const totalActive = totalRes.rows[0]?.count || 0;
      const data = type === 'age'
        ? await ageOrTenureBuckets('date_of_birth', req.user, extra)
        : await experienceTenureBuckets(req.user, extra);
      return res.json({ success: true, type, data, totalActive });
    }
    const scope = reportsScope(req.user, 'e', 1 + extra.params.length);
    const r = await pool.query(
      `SELECT COALESCE(e.gender,'Unspecified') AS label, COUNT(*)::int AS count
         FROM employees e WHERE e.status='active'${extra.clause}${scope.clause}
        GROUP BY e.gender ORDER BY count DESC`,
      [...extra.params, ...scope.params]
    );
    res.json({ success: true, type, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// Per-year buckets (<1, 1, 2, 3, ...) rather than wide bands, matching
// Zoho's granularity — banded at 10+ so a handful of very long tenures
// don't produce a chart with dozens of near-empty buckets.
// Shared by the Dashboard widget (no filters, all-time) and the full
// Experience Wise Exit report page (optional exit-date range + employment
// type). startDate/endDate/employmentType are all optional.
async function experienceExitBuckets(user, { startDate, endDate, employmentType, query = {} } = {}) {
  const params = [];
  let extraClause = '';
  if (startDate) { params.push(startDate); extraClause += ` AND e.exit_date >= $${params.length}::date`; }
  if (endDate) { params.push(endDate); extraClause += ` AND e.exit_date <= $${params.length}::date`; }
  if (employmentType) { params.push(employmentType); extraClause += ` AND e.employment_type = $${params.length}`; }
  // Dimension chips. employmentType is handled above as its own dedicated
  // filter, so it's stripped here to avoid applying the same clause twice.
  const { employmentType: _omit, experience: _omitExp, ...dimQuery } = query;
  const dims = extraEmployeeFilters(dimQuery, 'e', params.length + 1);
  params.push(...dims.params);
  extraClause += dims.clause;
  const scope = reportsScope(user, 'e', params.length + 1);
  const r = await pool.query(
    `SELECT
       -- Single years up to 3, then two-year bands, matching Zoho's tenure
       -- banding (its chart reads "<1, 1, 2, 3, 4-5"). Banding the tail keeps
       -- a handful of long tenures from producing dozens of empty buckets.
       CASE
         WHEN yrs < 1 THEN '<1'
         WHEN yrs <= 3 THEN yrs::text
         WHEN yrs <= 5 THEN '4-5'
         WHEN yrs <= 7 THEN '6-7'
         WHEN yrs <= 9 THEN '8-9'
         ELSE '10+'
       END AS label,
       -- Sort by the band's first year, not the raw year: otherwise 4 and 5
       -- keep distinct sort keys and GROUP BY emits "4-5" twice.
       CASE
         WHEN yrs < 1 THEN 0
         WHEN yrs <= 3 THEN yrs
         WHEN yrs <= 5 THEN 4
         WHEN yrs <= 7 THEN 6
         WHEN yrs <= 9 THEN 8
         ELSE 10
       END AS sort_key,
       COUNT(*)::int AS count
      FROM (
        SELECT FLOOR(EXTRACT(YEAR FROM AGE(e.exit_date, e.joining_date)))::int AS yrs
          FROM employees e
         WHERE e.exit_date IS NOT NULL AND e.joining_date IS NOT NULL${extraClause}${scope.clause}
      ) ranked
     GROUP BY label, sort_key
     ORDER BY sort_key`,
    [...params, ...scope.params]
  );
  return r.rows.map(({ label, count }) => ({ label, count }));
}

router.get('/employee/experience-exit', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const { startDate, endDate, employmentType } = req.query;
    const data = await experienceExitBuckets(req.user, { startDate, endDate, employmentType, query: req.query });
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// ══════════════════════════ Leave Tracker reports ══════════════════════════

// Pie-by-leave-type for the day, plus the underlying employee list for the
// "list" view toggle — Zoho's Daily Leave Status is a type breakdown, not
// a flat name list.
const LEAVE_CATEGORY = { casual: 'Paid', comp_off: 'Paid', permission: 'Paid', unpaid: 'Unpaid' };

// Approved AND pending requests both count here — Zoho's Daily Leave Status
// tracks who's requested/booked leave for the day, not just confirmed
// leave, and shows an Approval Status column so the distinction is visible
// rather than hidden.
router.get('/leave/daily-status', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const date = req.query.date || new Date().toLocaleDateString('en-CA');
    const leaveTypeFilter = ['casual', 'comp_off', 'unpaid', 'permission'].includes(req.query.leaveType) ? req.query.leaveType : null;

    // Running-index composition: each clause builder is handed the next
    // free $N and reports back how many params it consumed, so the next
    // builder always starts in the right place — avoids hand-computed
    // index arithmetic (a real off-by-one risk once 3+ filters combine).
    let idx = 2; // $1 is always `date`
    const extra = extraEmployeeFilters(req.query, 'e', idx); idx += extra.params.length;
    const directReports = directReportsClause(req, 'e', idx); idx += directReports.params.length;
    let leaveTypeClause = '', leaveTypeParams = [];
    if (leaveTypeFilter) { leaveTypeParams = [leaveTypeFilter]; leaveTypeClause = ` AND l.leave_type = $${idx}`; idx += 1; }
    const scope = reportsScope(req.user, 'e', idx);

    const baseParams = [date, ...extra.params, ...directReports.params, ...leaveTypeParams, ...scope.params];
    const whereTail = `${employeeStatusClause(req)}${extra.clause}${directReports.clause}${leaveTypeClause}${scope.clause}`;

    const [typeRes, listRes] = await Promise.all([
      pool.query(
        `SELECT l.leave_type AS "leaveType", COUNT(*)::int AS count
           FROM leaves l JOIN employees e ON l.employee_id = e.id
          WHERE l.status IN ('approved','pending') AND l.start_date <= $1::date AND l.end_date >= $1::date${whereTail}
          GROUP BY l.leave_type`,
        baseParams
      ),
      pool.query(
        `SELECT l.id AS "_id", e.first_name AS "firstName", e.last_name AS "lastName", e.department, e.employee_id AS "employeeCode",
                l.leave_type AS "leaveType", l.is_half_day AS "isHalfDay", l.reason, l.status AS "approvalStatus"
           FROM leaves l JOIN employees e ON l.employee_id = e.id
          WHERE l.status IN ('approved','pending') AND l.start_date <= $1::date AND l.end_date >= $1::date${whereTail}
          ORDER BY e.employee_id`,
        baseParams
      ),
    ]);
    const employees = listRes.rows.map(row => ({ ...row, category: LEAVE_CATEGORY[row.leaveType] || null }));
    res.json({ success: true, date, byType: typeRes.rows, employees });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// Day-by-day leave calendar grid across a date range — same walk pattern as
// Attendance's Muster Roll, but cells carry a leave-type code (CL/CO/LWP/PM)
// instead of a present/absent code. Includes exited employees (annotated
// with their exit date) since Zoho's own report does too.
router.get('/leave/resource-availability', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const start = req.query.startDate || new Date(new Date().setDate(1)).toLocaleDateString('en-CA');
    const end = req.query.endDate || new Date().toLocaleDateString('en-CA');
    const startD = new Date(start), endD = new Date(end);
    const { holMap, rules } = await loadHolidaysAndRulesRange(startD, endD);

    let empIdx = 1;
    const extra = extraEmployeeFilters(req.query, 'e', empIdx); empIdx += extra.params.length;
    const directReports = directReportsClause(req, 'e', empIdx); empIdx += directReports.params.length;
    const scope = reportsScope(req.user, 'e', empIdx);
    const empParams = [...extra.params, ...directReports.params, ...scope.params];
    const empWhereTail = `${employeeStatusClause(req)}${extra.clause}${directReports.clause}${scope.clause}`;

    const leaveTypeFilter = ['casual', 'comp_off', 'unpaid', 'permission'].includes(req.query.leaveType) ? req.query.leaveType : null;
    const leaveParams = [start, end];
    let leaveTypeClause = '';
    if (leaveTypeFilter) { leaveParams.push(leaveTypeFilter); leaveTypeClause = ` AND leave_type = $3`; }

    const [empRes, leaveRes, absentRes] = await Promise.all([
      pool.query(
        `SELECT id AS "_id", first_name AS "firstName", last_name AS "lastName", department, employee_id AS "employeeCode", exit_date AS "exitDate"
           FROM employees e WHERE 1=1${empWhereTail} ORDER BY first_name`,
        empParams
      ),
      pool.query(
        `SELECT employee_id, leave_type, start_date, end_date, is_half_day
           FROM leaves WHERE status='approved' AND start_date <= $2::date AND end_date >= $1::date${leaveTypeClause}`,
        leaveParams
      ),
      // Plain attendance-marked absences (no approved leave covering the day)
      // get their own 'A' code — Zoho's calendar marks these too, not just
      // approved-leave days.
      pool.query(
        `SELECT employee_id, date FROM attendance WHERE status='absent' AND date >= $1::date AND date <= $2::date`,
        [start, end]
      ),
    ]);

    const LEAVE_CODE = { casual: 'CL', comp_off: 'CO', unpaid: 'LWP', permission: 'PM' };
    const leavesByEmp = new Map();
    leaveRes.rows.forEach(l => {
      if (!leavesByEmp.has(l.employee_id)) leavesByEmp.set(l.employee_id, []);
      leavesByEmp.get(l.employee_id).push({ code: LEAVE_CODE[l.leave_type] || l.leave_type, start: new Date(l.start_date), end: new Date(l.end_date), isHalfDay: l.is_half_day });
    });
    const absentByEmp = new Set(absentRes.rows.map(r => `${r.employee_id}|${new Date(r.date).toLocaleDateString('en-CA')}`));

    const days = [];
    for (const d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) days.push(new Date(d));

    const data = empRes.rows.map(emp => {
      const cells = days.map(day => {
        const key = `${day.getFullYear()}-${day.getMonth() + 1}-${day.getDate()}`;
        const holType = holMap.get(key);
        if (holidayClosesOffice(holType)) return 'H';
        if (holType !== 'working_day' && rules.some(rule => ruleMatchesDate(rule, day))) return 'WO';
        const leave = (leavesByEmp.get(emp._id) || []).find(l => day >= l.start && day <= l.end);
        if (leave) return `${leave.code}${leave.isHalfDay ? '½' : ''}`;
        if (absentByEmp.has(`${emp._id}|${day.toLocaleDateString('en-CA')}`)) return 'A';
        return '';
      });
      return { ...emp, days: cells };
    });

    res.json({ success: true, data, dayLabels: days.map(d => d.toLocaleDateString('en-CA')), startDate: start, endDate: end });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// Per-employee balance (pick one employee, see their figures) — matches
// Zoho's picker-driven Employee Leave Balance rather than an all-employees
// table. Every leave type reports both a days figure and an hours figure
// (blank/0 for whichever unit doesn't apply to that type) instead of a
// Day/Hour toggle that hides one or the other.
// Deliberately limited to casual/comp-off/unpaid/permission — those are the
// only leave types with a real, wired-up balance concept anywhere in this
// app's leave flow (see /leaves/balance). employees.sick_leave/earned_leave
// exist as columns but no application flow ever reads/writes them for a
// real balance, so showing them would just be fake numbers.
// How much accrues, when, and for which types is read from the Leave Policy
// table (leave_types.accrual_mode / accrual_amount) via utils/leavePolicy —
// see that file for the modes. Seeded so the behaviour is unchanged: casual
// is annual, permission accrues 4 hours a month, comp-off is earned, unpaid
// has no entitlement. Shared by all three balance endpoints below, so the
// summary, the monthly drilldown and the ledger cannot disagree about what
// was granted.
router.get('/leave/balance-user', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const { employeeId } = req.query;
    if (!employeeId) return res.status(400).json({ success: false, message: 'employeeId is required' });
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();

    const empRes = await pool.query(
      `SELECT id AS "_id", first_name AS "firstName", last_name AS "lastName", employee_id AS "employeeCode", department, exit_date AS "exitDate", joining_date::text AS "joiningDate", COALESCE(casual_leave,0) AS "casualAllocated"
         FROM employees WHERE id = $1`, [employeeId]
    );
    const emp = empRes.rows[0];
    if (!emp) return res.status(404).json({ success: false, message: 'Employee not found' });

    const [leaveRes, compRes, absentRes] = await Promise.all([
      pool.query(
        `SELECT leave_type AS "leaveType", COALESCE(SUM(total_days),0) AS days, COALESCE(SUM(hours),0) AS hours
           FROM leaves WHERE employee_id = $1 AND status = 'approved' AND EXTRACT(YEAR FROM start_date) = $2
           GROUP BY leave_type`,
        [employeeId, year]
      ),
      pool.query(
        `SELECT COALESCE(SUM(days_earned),0) AS earned, COALESCE(SUM(days_used),0) AS used
           FROM comp_offs WHERE employee_id = $1 AND status = 'approved' AND EXTRACT(YEAR FROM worked_date) = $2`,
        [employeeId, year]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS count FROM attendance WHERE employee_id = $1 AND status = 'absent' AND EXTRACT(YEAR FROM date) = $2`,
        [employeeId, year]
      ),
    ]);

    const policies = await getLeavePolicies();
    const byType = new Map(leaveRes.rows.map(r => [r.leaveType, r]));
    const casualBooked = parseFloat(byType.get('casual')?.days) || 0;
    const casualAllocated = parseFloat(emp.casualAllocated) || 0;
    const unpaidBooked = parseFloat(byType.get('unpaid')?.days) || 0;
    const permissionHours = parseFloat(byType.get('permission')?.hours) || 0;
    const compEarned = parseFloat(compRes.rows[0].earned) || 0;
    const compUsed = parseFloat(compRes.rows[0].used) || 0;
    const absentCount = absentRes.rows[0].count;

    // Only accruals up to today count — one that hasn't happened yet isn't
    // spendable.
    const upToMonth = year === new Date().getFullYear() ? new Date().getMonth() + 1 : 12;
    const granted = (code, opts = {}) =>
      grantedToDate(policies.get(code), { year, upToMonth, joiningDate: emp.joiningDate, ...opts });

    // Casual is the one type whose allocation is per-employee
    // (employees.casual_leave); the policy supplies the schedule, that column
    // the amount.
    const casualGranted = granted('casual', { annualAmount: casualAllocated });
    const compGranted = granted('comp_off', { earnedAmount: compEarned });
    const unpaidGranted = granted('unpaid');
    const absentGranted = granted('absent');
    // A null granted means the type has no entitlement to draw down, so its
    // Current Balance is 0 rather than a negative running total.
    const balanceOf = (g, booked) => (g === null ? 0 : round2(Math.max(0, g - booked)));

    // Split by unit like Zoho's Day/Hour toggle — Day mode never shows
    // Permission (it's hour-only) and Hour mode shows nothing else, rather
    // than merging both units into one row per type.
    const dayData = [
      // Absent is a count of attendance-marked absences with no grant behind
      // it. Leave Without Pay is the same shape: unlimited by definition,
      // nothing to draw down.
      { leaveType: 'absent', label: 'Absent', granted: absentGranted, booked: absentCount, balance: balanceOf(absentGranted, absentCount) },
      { leaveType: 'casual', label: 'Casual Leave', granted: casualGranted, booked: casualBooked, balance: balanceOf(casualGranted, casualBooked) },
      { leaveType: 'comp_off', label: 'Compensatory Off', granted: compGranted, booked: compUsed, balance: balanceOf(compGranted, compUsed) },
      { leaveType: 'unpaid', label: 'Leave Without Pay', granted: unpaidGranted, booked: unpaidBooked, balance: balanceOf(unpaidGranted, unpaidBooked) },
    ];
    // Permission does have a balance: what accrues and isn't taken stays.
    // It is not clamped at 0 — permission can be booked past the accrual and
    // the report should show that rather than hide it.
    const permissionGranted = granted('permission') || 0;
    const hourData = [
      {
        leaveType: 'permission', label: 'Permission',
        granted: permissionGranted,
        booked: permissionHours,
        balance: round2(permissionGranted - permissionHours),
      },
    ];
    res.json({ success: true, employee: emp, year, dayData, hourData });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// Month-by-month drilldown for one employee + one leave type — the modal
// Zoho opens when you click a leave type row. Granted follows the type's
// configured accrual mode: an annual policy puts the whole allocation in the
// entitlement month and 0 after (this system has no schedule to spread it
// over, so spreading it would be fabricated data), a monthly policy repeats
// its amount, an earned policy (Comp-Off) sums what its own worked_date
// events credited that month, and a type with no accrual keeps
// granted/balance null every month, same as the summary table.
//
// "absent" is not a leave type — it's days marked absent on the attendance
// register, with no grant or balance behind it. It's drillable all the same,
// because the row is on the report and a row you can't open reads as broken;
// its Booked column is the count of absences and Granted/Balance stay null.
router.get('/leave/balance-user-detail', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const { employeeId, leaveType } = req.query;
    if (!employeeId || !['casual', 'comp_off', 'unpaid', 'permission', 'absent'].includes(leaveType)) {
      return res.status(400).json({ success: false, message: 'employeeId and a valid leaveType are required' });
    }
    const now = new Date();
    const year = parseInt(req.query.year, 10) || now.getFullYear();
    const monthsCount = year === now.getFullYear() ? now.getMonth() + 1 : 12;

    const empRes = await pool.query('SELECT joining_date::text AS "joiningDate", COALESCE(casual_leave,0) AS "casualAllocated" FROM employees WHERE id = $1', [employeeId]);
    if (!empRes.rows[0]) return res.status(404).json({ success: false, message: 'Employee not found' });
    const { joiningDate } = empRes.rows[0];
    const casualAllocated = parseFloat(empRes.rows[0].casualAllocated) || 0;
    const startIso = entitlementStart(year, joiningDate);
    // Nothing accrues before someone joins, so the ledger opens in their
    // joining month rather than listing months they weren't employed for.
    const firstMonth = Number(startIso.slice(5, 7));

    const policy = (await getLeavePolicies()).get(leaveType);
    const grantedByMonth = new Map();
    accrualEvents(policy, {
      year, upToMonth: monthsCount, joiningDate,
      annualAmount: leaveType === 'casual' ? casualAllocated : null,
    }).forEach(a => grantedByMonth.set(a.month, (grantedByMonth.get(a.month) || 0) + a.amount));

    const bookedRes = leaveType === 'absent'
      ? await pool.query(
          `SELECT EXTRACT(MONTH FROM date)::int AS month, COUNT(*)::float AS days, 0 AS hours
             FROM attendance WHERE employee_id = $1 AND status = 'absent' AND EXTRACT(YEAR FROM date) = $2
             GROUP BY month`,
          [employeeId, year]
        )
      : await pool.query(
          `SELECT EXTRACT(MONTH FROM start_date)::int AS month, COALESCE(SUM(total_days),0) AS days, COALESCE(SUM(hours),0) AS hours
             FROM leaves WHERE employee_id = $1 AND leave_type = $2 AND status = 'approved' AND EXTRACT(YEAR FROM start_date) = $3
             GROUP BY month`,
          [employeeId, leaveType, year]
        );
    const bookedByMonth = new Map(bookedRes.rows.map(r => [r.month, r]));

    // An earned policy has no schedule — what it granted in a month is
    // whatever its own events credited there.
    let compOffGrantedByMonth = new Map();
    if (policy.accrualMode === 'earned' && leaveType === 'comp_off') {
      const g = await pool.query(
        `SELECT EXTRACT(MONTH FROM worked_date)::int AS month, COALESCE(SUM(days_earned),0) AS earned
           FROM comp_offs WHERE employee_id = $1 AND status = 'approved' AND EXTRACT(YEAR FROM worked_date) = $2
           GROUP BY month`,
        [employeeId, year]
      );
      compOffGrantedByMonth = new Map(g.rows.map(r => [r.month, parseFloat(r.earned) || 0]));
    }

    const data = [];
    let cumGranted = 0, cumBooked = 0;
    for (let m = firstMonth; m <= monthsCount; m++) {
      const bookedRow = bookedByMonth.get(m);
      const bookedDays = bookedRow ? parseFloat(bookedRow.days) || 0 : 0;
      const bookedHours = bookedRow ? parseFloat(bookedRow.hours) || 0 : 0;

      let granted = null;
      if (policy.accrualMode === 'earned') granted = compOffGrantedByMonth.get(m) || 0;
      else if (policy.accrualMode !== 'none') granted = grantedByMonth.get(m) || 0;

      let balance = null;
      if (granted !== null) {
        cumGranted += granted;
        cumBooked += leaveType === 'permission' ? bookedHours : bookedDays;
        balance = Math.round(Math.max(0, cumGranted - cumBooked) * 100) / 100;
      }

      data.push({
        month: m,
        monthLabel: new Date(year, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        granted, bookedDays, bookedHours, balance, lapsed: 0,
      });
    }

    res.json({ success: true, data, leaveType, year, unit: leaveType === 'permission' ? 'hours' : 'days' });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// Transaction-level ledger behind the monthly summary above — the reference's
// "History" view. Each row moves the running balance: an opening marker, the
// accruals, and every booking.
//
// This is derived rather than stored: there is no accrual-history table. It
// replays the type's current accrual policy over the year. That is exact
// rather than a reconstruction only because leave_types holds one policy with
// no history — editing a policy rewrites the past ledger as well as the
// future. If per-year or dated policies are ever introduced, this derivation
// stops being faithful and needs a real ledger table.
//
// "absent" is included so every row on the report opens. It has no accrual,
// so Added is empty throughout and the running figure counts absences rather
// than draining an entitlement — the same number the report's Current Balance
// column shows for that row.
router.get('/leave/balance-user-history', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const { employeeId, leaveType } = req.query;
    if (!employeeId || !['casual', 'comp_off', 'unpaid', 'permission', 'absent'].includes(leaveType)) {
      return res.status(400).json({ success: false, message: 'employeeId and a valid leaveType are required' });
    }
    const now = new Date();
    const year = parseInt(req.query.year, 10) || now.getFullYear();
    const upToMonth = year === now.getFullYear() ? now.getMonth() + 1 : 12;
    const isHours = leaveType === 'permission';

    const [empRes, takenRes, compRes] = await Promise.all([
      pool.query('SELECT joining_date::text AS "joiningDate", COALESCE(casual_leave,0) AS "casualAllocated" FROM employees WHERE id = $1', [employeeId]),
      leaveType === 'absent'
        ? pool.query(
            `SELECT date::text AS date, 1 AS days, 0 AS hours
               FROM attendance WHERE employee_id = $1 AND status = 'absent' AND EXTRACT(YEAR FROM date) = $2
              ORDER BY date`,
            [employeeId, year]
          )
        : pool.query(
            `SELECT start_date::text AS date, COALESCE(total_days,0) AS days, COALESCE(hours,0) AS hours
               FROM leaves
              WHERE employee_id = $1 AND leave_type = $2 AND status = 'approved'
                AND EXTRACT(YEAR FROM start_date) = $3
              ORDER BY start_date`,
            [employeeId, leaveType, year]
          ),
      leaveType === 'comp_off'
        ? pool.query(
            `SELECT worked_date::text AS date, COALESCE(days_earned,0) AS earned
               FROM comp_offs WHERE employee_id = $1 AND status='approved' AND EXTRACT(YEAR FROM worked_date) = $2
              ORDER BY worked_date`,
            [employeeId, year]
          )
        : Promise.resolve({ rows: [] }),
    ]);
    if (!empRes.rows[0]) return res.status(404).json({ success: false, message: 'Employee not found' });

    const policy = (await getLeavePolicies()).get(leaveType);
    const events = [];
    if (policy.accrualMode === 'earned') {
      compRes.rows.forEach(r => events.push({ date: r.date, type: 'Accrual', added: parseFloat(r.earned) || 0 }));
    } else {
      // Scheduled accruals, dated where the entitlement actually arrived — a
      // mid-year joiner's annual allocation lands on their joining date, not
      // the preceding January.
      accrualEvents(policy, {
        year, upToMonth, joiningDate: empRes.rows[0].joiningDate,
        annualAmount: leaveType === 'casual' ? parseFloat(empRes.rows[0].casualAllocated) || 0 : null,
      }).forEach(a => events.push({ date: a.date, type: 'Accrual', added: a.amount }));
    }
    takenRes.rows.forEach(r => events.push({
      date: r.date, type: leaveType === 'absent' ? 'Absent' : 'Leave Taken',
      booked: isHours ? (parseFloat(r.hours) || 0) : (parseFloat(r.days) || 0),
    }));

    // Accruals settle before bookings on the same date, so a same-day grant is
    // available to spend rather than pushing the balance negative.
    events.sort((a, b) => (a.date === b.date
      ? (a.type === 'Accrual' ? -1 : 1)
      : a.date.localeCompare(b.date)));

    // Absent has no entitlement behind it, so it carries no balance at all —
    // neither draining one (which would run negative) nor counting up, which
    // would contradict the 0 the report shows for that row.
    const hasBalance = leaveType !== 'absent';
    let balance = 0;
    const data = [{ date: `${year}-01-01`, type: 'Report Initiated', added: null, booked: null, balance: hasBalance ? 0 : null }];
    events.forEach(e => {
      balance += (e.added || 0) - (e.booked || 0);
      data.push({
        date: e.date, type: e.type,
        added: e.added ?? null, booked: e.booked ?? null,
        balance: hasBalance ? parseFloat(balance.toFixed(4)) : null,
      });
    });

    res.json({ success: true, data, leaveType, year, unit: isHours ? 'hours' : 'days' });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.get('/leave/booked-balance', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const start = req.query.startDate || new Date(new Date().setDate(1)).toLocaleDateString('en-CA');
    const end = req.query.endDate || new Date().toLocaleDateString('en-CA');
    const unit = req.query.unit === 'hour' ? 'hour' : 'day';
    const filters = standardEmployeeFilters(req, 'e', 3);

    if (unit === 'hour') {
      // Hour mode shows only Permission — the only hour-based leave type —
      // same convention as Zoho's Hour toggle, which drops the day-based
      // Casual/Unpaid/Comp-Off columns entirely rather than mixing units.
      // Permission's real rule is 4h per CALENDAR MONTH with no carry-over
      // (see leaves.js), so the allocation for an arbitrary range is
      // 4h x (number of distinct calendar months the range touches).
      const monthsTouched = (() => {
        const s = new Date(start), e = new Date(end);
        const set = new Set();
        for (const d = new Date(s.getFullYear(), s.getMonth(), 1); d <= e; d.setMonth(d.getMonth() + 1)) {
          set.add(`${d.getFullYear()}-${d.getMonth()}`);
        }
        return set.size;
      })();
      const r = await pool.query(
        `SELECT e.id AS "_id", e.first_name AS "firstName", e.last_name AS "lastName", e.department, e.employee_id AS "employeeCode", e.exit_date AS "exitDate",
                COALESCE(perm.hours, 0) AS "permissionBooked"
           FROM employees e
           LEFT JOIN (SELECT employee_id, SUM(hours) AS hours FROM leaves WHERE status='approved' AND leave_type='permission' AND start_date <= $2::date AND end_date >= $1::date GROUP BY employee_id) perm ON perm.employee_id = e.id
          WHERE 1=1${filters.clause}
          ORDER BY e.employee_id`,
        [start, end, ...filters.params]
      );
      const data = r.rows.map(row => {
        const permissionBooked = parseFloat(row.permissionBooked) || 0;
        const permissionAllocated = monthsTouched * 4;
        return { ...row, permissionBooked, permissionAllocated, permissionBalance: Math.max(0, permissionAllocated - permissionBooked) };
      });
      return res.json({ success: true, data, unit, startDate: start, endDate: end });
    }

    const r = await pool.query(
      `SELECT e.id AS "_id", e.first_name AS "firstName", e.last_name AS "lastName", e.department, e.employee_id AS "employeeCode", e.exit_date AS "exitDate",
              -- NULL means no allocation exists, which is not the same statement as an
              -- allocation of zero. COALESCE erased that difference; the report
              -- renders the first as N/A and the second as 0.
              e.casual_leave AS "casualAllocated",
              COALESCE(casual.days, 0) AS "casualBooked",
              COALESCE(absent.cnt, 0) AS "absentBooked",
              COALESCE(lwp.days, 0) AS "lwpBooked",
              COALESCE(co.earned, 0) - COALESCE(co.used, 0) AS "compOffBalance",
              COALESCE(co_range.used, 0) AS "compOffBooked"
         FROM employees e
         LEFT JOIN (SELECT employee_id, SUM(total_days) AS days FROM leaves WHERE status='approved' AND leave_type='casual' AND start_date <= $2::date AND end_date >= $1::date GROUP BY employee_id) casual ON casual.employee_id = e.id
         LEFT JOIN (SELECT employee_id, SUM(total_days) AS days FROM leaves WHERE status='approved' AND leave_type='unpaid' AND start_date <= $2::date AND end_date >= $1::date GROUP BY employee_id) lwp ON lwp.employee_id = e.id
         LEFT JOIN (SELECT employee_id, COUNT(*)::int AS cnt FROM attendance WHERE status='absent' AND date >= $1::date AND date <= $2::date GROUP BY employee_id) absent ON absent.employee_id = e.id
         LEFT JOIN (SELECT employee_id, SUM(days_earned) AS earned, SUM(days_used) AS used FROM comp_offs WHERE status='approved' GROUP BY employee_id) co ON co.employee_id = e.id
         LEFT JOIN (SELECT employee_id, SUM(days_used) AS used FROM comp_offs WHERE status='approved' AND comp_off_date >= $1::date AND comp_off_date <= $2::date GROUP BY employee_id) co_range ON co_range.employee_id = e.id
        WHERE 1=1${filters.clause}
        ORDER BY e.employee_id`,
      [start, end, ...filters.params]
    );
    const data = r.rows.map(row => {
      // An employee with no allocation row carries null, not zero, all the way
      // through to the table — the report prints N/A there, which says "this
      // does not apply" rather than "this is zero".
      const noAllocation = row.casualAllocated === null || row.casualAllocated === undefined;
      const casualAllocated = noAllocation ? null : parseFloat(row.casualAllocated) || 0;
      const casualBooked = parseFloat(row.casualBooked) || 0;
      const absentBooked = parseFloat(row.absentBooked) || 0;
      const lwpBooked = parseFloat(row.lwpBooked) || 0;
      return {
        ...row,
        casualAllocated,
        casualBooked: noAllocation ? null : casualBooked,
        casualBalance: noAllocation ? null : Math.max(0, casualAllocated - casualBooked),
        absentBooked, lwpBooked,
        unpaidTotalBooked: absentBooked + lwpBooked,
        compOffBooked: parseFloat(row.compOffBooked) || 0,
        compOffBalance: parseFloat(row.compOffBalance) || 0,
      };
    });
    res.json({ success: true, data, unit, startDate: start, endDate: end });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// Leave types + years that actually have data — feeds the "Leave type"
// dropdown on Leave Type Wise Summary, so it only ever shows real years
// (matching how Zoho's dropdown accumulates a "Casual Leave 2023/2024/2025"
// entry per year it's actually been used) instead of a hardcoded list.
router.get('/leave/types-available', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT DISTINCT leave_type AS "leaveType", EXTRACT(YEAR FROM start_date)::int AS year
         FROM leaves ORDER BY leave_type, year DESC`
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// Per-employee ledger for ONE leave type + year. openingBalance and lapsed
// are always 0 — this system has no carry-forward or lapse-policy tracking,
// so rather than fabricate numbers, those columns honestly show 0 instead
// of a guess.
router.get('/leave/type-summary', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const leaveType = ['casual', 'comp_off', 'unpaid', 'permission'].includes(req.query.leaveType) ? req.query.leaveType : 'casual';
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const filters = standardEmployeeFilters(req, 'e', 3);
    const r = await pool.query(
      `SELECT e.id AS "_id", e.first_name AS "firstName", e.last_name AS "lastName", e.department, e.employee_id AS "employeeCode", e.exit_date AS "exitDate",
              ${leaveType === 'casual' ? 'COALESCE(e.casual_leave,0)' : 'NULL'} AS granted,
              COALESCE(SUM(l.total_days) FILTER (WHERE l.status='approved'), 0) AS booked,
              COALESCE(SUM(l.hours) FILTER (WHERE l.status='approved'), 0) AS "bookedHours"
         FROM employees e
         LEFT JOIN leaves l ON l.employee_id = e.id AND l.leave_type = $1 AND EXTRACT(YEAR FROM l.start_date) = $2
        WHERE 1=1${filters.clause}
        GROUP BY e.id, e.first_name, e.last_name, e.department, e.employee_id, e.exit_date, e.casual_leave
        ORDER BY e.employee_id`,
      [leaveType, year, ...filters.params]
    );
    const data = r.rows.map(row => {
      const granted = row.granted !== null ? parseFloat(row.granted) : null;
      const booked = parseFloat(row.booked) || 0;
      return {
        ...row, granted, booked,
        bookedHours: parseFloat(row.bookedHours) || 0,
        openingBalance: 0,
        closingBalance: granted !== null ? Math.max(0, granted - booked) : null,
        lapsed: 0,
      };
    });
    res.json({ success: true, data, leaveType, year });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.get('/leave/encashment', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT l.id AS "_id", l.leave_type AS "leaveType", l.days, l.status, l.reason, l.created_at AS "createdAt",
              e.first_name AS "firstName", e.last_name AS "lastName", e.department, e.employee_id AS "employeeCode", e.exit_date AS "exitDate"
         FROM leave_encashments l JOIN employees e ON l.employee_id = e.id
        WHERE 1=1${reportsScope(req.user, 'e', 1).clause}
        ORDER BY l.created_at DESC LIMIT 200`,
      reportsScope(req.user, 'e', 1).params
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// Reuses the exact same lopDaysForRange() Payroll Run computes with, so
// this report can never disagree with what actually gets deducted.
// previousPeriodBalance/waivedOff/carryOver/reason are always 0/blank —
// this system doesn't track LOP adjustments or carry-over between pay
// periods, so those columns are honestly empty rather than invented.
router.get('/leave/lop', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(new Date().setDate(1));
    const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();
    const { holMap, rules } = await loadHolidaysAndRulesRange(startDate, endDate);

    const filters = standardEmployeeFilters(req, 'e', 1);
    const empRes = await pool.query(
      `SELECT id AS "_id", first_name AS "firstName", last_name AS "lastName", department, employee_id AS "employeeCode", exit_date AS "exitDate"
         FROM employees e WHERE 1=1${filters.clause} ORDER BY first_name`,
      filters.params
    );

    const data = [];
    for (const emp of empRes.rows) {
      const lopDays = await lopDaysForRange(emp._id, startDate, endDate, holMap, rules, pool);
      // Every employee is listed, including those with no loss of pay. This
      // report is read to confirm a payroll figure, and "nobody had LOP" and
      // "the report failed to load" look identical if the rows are dropped —
      // a table of zeros is the answer, not an empty state.
      data.push({ ...emp, previousPeriodBalance: 0, booked: lopDays, total: lopDays, waivedOff: 0, carryOver: 0, reason: null, lopDays, lopHours: 0 });
    }
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// Per-employee payroll-period summary — Total days / Loss of Pay / Paid
// days, matching Zoho's actual Leave Data for Payroll report (not a raw
// list of leave applications, which is a different report). "Total days"
// is the days the employee was actually on rolls within the period —
// capped by joining_date/exit_date on either end — so a mid-period
// joiner/exit shows their real partial-period day count, not the full
// period length.
router.get('/leave/payroll-export', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const start = req.query.startDate || new Date(new Date().setDate(1)).toLocaleDateString('en-CA');
    const end = req.query.endDate || new Date().toLocaleDateString('en-CA');
    const startD = new Date(start), endD = new Date(end);
    const reportType = req.query.reportType === 'detailed' ? 'detailed' : 'default';
    const unit = req.query.unit === 'hour' ? 'hour' : 'day';
    // Hour mode is a flat 8-hours-per-day conversion of the day figures —
    // this app doesn't track shift-specific hour totals for payroll days,
    // so a standard workday is the only non-fabricated basis available.
    const HOURS_PER_DAY = 8;
    const { holMap, rules } = await loadHolidaysAndRulesRange(startD, endD);

    const filters = standardEmployeeFilters(req, 'e', 1);
    const empRes = await pool.query(
      `SELECT id AS "_id", first_name AS "firstName", last_name AS "lastName", employee_id AS "employeeCode", department,
              exit_date AS "exitDate", joining_date AS "joiningDate"
         FROM employees e WHERE 1=1${filters.clause} ORDER BY first_name`,
      filters.params
    );

    const data = [];
    for (const emp of empRes.rows) {
      const effStart = emp.joiningDate && new Date(emp.joiningDate) > startD ? new Date(emp.joiningDate) : startD;
      const effEnd = emp.exitDate && new Date(emp.exitDate) < endD ? new Date(emp.exitDate) : endD;
      if (effEnd < effStart) continue; // not on rolls at any point in this period
      const totalDays = Math.round((effEnd - effStart) / 86400000) + 1;
      // eslint-disable-next-line no-await-in-loop
      const lopDays = await lopDaysForRange(emp._id, effStart, effEnd, holMap, rules, pool);
      const paidDays = Math.max(0, totalDays - lopDays);
      const row = { ...emp, totalDays, lopDays, paidDays };

      if (reportType === 'detailed') {
        let weekendCount = 0, holidayCount = 0;
        for (const d = new Date(effStart); d <= effEnd; d.setDate(d.getDate() + 1)) {
          const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
          const holType = holMap.get(key);
          if (holidayClosesOffice(holType)) holidayCount++;
          else if (holType !== 'working_day' && rules.some(rule => ruleMatchesDate(rule, d))) weekendCount++;
        }
        // eslint-disable-next-line no-await-in-loop
        const leaveRes = await pool.query(
          `SELECT leave_type, COALESCE(SUM(total_days), 0) AS days
             FROM leaves WHERE employee_id = $1 AND status = 'approved' AND leave_type IN ('casual','unpaid','comp_off')
               AND start_date <= $3::date AND end_date >= $2::date
             GROUP BY leave_type`,
          [emp._id, effStart.toLocaleDateString('en-CA'), effEnd.toLocaleDateString('en-CA')]
        );
        const byType = Object.fromEntries(leaveRes.rows.map(r => [r.leave_type, parseFloat(r.days) || 0]));
        const leavePaid = byType.casual || 0, leaveUnpaid = byType.unpaid || 0, leaveComp = byType.comp_off || 0;
        // On Duty is always 0 — that leave type doesn't exist in this
        // system yet (no application flow writes it), so the column is
        // honestly empty rather than a fabricated figure. Kept in the
        // response now so the report's structure matches Zoho's and needs
        // no rework once On Duty is actually built.
        Object.assign(row, {
          weekendCount, holidayCount, payableDays: paidDays, onDutyDays: 0,
          leavePaid, leaveUnpaid, leaveComp, leaveTotal: leavePaid + leaveUnpaid + leaveComp,
        });
      }
      data.push(row);
    }

    const numericKeys = ['totalDays', 'lopDays', 'paidDays', 'weekendCount', 'holidayCount', 'payableDays', 'onDutyDays', 'leavePaid', 'leaveUnpaid', 'leaveComp', 'leaveTotal'];
    const finalData = unit === 'hour'
      ? data.map(row => {
          const converted = { ...row };
          for (const k of numericKeys) if (k in converted) converted[k] = converted[k] * HOURS_PER_DAY;
          return converted;
        })
      : data;

    res.json({ success: true, data: finalData, reportType, unit, startDate: start, endDate: end });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// ══════════════════════════ Attendance reports ═════════════════════════════

// The identity block every employee-level export opens with. Kept as one
// fragment so a report can't drift into exporting a different set of columns
// than its siblings — "Reporting To" in particular needs a self-join that's
// easy to get subtly wrong per query.
const EMP_IDENTITY_SQL = `e.email,
  e.designation, e.work_location AS "workLocation", e.role,
  (SELECT TRIM(COALESCE(m.first_name,'') || ' ' || COALESCE(m.last_name,''))
     FROM employees m WHERE m.id = e.reporting_manager_id) AS "reportingTo"`;

// Leave-type → grid code, matching the Leave Tracker calendar so the same
// leave reads identically in both report families.
const ATT_LEAVE_CODE = { casual: 'CL', comp_off: 'CO', unpaid: 'LWP', permission: 'PM' };
const ATT_STATUS_LABEL = {
  present: 'Present', onDuty: 'On Duty', paidLeave: 'Paid Leave',
  absent: 'Absent', unpaidLeave: 'Unpaid Leave', holiday: 'Holidays', weekend: 'Weekend',
};

// Full leave names for the Status column. The bucket label ("Paid Leave") is
// what the pie counts; the column itself names the actual record, the way the
// reference reads "Casual Leave(Second Half)" rather than "Paid Leave".
const ATT_LEAVE_NAME = {
  casual: 'Casual Leave', comp_off: 'Comp-Off', unpaid: 'Leave Without Pay', permission: 'Permission',
};
const HALF_DAY_LABEL = { first_half: 'First Half', second_half: 'Second Half' };

const hhmm = h => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

// "Casual Leave(Second Half)", "Permission(01:00 hours)", comma-joined when a
// day carries more than one record. A permission is hours off inside a working
// day, so it is qualified by its duration rather than by a half-day marker.
function leaveStatusText(leaves) {
  return leaves.map(l => {
    const name = ATT_LEAVE_NAME[l.leaveType] || l.leaveType;
    if (l.leaveType === 'permission') {
      const hrs = parseFloat(l.hours);
      return hrs > 0 ? `${name}(${hhmm(hrs)} hours)` : name;
    }
    const half = l.isHalfDay ? HALF_DAY_LABEL[l.halfDayType] : null;
    return half ? `${name}(${half})` : name;
  }).join(', ');
}

// Shift length in hours. Falls back to a standard 8h day when an employee has
// no shift assigned — this app has no per-employee hour contract, so a
// standard workday is the only non-fabricated basis available.
function shiftHoursOf(startTime, endTime, fallback = 8) {
  if (!startTime || !endTime) return fallback;
  const [sh, sm] = String(startTime).split(':').map(Number);
  const [eh, em] = String(endTime).split(':').map(Number);
  if ([sh, eh].some(Number.isNaN)) return fallback;
  let h = ((eh * 60 + (em || 0)) - (sh * 60 + (sm || 0))) / 60;
  if (h <= 0) h += 24; // overnight shift
  return h;
}

// Minutes past midnight for a 'HH:MM' shift boundary.
function shiftMinutes(t) {
  if (!t) return null;
  const [h, m] = String(t).split(':').map(Number);
  return Number.isNaN(h) ? null : h * 60 + (m || 0);
}

// Single source of truth for "what happened on this day for this employee",
// shared by every calendar/summary attendance report so Muster Roll, Present/
// Absent Status, Presence Hours Break-up and Attendance Data for Payroll can
// never disagree about whether a day was a holiday, a weekend, leave, or an
// absence. `kind` drives the numeric summaries; `code` is the grid cell text.
// On Duty is never produced — that leave type doesn't exist in this system
// yet, so its counters stay honestly 0 rather than being invented.
function classifyAttendanceDay({ date, holMap, rules, attStatus, leave, isFuture }) {
  if (isFuture) return { code: '-', kind: 'future' };
  const holType = holMap.get(`${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`);
  if (holidayClosesOffice(holType)) return { code: 'H', kind: 'holiday' };
  if (holType !== 'working_day' && rules.some(rule => ruleMatchesDate(rule, date))) return { code: 'W', kind: 'weekend' };
  if (leave) {
    const code = ATT_LEAVE_CODE[leave.leaveType] || 'L';
    return {
      code: leave.isHalfDay ? `0.5${code}/0.5P` : code,
      kind: leave.leaveType === 'unpaid' ? 'unpaidLeave' : 'paidLeave',
      fraction: leave.isHalfDay ? 0.5 : 1,
    };
  }
  if (attStatus === 'present' || attStatus === 'late') return { code: 'P', kind: 'present' };
  if (attStatus === 'half-day') return { code: 'HD', kind: 'present', fraction: 0.5 };
  return { code: 'A', kind: 'absent' };
}

// Loads everything the day-grid attendance reports need for a range in one
// place: filtered employees (with their shift), their attendance rows, their
// approved leaves, and the holiday/weekend rule set.
async function loadAttendanceContext(req, start, end) {
  const filters = standardEmployeeFilters(req, 'e', 1);
  const [empRes, attRes, leaveRes, cal] = await Promise.all([
    pool.query(
      `SELECT e.id AS "_id", e.first_name AS "firstName", e.last_name AS "lastName", e.department,
              e.employee_id AS "employeeCode", e.exit_date AS "exitDate", e.joining_date AS "joiningDate",
              ${EMP_IDENTITY_SQL},
              s.name AS "shiftName", s.start_time AS "shiftStart", s.end_time AS "shiftEnd"
         FROM employees e
         LEFT JOIN shifts s ON e.shift_id = s.id
        WHERE 1=1${filters.clause}
        ORDER BY e.employee_id`,
      filters.params
    ),
    pool.query(
      `SELECT employee_id, date::text AS date, check_in AS "checkIn", check_out AS "checkOut",
              working_hours AS "workingHours", status, late_minutes AS "lateMinutes"
         FROM attendance WHERE date >= $1::date AND date <= $2::date`,
      [start, end]
    ),
    pool.query(
      `SELECT employee_id, leave_type AS "leaveType", start_date, end_date,
              start_date::text AS "startYmd", end_date::text AS "endYmd",
              is_half_day AS "isHalfDay", half_day_type AS "halfDayType", hours
         FROM leaves WHERE status='approved' AND start_date <= $2::date AND end_date >= $1::date
        ORDER BY start_date, leave_type`,
      [start, end]
    ),
    loadHolidaysAndRulesRange(new Date(start), new Date(end)),
  ]);

  const attByKey = new Map(attRes.rows.map(r => [`${r.employee_id}|${r.date}`, r]));
  const leavesByEmp = new Map();
  leaveRes.rows.forEach(l => {
    if (!leavesByEmp.has(l.employee_id)) leavesByEmp.set(l.employee_id, []);
    leavesByEmp.get(l.employee_id).push({ ...l, start: new Date(l.start_date), end: new Date(l.end_date) });
  });
  // Match on the calendar date as a string, never on Date objects. A DATE
  // column comes back as local midnight while the day being tested is built
  // from `new Date('YYYY-MM-DD')` — UTC midnight — so east of Greenwich the
  // day sat hours *after* the leave's end and every single-day leave was
  // silently missed. Same date-vs-timezone trap as isFuture.
  const covers = (l, ymd) => ymd >= l.startYmd && ymd <= l.endYmd;
  const leaveOn = (empId, date) => (leavesByEmp.get(empId) || []).find(l => covers(l, date.toLocaleDateString('en-CA')));
  // Every record on the day, not just the first — a person can hold a
  // permission and a half-day leave at once, and the Status column names both.
  const leavesOn = (empId, date) => (leavesByEmp.get(empId) || []).filter(l => covers(l, date.toLocaleDateString('en-CA')));

  const days = [];
  const endD = new Date(end);
  for (const d = new Date(start); d <= endD; d.setDate(d.getDate() + 1)) days.push(new Date(d));

  const today = new Date(); today.setHours(0, 0, 0, 0);
  // An employee only "has" days between joining and exit — outside that range
  // they aren't absent, they simply weren't on rolls.
  const onRolls = (emp, date) =>
    !(emp.joiningDate && new Date(emp.joiningDate) > date) &&
    !(emp.exitDate && new Date(emp.exitDate) < date);

  return { employees: empRes.rows, attByKey, leaveOn, leavesOn, days, today, onRolls, holMap: cal.holMap, rules: cal.rules };
}

// Local clock minutes for a timestamp — used to compare an actual punch
// against the shift's HH:MM boundary.
const clockMinutes = (ts) => { const d = new Date(ts); return d.getHours() * 60 + d.getMinutes(); };

// Applies the "Total Hours: All / Lesser than / Greater than N" comparator
// that Zoho puts on several attendance reports.
// Punch-time filter for Early/late check-in and check-out.
//
// Six modes, matching the reference. Two are relative to the shift and take a
// duration in minutes ("before shift by 30"); two are absolute and take a
// clock time ("before 09:30"); the other two take nothing.
//
// A mode that needs a value but has none is treated as no filter rather than
// as "matches nothing" — a half-set filter should show everything, not an
// empty table that looks like missing data.
function punchMatches(mode, rawValue, punchMin, earlyBy, lateBy) {
  if (!mode) return true;
  if (mode === 'not_recorded') return punchMin === null;
  // Every remaining mode describes a punch, so a missing one cannot match.
  if (punchMin === null) return false;

  if (mode === 'before_shift') return earlyBy !== null;
  if (mode === 'after_shift') return lateBy !== null;

  if (mode === 'before_shift_by' || mode === 'after_shift_by') {
    const mins = Number(rawValue);
    if (!Number.isFinite(mins) || mins < 0) return true;
    const delta = mode === 'before_shift_by' ? earlyBy : lateBy;
    return delta !== null && delta >= mins;
  }

  if (mode === 'before' || mode === 'after') {
    // "HH:MM" — anything else is an unset filter, not a match of nothing.
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(rawValue || ''));
    if (!m) return true;
    const at = Number(m[1]) * 60 + Number(m[2]);
    return mode === 'before' ? punchMin < at : punchMin > at;
  }
  return true;
}

function totalHoursMatches(query, hours) {
  const mode = query.totalHours;
  if (mode !== 'lt' && mode !== 'gt') return true;
  const threshold = parseFloat(query.totalHoursValue);
  if (Number.isNaN(threshold)) return true;
  return mode === 'lt' ? hours < threshold : hours > threshold;
}

// Pie of attendance status for one date + the separate current-day presence
// donut (In / Out / Yet to check-in), plus the underlying employee list —
// matching Zoho's Daily Attendance Status, which shows those as two distinct
// charts rather than one mixed pie.
router.get('/attendance/daily-status', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const date = req.query.date || new Date().toLocaleDateString('en-CA');
    const ctx = await loadAttendanceContext(req, date, date);
    const day = new Date(date);
    // Compare calendar dates as strings, not Date objects. `new Date('2026-08-13')`
    // is UTC midnight while ctx.today is local midnight, so east of Greenwich the
    // Date comparison made today itself look like the future and the whole report
    // came back empty. ISO date strings sort correctly and carry no zone.
    const todayStr = ctx.today.toLocaleDateString('en-CA');
    const isFuture = date > todayStr;
    const isToday = date === todayStr;
    const statusFilter = [].concat(req.query.status || []).filter(Boolean);

    const counts = { present: 0, onDuty: 0, paidLeave: 0, absent: 0, unpaidLeave: 0, holiday: 0, weekend: 0 };
    const presence = { in: 0, out: 0, yetToCheckIn: 0 };
    let employees = [];

    for (const emp of ctx.employees) {
      if (!ctx.onRolls(emp, day)) continue;
      const att = ctx.attByKey.get(`${emp._id}|${date}`);
      const dayLeaves = ctx.leavesOn(emp._id, day);
      const cls = classifyAttendanceDay({
        date: day, holMap: ctx.holMap, rules: ctx.rules,
        // A permission is hours off inside a working day, so when it sits
        // alongside a real leave the leave is what classifies the day.
        attStatus: att?.status,
        leave: dayLeaves.find(l => l.leaveType !== 'permission') || dayLeaves[0],
        isFuture,
      });

      // An absence is only settled once the day is over. On the current date
      // someone with no punch and no leave has not failed to attend yet — they
      // are still pending a check-in, so they stay out of the status pie and
      // show only in the presence donut. Past dates settle normally.
      const kind = cls.kind === 'absent' && isToday ? 'pending' : cls.kind;
      if (kind !== 'future' && kind !== 'pending') counts[kind] = (counts[kind] || 0) + 1;

      const presenceKey = att?.checkIn && !att?.checkOut ? 'in' : att?.checkIn ? 'out' : 'yetToCheckIn';
      // Only working days can leave someone "yet to check in" — nobody is
      // pending a punch on a holiday or weekend.
      if (presenceKey !== 'yetToCheckIn' || kind === 'present' || kind === 'absent' || kind === 'pending') presence[presenceKey]++;

      // Hours are N/A, not zero, on a day nobody was expected to work and
      // nothing was punched — a full day of leave, a holiday or a weekend.
      const hoursApply = !!att || kind === 'present' || kind === 'absent' || kind === 'pending';

      employees.push({
        _id: emp._id, firstName: emp.firstName, lastName: emp.lastName,
        employeeCode: emp.employeeCode, department: emp.department, exitDate: emp.exitDate,
        firstIn: att?.checkIn || null, lastOut: att?.checkOut || null,
        totalHours: hoursApply ? parseFloat(att?.workingHours) || 0 : null,
        statusKey: kind,
        // The column names the actual leave records when there are any, and
        // falls back to the bucket label otherwise.
        status: dayLeaves.length ? leaveStatusText(dayLeaves) : (ATT_STATUS_LABEL[kind] || null),
        presenceKey, shiftName: emp.shiftName || null,
      });
    }

    const totalUsers = employees.length;
    if (statusFilter.length) {
      employees = employees.filter(r => statusFilter.includes(r.statusKey) || statusFilter.includes(r.presenceKey));
    }
    employees = employees.filter(r => totalHoursMatches(req.query, r.totalHours));

    const byStatus = Object.entries(counts).map(([key, count]) => ({ key, label: ATT_STATUS_LABEL[key], count }));
    res.json({ success: true, date, totalUsers, byStatus, presence, employees });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// Entry (Early | Late) and Exit (Early | Late) against each employee's shift,
// plus net hours vs the shift length — Zoho's Early/Late Check-in and
// Check-out. One row per employee per day in range, so "Not recorded" days
// are visible rather than silently dropped.
router.get('/attendance/early-late', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const start = req.query.startDate || new Date().toLocaleDateString('en-CA');
    const end = req.query.endDate || start;
    const ctx = await loadAttendanceContext(req, start, end);
    const { firstCheckIn, lastCheckOut } = req.query;

    const data = [];
    for (const emp of ctx.employees) {
      const baseStartMin = shiftMinutes(emp.shiftStart);
      const shiftEndMin = shiftMinutes(emp.shiftEnd);
      const baseShiftHours = shiftHoursOf(emp.shiftStart, emp.shiftEnd);

      for (const d of ctx.days) {
        if (d > ctx.today || !ctx.onRolls(emp, d)) continue;
        const ymd = d.toLocaleDateString('en-CA');
        const dayLeaves = ctx.leavesOn(emp._id, d);
        const cls = classifyAttendanceDay({
          date: d, holMap: ctx.holMap, rules: ctx.rules,
          attStatus: ctx.attByKey.get(`${emp._id}|${ymd}`)?.status,
          leave: dayLeaves.find(l => l.leaveType !== 'permission') || dayLeaves[0],
          isFuture: false,
        });
        // Non-working days have no shift to be early or late against.
        if (cls.kind === 'holiday' || cls.kind === 'weekend') continue;

        // A permission is approved time off inside the working day, so it
        // moves the boundary rather than being measured against it: an hour
        // of permission buys an hour's later start and takes an hour off what
        // the day owes. Without this, someone who cleared a late arrival in
        // advance still read as late by the full amount.
        const permHours = dayLeaves
          .filter(l => l.leaveType === 'permission')
          .reduce((s, l) => s + (parseFloat(l.hours) || 0), 0);
        const shiftStartMin = baseStartMin === null ? null : baseStartMin + Math.round(permHours * 60);
        const shiftHours = baseShiftHours - permHours;

        const att = ctx.attByKey.get(`${emp._id}|${ymd}`);
        const inMin = att?.checkIn ? clockMinutes(att.checkIn) : null;
        const outMin = att?.checkOut ? clockMinutes(att.checkOut) : null;
        const totalHours = parseFloat(att?.workingHours) || 0;

        const entryEarly = inMin !== null && shiftStartMin !== null && inMin < shiftStartMin ? shiftStartMin - inMin : null;
        const entryLate = inMin !== null && shiftStartMin !== null && inMin > shiftStartMin ? inMin - shiftStartMin : null;
        const exitEarly = outMin !== null && shiftEndMin !== null && outMin < shiftEndMin ? shiftEndMin - outMin : null;
        const exitLate = outMin !== null && shiftEndMin !== null && outMin > shiftEndMin ? outMin - shiftEndMin : null;

        if (!punchMatches(firstCheckIn, req.query.firstCheckInValue, inMin, entryEarly, entryLate)) continue;
        if (!punchMatches(lastCheckOut, req.query.lastCheckOutValue, outMin, exitEarly, exitLate)) continue;
        if (!totalHoursMatches(req.query, totalHours)) continue;

        data.push({
          _id: `${emp._id}|${ymd}`, employeeId: emp._id,
          firstName: emp.firstName, lastName: emp.lastName, employeeCode: emp.employeeCode,
          department: emp.department, exitDate: emp.exitDate, date: ymd,
          firstIn: att?.checkIn || null, lastOut: att?.checkOut || null,
          totalHours, entryEarly, entryLate, exitEarly, exitLate,
          // Net hours is worked-vs-expected, so it needs a real shift to be
          // measured against. Without one it used to fall back to a standard
          // 8h day and report everybody half an hour up, while Entry and Exit
          // — measured against the same missing shift — honestly showed "-".
          netMinutes: att?.checkIn && shiftStartMin !== null && shiftEndMin !== null
            ? Math.round((totalHours - shiftHours) * 60)
            : null,
          shiftName: emp.shiftName || null,
        });
      }
    }
    res.json({ success: true, data, startDate: start, endDate: end });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// Employee × date calendar grid of attendance codes — Zoho's Employee
// Present/Absent Status. Same shape as Leave Tracker's Resource Availability
// but attendance-first (P/A dominate, leave codes layer on top).
router.get('/attendance/present-absent', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const now = new Date();
    const start = req.query.startDate || new Date(now.getFullYear(), now.getMonth(), 1).toLocaleDateString('en-CA');
    const end = req.query.endDate || new Date(now.getFullYear(), now.getMonth() + 1, 0).toLocaleDateString('en-CA');
    const ctx = await loadAttendanceContext(req, start, end);

    const todayYmd = ctx.today.toLocaleDateString('en-CA');

    // Two readings of the same grid. `days` carries the status code, `hours`
    // the time actually punched — null where there is no attendance row at
    // all, because hours don't apply to a day nobody recorded, whereas 00:00
    // means a day that was recorded and came to nothing.
    const data = ctx.employees.map(emp => {
      const shiftHours = shiftHoursOf(emp.shiftStart, emp.shiftEnd);
      const days = [], hours = [];

      for (const d of ctx.days) {
        if (!ctx.onRolls(emp, d)) { days.push('-'); hours.push(null); continue; }
        const ymd = d.toLocaleDateString('en-CA');
        const att = ctx.attByKey.get(`${emp._id}|${ymd}`);
        const dayLeaves = ctx.leavesOn(emp._id, d);
        const cls = classifyAttendanceDay({
          date: d, holMap: ctx.holMap, rules: ctx.rules,
          attStatus: att?.status,
          leave: dayLeaves.find(l => l.leaveType !== 'permission') || dayLeaves[0],
          isFuture: ymd > todayYmd,
        });

        const worked = parseFloat(att?.workingHours) || 0;
        const permHours = dayLeaves
          .filter(l => l.leaveType === 'permission')
          .reduce((s, l) => s + (parseFloat(l.hours) || 0), 0);

        // A permission taken on a day that was also worked is not the whole
        // story of that day, so the cell tells both halves — the reference
        // splits it the same way ("0.06PM/0.94P", "00:30(PM)/07:30(P)").
        if (permHours > 0 && att?.checkIn) {
          const frac = Math.min(1, permHours / (shiftHours || 8));
          days.push(`${frac.toFixed(2)}PM/${(1 - frac).toFixed(2)}P`);
          hours.push(`${hhmm(permHours)}(PM)/${hhmm(worked)}(P)`);
        } else {
          days.push(cls.code);
          hours.push(att ? hhmm(worked) : null);
        }
      }

      return {
        _id: emp._id, firstName: emp.firstName, lastName: emp.lastName,
        employeeCode: emp.employeeCode, department: emp.department, exitDate: emp.exitDate,
        days, hours,
      };
    });

    res.json({ success: true, data, dayLabels: ctx.days.map(d => d.toLocaleDateString('en-CA')), startDate: start, endDate: end });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// Per-employee day-by-day presence ledger + a Day/Hour summary — Zoho's
// Presence Hours Break-up is a single-employee drilldown, not an
// all-employees aggregate. Payable hours = the shift length on any day the
// company pays for (worked, paid leave, holiday, weekend); 0 on absence and
// unpaid leave.
router.get('/attendance/hours-breakup', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const { employeeId } = req.query;
    if (!employeeId) return res.status(400).json({ success: false, message: 'employeeId is required' });
    const now = new Date();
    const start = req.query.startDate || new Date(now.getFullYear(), now.getMonth(), 1).toLocaleDateString('en-CA');
    const end = req.query.endDate || new Date().toLocaleDateString('en-CA');

    const empRes = await pool.query(
      `SELECT e.id AS "_id", e.first_name AS "firstName", e.last_name AS "lastName", e.department,
              e.employee_id AS "employeeCode", e.exit_date AS "exitDate", e.joining_date AS "joiningDate",
              ${EMP_IDENTITY_SQL},
              s.name AS "shiftName", s.start_time AS "shiftStart", s.end_time AS "shiftEnd"
         FROM employees e LEFT JOIN shifts s ON e.shift_id = s.id WHERE e.id = $1`,
      [employeeId]
    );
    const emp = empRes.rows[0];
    if (!emp) return res.status(404).json({ success: false, message: 'Employee not found' });

    const [attRes, leaveRes, cal] = await Promise.all([
      pool.query(
        `SELECT date::text AS date, check_in AS "checkIn", check_out AS "checkOut",
                working_hours AS "workingHours", status
           FROM attendance WHERE employee_id = $1 AND date >= $2::date AND date <= $3::date`,
        [employeeId, start, end]
      ),
      pool.query(
        `SELECT leave_type AS "leaveType", start_date::text AS "startYmd", end_date::text AS "endYmd",
                is_half_day AS "isHalfDay", half_day_type AS "halfDayType", hours
           FROM leaves WHERE employee_id = $1 AND status='approved' AND start_date <= $3::date AND end_date >= $2::date
          ORDER BY start_date, leave_type`,
        [employeeId, start, end]
      ),
      loadHolidaysAndRulesRange(new Date(start), new Date(end)),
    ]);

    // The Status column names the holiday, not the category — the reference
    // reads "India Independence Day", not "Holidays". holMap only carries the
    // type (it drives whether the office closes), so the names come separately.
    const holNameRes = await pool.query(
      `SELECT date::text AS ymd, name FROM holidays WHERE date >= $1::date AND date <= $2::date`,
      [start, end]
    );
    const holNames = new Map(holNameRes.rows.map(r => [r.ymd, r.name]));

    const attByDate = new Map(attRes.rows.map(r => [r.date, r]));
    // Match leaves on the calendar date as a string. Comparing Date objects
    // dropped every single-day leave east of Greenwich, which is why a day of
    // casual leave was reading as an absence here.
    const leaves = leaveRes.rows;
    const leavesOnDay = ymd => leaves.filter(l => ymd >= l.startYmd && ymd <= l.endYmd);
    const shiftHours = shiftHoursOf(emp.shiftStart, emp.shiftEnd);
    const todayYmd = new Date().toLocaleDateString('en-CA');

    const summaryDays = { payableDays: 0, present: 0, onDuty: 0, paidLeave: 0, holiday: 0, weekend: 0, absent: 0, unpaidLeave: 0 };
    const rows = [];
    const endD = new Date(end);
    for (const d = new Date(start); d <= endD; d.setDate(d.getDate() + 1)) {
      const day = new Date(d);
      if (emp.joiningDate && new Date(emp.joiningDate) > day) continue;
      if (emp.exitDate && new Date(emp.exitDate) < day) continue;
      const ymd = day.toLocaleDateString('en-CA');
      const att = attByDate.get(ymd);
      const dayLeaves = leavesOnDay(ymd);
      // Classify the day on its own terms first. A holiday or a weekend is
      // known in advance and is paid whether or not it has happened yet, so
      // "future" is not asked here — it only decides what an ordinary working
      // day means.
      const cls = classifyAttendanceDay({
        date: day, holMap: cal.holMap, rules: cal.rules,
        attStatus: att?.status,
        leave: dayLeaves.find(l => l.leaveType !== 'permission') || dayLeaves[0],
        isFuture: false,
      });

      // A working day still to come is not an absence — nobody has failed to
      // attend yet. The reference shows it as a row with no status and nothing
      // payable, and leaves it out of every count. Same for today.
      const pending = ymd >= todayYmd && cls.kind === 'absent';
      const kind = pending ? null : cls.kind;

      const isPayable = ['present', 'paidLeave', 'holiday', 'weekend'].includes(kind);
      if (kind) summaryDays[kind] = (summaryDays[kind] || 0) + 1;
      if (isPayable) summaryDays.payableDays += 1;

      rows.push({
        date: ymd, firstIn: att?.checkIn || null, lastOut: att?.checkOut || null,
        totalHours: parseFloat(att?.workingHours) || 0,
        payableHours: isPayable ? shiftHours : 0,
        statusKey: kind,
        // Name the actual thing: the leave records if there are any, else the
        // holiday's own name, else the bucket label.
        status: dayLeaves.length ? leaveStatusText(dayLeaves)
          : kind === 'holiday' ? (holNames.get(ymd) || ATT_STATUS_LABEL.holiday)
          : (kind ? ATT_STATUS_LABEL[kind] : null),
        code: cls.code,
        shiftName: emp.shiftName || null,
      });
    }

    const filtered = rows.filter(r => totalHoursMatches(req.query, r.totalHours));
    // Hour summary is the day summary × the shift length — this app has no
    // per-category hour tracking, so the shift is the only honest basis.
    const summaryHours = Object.fromEntries(Object.entries(summaryDays).map(([k, v]) => [k, parseFloat((v * shiftHours).toFixed(2))]));
    // Every other figure is a day count scaled by the shift length, which
    // makes them expectations rather than measurements. Total Hours is the
    // one real number here: what the employee actually clocked. Without it
    // the Hour tab shows only what was owed, never what was worked.
    summaryHours.totalHours = parseFloat(
      filtered.reduce((s, r) => s + (Number(r.totalHours) || 0), 0).toFixed(2)
    );

    res.json({ success: true, employee: emp, data: filtered, summaryDays, summaryHours, shiftHours, startDate: start, endDate: end });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// Grouped payroll summary per employee — Payable / Expected / Worked / Paid
// Off / Unpaid Off, in Day or Hour mode, matching Zoho's Attendance Data for
// Payroll. `simple=true` collapses it to the headline columns only.
// On Duty is always 0 (that leave type isn't modelled yet) and hour figures
// are day figures × the employee's shift length, since this app tracks no
// per-category hour totals.
router.get('/attendance/payroll-export', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const now = new Date();
    const start = req.query.startDate || new Date(now.getFullYear(), now.getMonth(), 1).toLocaleDateString('en-CA');
    const end = req.query.endDate || new Date().toLocaleDateString('en-CA');
    const unit = req.query.unit === 'hour' ? 'hour' : 'day';
    const simple = req.query.simple === 'true';
    const ctx = await loadAttendanceContext(req, start, end);

    const todayYmd = ctx.today.toLocaleDateString('en-CA');

    const data = ctx.employees.map(emp => {
      const shiftHours = shiftHoursOf(emp.shiftStart, emp.shiftEnd);
      const c = { present: 0, onDuty: 0, paidLeave: 0, holiday: 0, weekend: 0, absent: 0, unpaidLeave: 0 };
      let totalWorkedHours = 0;
      // The two "Expected" figures come from the calendar, not from the
      // outcome: every day on rolls could be paid, and every one of those that
      // is neither a weekend nor a holiday is a day work was expected. Adding
      // up the outcome columns instead — as this did — made them shrink
      // whenever a day had not been settled yet.
      let expectedPayableDays = 0;
      let expectedWorkingDays = 0;

      for (const d of ctx.days) {
        if (!ctx.onRolls(emp, d)) continue;
        const ymd = d.toLocaleDateString('en-CA');
        const att = ctx.attByKey.get(`${emp._id}|${ymd}`);
        const cls = classifyAttendanceDay({
          date: d, holMap: ctx.holMap, rules: ctx.rules,
          attStatus: att?.status, leave: ctx.leaveOn(emp._id, d), isFuture: false,
        });

        expectedPayableDays += 1;
        if (cls.kind !== 'weekend' && cls.kind !== 'holiday') expectedWorkingDays += 1;

        // A working day still to come is not an absence, so it counts towards
        // what was expected but towards none of the outcomes.
        const pending = ymd >= todayYmd && cls.kind === 'absent';
        if (!pending) c[cls.kind] = (c[cls.kind] || 0) + 1;
        totalWorkedHours += parseFloat(att?.workingHours) || 0;
      }

      const workedTotal = c.present + c.onDuty;
      const paidOffTotal = c.paidLeave + c.holiday + c.weekend;
      const unpaidTotal = c.unpaidLeave + c.absent;
      const payableTotal = workedTotal + paidOffTotal;

      const days = {
        expectedPayableDays, payableWorked: workedTotal, payablePaidOff: paidOffTotal, payableTotal,
        expectedWorkingDays, workedPresent: c.present, workedOnDuty: c.onDuty, workedTotal,
        paidLeave: c.paidLeave, paidHolidays: c.holiday, paidWeekend: c.weekend, paidOffTotal,
        unpaidLeave: c.unpaidLeave, unpaidAbsent: c.absent, unpaidTotal,
      };
      const scaled = unit === 'hour'
        ? Object.fromEntries(Object.entries(days).map(([k, v]) => [k, parseFloat((v * shiftHours).toFixed(2))]))
        : days;

      return {
        _id: emp._id, firstName: emp.firstName, lastName: emp.lastName,
        employeeCode: emp.employeeCode, department: emp.department, exitDate: emp.exitDate,
        totalWorkedHours: parseFloat(totalWorkedHours.toFixed(2)), shiftHours, ...scaled,
      };
    });

    res.json({ success: true, data, unit, simple, startDate: start, endDate: end });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// Day-by-day grid showing BOTH the rostered shift and the resulting status
// per date, over an arbitrary range — Zoho's Muster Roll pairs the two under
// each date rather than showing status alone.
router.get('/attendance/muster-roll', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const now = new Date();
    const start = req.query.startDate || new Date(now.getFullYear(), now.getMonth(), 1).toLocaleDateString('en-CA');
    const end = req.query.endDate || new Date(now.getFullYear(), now.getMonth() + 1, 0).toLocaleDateString('en-CA');
    const ctx = await loadAttendanceContext(req, start, end);

    const todayYmd = ctx.today.toLocaleDateString('en-CA');

    // Each cell carries the rostered shift, the status code for the Day view,
    // and the time actually punched for the Hour view — null where there is no
    // attendance row at all, because hours do not apply to a day nobody
    // recorded, whereas 00:00 means recorded and came to nothing.
    const data = ctx.employees.map(emp => {
      const shiftHours = shiftHoursOf(emp.shiftStart, emp.shiftEnd);
      return {
        _id: emp._id, firstName: emp.firstName, lastName: emp.lastName,
        employeeCode: emp.employeeCode, department: emp.department, exitDate: emp.exitDate,
        shiftName: emp.shiftName || null,
        days: ctx.days.map(d => {
          if (!ctx.onRolls(emp, d)) return { shift: null, code: '-', hours: null };
          const ymd = d.toLocaleDateString('en-CA');
          const att = ctx.attByKey.get(`${emp._id}|${ymd}`);
          const dayLeaves = ctx.leavesOn(emp._id, d);
          const cls = classifyAttendanceDay({
            date: d, holMap: ctx.holMap, rules: ctx.rules,
            attStatus: att?.status,
            leave: dayLeaves.find(l => l.leaveType !== 'permission') || dayLeaves[0],
            isFuture: ymd > todayYmd,
          });

          const worked = parseFloat(att?.workingHours) || 0;
          const permHours = dayLeaves
            .filter(l => l.leaveType === 'permission')
            .reduce((s, l) => s + (parseFloat(l.hours) || 0), 0);

          // A permission on a day that was also worked is two things at once,
          // and the cell says both — as it does on Present/Absent Status.
          if (permHours > 0 && att?.checkIn) {
            const frac = Math.min(1, permHours / (shiftHours || 8));
            return {
              shift: emp.shiftName || null,
              code: `${frac.toFixed(2)}PM/${(1 - frac).toFixed(2)}P`,
              hours: `${hhmm(permHours)}(PM)/${hhmm(worked)}(P)`,
            };
          }
          return { shift: emp.shiftName || null, code: cls.code, hours: att ? hhmm(worked) : null };
        }),
      };
    });

    res.json({ success: true, data, dayLabels: ctx.days.map(d => d.toLocaleDateString('en-CA')), startDate: start, endDate: end });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// Unbroken runs of absence per employee. Absence is derived here exactly as it
// is everywhere else — a working day with no punch and no leave — rather than
// read from a stored status. This used to select attendance rows with
// status='absent', and since nothing in this system ever writes such a row the
// report was permanently empty.
//
// A run is broken by any day that is not an absence, non-working days
// included: a weekend between two absences ends the first run and starts a
// second rather than joining them, which is what the reference does.
router.get('/attendance/consecutive-absences', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const start = req.query.startDate || new Date(new Date().setDate(1)).toLocaleDateString('en-CA');
    const end = req.query.endDate || new Date().toLocaleDateString('en-CA');
    // "Absent consecutively for more than N days" — the threshold is exclusive,
    // as in the reference, so N=3 lists runs of 4 and up.
    const minDays = Math.max(0, parseInt(req.query.minDays, 10) || 3);
    const ctx = await loadAttendanceContext(req, start, end);
    const todayYmd = ctx.today.toLocaleDateString('en-CA');

    const data = [];
    for (const emp of ctx.employees) {
      let run = null;
      const close = () => {
        if (run && run.count > minDays) {
          data.push({
            _id: emp._id, firstName: emp.firstName, lastName: emp.lastName,
            department: emp.department, employeeCode: emp.employeeCode, exitDate: emp.exitDate,
            startDate: run.startDate, endDate: run.endDate, count: run.count,
          });
        }
        run = null;
      };

      for (const d of ctx.days) {
        const ymd = d.toLocaleDateString('en-CA');
        if (!ctx.onRolls(emp, d)) { close(); continue; }
        const dayLeaves = ctx.leavesOn(emp._id, d);
        const cls = classifyAttendanceDay({
          date: d, holMap: ctx.holMap, rules: ctx.rules,
          attStatus: ctx.attByKey.get(`${emp._id}|${ymd}`)?.status,
          leave: dayLeaves.find(l => l.leaveType !== 'permission') || dayLeaves[0],
          isFuture: false,
        });
        // A working day still to come is not an absence yet, and neither is
        // today — nobody has failed to attend until the day is over.
        const absent = cls.kind === 'absent' && ymd < todayYmd;
        if (!absent) { close(); continue; }
        if (run) { run.endDate = ymd; run.count += 1; }
        else run = { startDate: ymd, endDate: ymd, count: 1 };
      }
      close();
    }

    res.json({ success: true, data, minDays, startDate: start, endDate: end });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// A running hour ledger per employee, as in the reference: what the period
// owed, what it paid for, and the balance that carries in and out.
//
//   Expected Hours = every day the employee was on rolls x their shift length
//   Payable Hours  = the days the company pays for x their shift length
//                    (worked, paid leave, holiday, weekend)
//   Balance Hours  = Previous Balance + Payable - Expected
//
// Expected counts every day rather than only working days, matching Attendance
// Data for Payroll's Expected Payable column — the two reports would otherwise
// disagree about the same period.
//
// This system stores no carried-forward hour bank, so Previous Balance is the
// same Payable - Expected sum run over every day from the employee's joining
// date up to the day before the period. It is therefore derived from our own
// attendance rather than migrated from anywhere, and will not match a balance
// accumulated in another system.
router.get('/attendance/expected-vs-worked', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const start = req.query.startDate || new Date(new Date().setDate(1)).toLocaleDateString('en-CA');
    const end = req.query.endDate || new Date().toLocaleDateString('en-CA');

    // How far back the ledger runs. One context covering history plus the
    // period, rather than two loads over overlapping ranges.
    //
    // It begins when this system began recording, not at the joining date.
    // Before there is any attendance at all there is no evidence either way,
    // and scoring those days as absences would invent a deficit of thousands
    // of hours for anyone who joined before the data starts.
    const boundsRes = await pool.query(
      `SELECT (SELECT MIN(joining_date)::text FROM employees WHERE deleted_at IS NULL) AS "joined",
              (SELECT MIN(date)::text FROM attendance) AS "recorded"`
    );
    const { joined, recorded } = boundsRes.rows[0] || {};
    const earliest = joined && recorded ? (joined > recorded ? joined : recorded) : (recorded || joined);
    const ledgerStart = earliest && earliest < start ? earliest : start;

    const ctx = await loadAttendanceContext(req, ledgerStart, end);
    const todayYmd = ctx.today.toLocaleDateString('en-CA');
    const PAYABLE = new Set(['present', 'onDuty', 'paidLeave', 'holiday', 'weekend']);

    const data = ctx.employees.map(emp => {
      const shiftHours = shiftHoursOf(emp.shiftStart, emp.shiftEnd);
      let prevExpected = 0, prevPayable = 0, expected = 0, payable = 0;

      for (const d of ctx.days) {
        if (!ctx.onRolls(emp, d)) continue;
        const ymd = d.toLocaleDateString('en-CA');
        // A day that has not happened yet owes nothing and pays nothing.
        if (ymd > todayYmd) continue;
        const dayLeaves = ctx.leavesOn(emp._id, d);
        const cls = classifyAttendanceDay({
          date: d, holMap: ctx.holMap, rules: ctx.rules,
          attStatus: ctx.attByKey.get(`${emp._id}|${ymd}`)?.status,
          leave: dayLeaves.find(l => l.leaveType !== 'permission') || dayLeaves[0],
          isFuture: false,
        });
        const isPayable = PAYABLE.has(cls.kind);
        if (ymd < start) {
          prevExpected += shiftHours;
          if (isPayable) prevPayable += shiftHours;
        } else {
          expected += shiftHours;
          if (isPayable) payable += shiftHours;
        }
      }

      const round = n => parseFloat(n.toFixed(2));
      const previousBalance = round(prevPayable - prevExpected);
      return {
        _id: emp._id, firstName: emp.firstName, lastName: emp.lastName, department: emp.department,
        employeeCode: emp.employeeCode, exitDate: emp.exitDate, shiftName: emp.shiftName,
        previousBalance,
        expectedHours: round(expected),
        payableHours: round(payable),
        balanceHours: round(previousBalance + payable - expected),
      };
    });

    res.json({ success: true, data, startDate: start, endDate: end });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

module.exports = router;
