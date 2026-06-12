const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { isFullAccess, isManager, reportsScope } = require('../utils/roles');
router.use(protect);

// Bug #10 fix: single JOIN+GROUP BY query instead of N+1 loop
// Bug #20 fix: summary now accepts startDate/endDate OR month/year params
router.get('/attendance', async (req, res) => {
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

    const attRes = await pool.query(
      `SELECT a.id as "_id", a.date, a.check_in as "checkIn", a.check_out as "checkOut", a.working_hours as "workingHours", a.status,
       json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name, 'department', e.department, 'employeeId', e.employee_id) as employee
       FROM attendance a
       JOIN employees e ON a.employee_id = e.id
       WHERE a.employee_id = ANY($1) AND a.date >= $2::date AND a.date <= $3::date
       ORDER BY a.date DESC`,
      [ids, start, end]
    );

    res.json({ success: true, data: attRes.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Bug #10 + #20 fix: single aggregation query, also accepts startDate/endDate
router.get('/summary', authorize('super_admin', 'hr', 'manager'), async (req, res) => {
  try {
    const { month, year, startDate, endDate } = req.query;
    let start, end;

    if (startDate && endDate) {
      start = startDate;
      end = endDate;
    } else {
      const now = new Date();
      const m = month ? parseInt(month) : now.getMonth();
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
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
