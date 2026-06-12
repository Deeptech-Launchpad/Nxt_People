/**
 * Compensation claims — employee submits expense claims (medical, travel,
 * food, equipment, etc.), manager/admin approves or rejects.
 *
 *   GET    /api/compensation            — admin/manager: all claims
 *   GET    /api/compensation/my         — employee: own claims
 *   POST   /api/compensation            — employee: submit (multipart, optional receipt)
 *   PUT    /api/compensation/:id/action — manager/admin: approve | reject
 *   DELETE /api/compensation/:id        — employee: cancel own pending claim
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { isFullAccess, reportsScope, canActOnEmployee } = require('../utils/roles');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
router.use(protect);

const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename:    (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `receipt-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['.pdf', '.jpg', '.jpeg', '.png'].includes(path.extname(file.originalname).toLowerCase());
    cb(null, ok);
  },
});

const SELECT_OWN = `
  SELECT c.id AS "_id",
         c.claim_type AS "claimType", c.amount, c.claim_date AS "claimDate",
         c.description, c.receipt_url AS "receiptUrl", c.status,
         c.rejection_reason AS "rejectionReason",
         c.approved_at AS "approvedAt", c.created_at AS "createdAt"
    FROM compensation_claims c
   WHERE c.employee_id = $1
   ORDER BY c.created_at DESC
`;

const SELECT_ALL = `
  SELECT c.id AS "_id",
         c.claim_type AS "claimType", c.amount, c.claim_date AS "claimDate",
         c.description, c.receipt_url AS "receiptUrl", c.status,
         c.rejection_reason AS "rejectionReason",
         c.approved_at AS "approvedAt", c.created_at AS "createdAt",
         json_build_object(
           '_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name,
           'employeeId', e.employee_id, 'department', e.department
         ) AS employee
    FROM compensation_claims c
    JOIN employees e ON c.employee_id = e.id
   WHERE 1=1`;
// (caller appends an optional direct-reports scope, then ORDER BY)

router.get('/my', async (req, res) => {
  try {
    const r = await pool.query(SELECT_OWN, [req.user._id]);
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/', authorize('super_admin', 'hr', 'manager'), async (req, res) => {
  try {
    // Full-access sees all claims; managers only their direct reports'.
    const scope = reportsScope(req.user, 'e', 1);
    const r = await pool.query(`${SELECT_ALL}${scope.clause} ORDER BY c.created_at DESC`, scope.params);
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/', upload.single('receipt'), async (req, res) => {
  try {
    const { claimType, amount, claimDate, description } = req.body;
    if (!claimType || !amount || !claimDate) {
      return res.status(400).json({ success: false, message: 'claimType, amount, claimDate are required' });
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ success: false, message: 'amount must be a positive number' });
    }
    const receiptUrl = req.file ? `/uploads/${req.file.filename}` : null;
    const r = await pool.query(
      `INSERT INTO compensation_claims
         (employee_id, claim_type, amount, claim_date, description, receipt_url)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id AS "_id"`,
      [req.user._id, claimType, amt, claimDate, description || null, receiptUrl]
    );
    res.status(201).json({ success: true, data: { _id: r.rows[0]._id } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.put('/:id/action', authorize('super_admin', 'hr', 'manager'), async (req, res) => {
  try {
    const { action, rejectionReason } = req.body;
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ success: false, message: 'action must be approve or reject' });
    }

    // Block self-approval — a manager cannot approve their own claim.
    // Full-access (Super Admin / HR) is exempt as the final authority.
    const own = await pool.query(
      `SELECT c.employee_id, e.reporting_manager_id, e.approving_authority_id
         FROM compensation_claims c JOIN employees e ON c.employee_id = e.id WHERE c.id = $1`,
      [req.params.id]
    );
    if (own.rows.length === 0) return res.status(404).json({ success: false, message: 'Claim not found' });
    if (String(own.rows[0].employee_id) === String(req.user._id) && !isFullAccess(req.user.role)) {
      return res.status(403).json({ success: false, message: 'You cannot approve or reject your own claim.' });
    }
    // Managers may only act on their direct reports; full-access on anyone.
    if (!canActOnEmployee(req.user, own.rows[0])) {
      return res.status(403).json({ success: false, message: 'You can only act on your direct reports’ claims.' });
    }

    const status = action === 'approve' ? 'approved' : 'rejected';
    const r = await pool.query(
      `UPDATE compensation_claims
          SET status = $1, approved_by = $2, approved_at = NOW(),
              rejection_reason = $3
        WHERE id = $4 AND status = 'pending'
        RETURNING id`,
      [status, req.user._id, action === 'reject' ? (rejectionReason || null) : null, req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ success: false, message: 'Claim not found or already actioned' });
    res.json({ success: true, message: `Claim ${status}` });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const r = await pool.query(
      `DELETE FROM compensation_claims
        WHERE id = $1 AND employee_id = $2 AND status = 'pending'
        RETURNING id`,
      [req.params.id, req.user._id]
    );
    if (r.rows.length === 0) return res.status(404).json({ success: false, message: 'Claim not found or already processed' });
    res.json({ success: true, message: 'Cancelled' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
