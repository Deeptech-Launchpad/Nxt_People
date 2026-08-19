const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { protect } = require('../middleware/auth');
const { mergeRows } = require('../utils/mergeRows');
const { serverError } = require('../utils/serverError');
const { orgPolicy, mayUpdatePhoto, applyPrivacy } = require('../utils/orgPolicy');
router.use(protect);

// Identity of one real entry — used to collapse the partial duplicate rows the
// Zoho sync can leave behind (same company/start-date, or same institute/year).
const prevEmpKey = (r) => `${String(r.company || '').trim().toLowerCase()}|${r.fromDate || ''}`;
const eduKey     = (r) => `${String(r.institute || '').trim().toLowerCase()}|${r.yearOfPassing || ''}`;

const PROFILE_PHOTO_MAX_MB = 10;

/* ── Photo upload (used by every role: employee / manager / admin) ────────
 *   Stored under backend/uploads/photos/ and served via /uploads/photos/<f>. */
const photosDir = path.join(__dirname, '..', 'uploads', 'photos');
if (!fs.existsSync(photosDir)) fs.mkdirSync(photosDir, { recursive: true });

// Strict allowlist — anything outside this set is rejected at fileFilter,
// and the saved filename is locked to ONLY this extension. Defends against
// "image.jpg.php" double-extension tricks: even if Apache (or a future
// proxy) is misconfigured to map .php in /uploads, we never write that
// extension to disk.
const ALLOWED_PHOTO_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

const photoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, photosDir),
  filename:    (req, file, cb) => {
    // Re-check against the allowlist inside filename() so a future change
    // to fileFilter can't accidentally let a bad ext through to disk.
    const rawExt = path.extname(file.originalname).toLowerCase();
    const ext = ALLOWED_PHOTO_EXTS.has(rawExt) ? rawExt : '.jpg';
    // crypto.randomBytes prevents the Date.now() millisecond-collision case
    // where two uploads in the same ms clobbered each other.
    const rand = crypto.randomBytes(8).toString('hex');
    cb(null, `${req.user._id}-${rand}${ext}`);
  },
});
const photoUpload = multer({
  storage: photoStorage,
  limits:  { fileSize: PROFILE_PHOTO_MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    // path.extname returns ONLY the final extension, so "image.jpg.php"
    // already resolves to ".php" — which fails this allowlist. Mimetype
    // is a secondary signal we don't rely on alone (easily spoofed).
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, ALLOWED_PHOTO_EXTS.has(ext));
  },
});

/* Convert multer's storage/size errors into a clean 4xx with a friendly
 * message. Without this, LIMIT_FILE_SIZE bubbles up as a generic 500 from
 * the global error handler — the client toast then reads "Internal
 * server error" instead of telling the user to pick a smaller photo. */
function handleMulterError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        success: false,
        message: `Image is too large. Pick something under ${PROFILE_PHOTO_MAX_MB} MB.`,
      });
    }
    return res.status(400).json({ success: false, message: err.message });
  }
  return next(err);
}

