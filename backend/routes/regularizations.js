const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { createNotification } = require('./notifications');
router.use(protect);

// GET my regularization requests
router.get('/my', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.id as "_id", r.date, r.check_in as "checkIn", r.check_out as "checkOut",
       r.reason, r.status, r.rejection_reason as "rejectionReason", r.created_at as "createdAt",
       json_build_object('firstName', m.first_name, 'lastName', m.last_name) as "approvedBy"
       FROM attendance_regularizations r
       LEFT JOIN employees m ON r.approved_by = m.id
       WHERE r.employee_id = $1 ORDER BY r.created_at DESC`,
      [req.user._id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET all pending (admin/manager)
router.get('/pending', authorize('admin', 'manager'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.id as "_id", r.date, r.check_in as "checkIn", r.check_out as "checkOut",
       r.reason, r.status, r.created_at as "createdAt",
       json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name, 'employeeId', e.employee_id, 'department', e.department) as employee
       FROM attendance_regularizations r
       JOIN employees e ON r.employee_id = e.id
       WHERE r.status = 'pending' ORDER BY r.date DESC`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST submit request
router.post('/', async (req, res) => {
  try {
    const { date, checkIn, checkOut, reason } = req.body;
    if (!date || !reason) return res.status(400).json({ success: false, message: 'Date and reason are required' });
    const result = await pool.query(
      `INSERT INTO attendance_regularizations (employee_id, date, check_in, check_out, reason)
       VALUES ($1, $2, $3, $4, $5) RETURNING id as "_id", date, check_in as "checkIn", check_out as "checkOut", reason, status, created_at as "createdAt"`,
      [req.user._id, date, checkIn || null, checkOut || null, reason]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// PUT approve/reject
router.put('/:id/action', authorize('admin', 'manager'), async (req, res) => {
  try {
    const { action, rejectionReason } = req.body;
    const regRes = await pool.query('SELECT * FROM attendance_regularizations WHERE id = $1', [req.params.id]);
    const reg = regRes.rows[0];
    if (!reg) return res.status(404).json({ success: false, message: 'Request not found' });

    const status = action === 'approved' ? 'approved' : 'rejected';
    await pool.query(
      `UPDATE attendance_regularizations SET status=$1, approved_by=$2, approved_at=NOW(), rejection_reason=$3, updated_at=NOW() WHERE id=$4`,
      [status, req.user._id, rejectionReason || null, req.params.id]
    );

    // If approved, update the actual attendance record
    if (action === 'approved') {
      const exists = await pool.query('SELECT id FROM attendance WHERE employee_id=$1 AND date=$2', [reg.employee_id, reg.date]);
      if (exists.rows.length > 0) {
        await pool.query(
          `UPDATE attendance SET check_in = CASE WHEN $1::time IS NOT NULL THEN ($2::date + $1::time)::timestamp ELSE check_in END,
           check_out = CASE WHEN $3::time IS NOT NULL THEN ($2::date + $3::time)::timestamp ELSE check_out END, updated_at=NOW() WHERE employee_id=$4 AND date=$2`,
          [reg.check_in, reg.date, reg.check_out, reg.employee_id]
        );
      } else {
        await pool.query(
          `INSERT INTO attendance (employee_id, date, check_in, check_out, status) VALUES ($1,$2,
           CASE WHEN $3::time IS NOT NULL THEN ($2::date + $3::time)::timestamp END,
           CASE WHEN $4::time IS NOT NULL THEN ($2::date + $4::time)::timestamp END, 'present')`,
          [reg.employee_id, reg.date, reg.check_in, reg.check_out]
        );
      }
    }

    const notifTitle = action === 'approved' ? 'Regularization Approved ✓' : 'Regularization Rejected';
    const notifMsg = action === 'approved'
      ? `Your attendance regularization for ${new Date(reg.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} has been approved.`
      : `Your regularization for ${new Date(reg.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} was rejected.`;
    await createNotification(reg.employee_id, 'info', notifTitle, notifMsg, '/attendance/my');

    res.json({ success: true, message: `Regularization ${action}` });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
