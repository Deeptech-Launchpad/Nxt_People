const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { isFullAccess, isManager, reportsScope } = require('../utils/roles');
router.use(protect);

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
        ROUND(COALESCE(SUM(a.working_hours), 0)::numeric, 2) AS "totalHours"
       FROM employees e
       LEFT JOIN attendance a ON a.employee_id = e.id AND a.date >= $1::date AND a.date <= $2::date
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
      totalHours: parseFloat(r.totalHours)
    }));

    res.json({ success: true, data: results });
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

    const counts = { present: 0, absent: 0, leave: 0, checkedIn: 0, checkedOut: 0 };
    const data = r.rows.map(row => {
      let status;
      if (row.leaveId) { status = 'leave'; counts.leave++; }
      else if (row.attStatus === 'absent') { status = 'absent'; counts.absent++; }
      else if (row.checkIn && !row.checkOut) { status = 'checked-in'; counts.checkedIn++; counts.present++; }
      else if (row.checkIn && row.checkOut) { status = 'checked-out'; counts.checkedOut++; counts.present++; }
      // No attendance row and no leave on file — same "absent" convention the
      // dashboard headcount widget already uses (dashboard.js: a.id IS NULL).
      else { status = 'absent'; counts.absent++; }
      return { _id: row._id, firstName: row.firstName, lastName: row.lastName, department: row.department, status, checkIn: row.checkIn, checkOut: row.checkOut };
    });

    res.json({ success: true, date, counts, data });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

module.exports = router;