// GET /api/profile — get own full profile
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT e.id as "_id", e.first_name as "firstName", e.last_name as "lastName",
       e.nick_name as "nickName",
       e.email, e.phone,
       e.role, e.department, e.designation, e.company, e.division, e.employee_id as "employeeId",
       e.joining_date as "joiningDate", e.date_of_birth as "dateOfBirth",
       e.gender, e.marital_status as "maritalStatus", e.blood_group as "bloodGroup",
       e.nationality, e.about_me as "aboutMe",
       e.work_phone as "workPhone", e.extension, e.personal_email as "personalEmail",
       e.address, e.permanent_address as "permanentAddress",
       e.address_line1 as "addressLine1", e.address_line2 as "addressLine2",
       e.address_city as "addressCity", e.address_state as "addressState",
       e.address_pincode as "addressPincode", e.address_country as "addressCountry",
       e.permanent_address_line1 as "permanentAddressLine1",
       e.permanent_address_line2 as "permanentAddressLine2",
       e.permanent_address_city as "permanentAddressCity",
       e.permanent_address_state as "permanentAddressState",
       e.permanent_address_pincode as "permanentAddressPincode",
       e.permanent_address_country as "permanentAddressCountry",
       e.work_location as "workLocation", e.employment_type as "employmentType",
       e.source_of_hire as "sourceOfHire",
       e.exit_date as "exitDate", e.total_experience as "totalExperience",
       e.expertise,
       e.emergency_contact_name as "emergencyContactName",
       e.emergency_contact_phone as "emergencyContactPhone",
       e.emergency_contact_relation as "emergencyContactRelation",
       e.emergency_contact_dob as "emergencyContactDob",
       e.casual_leave as "casualLeave", e.sick_leave as "sickLeave",
       e.earned_leave as "earnedLeave", e.unpaid_leave as "unpaidLeave",
       e.pan_number as "panNumber", e.aadhaar_number as "aadhaarNumber",
       e.uan_number as "uanNumber",
       e.bank_name as "bankName", e.bank_account as "bankAccount",
       e.bank_ifsc as "bankIfsc", e.photo_url as "photoUrl", e.status,
       e.mfa_enabled as "mfaEnabled",
       CASE WHEN s.id IS NOT NULL THEN json_build_object('id', s.id, 'name', s.name, 'startTime', s.start_time, 'endTime', s.end_time) ELSE null END as shift,
       CASE WHEN m.id IS NOT NULL THEN json_build_object(
         'id', m.id, 'employeeId', m.employee_id, 'firstName', m.first_name, 'lastName', m.last_name,
         'email', m.email, 'designation', m.designation,
         'isCheckedIn', (a_m.check_in IS NOT NULL AND a_m.check_out IS NULL),
         'presence', CASE
           WHEN a_m.check_in IS NOT NULL AND a_m.check_out IS NULL THEN 'in'
           WHEN a_m.check_out IS NOT NULL THEN 'out'
           WHEN EXISTS (SELECT 1 FROM leaves lv WHERE lv.employee_id = m.id AND lv.status='approved' AND lv.start_date <= CURRENT_DATE AND lv.end_date >= CURRENT_DATE) THEN 'onLeave'
           ELSE 'yetToCheckIn'
         END
       ) ELSE null END as manager,
       CASE WHEN aa.id IS NOT NULL THEN json_build_object(
         'id', aa.id, 'employeeId', aa.employee_id, 'firstName', aa.first_name, 'lastName', aa.last_name,
         'email', aa.email, 'designation', aa.designation,
         'isCheckedIn', (a_aa.check_in IS NOT NULL AND a_aa.check_out IS NULL),
         'presence', CASE
           WHEN a_aa.check_in IS NOT NULL AND a_aa.check_out IS NULL THEN 'in'
           WHEN a_aa.check_out IS NOT NULL THEN 'out'
           WHEN EXISTS (SELECT 1 FROM leaves lv WHERE lv.employee_id = aa.id AND lv.status='approved' AND lv.start_date <= CURRENT_DATE AND lv.end_date >= CURRENT_DATE) THEN 'onLeave'
           ELSE 'yetToCheckIn'
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
    const profile = result.rows[0];
    if (profile) {
      // Education + previous employment live in their own tables. Tag them
      // on so the Profile page can render them inline without an extra
      // round-trip. Tables are owned by the Zoho sync (admin-zoho.js) which
      // upserts rows by (employee_id, institute) / (employee_id, company).
      const [eduRes, prevRes] = await Promise.all([
        pool.query(
          `SELECT id, highest_qualification AS "qualification", degree, course,
                  university_or_institution AS "institute",
                  year_of_passing AS "yearOfPassing",
                  percentage_or_cgpa  AS "percentageOrCgpa"
             FROM employee_education
            WHERE employee_id = $1
            ORDER BY year_of_passing DESC NULLS LAST`,
          [req.user._id]
        ),
        pool.query(
          `SELECT id, company, designation,
                  from_date AS "fromDate", to_date AS "toDate",
                  job_description AS "description"
             FROM employee_previous_employment
            WHERE employee_id = $1
            ORDER BY from_date DESC NULLS LAST`,
          [req.user._id]
        ),
      ]);
      // Merge partial duplicate rows so each real entry shows once with its
      // most complete data (e.g. the row missing a designation is filled from
      // its twin). Display-only — the rows stay untouched in the DB.
      profile.education = mergeRows(
        eduRes.rows, eduKey,
        ['qualification', 'degree', 'course', 'institute', 'yearOfPassing', 'percentageOrCgpa']
      );
      profile.previousEmployment = mergeRows(
        prevRes.rows, prevEmpKey,
        ['company', 'designation', 'fromDate', 'toDate', 'description']
      );
    }
    res.json({ success: true, data: profile });
  } catch (err) {
    serverError(res, err);
  }
});

