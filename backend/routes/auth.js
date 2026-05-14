const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const pool = require('../db');
const { protect } = require('../middleware/auth');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const { verifyMfaCode, issueMfaTicket, consumeMfaTicket } = require('./mfa');

// `ipKeyGenerator` normalises IPv6 addresses to their /64 prefix so an
// attacker can't rotate through addresses in their own subnet to bypass
// the limit. Required by express-rate-limit v8.
const ipPlusEmail = (req, res) =>
  `${ipKeyGenerator(req, res)}:${(req.body?.email || '').toLowerCase()}`;

// Rate limiters are bypassed in non-production so test suites and local dev
// can hammer the login endpoint without locking themselves out. In prod they
// still apply normally. Override with `RATE_LIMIT_DISABLED=true` if you ever
// need to disable them in prod (e.g. for an emergency mass-password-reset).
const skipRateLimit = () =>
  process.env.NODE_ENV !== 'production' || process.env.RATE_LIMIT_DISABLED === 'true';

// Per-IP+email brute-force protection on login (10 attempts / 15 min).
// Successful logins do not count toward the limit.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: ipPlusEmail,
  skip: skipRateLimit,
  message: { success: false, message: 'Too many login attempts. Try again in 15 minutes.' },
});

// Tight limiter for the password-reset surface (5 / 15 min per IP+email).
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipPlusEmail,
  skip: skipRateLimit,
  message: { success: false, message: 'Too many requests. Try again later.' },
});

// Limiter for /check-email. The endpoint differentiates account states
// (new / pending / approved / active) so the login UI can route correctly,
// which inherently leaks account existence. We can't collapse the response
// without breaking the UX, so we slow enumeration down: 20 lookups per
// 15-minute window per IP+email tuple. A scripted attacker rotating
// emails still hits the per-IP cap quickly.
const checkEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipPlusEmail,
  skip: skipRateLimit,
  message: { success: false, message: 'Too many requests. Try again later.' },
});

// Access token: short-lived (15 min by default)
const signToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, {
  expiresIn: process.env.JWT_ACCESS_EXPIRE || '15m',
});

// Refresh token: long-lived crypto random token stored as SHA-256 hash in DB
const generateRefreshToken = async (employeeId, req) => {
  const rawToken = crypto.randomBytes(64).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  await pool.query(
    `INSERT INTO refresh_tokens (employee_id, token_hash, expires_at, ip_address, user_agent)
     VALUES ($1,$2,$3,$4,$5)`,
    [
      employeeId,
      tokenHash,
      expiresAt,
      req.ip || null,
      req.get('user-agent')?.substring(0, 500) || null,
    ]
  );
  return rawToken;
};

