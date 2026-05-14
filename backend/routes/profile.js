const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { protect } = require('../middleware/auth');
router.use(protect);

/* ── Photo upload (used by every role: employee / manager / admin) ────────
 *   Stored under backend/uploads/photos/ and served via /uploads/photos/<f>. */
const photosDir = path.join(__dirname, '..', 'uploads', 'photos');
if (!fs.existsSync(photosDir)) fs.mkdirSync(photosDir, { recursive: true });

const photoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, photosDir),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${req.user._id}-${Date.now()}${ext}`);
  },
});
const photoUpload = multer({
  storage: photoStorage,
  limits:  { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
  },
});

// GET /api/profile — get own full profile
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT e.id as "_id", e.first_name as "firstName", e.last_name as "lastName", e.email, e.phone,
       e.role, e.department, e.designation, e.company, e.division, e.employee_id as "employeeId",
       e.joining_date as "joiningDate", e.date_of_birth as "dateOfBirth",
       e.address, e.emergency_contact_name as "emergencyContactName",
       e.emergency_contact_phone as "emergencyContactPhone",
       e.emergency_contact_relation as "emergencyContactRelation",
       e.casual_leave as "casualLeave", e.sick_leave as "sickLeave",
       e.earned_leave as "earnedLeave", e.unpaid_leave as "unpaidLeave",
       e.pan_number as "panNumber", e.bank_account as "bankAccount",
       e.bank_ifsc as "bankIfsc", e.photo_url as "photoUrl", e.status,
       e.mfa_enabled as "mfaEnabled",
       CASE WHEN s.id IS NOT NULL THEN json_build_object('id', s.id, 'name', s.name, 'startTime', s.start_time, 'endTime', s.end_time) ELSE null END as shift,
       CASE WHEN m.id IS NOT NULL THEN json_build_object(
         'id', m.id, 'employeeId', m.employee_id, 'firstName', m.first_name, 'lastName', m.last_name,
         'email', m.email, 'designation', m.designation,
         'isCheckedIn', (a_m.check_in IS NOT NULL AND a_m.check_out IS NULL),
         'presence', CASE
           WHEN a_m.check_in IS NULL THEN 'yetToCheckIn'
           WHEN a_m.check_out IS NULL THEN 'in'
           ELSE 'out'
         END
       ) ELSE null END as manager,
       CASE WHEN aa.id IS NOT NULL THEN json_build_object(
         'id', aa.id, 'employeeId', aa.employee_id, 'firstName', aa.first_name, 'lastName', aa.last_name,
         'email', aa.email, 'designation', aa.designation,
         'isCheckedIn', (a_aa.check_in IS NOT NULL AND a_aa.check_out IS NULL),
         'presence', CASE
           WHEN a_aa.check_in IS NULL THEN 'yetToCheckIn'
           WHEN a_aa.check_out IS NULL THEN 'in'
           ELSE 'out'
         END
       ) ELSE null END as "approvingAuthority"
       FROM employees e
       LEFT JOIN shifts s ON e.shift_id = s.id
       LEFT JOIN employees m ON e.reporting_manager_id = m.id
       LEFT JOIN employees aa ON e.approving_authority_id = aa.id
       LEFT JOIN attendance a_m ON a_m.employee_id = m.id AND a_m.date = CURRENT_DATE
       LEFT JOIN attendance a_aa ON a_aa.employee_id = aa.id AND a_aa.date = CURRENT_DATE
       WHERE e.id = $1`,
      [req.user._id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/profile — update own editable fields.
// Employees can self-edit ONLY their alternative phone number, current
// address, and emergency contact details. Everything else (name, DOB,
// PAN, bank details, role, department, joining date, etc.) is HR-managed
// and reaches the DB only via /api/employees/:id (admin/manager-gated).
// Locked fields in the request body are silently ignored — frontend already
// hides them, this is the defense-in-depth backstop.
router.put('/', async (req, res) => {
  try {
    const {
      phone, address,
      emergencyContactName, emergencyContactPhone, emergencyContactRelation,
    } = req.body;

    const updates = [];
    const params = [];
    let i = 1;
    const set = (col, val) => { updates.push(`${col} = $${i++}`); params.push(val); };

    if (phone !== undefined)                    set('phone', phone);
    if (address !== undefined)                  set('address', address);
    if (emergencyContactName !== undefined)     set('emergency_contact_name', emergencyContactName);
    if (emergencyContactPhone !== undefined)    set('emergency_contact_phone', emergencyContactPhone);
    if (emergencyContactRelation !== undefined) set('emergency_contact_relation', emergencyContactRelation);

    if (updates.length === 0) return res.json({ success: true, message: 'Nothing to update' });
    updates.push(`updated_at = NOW()`);
    params.push(req.user._id);

    await pool.query(`UPDATE employees SET ${updates.join(', ')} WHERE id = $${i}`, params);
    res.json({ success: true, message: 'Profile updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/profile/photo — upload (or replace) the caller's profile picture.
router.post('/photo', photoUpload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No image attached' });

    const photoUrl = `/uploads/photos/${req.file.filename}`;

    // Best-effort cleanup of the previous file so the directory doesn't grow forever.
    const prev = await pool.query('SELECT photo_url FROM employees WHERE id = $1', [req.user._id]);
    const oldUrl = prev.rows[0]?.photo_url;
    if (oldUrl && oldUrl.startsWith('/uploads/photos/')) {
      const oldPath = path.join(__dirname, '..', oldUrl);
      fs.unlink(oldPath, () => {}); // ignore errors — file may already be gone
    }

    await pool.query('UPDATE employees SET photo_url = $1, updated_at = NOW() WHERE id = $2',
      [photoUrl, req.user._id]);

    res.json({ success: true, photoUrl });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/profile/photo — remove the caller's profile picture (revert to initials).
router.delete('/photo', async (req, res) => {
  try {
    const prev = await pool.query('SELECT photo_url FROM employees WHERE id = $1', [req.user._id]);
    const oldUrl = prev.rows[0]?.photo_url;
    if (oldUrl && oldUrl.startsWith('/uploads/photos/')) {
      const oldPath = path.join(__dirname, '..', oldUrl);
      fs.unlink(oldPath, () => {});
    }
    await pool.query('UPDATE employees SET photo_url = NULL, updated_at = NOW() WHERE id = $1', [req.user._id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/profile/change-password
router.put('/change-password', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6)
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });

    const result = await pool.query('SELECT password FROM employees WHERE id = $1', [req.user._id]);

    // B6 fix: guard against null/missing password (self-registered users before approval)
    if (!result.rows[0] || !result.rows[0].password) {
      return res.status(400).json({ success: false, message: 'No password set on this account. Contact admin.' });
    }

    const isMatch = await bcrypt.compare(currentPassword, result.rows[0].password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect' });
    }

    const hashed = await bcrypt.hash(newPassword, 12);
    await pool.query('UPDATE employees SET password = $1, updated_at = NOW() WHERE id = $2', [hashed, req.user._id]);
    res.json({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
