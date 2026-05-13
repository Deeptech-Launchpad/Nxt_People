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
   ORDER BY t.created_at DESC
`;

router.get('/my', async (req, res) => {
  try {
    const r = await pool.query(SELECT_OWN, [req.user._id]);
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/', authorize('admin', 'manager'), async (_req, res) => {
  try {
    const r = await pool.query(SELECT_ALL);
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/', async (req, res) => {
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
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.put('/:id/action', authorize('admin', 'manager'), async (req, res) => {
  try {
    const { action, rejectionReason } = req.body;
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ success: false, message: 'action must be approve or reject' });
    }
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
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/:id', async (req, res) => {
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
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
