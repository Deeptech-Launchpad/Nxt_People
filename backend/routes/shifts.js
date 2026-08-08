const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
router.use(protect);

router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT id as "_id", name, start_time as "startTime", end_time as "endTime", grace_minutes as "graceMinutes", working_days as "workingDays", color, is_default as "isDefault" FROM shifts ORDER BY name ASC');
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  try {
    const { name, startTime, endTime, graceMinutes, workingDays, color, isDefault } = req.body;
    const result = await pool.query(`INSERT INTO shifts (name, start_time, end_time, grace_minutes, working_days, color, is_default) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id as "_id", name, start_time as "startTime", end_time as "endTime", grace_minutes as "graceMinutes", working_days as "workingDays", color, is_default as "isDefault"`, [name, startTime, endTime, graceMinutes, JSON.stringify(workingDays || []), color, isDefault]);
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.put('/:id', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  try {
    const { name, startTime, endTime, graceMinutes, workingDays, color, isDefault } = req.body;
    const result = await pool.query(`UPDATE shifts SET name = $1, start_time = $2, end_time = $3, grace_minutes = $4, working_days = $5, color = $6, is_default = $7, updated_at = NOW() WHERE id = $8 RETURNING id as "_id", name, start_time as "startTime", end_time as "endTime", grace_minutes as "graceMinutes", working_days as "workingDays", color, is_default as "isDefault"`, [name, startTime, endTime, graceMinutes, JSON.stringify(workingDays || []), color, isDefault, req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Shift not found' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/:id', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM shifts WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Shift deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/:id/assign', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const { employeeIds } = req.body;
    if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
      return res.status(400).json({ success: false, message: 'No employees specified' });
    }
    if (req.user.role === 'manager') {
      const uniqueIds = [...new Set(employeeIds)];
      const scope = await pool.query(
        'SELECT id FROM employees WHERE id = ANY($1) AND reporting_manager_id = $2',
        [uniqueIds, req.user._id]
      );
      if (scope.rows.length !== uniqueIds.length) {
        return res.status(403).json({ success: false, message: 'You can only assign shifts to employees in your team' });
      }
    }
    await pool.query('UPDATE employees SET shift_id = $1 WHERE id = ANY($2)', [req.params.id, employeeIds]);
    res.json({ success: true, message: 'Shift assigned' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
