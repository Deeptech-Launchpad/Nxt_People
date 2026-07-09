const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { reportsScope, canActOnEmployee } = require('../utils/roles');

router.use(protect);

router.get('/my', async (req, res) => {
  try {
    const result = await pool.query('SELECT id as "_id", week_start_date as "weekStartDate", week_end_date as "weekEndDate", total_hours as "totalHours", status, rejection_reason as "rejectionReason", notes FROM timesheets WHERE employee_id = $1 ORDER BY week_start_date DESC', [req.user._id]);
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.get('/', authorize('admin', 'director', 'manager'), async (req, res) => {
  try {
    const { status } = req.query;
    let params = [];
    let conds = [];
    if (status) { params.push(status); conds.push(`t.status = $${params.length}`); }
    // Full-access sees all timesheets; managers only their direct reports'.
    const scope = reportsScope(req.user, 'e', params.length + 1);
    if (scope.clause) { conds.push(scope.clause.replace(/^ AND /, '')); params.push(...scope.params); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const result = await pool.query(`
      SELECT t.id as "_id", t.week_start_date as "weekStartDate", t.week_end_date as "weekEndDate", t.total_hours as "totalHours", t.status, t.rejection_reason as "rejectionReason", t.notes,
      json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name, 'department', e.department) as employee
      FROM timesheets t
      JOIN employees e ON t.employee_id = e.id
      ${where}
      ORDER BY t.created_at DESC
    `, params);
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.post('/', async (req, res) => {
  try {
    const { weekStartDate, weekEndDate, totalHours, status, notes } = req.body;
    const hours = Number(totalHours) || 0;
    if (hours < 0 || hours > 168) {
      return res.status(400).json({ success: false, message: 'Total hours must be between 0 and 168.' });
    }
    const result = await pool.query(`
      INSERT INTO timesheets (employee_id, week_start_date, week_end_date, total_hours, status, notes)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id as "_id", week_start_date as "weekStartDate", week_end_date as "weekEndDate", total_hours as "totalHours", status, notes
    `, [req.user._id, weekStartDate, weekEndDate, hours, status || 'draft', notes]);
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.put('/:id', async (req, res) => {
  try {
    const { totalHours, notes } = req.body;
    const hours = Number(totalHours) || 0;
    if (hours < 0 || hours > 168) {
      return res.status(400).json({ success: false, message: 'Total hours must be between 0 and 168.' });
    }
    const result = await pool.query(`
      UPDATE timesheets SET total_hours = $1, notes = $2, updated_at = NOW() WHERE id = $3 AND employee_id = $4
      RETURNING id as "_id", week_start_date as "weekStartDate", week_end_date as "weekEndDate", total_hours as "totalHours", status, notes
    `, [hours, notes, req.params.id, req.user._id]);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.put('/:id/submit', async (req, res) => {
  try {
    const result = await pool.query(`
      UPDATE timesheets SET status = 'submitted', updated_at = NOW() WHERE id = $1 AND employee_id = $2
      RETURNING id as "_id", week_start_date as "weekStartDate", week_end_date as "weekEndDate", total_hours as "totalHours", status, notes
    `, [req.params.id, req.user._id]);
    res.json({ success: true, data: result.rows[0], message: 'Timesheet submitted' });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.put('/:id/action', authorize('admin', 'director', 'manager'), async (req, res) => {
  try {
    const { action, rejectionReason } = req.body;

    // Bug #15 fix: prevent self-approval — manager cannot approve their own timesheet
    const ownerRes = await pool.query(
      `SELECT t.employee_id, t.status, e.reporting_manager_id, e.approving_authority_id
         FROM timesheets t JOIN employees e ON t.employee_id = e.id WHERE t.id = $1`,
      [req.params.id]
    );
    if (ownerRes.rows.length === 0) return res.status(404).json({ success: false, message: 'Timesheet not found' });
    if (ownerRes.rows[0].status !== 'submitted') {
      return res.status(400).json({ success: false, message: 'Only submitted timesheets can be approved or rejected.' });
    }
    if (ownerRes.rows[0].employee_id === req.user._id) {
      return res.status(403).json({ success: false, message: 'You cannot approve your own timesheet' });
    }
    // Managers may only act on their direct reports; full-access on anyone.
    if (!canActOnEmployee(req.user, ownerRes.rows[0])) {
      return res.status(403).json({ success: false, message: 'You can only act on your direct reports’ timesheets.' });
    }

    const status = action === 'approved' ? 'approved' : 'rejected';
    const result = await pool.query(
      `UPDATE timesheets SET status = $1, approved_by = $2, approved_at = NOW(), rejection_reason = $3, updated_at = NOW() WHERE id = $4
       RETURNING id as "_id", week_start_date as "weekStartDate", week_end_date as "weekEndDate", total_hours as "totalHours", status, notes`,
      [status, req.user._id, rejectionReason || null, req.params.id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

module.exports = router;
