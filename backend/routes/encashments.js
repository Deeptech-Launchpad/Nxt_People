const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');

// Whitelist map — column names come from code, never from user input
const ENCASHMENT_COL = {
  earned: 'earned_leave',
  casual: 'casual_leave',
  sick:   'sick_leave',
};

router.use(protect);

// GET my encashments
router.get('/my', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM leave_encashments WHERE employee_id = $1 ORDER BY created_at DESC',
      [req.user._id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET all pending encashments (admin/manager)
router.get('/pending', authorize('admin', 'manager'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT l.*, json_build_object('firstName', e.first_name, 'lastName', e.last_name, 'department', e.department) as employee
      FROM leave_encashments l
      JOIN employees e ON l.employee_id = e.id
      WHERE l.status = 'pending'
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST apply for encashment
router.post('/', async (req, res) => {
  try {
    const { leaveType, days, reason } = req.body;

    // Validate leave type against whitelist before any DB access
    const balCol = ENCASHMENT_COL[leaveType];
    if (!balCol) {
      return res.status(400).json({
        success: false,
        message: `Invalid leave type. Must be one of: ${Object.keys(ENCASHMENT_COL).join(', ')}`,
      });
    }
    if (!days || days <= 0) {
      return res.status(400).json({ success: false, message: 'Days must be a positive number' });
    }

    // Check balance
    const empRes = await pool.query('SELECT earned_leave, casual_leave, sick_leave FROM employees WHERE id = $1', [req.user._id]);
    const emp = empRes.rows[0];

    if (emp[balCol] < days) {
      return res.status(400).json({ success: false, message: `Insufficient leave balance. Available: ${emp[balCol]} day(s)` });
    }

    const result = await pool.query(`
      INSERT INTO leave_encashments (employee_id, leave_type, days, reason)
      VALUES ($1, $2, $3, $4) RETURNING *
    `, [req.user._id, leaveType, days, reason]);

    res.status(201).json({ success: true, data: result.rows[0], message: 'Encashment request submitted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// PUT approve/reject
router.put('/:id/action', authorize('admin', 'manager'), async (req, res) => {
  try {
    const { action, reason } = req.body;
    const status = action === 'approve' ? 'approved' : 'rejected';

    const reqRes = await pool.query('SELECT * FROM leave_encashments WHERE id = $1', [req.params.id]);
    const encashReq = reqRes.rows[0];
    if (!encashReq || encashReq.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Invalid or already processed request' });
    }

    if (status === 'approved') {
      // Use whitelist map — column name is from code, not user input
      const balCol = ENCASHMENT_COL[encashReq.leave_type];
      if (balCol) {
        // GREATEST(0, ...) ensures balance never goes negative
        await pool.query(
          `UPDATE employees SET ${balCol} = GREATEST(0, ${balCol} - $1) WHERE id = $2`,
          [encashReq.days, encashReq.employee_id]
        );
      }
    }

    const up = await pool.query(`
      UPDATE leave_encashments
      SET status = $1, rejection_reason = $2, approved_by = $3, approved_at = NOW(), updated_at = NOW()
      WHERE id = $4 RETURNING *
    `, [status, reason || null, req.user._id, req.params.id]);

    res.json({ success: true, data: up.rows[0], message: `Encashment ${status}` });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});


module.exports = router;
