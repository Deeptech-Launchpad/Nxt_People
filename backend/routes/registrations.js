const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const multer = require('multer');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const { protect, authorize } = require('../middleware/auth');
const { nextIdForCompany } = require('../utils/employeeId');

// Nodemailer setup
const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE || 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Multer setup for uploads
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir)
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, uniqueSuffix + path.extname(file.originalname))
  }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB max

// ---------------------------------------------------------------------------
// PUBLIC ROUTES
// ---------------------------------------------------------------------------

router.get('/validate-token/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const result = await pool.query(
      'SELECT email, expires_at, used FROM onboarding_tokens WHERE token = $1',
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid token.' });
    }

    const tk = result.rows[0];
    if (tk.used) {
      return res.status(410).json({ success: false, message: 'This link has already been used.' });
    }
    if (new Date() > new Date(tk.expires_at)) {
      return res.status(410).json({ success: false, message: 'This link has expired.' });
    }

    res.json({ success: true, email: tk.email });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/submit/:token', upload.any(), async (req, res) => {
  try {
    const { token } = req.params;
    
    // Validate token again
    const tokenRes = await pool.query(
      'SELECT id, email, expires_at, used FROM onboarding_tokens WHERE token = $1',
      [token]
    );

    if (tokenRes.rows.length === 0) return res.status(400).json({ success: false, message: 'Invalid token.' });
    if (tokenRes.rows[0].used) return res.status(410).json({ success: false, message: 'Link already used.' });
    if (new Date() > new Date(tokenRes.rows[0].expires_at)) return res.status(410).json({ success: false, message: 'Link expired.' });

    const {
      firstName, lastName, gender, dateOfBirth, maritalStatus,
      bloodGroup, personalEmail, mobile, alternateMobile,
      currentAddress, permanentAddress, city, state, country, pinCode,
      aadhaarNumber, panNumber, passportNumber, drivingLicense, voterId, uanNumber,
      emergencyContactName, emergencyContactRelationship,
      emergencyContactNumber, emergencyContactAlternate,
      education // JSON string
    } = req.body;

    // Start transaction
    await pool.query('BEGIN');

    // Insert into employees table
    const empInsert = await pool.query(`
      INSERT INTO employees (
        first_name, last_name, email, phone, gender, date_of_birth, marital_status, blood_group,
        alternate_mobile, current_address, permanent_address, city, state, country, pin_code,
        aadhaar_number, pan_number, passport_number, driving_license, voter_id, uan_number,
        emergency_contact_name, emergency_contact_relationship, emergency_contact_number, emergency_contact_alternate,
        registration_status, has_accepted, role
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20, $21,
        $22, $23, $24, $25,
        'pending', false, 'employee'
      ) RETURNING id
    `, [
      firstName, lastName, personalEmail, mobile, gender, dateOfBirth, maritalStatus, bloodGroup,
      alternateMobile, currentAddress, permanentAddress, city, state, country, pinCode,
      aadhaarNumber, panNumber, passportNumber, drivingLicense, voterId, uanNumber,
      emergencyContactName, emergencyContactRelationship, emergencyContactNumber, emergencyContactAlternate
    ]);

    const employeeId = empInsert.rows[0].id;

    // Insert education records. `degree` (e.g. B.Tech) and `course`
    // (e.g. AI & Data Science) were both being silently dropped before —
    // schema and SQL now include them.
    if (education) {
      const eduArray = JSON.parse(education);
      for (let ed of eduArray) {
        await pool.query(`
          INSERT INTO employee_education (
            employee_id, highest_qualification, degree, course,
            university_or_institution, year_of_passing, percentage_or_cgpa, certifications
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
          employeeId, ed.highestQualification, ed.degree || null, ed.course || null,
          ed.universityOrInstitution, ed.yearOfPassing, ed.percentageOrCgpa, ed.certifications
        ]);
      }
    }

    // Process files. Write to BOTH the legacy columns (document_type / file_path /
    // original_name / mime_type / size) AND the modern columns (name / type /
    // file_url / file_size / uploaded_by / created_at) so the same row is visible
    // to the admin Employees view (reads legacy) AND the self-service /documents
    // page (reads modern). Without this, candidates' onboarding uploads only
    // appeared in the admin view.
    //
    // The onboarding form posts files under fieldnames like "aadhaarCard",
    // "tenthCertificate", etc. The self-service page groups by a canonical
    // type taxonomy (id_proof / educational / experience / ...), so we map
    // the raw fieldname → canonical type for the `type` column. The legacy
    // `document_type` column keeps the raw fieldname so existing admin views
    // (which display "aadhaarCard" verbatim) don't change.
    const FIELD_TO_TYPE = {
      aadhaarCard:        'id_proof',
      panCard:            'id_proof',
      tenthCertificate:   'educational',
      twelfthCertificate: 'educational',
      ugCertificate:      'educational',
      pgCertificate:      'educational',
      experienceLetters:  'experience',
      resume:             'resume',
      passportPhoto:      'photo',
      addressProof:       'address_proof',
      offerLetter:        'offer_letter',
    };
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const fileUrl  = `/uploads/${file.filename}`;
        const docType  = FIELD_TO_TYPE[file.fieldname] || 'other';
        await pool.query(`
          INSERT INTO employee_documents (
            employee_id,
            document_type, file_path, original_name, mime_type, size,
            name, type, file_url, file_size, uploaded_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $4, $7, $8, $6, $1)
        `, [
          employeeId,
          file.fieldname,            // $2 → document_type (legacy, raw form fieldname)
          fileUrl,                   // $3 → file_path (full /uploads/... URL)
          file.originalname,         // $4 → original_name AND name
          file.mimetype,             // $5 → mime_type
          file.size,                 // $6 → size AND file_size
          docType,                   // $7 → type (canonical taxonomy)
          fileUrl,                   // $8 → file_url
        ]);
      }
    }

    // Mark token as used
    await pool.query('UPDATE onboarding_tokens SET used = true WHERE id = $1', [tokenRes.rows[0].id]);

    await pool.query('COMMIT');

    res.json({ success: true, message: 'Submitted successfully. HR will review and contact you.' });
  } catch (err) {
    await pool.query('ROLLBACK');
    res.status(500).json({ success: false, message: err.message });
  }
});


// ---------------------------------------------------------------------------
// PROTECTED ROUTES (Admin/HR)
// ---------------------------------------------------------------------------
router.use(protect, authorize('admin', 'manager'));

router.post('/generate-link', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email is required' });

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days from now

    await pool.query(
      'INSERT INTO onboarding_tokens (token, email, created_by, expires_at) VALUES ($1, $2, $3, $4)',
      [token, email, req.user._id, expiresAt]
    );

    // Get the frontend origin from request headers or environment
    const frontendUrl = req.headers.origin || process.env.FRONTEND_URL || 'http://localhost:5173';
    const link = `${frontendUrl}/onboarding/${token}`;

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: `Welcome to ${process.env.COMPANY_NAME || 'AltiusNxt'} - Onboarding Preboard Link`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 10px;">
          <h2 style="color: #0f172a; margin-bottom: 20px;">Welcome!</h2>
          <p style="color: #475569; line-height: 1.5;">Please click the link below to complete your onboarding details. This is required for your preboarding process.</p>
          <div style="margin: 30px 0;">
            <a href="${link}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Complete Onboarding</a>
          </div>
          <p style="color: #64748b; font-size: 14px;">Or copy and paste this link into your browser:</p>
          <p style="color: #2563eb; word-break: break-all; font-size: 14px;">${link}</p>
          <p style="color: #ef4444; font-size: 13px; margin-top: 30px;">This link is valid for 7 days and is single-use.</p>
        </div>
      `
    };

    try {
      if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
        await transporter.sendMail(mailOptions);
      } else {
        console.warn('SMTP credentials not found in environment. Email not sent, returning link only.');
      }
    } catch (mailErr) {
      console.error('Failed to send email:', mailErr);
      return res.status(500).json({ success: false, message: 'Failed to send preboard email. Check SMTP settings.' });
    }

    res.json({ success: true, link, message: 'Link generated and emailed to candidate.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/:id/full', async (req, res) => {
  try {
    const { id } = req.params;
    const empRes = await pool.query('SELECT * FROM employees WHERE id = $1', [id]);
    if (empRes.rows.length === 0) return res.status(404).json({ success: false, message: 'Candidate not found' });

    const eduRes = await pool.query('SELECT * FROM employee_education WHERE employee_id = $1 ORDER BY year_of_passing DESC', [id]);
    const docRes = await pool.query('SELECT * FROM employee_documents WHERE employee_id = $1', [id]);
    
    const candidate = empRes.rows[0];
    candidate.education = eduRes.rows;
    candidate.documents = docRes.rows.map(d => ({
      documentType: d.document_type,
      originalName: d.original_name,
      filePath: d.file_path,
      uploadDate: d.upload_date
    }));

    res.json({ success: true, data: candidate });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/:id/confirm', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      dateOfJoining, companyName, division, employeeType,
      workingMode, designation, department, officialEmail, allowAccess,
      password, reportingManagerId, employeeId
    } = req.body;

    const empRes = await pool.query('SELECT registration_status, employee_id FROM employees WHERE id = $1', [id]);
    if (empRes.rows.length === 0) return res.status(404).json({ success: false, message: 'Candidate not found' });
    if (empRes.rows[0].registration_status !== 'pending') return res.status(400).json({ success: false, message: 'Only pending registrations can be confirmed' });

    // Resolve final employee_id. Priority:
    //   1. Admin-typed value from the form (if any)
    //   2. Existing employee_id on the row (if Zoho or earlier set it)
    //   3. Next per-company sequence (e.g. ANXT2600150 for AltiusNxt joining
    //      in 2026, dtlp-015 for DTLP). Format rules: utils/employeeId.js.
    let assignedEmployeeId = (employeeId || '').trim() || empRes.rows[0].employee_id;
    if (!assignedEmployeeId) {
      assignedEmployeeId = await nextIdForCompany(pool, companyName);
    }

    // Uniqueness guard if admin typed a custom ID. The unique index on the
    // column would catch it anyway, but a clean error message is friendlier.
    if (employeeId && assignedEmployeeId !== empRes.rows[0].employee_id) {
      const clash = await pool.query('SELECT id FROM employees WHERE employee_id = $1 AND id <> $2', [assignedEmployeeId, id]);
      if (clash.rows.length > 0) {
        return res.status(400).json({ success: false, message: `Employee ID "${assignedEmployeeId}" is already in use` });
      }
    }

    let passUpdate = '';
    let passValue = null;
    // date_of_joining is a DATE column — postgres rejects "" with
    // "invalid input syntax for type date: ''". Coerce blanks to NULL
    // here (mirrors the same fix in /api/employees POST/PUT).
    let queryParams = [
      dateOfJoining || null, companyName, division, employeeType,
      workingMode, designation, department, officialEmail, allowAccess,
      req.user._id, assignedEmployeeId, id
    ];

    let queryIdx = 13;

    if (password) {
      passValue = await bcrypt.hash(password, 12);
      passUpdate = `password = $${queryIdx},`;
      queryParams.push(passValue);
      queryIdx++;
    }

    let managerUpdate = '';
    if (reportingManagerId) {
      managerUpdate = `reporting_manager_id = $${queryIdx},`;
      queryParams.push(reportingManagerId);
      queryIdx++;
    }

    await pool.query(`
      UPDATE employees SET
        date_of_joining = $1,
        company = $2,
        division = $3,
        employee_type = $4,
        working_mode = $5,
        designation = $6,
        department = $7,
        official_email = $8,
        allow_access = $9,
        ${passUpdate}
        ${managerUpdate}
        registration_status = 'active',
        has_accepted = true,
        approved_by = $10,
        employee_id = $11,
        approved_at = NOW()
      WHERE id = $12
    `, queryParams);

    res.json({ success: true, message: 'Employee confirmed successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const { status = 'pending', page = 1, limit = 20 } = req.query;
    let query = 'WHERE 1=1';
    let params = [];
    let idx = 1;

    if (status !== 'all') { query += ` AND e.registration_status = $${idx++}`; params.push(status); }

    const limitNum = Number(limit);
    const offsetNum = (Number(page) - 1) * limitNum;

    const countRes = await pool.query(`SELECT COUNT(*) FROM employees e ${query}`, params);
    const total = parseInt(countRes.rows[0].count, 10);

    const result = await pool.query(`
      SELECT e.id as "_id", e.first_name as "firstName", e.last_name as "lastName", e.email, e.phone, e.designation, e.division, e.company, e.employee_id as "employeeId", e.registration_status as "registrationStatus", e.created_at as "createdAt", e.rejection_reason as "rejectionReason",
      json_build_object('_id', a.id, 'firstName', a.first_name, 'lastName', a.last_name, 'email', a.email) as "approvedBy"
      FROM employees e
      LEFT JOIN employees a ON e.approved_by = a.id
      ${query}
      ORDER BY e.created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `, [...params, limitNum, offsetNum]);

    res.json({ success: true, data: result.rows, total, page: Number(page) });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/counts', async (req, res) => {
  try {
    const countsRes = await pool.query(`
      SELECT registration_status, COUNT(*) 
      FROM employees 
      WHERE registration_status IN ('pending', 'approved', 'rejected', 'active') 
      GROUP BY registration_status
    `);
    
    let counts = { pending: 0, approved: 0, rejected: 0, active: 0 };
    countsRes.rows.forEach(r => { counts[r.registration_status] = parseInt(r.count, 10); });
    
    res.json({ success: true, data: counts });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.put('/:id/approve', async (req, res) => {
  try {
    const { role = 'employee', password, department } = req.body;
    const empRes = await pool.query('SELECT registration_status FROM employees WHERE id = $1', [req.params.id]);
    if (empRes.rows.length === 0) return res.status(404).json({ success: false, message: 'Registration not found' });
    if (empRes.rows[0].registration_status !== 'pending') return res.status(400).json({ success: false, message: 'Only pending registrations can be approved' });

    let updates = [`registration_status = 'approved'`, `approved_by = $1`, `approved_at = NOW()`, `role = $2`];
    let params = [req.user._id, role];
    let idx = 3;

    if (department) { updates.push(`department = $${idx++}`); params.push(department); }
    if (password) {
      const hashed = await bcrypt.hash(password, 12);
      updates.push(`password = $${idx++}`); params.push(hashed);
    }
    params.push(req.params.id);

    const up = await pool.query(`
      UPDATE employees SET ${updates.join(', ')} WHERE id = $${idx}
      RETURNING id as "_id", first_name as "firstName", last_name as "lastName", email, role, department, registration_status as "registrationStatus"
    `, params);

    res.json({ success: true, message: `${up.rows[0].firstName} ${up.rows[0].lastName} approved successfully.`, data: up.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.put('/:id/reject', async (req, res) => {
  try {
    const { reason } = req.body;
    const empRes = await pool.query('SELECT registration_status FROM employees WHERE id = $1', [req.params.id]);
    if (empRes.rows.length === 0) return res.status(404).json({ success: false, message: 'Registration not found' });
    if (empRes.rows[0].registration_status !== 'pending') return res.status(400).json({ success: false, message: 'Only pending registrations can be rejected' });

    const up = await pool.query(`
      UPDATE employees SET registration_status = 'rejected', rejection_reason = $1, approved_by = $2, approved_at = NOW() WHERE id = $3
      RETURNING id as "_id", first_name as "firstName", last_name as "lastName", email, registration_status as "registrationStatus"
    `, [reason || 'Not specified', req.user._id, req.params.id]);

    res.json({ success: true, message: 'Registration rejected.', data: up.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
