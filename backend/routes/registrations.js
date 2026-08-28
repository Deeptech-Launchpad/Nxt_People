const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const multer = require('multer');
const nodemailer = require('nodemailer');
const fs = require('fs');
const logger = require('../logger');
const path = require('path');
const { protect, authorize } = require('../middleware/auth');
const { nextIdForCompany } = require('../utils/employeeId');
const { serverError } = require('../utils/serverError');

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

// Allowed extensions for ANY upload through this endpoint. Documents are
// almost always images or PDFs; anything else hits the fileFilter rejection.
const ALLOWED_DOC_EXTS = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp']);

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir)
  },
  filename: function (req, file, cb) {
    // crypto.randomBytes(16) → 32 hex chars. Replaces Date.now()+Math.random()
    // which collided whenever two concurrent uploads landed in the same
    // millisecond AND Math.random() picked the same int (rare but a
    // documented production incident class). Also lock the saved extension
    // to ALLOWED_DOC_EXTS so a double-extension trick can never write
    // anything else to disk.
    const rawExt = path.extname(file.originalname).toLowerCase();
    const ext = ALLOWED_DOC_EXTS.has(rawExt) ? rawExt : '.bin';
    cb(null, crypto.randomBytes(16).toString('hex') + ext);
  }
});
// 5 MB per file, plus an explicit field whitelist so a malicious client
// can't post 10,000 files under unknown field names. Field names map to
// the FIELD_TO_TYPE table below; keep the two in sync.
const UPLOAD_FIELDS = [
  { name: 'aadhaarCard',        maxCount: 1 },
  { name: 'panCard',            maxCount: 1 },
  { name: 'tenthCertificate',   maxCount: 2 }, // marksheet + certificate
  { name: 'twelfthCertificate', maxCount: 2 },
  { name: 'ugCertificate',      maxCount: 4 }, // each year + degree
  { name: 'pgCertificate',      maxCount: 4 },
  { name: 'experienceLetters',  maxCount: 5 }, // multiple prior employers
  { name: 'resume',             maxCount: 1 },
  { name: 'passportPhoto',      maxCount: 1 },
  { name: 'addressProof',       maxCount: 2 },
  { name: 'offerLetter',        maxCount: 1 },
];
const upload = multer({
  storage,
  limits: {
    fileSize:  5 * 1024 * 1024,   // 5 MB per file
    files:     30,                 // hard upper bound across all fields
  },
  fileFilter: (req, file, cb) => {
    // First-line defence — reject before write. The filename() callback
    // forces a safe extension as belt-and-braces, but this lets us return
    // a clear error to the client instead of silently saving a .bin.
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_DOC_EXTS.has(ext)) {
      return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', `Unsupported file type: ${ext || 'unknown'}`));
    }
    cb(null, true);
  },
});

// ---------------------------------------------------------------------------
// PUBLIC ROUTES
// ---------------------------------------------------------------------------

router.get('/validate-token/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const result = await pool.query(
      'SELECT email, expires_at, used FROM onboarding_tokens WHERE token = $1',
      [tokenHash]
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
    serverError(res, err);
  }
});

function handleOnboardingUploadError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ success: false, message: 'One of the attached files is over 5 MB. Please pick a smaller file.' });
    }
    return res.status(400).json({ success: false, message: err.message });
  }
  return next(err);
}

/* An HTML form sends an untouched field as "", never as null.
 *
 * Most columns here are text and take that happily. Two do not: date_of_birth
 * is a DATE and year_of_passing is an INT, and postgres answers "" with
 * `invalid input syntax` — which this route turned into "An internal server
 * error occurred". A candidate who left one date blank filled in the entire
 * form and was told nothing, three times over.
 *
 * Blank means "not given", and not given is null. */
const blankToNull = (v) => {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
};

/** A date the column will accept, or null. Never the empty string. */
const dateOrNull = (v) => {
  const t = blankToNull(v);
  if (!t) return null;
  // Anything postgres cannot read as a date is treated as not given rather
  // than thrown, because a malformed date is not worth losing a whole
  // submission over.
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null;
};

