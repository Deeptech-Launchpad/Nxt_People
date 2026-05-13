const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
router.use(protect);

router.get('/pending', authorize('admin', 'manager'), async (req, res) => {
  try {
    const userId = req.user._id;
    const [leavesRes, timesheetsRes, regRes, wfhRes, compOffRes, approvedLeavesRes] = await Promise.all([
      pool.query(`
        SELECT l.id as "_id", l.leave_type as "leaveType", l.start_date as "startDate", l.end_date as "endDate",
               l.total_days as "totalDays", l.reason, l.status, l.is_half_day as "isHalfDay", l.created_at as "createdAt",
               json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name,
                 'department', e.department, 'employeeId', e.employee_id) as employee,
               (e.reporting_manager_id = $1) as "isManager",
               (e.approving_authority_id = $1) as "isApprovingAuthority"
        FROM leaves l JOIN employees e ON l.employee_id = e.id
        WHERE l.status = 'pending' ORDER BY l.created_at DESC
      `, [userId]),

      pool.query(`
        SELECT t.id as "_id", t.week_start_date as "weekStartDate", t.week_end_date as "weekEndDate",
               t.total_hours as "totalHours", t.status, t.notes, t.created_at as "createdAt",
               json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name,
                 'department', e.department, 'employeeId', e.employee_id) as employee
        FROM timesheets t JOIN employees e ON t.employee_id = e.id
        WHERE t.status = 'submitted' ORDER BY t.created_at DESC
      `),

      pool.query(`
        SELECT r.id as "_id", r.date, r.check_in as "checkIn", r.check_out as "checkOut",
               r.reason, r.status, r.created_at as "createdAt",
               json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name,
                 'department', e.department, 'employeeId', e.employee_id) as employee
        FROM attendance_regularizations r JOIN employees e ON r.employee_id = e.id
        WHERE r.status = 'pending' ORDER BY r.date DESC
      `),

      pool.query(`
        SELECT w.id as "_id", w.date, w.reason, w.status, w.created_at as "createdAt",
               json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name,
                 'department', e.department, 'employeeId', e.employee_id) as employee
        FROM wfh_requests w JOIN employees e ON w.employee_id = e.id
        WHERE w.status = 'pending' ORDER BY w.date DESC
      `),

      pool.query(`
        SELECT c.id as "_id", c.worked_date as "workedDate", c.reason,
               c.days_earned as "daysEarned", c.status, c.created_at as "createdAt",
               json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name,
                 'department', e.department, 'employeeId', e.employee_id) as employee
        FROM comp_offs c JOIN employees e ON c.employee_id = e.id
        WHERE c.status = 'pending' ORDER BY c.worked_date DESC
      `),
      
      pool.query(`
        SELECT l.id as "_id", l.leave_type as "leaveType", l.start_date as "startDate", l.end_date as "endDate",
               l.total_days as "totalDays", l.reason, l.status, l.is_half_day as "isHalfDay", l.created_at as "createdAt",
               json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name,
                 'department', e.department, 'employeeId', e.employee_id) as employee,
               (e.reporting_manager_id = $1) as "isManager",
               (e.approving_authority_id = $1) as "isApprovingAuthority"
        FROM leaves l JOIN employees e ON l.employee_id = e.id
        WHERE l.status IN ('approved', 'rejected') 
        ORDER BY l.created_at DESC LIMIT 100
      `, [userId]),
    ]);

    const leaves = leavesRes.rows;
    const timesheets = timesheetsRes.rows;
    const regularizations = regRes.rows;
    const wfhRequests = wfhRes.rows;
    const compOffs = compOffRes.rows;
    const approvedLeaves = approvedLeavesRes.rows;
    const total = leaves.length + timesheets.length + regularizations.length + wfhRequests.length + compOffs.length;

    res.json({
      success: true,
      data: { leaves, timesheets, regularizations, wfhRequests, compOffs, approvedLeaves, total }
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
