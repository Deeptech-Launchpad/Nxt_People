const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { isFullAccess, isManager, reportsScope } = require('../utils/roles');
const { countWorkingDays, ruleMatchesDate } = require('../utils/workingDays');
const { lopDaysForRange, listWorkingDays, loadHolidaysAndRules } = require('./payroll');
router.use(protect);

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
        ORDER BY e.first_name`,
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

router.get('/employee/dashboard', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toLocaleDateString('en-CA');
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toLocaleDateString('en-CA');
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toLocaleDateString('en-CA');
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0).toLocaleDateString('en-CA');

    const [statsRes, deptRes, genderRes, additionRes, attritionRes] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE e.status='active')::int AS active,
           COUNT(*) FILTER (WHERE e.status != 'active')::int AS inactive,
           COUNT(*) FILTER (WHERE e.status='active' AND e.joining_date >= $1::date AND e.joining_date <= $2::date)::int AS "newThisMonth",
           COUNT(*) FILTER (WHERE e.exit_date >= $1::date AND e.exit_date <= $2::date)::int AS "exitsThisMonth",
           COUNT(*) FILTER (WHERE e.status='active' AND e.joining_date >= $3::date AND e.joining_date <= $4::date)::int AS "newLastMonth",
           COUNT(*) FILTER (WHERE e.exit_date >= $3::date AND e.exit_date <= $4::date)::int AS "exitsLastMonth"
         FROM employees e WHERE 1=1${reportsScope(req.user, 'e', 5).clause}`,
        [monthStart, monthEnd, prevMonthStart, prevMonthEnd, ...reportsScope(req.user, 'e', 5).params]
      ),
      pool.query(
        `SELECT COALESCE(e.department,'Unassigned') AS label, COUNT(*)::int AS count
           FROM employees e WHERE e.status='active'${reportsScope(req.user, 'e', 1).clause}
          GROUP BY e.department ORDER BY count DESC`,
        reportsScope(req.user, 'e', 1).params
      ),
      pool.query(
        `SELECT COALESCE(e.gender,'Unspecified') AS label, COUNT(*)::int AS count
           FROM employees e WHERE e.status='active'${reportsScope(req.user, 'e', 1).clause}
          GROUP BY e.gender ORDER BY count DESC`,
        reportsScope(req.user, 'e', 1).params
      ),
      // Last 6 months addition/attrition — feeds the two mini trend charts,
      // which deep-link to the full Addition/Attrition Trend reports.
      pool.query(
        `SELECT to_char(date_trunc('month', e.joining_date), 'Mon') AS month, COUNT(*)::int AS count
           FROM employees e
          WHERE e.joining_date >= (date_trunc('month', CURRENT_DATE) - '5 months'::interval)${reportsScope(req.user, 'e', 1).clause}
          GROUP BY date_trunc('month', e.joining_date) ORDER BY date_trunc('month', e.joining_date)`,
        reportsScope(req.user, 'e', 1).params
      ),
      pool.query(
        `SELECT to_char(date_trunc('month', e.exit_date), 'Mon') AS month, COUNT(*)::int AS count
           FROM employees e
          WHERE e.exit_date IS NOT NULL AND e.exit_date >= (date_trunc('month', CURRENT_DATE) - '5 months'::interval)${reportsScope(req.user, 'e', 1).clause}
          GROUP BY date_trunc('month', e.exit_date) ORDER BY date_trunc('month', e.exit_date)`,
        reportsScope(req.user, 'e', 1).params
      ),
    ]);
    res.json({
      success: true,
      data: {
        ...statsRes.rows[0],
        byDepartment: deptRes.rows,
        byGender: genderRes.rows,
        last6MonthsAddition: additionRes.rows,
        last6MonthsAttrition: attritionRes.rows,
      },
    });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.get('/employee/headcount', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const [totalRes, deptRes, locRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM employees e WHERE e.status='active'${reportsScope(req.user, 'e', 1).clause}`, reportsScope(req.user, 'e', 1).params),
      pool.query(`SELECT COALESCE(e.department,'Unassigned') AS label, COUNT(*)::int AS count FROM employees e WHERE e.status='active'${reportsScope(req.user, 'e', 1).clause} GROUP BY e.department ORDER BY count DESC`, reportsScope(req.user, 'e', 1).params),
      pool.query(`SELECT COALESCE(e.work_location,'Unassigned') AS label, COUNT(*)::int AS count FROM employees e WHERE e.status='active'${reportsScope(req.user, 'e', 1).clause} GROUP BY e.work_location ORDER BY count DESC`, reportsScope(req.user, 'e', 1).params),
    ]);
    res.json({ success: true, data: { total: totalRes.rows[0].total, byDepartment: deptRes.rows, byLocation: locRes.rows } });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.get('/employee/addition-trend', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const months = Math.min(24, Math.max(1, parseInt(req.query.months, 10) || 12));
    const r = await pool.query(
      `SELECT to_char(date_trunc('month', e.joining_date), 'Mon YYYY') AS month, COUNT(*)::int AS count
         FROM employees e
        WHERE e.joining_date >= (date_trunc('month', CURRENT_DATE) - ($1 || ' months')::interval)${reportsScope(req.user, 'e', 2).clause}
        GROUP BY date_trunc('month', e.joining_date) ORDER BY date_trunc('month', e.joining_date)`,
      [months, ...reportsScope(req.user, 'e', 2).params]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.get('/employee/attrition-trend', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const months = Math.min(24, Math.max(1, parseInt(req.query.months, 10) || 12));
    const r = await pool.query(
      `SELECT to_char(date_trunc('month', e.exit_date), 'Mon YYYY') AS month, COUNT(*)::int AS count
         FROM employees e
        WHERE e.exit_date IS NOT NULL AND e.exit_date >= (date_trunc('month', CURRENT_DATE) - ($1 || ' months')::interval)${reportsScope(req.user, 'e', 2).clause}
        GROUP BY date_trunc('month', e.exit_date) ORDER BY date_trunc('month', e.exit_date)`,
      [months, ...reportsScope(req.user, 'e', 2).params]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.get('/employee/distribution', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    // Whitelisted before interpolation — never accept the column name straight from req.query.
    const col = req.query.by === 'designation' ? 'e.designation' : 'e.department';
    const r = await pool.query(
      `SELECT COALESCE(${col}, 'Unassigned') AS label, COUNT(*)::int AS count
         FROM employees e WHERE e.status='active'${reportsScope(req.user, 'e', 1).clause}
        GROUP BY ${col} ORDER BY count DESC`,
      reportsScope(req.user, 'e', 1).params
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.get('/employee/diversity', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT COALESCE(e.gender,'Unspecified') AS label, COUNT(*)::int AS count
         FROM employees e WHERE e.status='active'${reportsScope(req.user, 'e', 1).clause}
        GROUP BY e.gender ORDER BY count DESC`,
      reportsScope(req.user, 'e', 1).params
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.get('/employee/experience-exit', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT
         CASE
           WHEN AGE(e.exit_date, e.joining_date) < INTERVAL '1 year' THEN '< 1 year'
           WHEN AGE(e.exit_date, e.joining_date) < INTERVAL '3 years' THEN '1-3 years'
           WHEN AGE(e.exit_date, e.joining_date) < INTERVAL '5 years' THEN '3-5 years'
           ELSE '5+ years'
         END AS label,
         COUNT(*)::int AS count
        FROM employees e
       WHERE e.exit_date IS NOT NULL AND e.joining_date IS NOT NULL${reportsScope(req.user, 'e', 1).clause}
       GROUP BY label`,
      reportsScope(req.user, 'e', 1).params
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// ══════════════════════════ Leave Tracker reports ══════════════════════════

router.get('/leave/daily-status', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const date = req.query.date || new Date().toLocaleDateString('en-CA');
    const r = await pool.query(
      `SELECT l.id AS "_id", e.first_name AS "firstName", e.last_name AS "lastName", e.department, e.employee_id AS "employeeCode",
              l.leave_type AS "leaveType", l.is_half_day AS "isHalfDay"
         FROM leaves l JOIN employees e ON l.employee_id = e.id
        WHERE l.status = 'approved' AND l.start_date <= $1::date AND l.end_date >= $1::date${reportsScope(req.user, 'e', 2).clause}
        ORDER BY e.first_name`,
      [date, ...reportsScope(req.user, 'e', 2).params]
    );
    res.json({ success: true, data: r.rows, date });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.get('/leave/resource-availability', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const date = req.query.date || new Date().toLocaleDateString('en-CA');
    const [totalRes, onLeaveRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM employees e WHERE e.status='active'${reportsScope(req.user, 'e', 1).clause}`, reportsScope(req.user, 'e', 1).params),
      pool.query(
        `SELECT COUNT(DISTINCT l.employee_id)::int AS "onLeave"
           FROM leaves l JOIN employees e ON l.employee_id = e.id
          WHERE l.status='approved' AND l.start_date <= $1::date AND l.end_date >= $1::date${reportsScope(req.user, 'e', 2).clause}`,
        [date, ...reportsScope(req.user, 'e', 2).params]
      ),
    ]);
    const total = totalRes.rows[0].total;
    const onLeave = onLeaveRes.rows[0].onLeave;
    res.json({ success: true, data: { date, total, onLeave, available: Math.max(0, total - onLeave) } });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// Deliberately limited to casual/comp-off/unpaid — those are the only leave
