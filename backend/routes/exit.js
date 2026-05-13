const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { createNotification } = require('./notifications');
const { logAudit } = require('../utils/audit');
router.use(protect);

// GET my exit request
router.get('/my', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id as "_id", resignation_date as "resignationDate", last_working_date as "lastWorkingDate",
       reason, status, exit_interview_notes as "exitInterviewNotes",
       it_clearance as "itClearance", hr_clearance as "hrClearance", finance_clearance as "financeClearance",
       manager_clearance as "managerClearance", created_at as "createdAt"
       FROM exit_requests WHERE employee_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [req.user._id]
    );
    res.json({ success: true, data: r.rows[0] || null });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET all (admin only)
router.get('/all', authorize('admin'), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT ex.id as "_id", ex.resignation_date as "resignationDate", ex.last_working_date as "lastWorkingDate",
       ex.reason, ex.status, ex.it_clearance as "itClearance", ex.hr_clearance as "hrClearance",
       ex.finance_clearance as "financeClearance", ex.manager_clearance as "managerClearance",
       ex.exit_interview_notes as "exitInterviewNotes", ex.created_at as "createdAt",
       json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name, 'department', e.department, 'designation', e.designation, 'employeeId', e.employee_id) as employee
       FROM exit_requests ex JOIN employees e ON ex.employee_id = e.id
       ORDER BY ex.created_at DESC`
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST submit resignation
router.post('/', async (req, res) => {
  try {
    const { resignationDate, lastWorkingDate, reason } = req.body;
    if (!resignationDate || !reason) return res.status(400).json({ success: false, message: 'Resignation date and reason are required' });
    const exists = await pool.query("SELECT id FROM exit_requests WHERE employee_id=$1 AND status NOT IN ('rejected','withdrawn')", [req.user._id]);
    if (exists.rows.length > 0) return res.status(409).json({ success: false, message: 'An active exit request already exists' });
    const r = await pool.query(
      `INSERT INTO exit_requests (employee_id, resignation_date, last_working_date, reason)
       VALUES ($1,$2,$3,$4) RETURNING id as "_id", resignation_date as "resignationDate", status, created_at as "createdAt"`,
      [req.user._id, resignationDate, lastWorkingDate || null, reason]
    );
    await logAudit(req, {
      action: 'RESIGN_SUBMIT',
      resource: 'ExitRequest',
      resourceId: r.rows[0]._id,
      details: { resignationDate, lastWorkingDate }
    });
    res.status(201).json({ success: true, data: r.rows[0], message: 'Resignation submitted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// PUT approve/reject (admin)
router.put('/:id/action', authorize('admin'), async (req, res) => {
  try {
    const { action, lastWorkingDate, rejectionReason } = req.body;
    const existing = await pool.query('SELECT * FROM exit_requests WHERE id=$1', [req.params.id]);
    const ex = existing.rows[0];
    if (!ex) return res.status(404).json({ success: false, message: 'Not found' });

    const status = action === 'approved' ? 'approved' : 'rejected';
    await pool.query(
      'UPDATE exit_requests SET status=$1, approved_by=$2, approved_at=NOW(), last_working_date=COALESCE($3, last_working_date), rejection_reason=$4 WHERE id=$5',
      [status, req.user._id, lastWorkingDate || null, rejectionReason || null, req.params.id]
    );
    if (action === 'approved') {
      await pool.query("UPDATE employees SET status='resigned' WHERE id=$1", [ex.employee_id]);
    }
    await createNotification(ex.employee_id, 'alert',
      action === 'approved' ? 'Resignation Accepted' : 'Resignation Rejected',
      action === 'approved' ? `Your resignation has been accepted. Last working day confirmed.` : `Your resignation was rejected. ${rejectionReason || ''}`,
      '/profile'
    );
    await logAudit(req, {
      action: action === 'approved' ? 'EXIT_APPROVE' : 'EXIT_REJECT',
      resource: 'ExitRequest',
      resourceId: req.params.id,
      details: { action, lastWorkingDate, rejectionReason }
    });
    res.json({ success: true, message: `Exit request ${action}` });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// PUT update clearance status (admin)
router.put('/:id/clearance', authorize('admin'), async (req, res) => {
  try {
    const { itClearance, hrClearance, financeClearance, managerClearance, exitInterviewNotes } = req.body;
    await pool.query(
      `UPDATE exit_requests SET it_clearance=COALESCE($1,it_clearance), hr_clearance=COALESCE($2,hr_clearance),
       finance_clearance=COALESCE($3,finance_clearance), manager_clearance=COALESCE($4,manager_clearance),
       exit_interview_notes=COALESCE($5,exit_interview_notes) WHERE id=$6`,
      [itClearance, hrClearance, financeClearance, managerClearance, exitInterviewNotes || null, req.params.id]
    );
    // Check if all clearances done → mark completed
    const r = await pool.query('SELECT * FROM exit_requests WHERE id=$1', [req.params.id]);
    const ex = r.rows[0];
    if (ex.it_clearance && ex.hr_clearance && ex.finance_clearance && ex.manager_clearance) {
      await pool.query("UPDATE exit_requests SET status='completed' WHERE id=$1", [req.params.id]);
      await pool.query("UPDATE employees SET status='inactive' WHERE id=$1", [ex.employee_id]);
    }
    await logAudit(req, {
      action: 'CLEARANCE_UPDATE',
      resource: 'ExitRequest',
      resourceId: req.params.id,
      details: { itClearance, hrClearance, financeClearance, managerClearance }
    });
    res.json({ success: true, message: 'Clearance updated' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