/** A year the INT column will accept, or null. */
const yearOrNull = (v) => {
  const t = blankToNull(v);
  if (!t) return null;
  // "2020-2024" is a range somebody typed into a year box; take the end of it.
  const m = t.match(/(\d{4})\s*$/) || t.match(/(\d{4})/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
};

router.post('/submit/:token', (req, res, next) => {
  upload.fields(UPLOAD_FIELDS)(req, res, (err) => {
    if (err) return handleOnboardingUploadError(err, req, res, next);
    next();
  });
}, async (req, res) => {
  // Use a dedicated client for the whole transaction. The previous code
  // used pool.query('BEGIN') which can land BEGIN/COMMIT/ROLLBACK on
  // different physical connections under pool churn — silently breaking
  // atomicity. Single-client guarantees all statements share one txn.
  const client = await pool.connect();
  try {
    const { token } = req.params;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    await client.query('BEGIN');
    // FOR UPDATE serialises concurrent submissions from the same invite link
    const tokenRes = await client.query(
      'SELECT id, email, expires_at, used FROM onboarding_tokens WHERE token = $1 FOR UPDATE',
      [tokenHash]
    );

    if (tokenRes.rows.length === 0)              { await client.query('ROLLBACK'); return res.status(400).json({ success: false, message: 'Invalid token.' }); }
    if (tokenRes.rows[0].used)                   { await client.query('ROLLBACK'); return res.status(410).json({ success: false, message: 'Link already used.' }); }
    if (new Date() > new Date(tokenRes.rows[0].expires_at)) {
      await client.query('ROLLBACK'); return res.status(410).json({ success: false, message: 'Link expired.' });
    }

    const {
      firstName, lastName, gender, dateOfBirth, maritalStatus,
      bloodGroup, personalEmail, mobile, alternateMobile,
      currentAddress, permanentAddress, city, state, country, pinCode,
      aadhaarNumber, panNumber, passportNumber, drivingLicense, voterId, uanNumber,
      emergencyContactName, emergencyContactRelationship,
      emergencyContactNumber, emergencyContactAlternate,
      education // JSON string
    } = req.body;

    /* Everything that can be refused is refused BEFORE anything is written.
     *
     * These checks used to sit after the INSERT, so a candidate whose address
     * was already on an employee row hit the UNIQUE constraint first and got
     * "An internal server error occurred" — for a situation the form could have
     * explained in a sentence. They had filled in the whole form by then. */
    if (!personalEmail || !String(personalEmail).trim()) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Your email address is required — it has to be the address this invitation was sent to.',
      });
    }
    if (personalEmail.trim().toLowerCase() !== String(tokenRes.rows[0].email).trim().toLowerCase()) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `This invitation was sent to ${tokenRes.rows[0].email}. Please use that address, or ask HR to send a new invitation to the one you want to use.`,
      });
    }
    // employees.email is UNIQUE, so this would otherwise fail as a constraint
    // violation and read as the server breaking.
    const taken = await client.query(
      'SELECT 1 FROM employees WHERE LOWER(email) = LOWER($1) LIMIT 1', [personalEmail.trim()]);
    if (taken.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'Somebody is already registered with this email address. If you have already submitted this form, there is nothing more to do — HR will be in touch. Otherwise please tell HR.',
      });
    }

    // Normalize PAN before storing — otherwise the same value gets stored
    // inconsistently ("abcde1234f", "ABCDE 1234F", ...) depending on how the
    // candidate typed it.
    const panNormalized = panNumber ? panNumber.trim().toUpperCase().replace(/\s+/g, '') : panNumber;

    // Insert into employees table
    const empInsert = await client.query(`
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
        'pending', false, 'team_member'
      ) RETURNING id
    `, [
      blankToNull(firstName), blankToNull(lastName), personalEmail.trim(), blankToNull(mobile),
      blankToNull(gender), dateOrNull(dateOfBirth), blankToNull(maritalStatus), blankToNull(bloodGroup),
      blankToNull(alternateMobile), blankToNull(currentAddress), blankToNull(permanentAddress),
      blankToNull(city), blankToNull(state), blankToNull(country), blankToNull(pinCode),
      blankToNull(aadhaarNumber), blankToNull(panNormalized), blankToNull(passportNumber),
      blankToNull(drivingLicense), blankToNull(voterId), blankToNull(uanNumber),
      blankToNull(emergencyContactName), blankToNull(emergencyContactRelationship),
      blankToNull(emergencyContactNumber), blankToNull(emergencyContactAlternate)
    ]);

    const employeeId = empInsert.rows[0].id;

    // Insert education records.
    if (education) {
      let eduArray;
      try { eduArray = JSON.parse(education); } catch {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'Invalid education data format.' });
      }
      for (let ed of eduArray) {
        // A row the candidate started and abandoned carries nothing worth
        // storing, and storing it makes the record look filled in when it is not.
        const hasAnything = [ed.highestQualification, ed.degree, ed.course,
          ed.universityOrInstitution, ed.yearOfPassing, ed.percentageOrCgpa, ed.certifications]
          .some(v => blankToNull(v) !== null);
        if (!hasAnything) continue;
        await client.query(`
          INSERT INTO employee_education (
            employee_id, highest_qualification, degree, course,
            university_or_institution, year_of_passing, percentage_or_cgpa, certifications
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
          employeeId, blankToNull(ed.highestQualification), blankToNull(ed.degree),
          blankToNull(ed.course), blankToNull(ed.universityOrInstitution),
          yearOrNull(ed.yearOfPassing), blankToNull(ed.percentageOrCgpa),
          blankToNull(ed.certifications)
        ]);
      }
    }

    // Map raw form fieldname → canonical document type so the same row
    // is visible to BOTH the admin employees view (reads legacy
    // `document_type`) AND the self-service /documents page (reads `type`).
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

    // upload.fields() puts files in req.files keyed by fieldname.
    // Flatten back to a list and insert each.
    const filesFlat = Object.values(req.files || {}).flat();
    for (const file of filesFlat) {
      const fileUrl = `/uploads/${file.filename}`;
      const docType = FIELD_TO_TYPE[file.fieldname] || 'other';
      await client.query(`
        INSERT INTO employee_documents (
          employee_id,
          document_type, file_path, original_name, mime_type, size,
          name, type, file_url, file_size, uploaded_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $4, $7, $8, $6, $1)
      `, [
        employeeId,
        file.fieldname,
        fileUrl,
        file.originalname,
        file.mimetype,
        file.size,
        docType,
        fileUrl,
      ]);
    }

    // Mark token as used
    await client.query('UPDATE onboarding_tokens SET used = true WHERE id = $1', [tokenRes.rows[0].id]);

    await client.query('COMMIT');

    res.json({ success: true, message: 'Submitted successfully. HR will review and contact you.' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    /* A candidate who has just filled in a long form deserves better than a
     * blank refusal, and so does whoever has to work out why. This route said
     * "An internal server error occurred" and logged nothing, so the one thing
     * that knew what was wrong kept it to itself. */
    logger.error({ err: err?.message, code: err?.code, constraint: err?.constraint, stack: err?.stack },
      'onboarding submission failed');

    // A unique violation here is a real situation with a real explanation, not
    // a server fault. 23505 is postgres for "that already exists".
    if (err?.code === '23505') {
      return res.status(409).json({
        success: false,
        message: 'Some of these details are already registered against another person — most often the email address. Please check with HR.',
      });
    }
    // 22P02 is a value postgres could not read for the column's type — an
    // empty date, a year that is not a number. The coercions above should mean
    // this never fires; if it does, the field is worth naming.
    if (err?.code === '22P02') {
      return res.status(400).json({
        success: false,
        message: 'One of the dates or numbers could not be read. Please check your date of birth and your year of passing, then try again.',
      });
    }
    // 23502 is a NOT NULL violation: a required field arrived empty.
    if (err?.code === '23502') {
      return res.status(400).json({
        success: false,
        message: 'A required field was left empty. Please check the form and try again.',
      });
    }
    res.status(500).json({ success: false, message: 'Something went wrong saving your details. Please tell HR — they can see what happened.' });
  } finally {
    client.release();
  }
});


// ---------------------------------------------------------------------------
// PROTECTED ROUTES (Super Admin / HR — onboarding creates employees, so it is
// full-access only; managers have no employee CRUD)
// ---------------------------------------------------------------------------
router.use(protect, authorize('admin', 'director', 'hr_admin'));

router.post('/generate-link', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email is required' });

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days from now

    await pool.query(
      'INSERT INTO onboarding_tokens (token, email, created_by, expires_at) VALUES ($1, $2, $3, $4)',
      [tokenHash, email, req.user._id, expiresAt]
    );

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
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
        logger.warn('SMTP credentials not found in environment. Email not sent, returning link only.');
      }
    } catch (mailErr) {
      logger.error({ err: mailErr?.message }, 'Failed to send registration email');
      return res.status(500).json({ success: false, message: 'Failed to send preboard email. Check SMTP settings.' });
    }

    res.json({ success: true, link, message: 'Link generated and emailed to candidate.' });
  } catch (err) {
    serverError(res, err);
  }
});

// POST /generate-links-bulk — { emails: string[] } → one onboarding invite per
// address. Each send is isolated: one recipient's SMTP failure is logged and
// the batch continues, instead of one bad address aborting everyone after it.
router.post('/generate-links-bulk', async (req, res) => {
  const { emails } = req.body;
  if (!Array.isArray(emails) || emails.length === 0) {
    return res.status(400).json({ success: false, message: 'emails must be a non-empty array' });
  }

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const companyName = process.env.COMPANY_NAME || 'AltiusNxt';
  const results = [];

  for (const email of emails) {
    if (!email || typeof email !== 'string') {
      results.push({ email, success: false, message: 'Invalid email' });
      continue;
    }
    try {
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      await pool.query(
        'INSERT INTO onboarding_tokens (token, email, created_by, expires_at) VALUES ($1, $2, $3, $4)',
        [tokenHash, email, req.user._id, expiresAt]
      );

      const link = `${frontendUrl}/onboarding/${token}`;

      if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
        await transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: email,
          subject: `Welcome to ${companyName} - Onboarding Preboard Link`,
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
        });
      } else {
        logger.warn('SMTP credentials not found in environment. Email not sent, returning link only.');
      }

      results.push({ email, success: true, link });
    } catch (err) {
      logger.error({ err: err?.message, email }, 'Failed to send bulk onboarding email');
      results.push({ email, success: false, message: 'Failed to send onboarding email' });
    }
  }

  res.json({ success: true, data: results });
});

router.get('/:id/full', async (req, res) => {
  try {
    const { id } = req.params;
    const empRes = await pool.query('SELECT * FROM employees WHERE id = $1', [id]);
    if (empRes.rows.length === 0) return res.status(404).json({ success: false, message: 'Candidate not found' });

    const eduRes = await pool.query('SELECT * FROM employee_education WHERE employee_id = $1 ORDER BY year_of_passing DESC', [id]);
    const docRes = await pool.query('SELECT * FROM employee_documents WHERE employee_id = $1', [id]);

    const { password, mfa_secret, mfa_backup_codes, reset_password_token, reset_password_expires, ...safeRow } = empRes.rows[0];
    const candidate = safeRow;
    candidate.education = eduRes.rows;
    candidate.documents = docRes.rows.map(d => ({
      documentType: d.document_type,
      originalName: d.original_name,
      filePath: d.file_path,
      uploadDate: d.upload_date
    }));

    res.json({ success: true, data: candidate });
  } catch (err) {
    serverError(res, err);
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
    serverError(res, err);
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
  } catch (err) { serverError(res, err); }
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
  } catch (err) { serverError(res, err); }
});

router.put('/:id/approve', async (req, res) => {
  const client = await pool.connect();
  try {
    const { role = 'team_member', password, department } = req.body;

    await client.query('BEGIN');
    const empRes = await client.query('SELECT registration_status FROM employees WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (empRes.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Registration not found' }); }
    if (empRes.rows[0].registration_status !== 'pending') { await client.query('ROLLBACK'); return res.status(400).json({ success: false, message: 'Only pending registrations can be approved' }); }

    let updates = [`registration_status = 'approved'`, `approved_by = $1`, `approved_at = NOW()`, `role = $2`];
    let params = [req.user._id, role];
    let idx = 3;

    if (department) { updates.push(`department = $${idx++}`); params.push(department); }
    if (password) {
      const hashed = await bcrypt.hash(password, 12);
      updates.push(`password = $${idx++}`); params.push(hashed);
    }
    params.push(req.params.id);

    const setupToken = crypto.randomBytes(32).toString('hex');
    const setupTokenHash = crypto.createHash('sha256').update(setupToken).digest('hex');
    // 7-day window — longer than the 10-minute forgot-password reset token
    // since this is a one-time onboarding invite, not an active password
    // reset a user is sitting in front of their inbox for. Previously this
    // token never expired at all (reset_password_expires was never set),
    // so accept-terms had no time-based invalidation.
    const setupTokenExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    updates.push(`reset_password_token = $${idx++}`, `reset_password_expires = $${idx++}`);
    params.push(setupTokenHash, setupTokenExpires);

    const up = await client.query(`
      UPDATE employees SET ${updates.join(', ')} WHERE id = $${idx}
      RETURNING id as "_id", first_name as "firstName", last_name as "lastName", email, role, department, registration_status as "registrationStatus"
    `, params);

    await client.query('COMMIT');

    const emp = up.rows[0];
    const esc = (s) => s ? String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : '';
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const companyName = process.env.COMPANY_NAME || 'NxtPeople';
    try {
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: emp.email,
        subject: `Your account has been approved — ${companyName}`,
        html: `<p>Hi ${esc(emp.firstName)},</p><p>Your registration has been approved. Click the link below to complete your account setup:</p><p><a href="${frontendUrl}/login?email=${encodeURIComponent(emp.email)}&setupToken=${setupToken}">Complete Setup</a></p><p>This link expires in 7 days. If you did not register, please ignore this email.</p>`
      });
    } catch (mailErr) {
      logger.error({ err: mailErr?.message }, 'Failed to send approval email');
    }

    res.json({ success: true, message: `${emp.firstName} ${emp.lastName} approved successfully.`, data: emp });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  } finally {
    client.release();
  }
});

router.put('/:id/reject', async (req, res) => {
  try {
    const { reason } = req.body;
    const empRes = await pool.query('SELECT registration_status, email FROM employees WHERE id = $1', [req.params.id]);
    if (empRes.rows.length === 0) return res.status(404).json({ success: false, message: 'Registration not found' });
    if (empRes.rows[0].registration_status !== 'pending') return res.status(400).json({ success: false, message: 'Only pending registrations can be rejected' });

    // Free the email so the candidate can submit a fresh application later —
    // employees.email is UNIQUE, so leaving it as-is would permanently block
    // any future registration or onboarding-link attempt with that address.
    // The original address stays embedded in the mangled value for HR reference.
    const mangledEmail = `rejected-${req.params.id}+${empRes.rows[0].email}`;

    const up = await pool.query(`
      UPDATE employees SET registration_status = 'rejected', rejection_reason = $1, approved_by = $2, approved_at = NOW(), email = $3 WHERE id = $4
      RETURNING id as "_id", first_name as "firstName", last_name as "lastName", email, registration_status as "registrationStatus"
    `, [reason || 'Not specified', req.user._id, mangledEmail, req.params.id]);

    res.json({ success: true, message: 'Registration rejected.', data: up.rows[0] });
  } catch (err) { serverError(res, err); }
});

module.exports = router;