// types with a real, wired-up balance concept anywhere in this app's leave
// flow (see /leaves/balance). employees.sick_leave/earned_leave exist as
// columns but no application flow ever writes to or reads them for a real
// employee-facing balance, so showing them here would just be fake numbers.
router.get('/leave/balance-all', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const r = await pool.query(
      `SELECT e.id AS "_id", e.first_name AS "firstName", e.last_name AS "lastName", e.department,
              COALESCE(e.casual_leave, 0) AS "casualAllocated",
              COALESCE(booked.casual_used, 0) AS "casualBooked",
              COALESCE(booked.unpaid_used, 0) AS "unpaidBooked",
              COALESCE(co.avail, 0) AS "compOffAvailable"
         FROM employees e
         LEFT JOIN (
           SELECT employee_id,
                  SUM(total_days) FILTER (WHERE leave_type = 'casual') AS casual_used,
                  SUM(total_days) FILTER (WHERE leave_type = 'unpaid') AS unpaid_used
             FROM leaves
            WHERE status = 'approved' AND EXTRACT(YEAR FROM start_date) = $1
            GROUP BY employee_id
         ) booked ON booked.employee_id = e.id
         LEFT JOIN (
           SELECT employee_id, SUM(days_earned - days_used) AS avail
             FROM comp_offs
            WHERE status = 'approved' AND (expires_at IS NULL OR expires_at >= CURRENT_DATE)
            GROUP BY employee_id
         ) co ON co.employee_id = e.id
        WHERE e.status = 'active'${reportsScope(req.user, 'e', 2).clause}
        ORDER BY e.first_name`,
      [year, ...reportsScope(req.user, 'e', 2).params]
    );
    const data = r.rows.map(row => {
      const casualAllocated = parseFloat(row.casualAllocated) || 0;
      const casualBooked = parseFloat(row.casualBooked) || 0;
      return {
        ...row,
        casualAllocated, casualBooked,
        unpaidBooked: parseFloat(row.unpaidBooked) || 0,
        compOffAvailable: parseFloat(row.compOffAvailable) || 0,
        casualBalance: Math.max(0, casualAllocated - casualBooked),
      };
    });
    res.json({ success: true, data, year });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.get('/leave/booked-balance', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const start = req.query.startDate || new Date(new Date().setDate(1)).toLocaleDateString('en-CA');
    const end = req.query.endDate || new Date().toLocaleDateString('en-CA');
    const r = await pool.query(
      `SELECT e.id AS "_id", e.first_name AS "firstName", e.last_name AS "lastName", e.department,
              COALESCE(e.casual_leave, 0) AS "casualAllocated",
              COALESCE(SUM(l.total_days) FILTER (WHERE l.status='approved'), 0) AS "daysBooked"
         FROM employees e
         LEFT JOIN leaves l ON l.employee_id = e.id AND l.start_date <= $2::date AND l.end_date >= $1::date
        WHERE e.status = 'active'${reportsScope(req.user, 'e', 3).clause}
        GROUP BY e.id, e.first_name, e.last_name, e.department, e.casual_leave
        ORDER BY e.first_name`,
      [start, end, ...reportsScope(req.user, 'e', 3).params]
    );
    const data = r.rows.map(row => ({ ...row, daysBooked: parseFloat(row.daysBooked) || 0, casualAllocated: parseFloat(row.casualAllocated) || 0 }));
    res.json({ success: true, data, startDate: start, endDate: end });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.get('/leave/type-summary', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const start = req.query.startDate || new Date(new Date().setDate(1)).toLocaleDateString('en-CA');
    const end = req.query.endDate || new Date().toLocaleDateString('en-CA');
    const r = await pool.query(
      `SELECT l.leave_type AS "leaveType", COUNT(*)::int AS requests, COALESCE(SUM(l.total_days), 0) AS "totalDays"
         FROM leaves l JOIN employees e ON l.employee_id = e.id
        WHERE l.status = 'approved' AND l.start_date <= $2::date AND l.end_date >= $1::date${reportsScope(req.user, 'e', 3).clause}
        GROUP BY l.leave_type ORDER BY "totalDays" DESC`,
      [start, end, ...reportsScope(req.user, 'e', 3).params]
    );
    const data = r.rows.map(row => ({ leaveType: row.leaveType, count: row.requests, totalDays: parseFloat(row.totalDays) || 0 }));
    res.json({ success: true, data, startDate: start, endDate: end });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.get('/leave/encashment', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT l.id AS "_id", l.leave_type AS "leaveType", l.days, l.status, l.reason, l.created_at AS "createdAt",
              e.first_name AS "firstName", e.last_name AS "lastName", e.department, e.employee_id AS "employeeCode"
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
router.get('/leave/lop', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(new Date().setDate(1));
    const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();
    const { holMap, rules } = await loadHolidaysAndRulesRange(startDate, endDate);

    const empRes = await pool.query(
      `SELECT id AS "_id", first_name AS "firstName", last_name AS "lastName", department, employee_id AS "employeeCode"
         FROM employees e WHERE e.status='active'${reportsScope(req.user, 'e', 1).clause} ORDER BY first_name`,
      reportsScope(req.user, 'e', 1).params
    );

    const data = [];
    for (const emp of empRes.rows) {
      const lopDays = await lopDaysForRange(emp._id, startDate, endDate, holMap, rules, pool);
      if (lopDays > 0) data.push({ ...emp, lopDays });
    }
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.get('/leave/payroll-export', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const start = req.query.startDate || new Date(new Date().setDate(1)).toLocaleDateString('en-CA');
    const end = req.query.endDate || new Date().toLocaleDateString('en-CA');
    const r = await pool.query(
      `SELECT e.first_name AS "firstName", e.last_name AS "lastName", e.employee_id AS "employeeCode", e.department,
              l.leave_type AS "leaveType", l.total_days AS "totalDays", l.start_date AS "startDate", l.end_date AS "endDate"
         FROM leaves l JOIN employees e ON l.employee_id = e.id
        WHERE l.status = 'approved' AND l.start_date <= $2::date AND l.end_date >= $1::date${reportsScope(req.user, 'e', 3).clause}
        ORDER BY e.first_name, l.start_date`,
      [start, end, ...reportsScope(req.user, 'e', 3).params]
    );
    res.json({ success: true, data: r.rows, startDate: start, endDate: end });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// ══════════════════════════ Attendance reports (new) ═══════════════════════
// Daily attendance status, Employee present/absent status, and Early/late
// check-in and check-out are already covered by the existing Attendance
// Reports page's Daily/Summary/Detailed tabs (deep-linked via ?tab=) — no
// need to duplicate them here.

router.get('/attendance/hours-breakup', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const start = req.query.startDate || new Date(new Date().setDate(1)).toLocaleDateString('en-CA');
    const end = req.query.endDate || new Date().toLocaleDateString('en-CA');
    const r = await pool.query(
      `SELECT e.id AS "_id", e.first_name AS "firstName", e.last_name AS "lastName", e.department,
              COUNT(*) FILTER (WHERE a.status IN ('present','late'))::int AS "presentDays",
              ROUND(COALESCE(SUM(a.working_hours), 0)::numeric, 2) AS "totalHours"
         FROM employees e
         LEFT JOIN attendance a ON a.employee_id = e.id AND a.date >= $1::date AND a.date <= $2::date
        WHERE e.status='active'${reportsScope(req.user, 'e', 3).clause}
        GROUP BY e.id, e.first_name, e.last_name, e.department
        ORDER BY e.first_name`,
      [start, end, ...reportsScope(req.user, 'e', 3).params]
    );
    const data = r.rows.map(row => {
      const totalHours = parseFloat(row.totalHours) || 0;
      return { ...row, totalHours, avgHoursPerDay: row.presentDays > 0 ? parseFloat((totalHours / row.presentDays).toFixed(2)) : 0 };
    });
    res.json({ success: true, data, startDate: start, endDate: end });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.get('/attendance/payroll-export', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const start = req.query.startDate || new Date(new Date().setDate(1)).toLocaleDateString('en-CA');
    const end = req.query.endDate || new Date().toLocaleDateString('en-CA');
    const r = await pool.query(
      `SELECT e.first_name AS "firstName", e.last_name AS "lastName", e.employee_id AS "employeeCode", e.department,
              COUNT(*) FILTER (WHERE a.status IN ('present','late'))::int AS "presentDays",
              COUNT(*) FILTER (WHERE a.status = 'absent')::int AS "absentDays",
              ROUND(COALESCE(SUM(a.working_hours), 0)::numeric, 2) AS "totalHours"
         FROM employees e
         LEFT JOIN attendance a ON a.employee_id = e.id AND a.date >= $1::date AND a.date <= $2::date
        WHERE e.status='active'${reportsScope(req.user, 'e', 3).clause}
        GROUP BY e.id, e.first_name, e.last_name, e.employee_id, e.department
        ORDER BY e.first_name`,
      [start, end, ...reportsScope(req.user, 'e', 3).params]
    );
    const data = r.rows.map(row => ({ ...row, totalHours: parseFloat(row.totalHours) || 0 }));
    res.json({ success: true, data, startDate: start, endDate: end });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// Day-by-day grid for one calendar month: P (present), HD (half-day),
// A (absent), L (leave), WO (weekly off), H (holiday), - (future/no data).
router.get('/attendance/muster-roll', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const month = Math.min(12, Math.max(1, parseInt(req.query.month, 10) || (new Date().getMonth() + 1)));
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const { holMap, rules } = await loadHolidaysAndRules(month, year);

    const daysInMonth = new Date(year, month, 0).getDate();
    const start = new Date(year, month - 1, 1).toLocaleDateString('en-CA');
    const end = new Date(year, month - 1, daysInMonth).toLocaleDateString('en-CA');

    const empRes = await pool.query(
      `SELECT id AS "_id", first_name AS "firstName", last_name AS "lastName", department, employee_id AS "employeeCode"
         FROM employees e WHERE e.status='active'${reportsScope(req.user, 'e', 1).clause} ORDER BY first_name`,
      reportsScope(req.user, 'e', 1).params
    );
    const [attRes, leaveRes] = await Promise.all([
      pool.query(`SELECT employee_id, date::text AS date, status FROM attendance WHERE date >= $1::date AND date <= $2::date`, [start, end]),
      pool.query(`SELECT employee_id, start_date, end_date FROM leaves WHERE status='approved' AND start_date <= $2::date AND end_date >= $1::date`, [start, end]),
    ]);

    const attMap = new Map(attRes.rows.map(r => [`${r.employee_id}_${r.date}`, r.status]));
    const leavesByEmp = new Map();
    leaveRes.rows.forEach(l => {
      if (!leavesByEmp.has(l.employee_id)) leavesByEmp.set(l.employee_id, []);
      leavesByEmp.get(l.employee_id).push({ start: new Date(l.start_date), end: new Date(l.end_date) });
    });

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const data = empRes.rows.map(emp => {
      const days = [];
      for (let d = 1; d <= daysInMonth; d++) {
        const dateObj = new Date(year, month - 1, d);
        const ymd = dateObj.toLocaleDateString('en-CA');
        const holType = holMap.get(`${year}-${month}-${d}`);
        let code;
        if (dateObj > today) code = '-';
        else if (holType && holType !== 'working_day') code = 'H';
        else if (!holType && rules.some(rule => ruleMatchesDate(rule, dateObj))) code = 'WO';
        else {
          const attStatus = attMap.get(`${emp._id}_${ymd}`);
          const onLeave = (leavesByEmp.get(emp._id) || []).some(l => dateObj >= l.start && dateObj <= l.end);
          if (attStatus === 'present' || attStatus === 'late') code = 'P';
          else if (attStatus === 'half-day') code = 'HD';
          else if (onLeave) code = 'L';
          else code = 'A';
        }
        days.push(code);
      }
      return { ...emp, days };
    });

    res.json({ success: true, data, month, year, daysInMonth });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.get('/attendance/consecutive-absences', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const start = req.query.startDate || new Date(new Date().setDate(1)).toLocaleDateString('en-CA');
    const end = req.query.endDate || new Date().toLocaleDateString('en-CA');
    const minDays = Math.max(2, parseInt(req.query.minDays, 10) || 2);

    const r = await pool.query(
      `SELECT a.employee_id AS "_id", a.date::text AS date, e.first_name AS "firstName", e.last_name AS "lastName", e.department
         FROM attendance a JOIN employees e ON a.employee_id = e.id
        WHERE a.status = 'absent' AND a.date >= $1::date AND a.date <= $2::date${reportsScope(req.user, 'e', 3).clause}
        ORDER BY a.employee_id, a.date`,
      [start, end, ...reportsScope(req.user, 'e', 3).params]
    );

    // Run-length detection of consecutive calendar-day absences per employee.
    const streaks = [];
    let cur = null;
    for (const row of r.rows) {
      const d = new Date(row.date);
      if (cur && cur.employeeId === row._id && (d - cur.lastDate) === 86400000) {
        cur.lastDate = d; cur.count++; cur.endDate = row.date;
      } else {
        if (cur && cur.count >= minDays) streaks.push(cur);
        cur = { employeeId: row._id, firstName: row.firstName, lastName: row.lastName, department: row.department, startDate: row.date, endDate: row.date, lastDate: d, count: 1 };
      }
    }
    if (cur && cur.count >= minDays) streaks.push(cur);

    const data = streaks.map(({ lastDate, employeeId, ...rest }) => ({ _id: employeeId, ...rest }));
    res.json({ success: true, data, startDate: start, endDate: end });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.get('/attendance/expected-vs-worked', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const start = req.query.startDate || new Date(new Date().setDate(1)).toLocaleDateString('en-CA');
    const end = req.query.endDate || new Date().toLocaleDateString('en-CA');
    const { holMap, rules } = await loadHolidaysAndRulesRange(new Date(start), new Date(end));
    const workingDaysCount = listWorkingDays(new Date(start), new Date(end), holMap, rules).length;

    const r = await pool.query(
      `SELECT e.id AS "_id", e.first_name AS "firstName", e.last_name AS "lastName", e.department,
              s.start_time AS "shiftStart", s.end_time AS "shiftEnd",
              ROUND(COALESCE(SUM(a.working_hours), 0)::numeric, 2) AS "workedHours"
         FROM employees e
         LEFT JOIN shifts s ON e.shift_id = s.id
         LEFT JOIN attendance a ON a.employee_id = e.id AND a.date >= $1::date AND a.date <= $2::date
        WHERE e.status='active'${reportsScope(req.user, 'e', 3).clause}
        GROUP BY e.id, e.first_name, e.last_name, e.department, s.start_time, s.end_time
        ORDER BY e.first_name`,
      [start, end, ...reportsScope(req.user, 'e', 3).params]
    );

    const data = r.rows.map(row => {
      let shiftHours = 9; // sane default when no shift is assigned
      if (row.shiftStart && row.shiftEnd) {
        const [sh, sm] = row.shiftStart.split(':').map(Number);
        const [eh, em] = row.shiftEnd.split(':').map(Number);
        shiftHours = ((eh * 60 + em) - (sh * 60 + sm)) / 60;
        if (shiftHours <= 0) shiftHours += 24;
      }
      const expectedHours = parseFloat((shiftHours * workingDaysCount).toFixed(2));
      const workedHours = parseFloat(row.workedHours) || 0;
      return { _id: row._id, firstName: row.firstName, lastName: row.lastName, department: row.department, expectedHours, workedHours, variance: parseFloat((workedHours - expectedHours).toFixed(2)) };
    });
    res.json({ success: true, data, startDate: start, endDate: end, workingDays: workingDaysCount });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

module.exports = router;