// PUT /api/profile — update own editable fields.
// Employees can self-edit ONLY their alternative phone number, current
// address, and emergency contact details. Everything else (name, DOB,
// PAN, bank details, role, department, joining date, etc.) is HR-managed
// and reaches the DB only via /api/employees/:id (admin/manager-gated).
// Locked fields in the request body are silently ignored — frontend already
// hides them, this is the defense-in-depth backstop.
// Hard allowlist of columns this endpoint is permitted to touch. Used as a
// runtime assertion inside set() — defence-in-depth so a future PR that
// accidentally passes a caller-supplied column name throws here instead of
// reaching the SQL builder. Keep in sync with the set(...) calls below.
const PROFILE_UPDATABLE_COLS = new Set([
  'phone', 'address',
  'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relation',
]);

router.put('/', async (req, res) => {
  try {
    const {
      phone, address,
      emergencyContactName, emergencyContactPhone, emergencyContactRelation,
    } = req.body;

    const updates = [];
    const params = [];
    let i = 1;
    const set = (col, val) => {
      if (!PROFILE_UPDATABLE_COLS.has(col)) {
        // This is a programmer error, not a user error — log + throw so it
        // surfaces in tests instead of silently building bad SQL.
        throw new Error(`[profile] column not in allowlist: ${col}`);
      }
      updates.push(`${col} = $${i++}`);
      params.push(val);
    };

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
    serverError(res, err);
  }
});

// GET /api/profile/privacy — what this person has chosen to share, and which
// of those choices the organisation is currently offering.
//
// Both halves are returned together on purpose: a preference the org has not
// enabled is stored but inert, and a screen that showed the switch without
// saying so would be making the same promise the settings badges exist to
// avoid.
router.get('/privacy', async (req, res) => {
  try {
    const r = await pool.query(`SELECT privacy_prefs AS prefs FROM employees WHERE id = $1`, [req.user._id]);
    const policy = await orgPolicy();
    res.json({
      success: true,
      data: {
        prefs: r.rows[0]?.prefs || { birthday: true, workAnniversary: true, mobileNumber: true },
        offered: {
          birthday: !!policy?.personalInformation?.birthday,
          workAnniversary: !!policy?.personalInformation?.workAnniversary,
          mobileNumber: !!policy?.personalInformation?.mobileNumber,
        },
      },
    });
  } catch (err) { serverError(res, err); }
});

// PATCH /api/profile/privacy — the employee's own call, and only ever their own:
// the row is addressed by req.user._id, never by anything the caller sends.
router.patch('/privacy', async (req, res) => {
  try {
    const b = req.body || {};
    const cur = (await pool.query(`SELECT privacy_prefs AS prefs FROM employees WHERE id = $1`, [req.user._id]))
      .rows[0]?.prefs || {};
    const next = { ...cur };
    for (const k of ['birthday', 'workAnniversary', 'mobileNumber']) {
      if (b[k] !== undefined) next[k] = !!b[k];
    }
    const r = await pool.query(
      `UPDATE employees SET privacy_prefs = $1::jsonb, updated_at = NOW() WHERE id = $2
       RETURNING privacy_prefs AS prefs`,
      [JSON.stringify(next), req.user._id]
    );
    res.json({ success: true, data: r.rows[0].prefs });
  } catch (err) { serverError(res, err); }
});

// POST /api/profile/photo — upload (or replace) the caller's profile picture.
// handleMulterError sits between multer and the route body so size/type
// errors return a clean 413/400 instead of falling through to a 500.
router.post('/photo', (req, res, next) => {
  photoUpload.single('photo')(req, res, (err) => {
    if (err) return handleMulterError(err, req, res, next);
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No image attached' });

    // "Profile picture update" on Organization > Policy. Unset means
    // unrestricted, which is what this route did before the setting existed —
    // an admin who never opened that screen must not find uploads switched off.
    const policy = await orgPolicy();
    if (!mayUpdatePhoto(policy, { isSelf: true, isAdmin: isFullAccess(req.user.role) })) {
      return res.status(403).json({
        success: false,
        message: 'Your organisation does not allow employees to change their own profile picture.',
      });
    }

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
    serverError(res, err);
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
    serverError(res, err);
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
    // This is the endpoint the frontend actually calls for password changes
    // (auth.js has a near-identical /change-password that isn't wired to any
    // UI). It was missing the session-revocation step auth.js's copy has —
    // meaning a password change here didn't invalidate any existing access
    // or refresh tokens, so a stolen token/session stayed valid indefinitely
    // even after the user "secured" their account by changing the password.
    await pool.query('UPDATE employees SET password = $1, updated_at = NOW(), tokens_revoked_at = NOW() WHERE id = $2', [hashed, req.user._id]);
    await pool.query('DELETE FROM refresh_tokens WHERE employee_id = $1', [req.user._id]);
    res.json({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    serverError(res, err);
  }
});

module.exports = router;
