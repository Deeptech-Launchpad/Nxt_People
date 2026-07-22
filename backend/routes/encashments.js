const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { isFullAccess, reportsScope, canActOnEmployee } = require('../utils/roles');
const { audit } = require('../middleware/audit');

// Whitelist map — column names come from code, never from user input
const ENCASHMENT_COL = {
  casual: 'casual_leave',
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
router.get('/pending', authorize('admin', 'director', 'manager'), async (req, res) => {
  try {
    // Full-access sees the whole org queue; managers only their direct reports.
    const scope = reportsScope(req.user, 'e', 1);
    const result = await pool.query(`
      SELECT l.*, json_build_object('firstName', e.first_name, 'lastName', e.last_name, 'department', e.department) as employee
      FROM leave_encashments l
      JOIN employees e ON l.employee_id = e.id
      WHERE l.status = 'pending'${scope.clause}
    `, scope.params);
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST apply for encashment
router.post('/', audit('CREATE', 'encashment'), async (req, res) => {
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
router.put('/:id/action', authorize('admin', 'director', 'manager'), audit('ACTION', 'encashment'), async (req, res) => {
  try {
    const { action, reason } = req.body;
    const status = action === 'approve' ? 'approved' : 'rejected';

    const client = await pool.connect();
    try {
      await client.query(‘BEGIN’);
      const reqRes = await client.query(
        `SELECT l.*, e.reporting_manager_id, e.approving_authority_id
           FROM leave_encashments l JOIN employees e ON l.employee_id = e.id WHERE l.id = $1 FOR UPDATE OF l`,
        [req.params.id]
      );
      const encashReq = reqRes.rows[0];
      if (!encashReq || encashReq.status !== ‘pending’) {
        await client.query(‘ROLLBACK’);
        return res.status(400).json({ success: false, message: ‘Invalid or already processed request’ });
      }

      if (encashReq.employee_id === req.user._id && !isFullAccess(req.user.role)) {
        await client.query(‘ROLLBACK’);
        return res.status(403).json({ success: false, message: ‘You cannot act on your own encashment request.’ });
      }
      if (!canActOnEmployee(req.user, encashReq)) {
        await client.query(‘ROLLBACK’);
        return res.status(403).json({ success: false, message: ‘You can only act on requests from your direct reports.’ });
      }

      if (status === ‘approved’) {
        const balCol = ENCASHMENT_COL[encashReq.leave_type];
        if (balCol) {
          await client.query(
            `UPDATE employees SET ${balCol} = GREATEST(0, ${balCol} - $1) WHERE id = $2`,
            [encashReq.days, encashReq.employee_id]
          );
        }
      }

      const up = await client.query(`
        UPDATE leave_encashments
        SET status = $1, rejection_reason = $2, approved_by = $3, approved_at = NOW(), updated_at = NOW()
        WHERE id = $4 AND status = ‘pending’ RETURNING *
      `, [status, reason || null, req.user._id, req.params.id]);

      await client.query(‘COMMIT’);
      res.json({ success: true, data: up.rows[0], message: `Encashment ${status}` });
    } catch (err) {
      await client.query(‘ROLLBACK’);
      throw err;
    } finally {
      client.release();
    }
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});


module.exports = router;
