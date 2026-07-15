const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { isFullAccess, reportsScope, canActOnEmployee } = require('../utils/roles');
const { audit } = require('../middleware/audit');
const { createNotification } = require('./notifications');
router.use(protect);

// GET my WFH requests
router.get('/my', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT w.id as "_id", w.date, w.reason, w.status, w.rejection_reason as "rejectionReason", w.created_at as "createdAt"
       FROM wfh_requests w WHERE w.employee_id = $1 ORDER BY w.created_at DESC`,
      [req.user._id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET all pending (admin/manager)
router.get('/pending', authorize('admin', 'director', 'hr_admin', 'manager', 'team_incharge'), async (req, res) => {
  try {
    // Full-access sees the whole org queue; managers only their direct reports.
    const scope = reportsScope(req.user, 'e', 1);
    const result = await pool.query(
      `SELECT w.id as "_id", w.date, w.reason, w.status, w.created_at as "createdAt",
       json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name, 'employeeId', e.employee_id, 'department', e.department) as employee
       FROM wfh_requests w JOIN employees e ON w.employee_id = e.id
       WHERE w.status = 'pending'${scope.clause} ORDER BY w.date DESC`,
      scope.params
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST apply WFH
router.post('/', audit('CREATE', 'wfh_request'), async (req, res) => {
  try {
    const { date, reason } = req.body;
    if (!date || !reason) return res.status(400).json({ success: false, message: 'Date and reason are required' });
    const conflict = await pool.query('SELECT id FROM wfh_requests WHERE employee_id=$1 AND date=$2', [req.user._id, date]);
    if (conflict.rows.length > 0) return res.status(409).json({ success: false, message: 'WFH already requested for this date' });
    const result = await pool.query(
      `INSERT INTO wfh_requests (employee_id, date, reason) VALUES ($1,$2,$3)
       RETURNING id as "_id", date, reason, status, created_at as "createdAt"`,
      [req.user._id, date, reason]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// PUT approve/reject
router.put('/:id/action', authorize('admin', 'director', 'manager', 'team_incharge'), audit('ACTION', 'wfh_request'), async (req, res) => {
  try {
    const { action, rejectionReason } = req.body;
    const wRes = await pool.query(
      `SELECT w.*, e.reporting_manager_id, e.approving_authority_id
         FROM wfh_requests w JOIN employees e ON w.employee_id = e.id
        WHERE w.id=$1`,
      [req.params.id]
    );
    const wfh = wRes.rows[0];
    if (!wfh) return res.status(404).json({ success: false, message: 'WFH request not found' });

    // Block self-approval (full-access exempt); managers only their direct reports.
    if (wfh.employee_id === req.user._id && !isFullAccess(req.user.role))
      return res.status(403).json({ success: false, message: 'You cannot act on your own WFH request.' });
    if (!canActOnEmployee(req.user, wfh))
      return res.status(403).json({ success: false, message: 'You can only act on your direct reports’ requests.' });

    const status = action === 'approved' ? 'approved' : 'rejected';
    await pool.query(
      'UPDATE wfh_requests SET status=$1, approved_by=$2, approved_at=NOW(), rejection_reason=$3 WHERE id=$4',
      [status, req.user._id, rejectionReason || null, req.params.id]
    );

    const dateLabel = new Date(wfh.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    await createNotification(wfh.employee_id, 'info',
      action === 'approved' ? 'WFH Approved ✓' : 'WFH Rejected',
      action === 'approved' ? `Your WFH request for ${dateLabel} has been approved.` : `Your WFH request for ${dateLabel} was rejected.`,
      '/wfh'
    );

    res.json({ success: true, message: `WFH ${action}` });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
