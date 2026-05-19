const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { createNotification } = require('./notifications');
router.use(protect);

// GET my comp-offs
router.get('/my', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id as "_id", worked_date as "workedDate", reason, days_earned as "daysEarned",
       days_used as "daysUsed", status, rejection_reason as "rejectionReason", created_at as "createdAt"
       FROM comp_offs WHERE employee_id = $1 ORDER BY created_at DESC`,
      [req.user._id]
    );
    const balance = r.rows.filter(x => x.status === 'approved').reduce((s, x) => s + (parseFloat(x.daysEarned) - parseFloat(x.daysUsed)), 0);
    res.json({ success: true, data: r.rows, balance: Math.max(0, balance) });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET pending (admin/manager)
router.get('/pending', authorize('admin', 'manager'), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT c.id as "_id", c.worked_date as "workedDate", c.reason, c.days_earned as "daysEarned", c.status, c.created_at as "createdAt",
       json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name, 'department', e.department) as employee
       FROM comp_offs c JOIN employees e ON c.employee_id = e.id WHERE c.status = 'pending' ORDER BY c.worked_date DESC`
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST apply comp-off
router.post('/', audit('CREATE', 'comp_off'), async (req, res) => {
  try {
    const { workedDate, reason, daysEarned = 1 } = req.body;
    if (!workedDate) return res.status(400).json({ success: false, message: 'Worked date is required' });
    const r = await pool.query(
      `INSERT INTO comp_offs (employee_id, worked_date, reason, days_earned) VALUES ($1,$2,$3,$4)
       RETURNING id as "_id", worked_date as "workedDate", reason, days_earned as "daysEarned", status, created_at as "createdAt"`,
      [req.user._id, workedDate, reason, daysEarned]
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// PUT approve/reject
router.put('/:id/action', authorize('admin', 'manager'), audit('ACTION', 'comp_off'), async (req, res) => {
  try {
    const { action, rejectionReason } = req.body;
    const existing = await pool.query('SELECT * FROM comp_offs WHERE id=$1', [req.params.id]);
    const co = existing.rows[0];
    if (!co) return res.status(404).json({ success: false, message: 'Not found' });

    // Block self-approval — a manager cannot approve their own comp-off.
    // Admins are exempt because they're the final authority.
    if (co.employee_id === req.user._id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'You cannot approve or reject your own comp-off request.' });
    }

    const status = action === 'approved' ? 'approved' : 'rejected';
    await pool.query(
      'UPDATE comp_offs SET status=$1, approved_by=$2, approved_at=NOW(), rejection_reason=$3 WHERE id=$4',
      [status, req.user._id, rejectionReason || null, req.params.id]
    );

    const dateLabel = new Date(co.worked_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    await createNotification(co.employee_id, 'info',
      action === 'approved' ? 'Comp-Off Approved ✓' : 'Comp-Off Rejected',
      action === 'approved'
        ? `Your comp-off for working on ${dateLabel} (${co.days_earned} day) has been approved.`
        : `Your comp-off request for ${dateLabel} was rejected.`,
      '/leave'
    );
    res.json({ success: true, message: `Comp-off ${action}` });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST use comp-off (deduct from balance)
router.post('/:id/use', audit('USE', 'comp_off'), async (req, res) => {
  try {
    const { daysToUse } = req.body;
    await pool.query(
      'UPDATE comp_offs SET days_used = LEAST(days_earned, days_used + $1) WHERE id = $2 AND employee_id = $3 AND status = $4',
      [daysToUse || 1, req.params.id, req.user._id, 'approved']
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
