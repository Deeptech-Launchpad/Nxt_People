const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
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
router.post('/', [
  body('date').isISO8601().withMessage('Date must be YYYY-MM-DD'),
  body('reason').isString().trim().isLength({ min: 3, max: 500 }).withMessage('Reason must be 3–500 characters'),
  body('checkIn').optional({ nullable: true }).matches(/^([01]\d|2[0-3]):[0-5]\d$/).withMessage('checkIn must be HH:MM'),
  body('checkOut').optional({ nullable: true }).matches(/^([01]\d|2[0-3]):[0-5]\d$/).withMessage('checkOut must be HH:MM'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, message: errors.array()[0].msg, errors: errors.array() });
  try {
    const { date, checkIn, checkOut, reason } = req.body;
    // No back-fill more than 90 days old, and no future dates.
    const d = new Date(`${date}T00:00:00`);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const ninetyAgo = new Date(today); ninetyAgo.setDate(ninetyAgo.getDate() - 90);
    if (d > today) return res.status(400).json({ success: false, message: 'Cannot regularize a future date' });
    if (d < ninetyAgo) return res.status(400).json({ success: false, message: 'Cannot regularize older than 90 days' });

    const result = await pool.query(
      `INSERT INTO attendance_regularizations (employee_id, date, check_in, check_out, reason)
       VALUES ($1, $2, $3, $4, $5) RETURNING id as "_id", date, check_in as "checkIn", check_out as "checkOut", reason, status, created_at as "createdAt"`,
      [req.user._id, date, checkIn || null, checkOut || null, reason]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// PUT approve/reject
// Atomic by design: marking the regularization approved AND patching the
// attendance row must commit together. Previously two separate pool.query
// calls — a crash between them left the regularization "approved" while
// the actual attendance row stayed unchanged, silently losing the fix.
router.put('/:id/action', authorize('admin', 'manager'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { action, rejectionReason } = req.body;
    const regRes = await client.query('SELECT * FROM attendance_regularizations WHERE id = $1', [req.params.id]);
    const reg = regRes.rows[0];
    if (!reg) { client.release(); return res.status(404).json({ success: false, message: 'Request not found' }); }

    // Block self-approval — managers can't approve their own regularization.
    if (reg.employee_id === req.user._id && req.user.role !== 'admin') {
      client.release();
      return res.status(403).json({ success: false, message: 'You cannot approve or reject your own regularization request.' });
    }

    const status = action === 'approved' ? 'approved' : 'rejected';

    await client.query('BEGIN');
    await client.query(
      `UPDATE attendance_regularizations SET status=$1, approved_by=$2, approved_at=NOW(), rejection_reason=$3, updated_at=NOW() WHERE id=$4`,
      [status, req.user._id, rejectionReason || null, req.params.id]
    );

    if (action === 'approved') {
      const exists = await client.query('SELECT id FROM attendance WHERE employee_id=$1 AND date=$2', [reg.employee_id, reg.date]);
      if (exists.rows.length > 0) {
        await client.query(
          `UPDATE attendance SET check_in = CASE WHEN $1::time IS NOT NULL THEN ($2::date + $1::time)::timestamp ELSE check_in END,
           check_out = CASE WHEN $3::time IS NOT NULL THEN ($2::date + $3::time)::timestamp ELSE check_out END, updated_at=NOW() WHERE employee_id=$4 AND date=$2`,
          [reg.check_in, reg.date, reg.check_out, reg.employee_id]
        );
      } else {
        await client.query(
          `INSERT INTO attendance (employee_id, date, check_in, check_out, status) VALUES ($1,$2,
           CASE WHEN $3::time IS NOT NULL THEN ($2::date + $3::time)::timestamp END,
           CASE WHEN $4::time IS NOT NULL THEN ($2::date + $4::time)::timestamp END, 'present')`,
          [reg.employee_id, reg.date, reg.check_in, reg.check_out]
        );
      }
    }
    await client.query('COMMIT');

    // Soft side-effect outside the txn — notification glitch shouldn't undo
    // a successful approval.
    const notifTitle = action === 'approved' ? 'Regularization Approved ✓' : 'Regularization Rejected';
    const notifMsg = action === 'approved'
      ? `Your attendance regularization for ${new Date(reg.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} has been approved.`
      : `Your regularization for ${new Date(reg.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} was rejected.`;
    await createNotification(reg.employee_id, 'info', notifTitle, notifMsg, '/attendance/my');

    res.json({ success: true, message: `Regularization ${action}` });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
