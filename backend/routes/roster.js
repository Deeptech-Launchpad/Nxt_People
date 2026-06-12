const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
router.use(protect);

// GET roster for a date range (week view)
router.get('/', async (req, res) => {
  try {
    const { startDate, endDate, department } = req.query;
    if (!startDate || !endDate) return res.status(400).json({ success: false, message: 'startDate and endDate required' });
    const deptFilter = department ? 'AND e.department = $3' : '';
    const params = department ? [startDate, endDate, department] : [startDate, endDate];
    const r = await pool.query(
      `SELECT sr.id as "_id", sr.date, sr.employee_id as "employeeId",
       json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name, 'department', e.department) as employee,
       json_build_object('id', s.id, 'name', s.name, 'startTime', s.start_time, 'endTime', s.end_time) as shift
       FROM shift_roster sr
       JOIN employees e ON sr.employee_id = e.id
       JOIN shifts s ON sr.shift_id = s.id
       WHERE sr.date BETWEEN $1 AND $2 ${deptFilter}
       ORDER BY sr.date, e.first_name`,
      params
    );
    // Also get employees without roster assignment for the period
    const emps = await pool.query(
      `SELECT e.id as "_id", e.first_name as "firstName", e.last_name as "lastName", e.department,
       s.id as "shiftId", s.name as "shiftName", s.start_time as "startTime", s.end_time as "endTime"
       FROM employees e LEFT JOIN shifts s ON e.shift_id = s.id WHERE e.status='active' ${department ? 'AND e.department=$1' : ''} ORDER BY e.first_name`,
      department ? [department] : []
    );
    res.json({ success: true, data: r.rows, employees: emps.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST assign shift (admin/manager)
router.post('/assign', authorize('super_admin', 'hr', 'manager'), async (req, res) => {
  try {
    const { employeeId, shiftId, date } = req.body;
    if (!employeeId || !shiftId || !date) return res.status(400).json({ success: false, message: 'employeeId, shiftId, date required' });
    const r = await pool.query(
      `INSERT INTO shift_roster (employee_id, shift_id, date, created_by) VALUES ($1,$2,$3,$4)
       ON CONFLICT (employee_id, date) DO UPDATE SET shift_id=$2, created_by=$4
       RETURNING id as "_id"`,
      [employeeId, shiftId, date, req.user._id]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST bulk assign (copy previous week)
router.post('/copy-week', authorize('super_admin', 'hr', 'manager'), async (req, res) => {
  try {
    const { fromStart, toStart } = req.body;
    const r = await pool.query(
      `INSERT INTO shift_roster (employee_id, shift_id, date, created_by)
       SELECT employee_id, shift_id, date + ($2::date - $1::date), $3
       FROM shift_roster WHERE date BETWEEN $1 AND ($1::date + 6)
       ON CONFLICT (employee_id, date) DO UPDATE SET shift_id = EXCLUDED.shift_id`,
      [fromStart, toStart, req.user._id]
    );
    res.json({ success: true, message: `Copied ${r.rowCount} assignments` });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// DELETE assignment
router.delete('/:id', authorize('super_admin', 'hr', 'manager'), async (req, res) => {
  try {
    await pool.query('DELETE FROM shift_roster WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
