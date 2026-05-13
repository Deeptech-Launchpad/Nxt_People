/**
 * HR letter requests — employee requests a letter (employment, salary
 * certificate, address proof, etc.), HR marks status and optionally
 * uploads the final signed letter PDF.
 *
 *   GET    /api/hr-letters             — admin/manager: all requests
 *   GET    /api/hr-letters/my          — employee: own requests
 *   POST   /api/hr-letters             — employee: submit request
 *   PUT    /api/hr-letters/:id/process — admin/manager: change status + optional PDF
 *   DELETE /api/hr-letters/:id         — employee: cancel own request while still 'requested'
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
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
    cb(null, `letter-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, ['.pdf', '.doc', '.docx'].includes(path.extname(file.originalname).toLowerCase()));
  },
});

// Letter types HR can issue. Adjust if your org needs more.
const LETTER_TYPES = [
  'employment_verification',
  'salary_certificate',
  'address_proof',
  'bonafide',
  'experience',
  'noc',
  'relieving',
  'other',
];

const VALID_STATUSES = ['requested', 'in_progress', 'issued', 'rejected'];

const SELECT_OWN = `
  SELECT l.id AS "_id",
         l.letter_type AS "letterType", l.purpose, l.status,
         l.letter_url AS "letterUrl",
         l.rejection_reason AS "rejectionReason",
         l.processed_at AS "processedAt", l.created_at AS "createdAt"
    FROM hr_letter_requests l
   WHERE l.employee_id = $1
   ORDER BY l.created_at DESC
`;

const SELECT_ALL = `
  SELECT l.id AS "_id",
         l.letter_type AS "letterType", l.purpose, l.status,
         l.letter_url AS "letterUrl",
         l.rejection_reason AS "rejectionReason",
         l.processed_at AS "processedAt", l.created_at AS "createdAt",
         json_build_object(
           '_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name,
           'employeeId', e.employee_id, 'department', e.department
         ) AS employee,
         CASE WHEN p.id IS NULL THEN NULL
              ELSE json_build_object('firstName', p.first_name, 'lastName', p.last_name)
         END AS "processedBy"
    FROM hr_letter_requests l
    JOIN employees e ON l.employee_id = e.id
    LEFT JOIN employees p ON l.processed_by = p.id
   ORDER BY l.created_at DESC
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
    const { letterType, purpose } = req.body;
    if (!letterType || !LETTER_TYPES.includes(letterType)) {
      return res.status(400).json({ success: false, message: `letterType must be one of: ${LETTER_TYPES.join(', ')}` });
    }
    const r = await pool.query(
      `INSERT INTO hr_letter_requests (employee_id, letter_type, purpose)
       VALUES ($1, $2, $3)
       RETURNING id AS "_id"`,
      [req.user._id, letterType, purpose || null]
    );
    res.status(201).json({ success: true, data: { _id: r.rows[0]._id } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// PUT /:id/process — change status, optionally upload signed PDF.
// Multipart body: { status, rejectionReason?, file? (signed letter PDF) }
router.put('/:id/process', authorize('admin', 'manager'), upload.single('letter'), async (req, res) => {
  try {
    const { status, rejectionReason } = req.body;
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: `status must be one of: ${VALID_STATUSES.join(', ')}` });
    }
    const letterUrl = req.file ? `/uploads/${req.file.filename}` : null;
    const r = await pool.query(
      `UPDATE hr_letter_requests
          SET status           = $1,
              processed_by     = $2,
              processed_at     = NOW(),
              rejection_reason = $3,
              letter_url       = COALESCE($4, letter_url)
        WHERE id = $5
        RETURNING id`,
      [status, req.user._id, status === 'rejected' ? (rejectionReason || null) : null, letterUrl, req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ success: false, message: 'Request not found' });
    res.json({ success: true, message: `Request updated to ${status}` });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const r = await pool.query(
      `DELETE FROM hr_letter_requests
        WHERE id = $1 AND employee_id = $2 AND status = 'requested'
        RETURNING id`,
      [req.params.id, req.user._id]
    );
    if (r.rows.length === 0) return res.status(404).json({ success: false, message: 'Request not found or already processed' });
    res.json({ success: true, message: 'Cancelled' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
