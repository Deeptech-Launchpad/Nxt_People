const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
router.use(protect);

// Local disk storage under backend/uploads/
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: (req, file, cb) => {
  const allowed = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png', '.xlsx', '.xls'];
  cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
}});

// Admin/manager can act on anyone's documents; employees can act only on
// their own. Used by GET, POST, and DELETE — folded into one helper so the
// rule stays consistent (the previous bug was missing checks on POST/DELETE).
const isPrivileged = (req) => req.user.role === 'admin' || req.user.role === 'manager';
const ownsFolder   = (req) => req.user._id === req.params.employeeId;

// GET documents for an employee
router.get('/:employeeId', async (req, res) => {
  try {
    if (!isPrivileged(req) && !ownsFolder(req)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    // LEFT JOIN on uploaded_by so legacy onboarding rows (which were inserted
    // without an uploaded_by) still appear. uploadedBy will be {firstName:null}
    // for those rows — the UI already handles that case gracefully.
    const r = await pool.query(
      `SELECT d.id AS "_id", d.name, d.type, d.file_url AS "fileUrl",
              d.file_size AS "fileSize", d.created_at AS "createdAt",
              CASE WHEN e.id IS NULL THEN NULL
                ELSE json_build_object('firstName', e.first_name, 'lastName', e.last_name)
              END AS "uploadedBy"
         FROM employee_documents d
         LEFT JOIN employees e ON d.uploaded_by = e.id
        WHERE d.employee_id = $1
        ORDER BY d.created_at DESC NULLS LAST`,
      [req.params.employeeId]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST upload document — admin/manager OR the owning employee uploading
// into their own folder. Before this check, any logged-in user could upload
// into anyone else's document folder.
router.post('/:employeeId', upload.single('file'), async (req, res) => {
  try {
    if (!isPrivileged(req) && !ownsFolder(req)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    const { name, type = 'other' } = req.body;
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const fileUrl = `/uploads/${req.file.filename}`;
    const r = await pool.query(
      `INSERT INTO employee_documents (employee_id, name, type, file_url, file_size, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id as "_id", name, type, file_url as "fileUrl", file_size as "fileSize", created_at as "createdAt"`,
      [req.params.employeeId, name || req.file.originalname, type, fileUrl, req.file.size, req.user._id]
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// DELETE document — admin/manager, OR the original uploader. Before this
// check, any logged-in user could delete any document in the system.
router.delete('/:employeeId/:docId', async (req, res) => {
  try {
    const doc = await pool.query(
      'SELECT file_url, uploaded_by FROM employee_documents WHERE id=$1',
      [req.params.docId]
    );
    if (!doc.rows[0]) return res.status(404).json({ success: false, message: 'Not found' });
    const isUploader = doc.rows[0].uploaded_by && doc.rows[0].uploaded_by === req.user._id;
    if (!isPrivileged(req) && !isUploader) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    // Delete physical file
    const filePath = path.join(__dirname, '..', doc.rows[0].file_url);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    await pool.query('DELETE FROM employee_documents WHERE id=$1', [req.params.docId]);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
