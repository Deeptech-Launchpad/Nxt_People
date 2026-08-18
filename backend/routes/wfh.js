const express = require('express');
const router = express.Router();
const pool = require('../db');
const { fire } = require('../utils/workflowEngine');
const { protect, authorize } = require('../middleware/auth');
const { isFullAccess, reportsScope } = require('../utils/roles');
const { audit } = require('../middleware/audit');
const { createNotification } = require('./notifications');
const { createLevels, canUserAct, applyApproval, applyApproveAll, applyRejection, approvalLevelsJson } = require('../utils/leaveApproval');
const { serverError } = require('../utils/serverError');
router.use(protect);

const WFH_LEVELS_JSON = approvalLevelsJson('wfh', 'w');

// GET my WFH requests
router.get('/my', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT w.id as "_id", w.date, w.reason, w.status, w.rejection_reason as "rejectionReason", w.created_at as "createdAt",
       ${WFH_LEVELS_JSON} as "approvalLevels"
       FROM wfh_requests w WHERE w.employee_id = $1 ORDER BY w.created_at DESC`,
      [req.user._id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { serverError(res, err); }
});

// GET all team WFH requests (all statuses, scoped to direct reports)
router.get('/pending', authorize('admin', 'director', 'hr_admin', 'manager', 'team_incharge'), async (req, res) => {
  try {
    const userId = req.user._id;
    const full = isFullAccess(req.user.role);
    const scope = reportsScope(req.user, 'e', 3);
    const result = await pool.query(
      `SELECT w.id as "_id", w.date, w.reason, w.status, w.rejection_reason as "rejectionReason", w.created_at as "createdAt",
       json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name, 'employeeId', e.employee_id, 'department', e.department) as employee,
       ${WFH_LEVELS_JSON} as "approvalLevels",
       ($2::boolean OR EXISTS (
          SELECT 1 FROM approval_levels x
           WHERE x.request_type = 'wfh' AND x.request_id = w.id AND x.approver_id = $1 AND x.status = 'pending'
       )) as "canAct"
       FROM wfh_requests w JOIN employees e ON w.employee_id = e.id
       WHERE 1=1${scope.clause} ORDER BY w.date DESC`,
      [userId, full, ...scope.params]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { serverError(res, err); }
});

// POST apply WFH
router.post('/', audit('CREATE', 'wfh_request'), async (req, res) => {
  try {
    const { date, reason } = req.body;
    if (!date || !reason) return res.status(400).json({ success: false, message: 'Date and reason are required' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const conflict = await client.query('SELECT id FROM wfh_requests WHERE employee_id=$1 AND date=$2', [req.user._id, date]);
      if (conflict.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ success: false, message: 'WFH already requested for this date' });
      }
      const leaveConflict = await client.query(
        `SELECT id FROM leaves WHERE employee_id=$1 AND status IN ('pending','pending_approval','approved')
           AND start_date <= $2::date AND end_date >= $2::date`,
        [req.user._id, date]
      );
      if (leaveConflict.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ success: false, message: 'You already have a leave request covering this date.' });
      }
      const result = await client.query(
        `INSERT INTO wfh_requests (employee_id, date, reason) VALUES ($1,$2,$3)
         RETURNING id as "_id", date, reason, status, created_at as "createdAt"`,
        [req.user._id, date, reason]
      );
      const wfh = result.rows[0];
      await createLevels(client, 'wfh', wfh._id, req.user._id);
      await client.query('COMMIT');
      res.status(201).json({ success: true, data: wfh });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) { serverError(res, err); }
});

// PUT approve/reject with multi-level hierarchy support
router.put('/:id/action', authorize('admin', 'director', 'hr_admin', 'manager', 'team_incharge'), audit('ACTION', 'wfh_request'), async (req, res) => {
  try {
    const { action, rejectionReason, approveAll } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const wRes = await client.query(
        `SELECT w.*, e.reporting_manager_id, e.approving_authority_id
           FROM wfh_requests w JOIN employees e ON w.employee_id = e.id
          WHERE w.id=$1 FOR UPDATE OF w`,
        [req.params.id]
      );
      const wfh = wRes.rows[0];
      if (!wfh) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'WFH request not found' }); }
      if (String(wfh.employee_id) === String(req.user._id)) {
        await client.query('ROLLBACK');
        return res.status(403).json({ success: false, message: 'You cannot approve or reject your own WFH request.' });
      }
      if (wfh.status !== 'pending') { await client.query('ROLLBACK'); return res.status(400).json({ success: false, message: 'This request has already been actioned.' }); }

      const canAct = await canUserAct(client, 'wfh', req.params.id, req.user);
      if (!canAct) { await client.query('ROLLBACK'); return res.status(403).json({ success: false, message: 'You are not a pending approver for this request.' }); }

      let result;
      if (action === 'approved') {
        result = approveAll
          ? await applyApproveAll(client, 'wfh', req.params.id, req.user)
          : await applyApproval(client, 'wfh', req.params.id, req.user);
      } else {
        result = await applyRejection(client, 'wfh', req.params.id, req.user);
      }

      if (!result.ok) {
        await client.query('ROLLBACK');
        return res.status(403).json({ success: false, message: result.message });
      }

      const finalStatus = action === 'rejected' ? 'rejected' : (result.allApproved ? 'approved' : 'pending');
      if (finalStatus === 'approved') {
        await client.query(`UPDATE wfh_requests SET status=$1, approved_by=$2, approved_at=NOW() WHERE id=$3`,
          ['approved', req.user._id, req.params.id]);
      } else if (finalStatus === 'rejected') {
        await client.query(`UPDATE wfh_requests SET status=$1, approved_by=$2, approved_at=NOW(), rejection_reason=$3 WHERE id=$4`,
          ['rejected', req.user._id, rejectionReason || null, req.params.id]);
      } else {
        await client.query(`UPDATE wfh_requests SET status=$1 WHERE id=$2`, ['pending', req.params.id]);
      }

      await client.query('COMMIT');

      if (finalStatus !== 'pending') {
        const dateLabel = new Date(wfh.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        await createNotification(wfh.employee_id, 'info',
          finalStatus === 'approved' ? 'WFH Approved ✓' : 'WFH Rejected',
          finalStatus === 'approved'
            ? `Your WFH request for ${dateLabel} has been approved.`
            : `Your WFH request for ${dateLabel} was rejected.`,
          '/wfh'
        );
      }

      // Fire-and-forget: the decision is committed, and a workflow must never
      // be able to fail or delay it. `finalStatus` is 'pending' while levels
      // remain, so this only fires on the decision that settles the request.
      if (finalStatus === 'approved' || finalStatus === 'rejected') {
        fire('wfh', finalStatus, { recordId: wfh.id, actorId: req.user._id });
      }
      res.json({ success: true, message: `WFH ${finalStatus}` });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) { serverError(res, err); }
});

module.exports = router;
