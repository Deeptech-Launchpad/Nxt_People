/**
 * External access-check endpoint.
 *
 * External sites (LMS, User Report, …) call this from their own login
 * flow to verify the employee is allowed. We identify the calling app
 * by its X-API-Key (issued in the API Connections admin page) and the
 * employee by their email.
 *
 *   POST /api/external/access/check
 *     Headers: X-API-Key: <the connection's key>
 *     Body:    { "email": "alice@altiusnxt.com" }
 *
 *   Response (allowed):
 *     {
 *       "allowed": true,
 *       "employee": { id, employeeId, firstName, lastName, email, department, designation, photoUrl },
 *       "application": { id, name }
 *     }
 *
 *   Response (denied):
 *     { "allowed": false, "reason": "NOT_GRANTED" | "EMPLOYEE_INACTIVE" | "NOT_FOUND" }
 *
 * Rate limited per API key so a leaked key can't be used to enumerate
 * employees by brute-forcing emails.
 */
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const pool = require('../db');

const accessLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,                       // 600 checks / 15 min / key — plenty for login traffic
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, res) => {
    const apiKey = req.headers['x-api-key'] || '';
    if (apiKey) return crypto.createHash('sha256').update(apiKey).digest('hex');
    return ipKeyGenerator(req, res);
  },
  skip: () => process.env.NODE_ENV !== 'production' || process.env.RATE_LIMIT_DISABLED === 'true',
  message: { allowed: false, reason: 'RATE_LIMITED' },
});
router.use(accessLimiter);

// API key validation — looks up the connection by hash. Same hashing
// scheme as routes/external.js so the SAME key works for both endpoints
// (data sync OR access check).
const validateAppKey = async (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ allowed: false, reason: 'API_KEY_MISSING' });
  const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const r = await pool.query(
    `SELECT id, name, is_active FROM api_connections WHERE api_key_hash = $1`,
    [hash]
  );
  if (r.rows.length === 0)  return res.status(401).json({ allowed: false, reason: 'INVALID_KEY' });
  if (!r.rows[0].is_active) return res.status(401).json({ allowed: false, reason: 'APP_INACTIVE' });
  req.application = r.rows[0];
  next();
};

router.post('/check', validateAppKey, async (req, res) => {
  try {
    const email = String(req.body?.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ allowed: false, reason: 'EMAIL_REQUIRED' });

    const r = await pool.query(`
      SELECT e.id AS "_id", e.employee_id AS "employeeId",
             e.first_name AS "firstName", e.last_name AS "lastName",
             e.email, e.department, e.designation, e.photo_url AS "photoUrl",
             e.status,
             (ac.id IS NOT NULL AND ac.revoked_at IS NULL) AS "hasAccess"
        FROM employees e
        LEFT JOIN application_access ac
          ON ac.employee_id = e.id AND ac.api_connection_id = $1
       WHERE LOWER(e.email) = $2
       LIMIT 1
    `, [req.application.id, email]);

    if (r.rows.length === 0)            return res.json({ allowed: false, reason: 'NOT_FOUND' });
    if (r.rows[0].status !== 'active')  return res.json({ allowed: false, reason: 'EMPLOYEE_INACTIVE' });
    if (!r.rows[0].hasAccess)           return res.json({ allowed: false, reason: 'NOT_GRANTED' });

    const { _id, employeeId, firstName, lastName, department, designation, photoUrl } = r.rows[0];
    res.json({
      allowed: true,
      employee: {
        id: _id, employeeId, firstName, lastName,
        email: r.rows[0].email,
        department, designation, photoUrl,
      },
      application: { id: req.application.id, name: req.application.name },
    });
  } catch (err) {
    res.status(500).json({ allowed: false, reason: 'INTERNAL_ERROR', message: err.message });
  }
});

module.exports = router;