// @POST /api/auth/check-email — drives the login UI's "what should I show
// for this email" branching. Leaks account state by design (the UI needs to
// know whether to show register / pending / accept-terms / login), so the
// limiter above slows enumeration. We deliberately do NOT return first_name
// any more — that was a real PII leak with no UX justification (the user
// types their email and the page greeted them by name before they proved
// identity).
router.post('/check-email', checkEmailLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email is required' });

    const result = await pool.query(
      'SELECT registration_status, has_accepted FROM employees WHERE email = $1',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.json({ success: true, status: 'new', message: 'No account found. Please register.' });
    }

    const employee = result.rows[0];
    return res.json({
      success: true,
      status: employee.registration_status,
      hasAccepted: employee.has_accepted,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @POST /api/auth/register
router.post('/register', [
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('firstName').notEmpty().withMessage('First name is required').trim(),
  body('lastName').notEmpty().withMessage('Last name is required').trim(),
  body('phone').notEmpty().withMessage('Phone is required').trim(),
  body('designation').notEmpty().withMessage('Designation is required').trim(),
  body('division').notEmpty().withMessage('Division is required').trim(),
  body('company').notEmpty().withMessage('Company is required').trim()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg, errors: errors.array() });
  }

  try {
    const { email, firstName, lastName, phone, designation, employeeId, division, company } = req.body;

    const existing = await pool.query('SELECT id FROM employees WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    }

    const result = await pool.query(
      `INSERT INTO employees (email, first_name, last_name, phone, designation, employee_id, division, company, registration_status, has_accepted)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', false) RETURNING email, first_name`,
      [email, firstName, lastName, phone, designation, employeeId?.trim() || null, division, company]
    );

    res.status(201).json({
      success: true,
      message: 'Registration submitted. Awaiting admin approval.',
      data: { email: result.rows[0].email, firstName: result.rows[0].first_name }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @POST /api/auth/accept-terms
router.post('/accept-terms', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email is required' });

    const result = await pool.query(
      'SELECT id, registration_status, employee_id FROM employees WHERE email = $1',
      [email.toLowerCase()]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Account not found' });

    const employee = result.rows[0];

    if (employee.registration_status !== 'approved') {
      return res.status(403).json({ success: false, message: 'Your account has not been approved yet.' });
    }

    let empId = employee.employee_id;
    if (!empId) {
      // Bug #8 fix: use MAX-based sequence to avoid collisions with employees.js
      const seqRes = await pool.query(
        "SELECT COALESCE(MAX(CAST(SUBSTRING(employee_id FROM 4) AS INTEGER)), 1000) + 1 AS next FROM employees WHERE employee_id ~ '^NXT[0-9]+$'"
      );
      empId = `NXT${String(seqRes.rows[0].next).padStart(4, '0')}`;
    }

    const updated = await pool.query(
      `UPDATE employees SET has_accepted = true, accepted_at = NOW(), registration_status = 'active', employee_id = $1 WHERE id = $2
       RETURNING id as "_id", first_name AS "firstName", last_name AS "lastName", email, role, department, designation, company, division, registration_status AS "registrationStatus", has_accepted AS "hasAccepted", employee_id AS "employeeId"`,
      [empId, employee.id]
    );

    const token = signToken(employee.id);
    const refreshToken = await generateRefreshToken(employee.id, req);

    res.json({
      success: true,
      message: 'Terms accepted. Welcome to Nxt People!',
      token,
      refreshToken,
      data: updated.rows[0]
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @POST /api/auth/login
router.post('/login', loginLimiter, [
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg, errors: errors.array() });
  }

  try {
    const { email, password } = req.body;

    const result = await pool.query(
      `SELECT id as "_id", password, registration_status, has_accepted, rejection_reason, mfa_enabled AS "mfaEnabled", first_name AS "firstName", last_name AS "lastName", email, role, department, designation, company, division, employee_id AS "employeeId", photo_url AS "photoUrl"
       FROM employees WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const employee = result.rows[0];

    // Verify password FIRST — never reveal account state to a caller who can't prove identity.
    if (!employee.password || !(await bcrypt.compare(password, employee.password))) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    if (employee.registration_status === 'pending') {
      return res.status(403).json({ success: false, message: 'Your account is pending approval.', status: 'pending' });
    }
    if (employee.registration_status === 'rejected') {
      return res.status(403).json({ success: false, message: 'Your registration was not approved.', status: 'rejected', reason: employee.rejection_reason });
    }
    if (employee.registration_status === 'approved' && !employee.has_accepted) {
      return res.status(403).json({ success: false, message: 'Please accept the terms to continue.', status: 'approved' });
    }

    // MFA gate: if the user has MFA enabled, don't hand out a session yet.
    // Issue a short-lived ticket; client must POST /api/auth/login-mfa with a TOTP
    // or backup code to exchange the ticket for real tokens.
    if (employee.mfaEnabled) {
      const mfaTicket = issueMfaTicket(employee._id);
      return res.json({ success: true, requiresMfa: true, mfaTicket });
    }

    const token = signToken(employee._id);
    const refreshToken = await generateRefreshToken(employee._id, req);
    delete employee.password;
    delete employee.registration_status;
    delete employee.has_accepted;
    delete employee.rejection_reason;
    delete employee.mfaEnabled;

    res.json({ success: true, token, refreshToken, data: employee });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @POST /api/auth/login-mfa — second step for users with MFA enabled.
// Body: { mfaTicket, code?, backupCode? }
router.post('/login-mfa', loginLimiter, async (req, res) => {
  try {
    const { mfaTicket, code, backupCode } = req.body;
    if (!mfaTicket) return res.status(400).json({ success: false, message: 'mfaTicket required' });
    if (!code && !backupCode) return res.status(400).json({ success: false, message: 'code or backupCode required' });

    const employeeId = consumeMfaTicket(mfaTicket);
    if (!employeeId) return res.status(401).json({ success: false, message: 'Ticket expired — log in again' });

    const verify = await verifyMfaCode({ employeeId, code, backupCode });
    if (!verify.ok) return res.status(401).json({ success: false, message: verify.reason || 'Invalid code' });

    const userRes = await pool.query(
      `SELECT id as "_id", first_name AS "firstName", last_name AS "lastName", email, role, department, designation, company, division, employee_id AS "employeeId", photo_url AS "photoUrl"
       FROM employees WHERE id = $1`,
      [employeeId]
    );
    const employee = userRes.rows[0];
    const token = signToken(employee._id);
    const refreshToken = await generateRefreshToken(employee._id, req);

    res.json({
      success: true,
      token, refreshToken,
      data: employee,
      ...(verify.usedBackupCode && { warning: `Backup code used — ${verify.remainingBackupCodes} left` }),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @GET /api/auth/me
router.get('/me', protect, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT e.id as "_id", e.first_name AS "firstName", e.last_name AS "lastName", e.email, e.role, e.department, e.designation, e.company, e.division, e.registration_status AS "registrationStatus", e.has_accepted AS "hasAccepted", e.employee_id AS "employeeId", e.photo_url AS "photoUrl",
       CASE WHEN s.id IS NOT NULL THEN json_build_object('id', s.id, 'name', s.name, 'start_time', s.start_time, 'end_time', s.end_time) ELSE null END as shift,
       CASE WHEN m.id IS NOT NULL THEN json_build_object('id', m.id, 'firstName', m.first_name, 'lastName', m.last_name, 'email', m.email) ELSE null END as manager
       FROM employees e
       LEFT JOIN shifts s ON e.shift_id = s.id
       LEFT JOIN employees m ON e.reporting_manager_id = m.id
       WHERE e.id = $1`,
      [req.user._id]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @PUT /api/auth/change-password
router.put('/change-password', protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
    }

    const result = await pool.query('SELECT password FROM employees WHERE id = $1', [req.user._id]);

    if (result.rows.length === 0 || !result.rows[0].password) {
      return res.status(401).json({ success: false, message: 'Invalid user state' });
    }

    if (!(await bcrypt.compare(currentPassword, result.rows[0].password))) {
      return res.status(401).json({ success: false, message: 'Current password incorrect' });
    }

    const hashed = await bcrypt.hash(newPassword, 12);
    await pool.query('UPDATE employees SET password = $1 WHERE id = $2', [hashed, req.user._id]);

    res.json({ success: true, message: 'Password updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @POST /api/auth/forgot-password
router.post('/forgot-password', forgotPasswordLimiter, async (req, res) => {
  // Always return the same message to prevent email enumeration attacks
  const genericMsg = 'If an account with that email exists, a password reset link has been sent.';
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email is required' });

    const result = await pool.query(
      'SELECT id, first_name FROM employees WHERE email = $1',
      [email.toLowerCase()]
    );

    // Silently succeed if account not found — prevents email enumeration
    if (result.rows.length === 0) {
      return res.json({ success: true, message: genericMsg });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    const resetExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await pool.query(
      'UPDATE employees SET reset_password_token = $1, reset_password_expires = $2 WHERE id = $3',
      [hashedToken, resetExpires, result.rows[0].id]
    );

    // Send reset link via email — NEVER expose the raw token in the API response
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const resetUrl = `${frontendUrl}/reset-password/${resetToken}`;
    const companyName = process.env.COMPANY_NAME || 'Nxt People';

    try {
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.EMAIL_PORT) || 587,
        secure: false,
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
      });
      await transporter.sendMail({
        from: `"${companyName}" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: `${companyName} — Password Reset Request`,
        html: `
          <div style="font-family:Inter,sans-serif;max-width:480px;margin:auto;padding:32px;background:#f8fafc;border-radius:12px">
            <h2 style="color:#4F46E5;margin-top:0">Password Reset</h2>
            <p>Hello <strong>${result.rows[0].first_name}</strong>,</p>
            <p>You requested a password reset. Click the button below — this link expires in <strong>10 minutes</strong>.</p>
            <a href="${resetUrl}" style="display:inline-block;padding:12px 28px;background:#4F46E5;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;margin:16px 0">Reset My Password</a>
            <p style="color:#6b7280;font-size:13px;margin-top:24px">If you did not request this reset, please ignore this email — your password will remain unchanged.</p>
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
            <p style="color:#9ca3af;font-size:12px">${companyName} · Sent from no-reply</p>
          </div>`,
      });
    } catch (emailErr) {
      // Log the failure but do NOT expose it to the caller
      console.error('❌ Password reset email delivery failed:', emailErr.message);
    }

    res.json({ success: true, message: genericMsg });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @PUT /api/auth/reset-password/:token
router.put('/reset-password/:token', async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
    }

    const hashedToken = crypto.createHash('sha256').update(req.params.token).digest('hex');

    const result = await pool.query(
      'SELECT id FROM employees WHERE reset_password_token = $1 AND reset_password_expires > NOW()',
      [hashedToken]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid or expired reset token' });
    }

    const newHashedPassword = await bcrypt.hash(newPassword, 12);

    await pool.query(
      'UPDATE employees SET password = $1, reset_password_token = NULL, reset_password_expires = NULL WHERE id = $2',
      [newHashedPassword, result.rows[0].id]
    );

    res.json({ success: true, message: 'Password reset successfully. You can now log in.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @POST /api/auth/refresh — exchange a valid refresh token for a new access token
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(401).json({ success: false, message: 'Refresh token required' });

    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

    const result = await pool.query(
      `SELECT rt.id, rt.employee_id, e.registration_status
       FROM refresh_tokens rt
       JOIN employees e ON rt.employee_id = e.id
       WHERE rt.token_hash = $1 AND rt.expires_at > NOW() AND rt.revoked_at IS NULL`,
      [tokenHash]
    );

    if (!result.rows[0]) {
      return res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
    }

    const { id: tokenId, employee_id: employeeId, registration_status } = result.rows[0];

    if (registration_status !== 'active') {
      return res.status(403).json({ success: false, message: 'Account is not active' });
    }

    // Rotate: revoke old token, issue new pair
    await pool.query(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1`, [tokenId]);
    const newAccessToken   = signToken(employeeId);
    const newRefreshToken  = await generateRefreshToken(employeeId, req);

    res.json({ success: true, token: newAccessToken, refreshToken: newRefreshToken });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @POST /api/auth/logout — revoke refresh token
router.post('/logout', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      await pool.query(
        `UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL`,
        [tokenHash]
      );
    }
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @GET /api/auth/sessions — list active sessions for current user (protected)
router.get('/sessions', protect, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, ip_address as "ipAddress", user_agent as "userAgent",
       created_at as "createdAt", expires_at as "expiresAt"
       FROM refresh_tokens
       WHERE employee_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
       ORDER BY created_at DESC`,
      [req.user._id]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;

