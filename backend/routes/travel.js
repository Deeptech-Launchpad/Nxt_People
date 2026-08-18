/**
 * Travel requests — employee submits, manager/admin approves.
 *
 *   GET    /api/travel            — admin/manager: all requests with employee info
 *   GET    /api/travel/my         — employee: own requests
 *   POST   /api/travel            — employee: create new request
 *   PUT    /api/travel/:id/action — admin/manager: approve | reject
 *   DELETE /api/travel/:id        — employee: cancel own pending request
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { isFullAccess, reportsScope, canActOnEmployee } = require('../utils/roles');
const { audit } = require('../middleware/audit');
const { serverError } = require('../utils/serverError');
router.use(protect);

const SELECT_OWN = `
  SELECT t.id AS "_id",
         t.destination, t.purpose, t.transport,
         t.from_date AS "fromDate", t.to_date AS "toDate",
         t.status, t.rejection_reason AS "rejectionReason",
         t.approved_at AS "approvedAt", t.created_at AS "createdAt"
    FROM travel_requests t
   WHERE t.employee_id = $1
   ORDER BY t.created_at DESC
`;

const SELECT_ALL = `
  SELECT t.id AS "_id",
         t.destination, t.purpose, t.transport,
         t.from_date AS "fromDate", t.to_date AS "toDate",
         t.status, t.rejection_reason AS "rejectionReason",
         t.approved_at AS "approvedAt", t.created_at AS "createdAt",
         json_build_object(
           '_id',       e.id,
           'firstName', e.first_name,
           'lastName',  e.last_name,
           'employeeId',e.employee_id,
           'department',e.department
         ) AS employee
    FROM travel_requests t
    JOIN employees e ON t.employee_id = e.id
   WHERE 1=1`;
// (caller appends an optional direct-reports scope, then ORDER BY)

router.get('/my', async (req, res) => {
  try {
    const r = await pool.query(SELECT_OWN, [req.user._id]);
    res.json({ success: true, data: r.rows });
  } catch (err) { serverError(res, err); }
});

router.get('/', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    // Full-access sees all requests; managers only their direct reports'.
    const scope = reportsScope(req.user, 'e', 1);
    const r = await pool.query(`${SELECT_ALL}${scope.clause} ORDER BY t.created_at DESC`, scope.params);
    res.json({ success: true, data: r.rows });
  } catch (err) { serverError(res, err); }
});

router.post('/', audit('CREATE', 'travel_request'), async (req, res) => {
  try {
    const { destination, purpose, fromDate, toDate, transport } = req.body;
    if (!destination || !fromDate || !toDate) {
      return res.status(400).json({ success: false, message: 'destination, fromDate, toDate are required' });
    }
    if (new Date(toDate) < new Date(fromDate)) {
      return res.status(400).json({ success: false, message: 'toDate cannot be before fromDate' });
    }
    const r = await pool.query(
      `INSERT INTO travel_requests
         (employee_id, destination, purpose, from_date, to_date, transport)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id AS "_id"`,
      [req.user._id, destination, purpose || null, fromDate, toDate, transport || null]
    );
    res.status(201).json({ success: true, data: { _id: r.rows[0]._id } });
  } catch (err) { serverError(res, err); }
});

router.put('/:id/action', authorize('admin', 'director', 'hr_admin', 'manager'), audit('ACTION', 'travel_request'), async (req, res) => {
  try {
    const { action, rejectionReason } = req.body;
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ success: false, message: 'action must be approve or reject' });
    }

    // Managers may only act on their direct reports; full-access on anyone.
    const tgt = await pool.query(
      `SELECT t.employee_id, e.reporting_manager_id, e.approving_authority_id
         FROM travel_requests t JOIN employees e ON t.employee_id = e.id WHERE t.id = $1`,
      [req.params.id]
    );
    if (tgt.rows.length === 0) return res.status(404).json({ success: false, message: 'Request not found' });
    if (tgt.rows[0].employee_id === req.user._id && !isFullAccess(req.user.role))
      return res.status(403).json({ success: false, message: 'You cannot act on your own travel request.' });
    if (!canActOnEmployee(req.user, tgt.rows[0]))
      return res.status(403).json({ success: false, message: 'You can only act on your direct reports’ requests.' });

    const status = action === 'approve' ? 'approved' : 'rejected';
    const r = await pool.query(
      `UPDATE travel_requests
          SET status = $1,
              approved_by = $2,
              approved_at = NOW(),
              rejection_reason = $3
        WHERE id = $4
          AND status = 'pending'
        RETURNING id`,
      [status, req.user._id, action === 'reject' ? (rejectionReason || null) : null, req.params.id]
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Request not found or already actioned' });
    }
    res.json({ success: true, message: `Request ${status}` });
  } catch (err) { serverError(res, err); }
});

router.delete('/:id', audit('CANCEL', 'travel_request'), async (req, res) => {
  try {
    // Employee can only cancel their own pending request.
    const r = await pool.query(
      `DELETE FROM travel_requests
        WHERE id = $1
          AND employee_id = $2
          AND status = 'pending'
        RETURNING id`,
      [req.params.id, req.user._id]
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Request not found or already processed' });
    }
    res.json({ success: true, message: 'Cancelled' });
  } catch (err) { serverError(res, err); }
});

module.exports = router;
