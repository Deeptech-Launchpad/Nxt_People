const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const pool = require('../db');
const bcrypt = require('bcryptjs');
const logger = require('../logger');
const { serverError } = require('../utils/serverError');

// Per-API-key rate limit. Prevents a leaked key from being used to
// hammer the bulk-upsert endpoint into a denial of service. Keyed on
// the SHA-256 of the key so we don't store secrets in memory; if no
// key is present, fall back to ipKeyGenerator (IPv6-safe helper from
// express-rate-limit; raw req.ip would let v6 callers bypass limits
// by rotating addresses inside their /64).
const externalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, res) => {
    const apiKey = req.headers['x-api-key'] || '';
    if (apiKey) return crypto.createHash('sha256').update(apiKey).digest('hex');
    return ipKeyGenerator(req, res);
  },
  skip: () => process.env.NODE_ENV !== 'production' || process.env.RATE_LIMIT_DISABLED === 'true',
  message: { success: false, message: 'Rate limit exceeded for this API key. Try again in 15 minutes.' },
});
router.use(externalLimiter);

const validateApiKey = async (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ success: false, message: 'API key required. Pass x-api-key header.' });

  const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const result = await pool.query('SELECT * FROM api_connections WHERE api_key_hash = $1 AND is_active = true', [apiKeyHash]);
  if (result.rows.length === 0) return res.status(401).json({ success: false, message: 'Invalid or inactive API key.' });

  const conn = result.rows[0];
  await pool.query('UPDATE api_connections SET last_sync_at = NOW() WHERE id = $1', [conn.id]);
  req.apiConnection = conn;
  next();
};
router.use(validateApiKey);

/**
 * Scope check helper. Resources can be requested with either of:
 *   - "<resource>"          → legacy form, read-only
 *   - "<resource>:read"     → explicit read
 *   - "<resource>:write"    → explicit write (implies read)
 *
 * This keeps existing connections with `["employees"]` working as read-only
 * while letting admins grant write access by switching to `["employees:write"]`
 * without a schema change.
 */
function hasScope(conn, resource, mode /* 'read' | 'write' */) {
  const list = Array.isArray(conn.allowed_data_types) ? conn.allowed_data_types : [];
  if (mode === 'read') {
    return list.includes(resource) || list.includes(`${resource}:read`) || list.includes(`${resource}:write`);
  }
  // write
  return list.includes(`${resource}:write`);
}

// Hard cap on bulk-upsert array size. One sync call should not be able to
// kick off thousands of sequential queries from one HTTP request.
const MAX_BULK_RECORDS = 500;

/**
 * Audit helper for external (API-key) requests. The standard audit
 * middleware assumes a logged-in employee (req.user) — external requests
 * don't have one, so we write directly with the connection's identity as
 * the actor. Fire-and-forget so audit-table hiccups can't take a sync down.
 */
const auditExternal = (req, action, resource, details) => {
  const conn = req.apiConnection;
  pool.query(
    `INSERT INTO audit_log
       (actor_id, actor_email, actor_role, action, resource, resource_id, changes, ip_address, user_agent)
     VALUES (NULL, $1, 'api_connection', $2, $3, $4, $5, $6, $7)`,
    [
      `api:${conn?.name || 'unknown'}`,
      action,
      resource,
      null,
      JSON.stringify(details || {}),
      req.ip || null,
      req.get('user-agent')?.substring(0, 500) || null,
    ]
  ).catch(err => logger.error({ action, resource, err: err.message }, 'AUDIT WRITE FAILED (external)'));
};

router.get('/employees', async (req, res) => {
  try {
    if (!hasScope(req.apiConnection, 'employees', 'read')) {
      return res.status(403).json({ success: false, message: 'This connection does not have read access to employees data.' });
    }
    // Notice Period employees retain access (same as Active) per the status
    // model in Employees.jsx — connected apps like User Report Tool must see
    // them too, or they get incorrectly locked out during their notice period.
    let query = `WHERE registration_status = 'active' AND status IN ('active', 'notice_period')`;
    let params = [];
    if (req.apiConnection.company) {
      query += ' AND company = $1';
      params.push(req.apiConnection.company);
    }
    const result = await pool.query(`SELECT employee_id as "employeeId", first_name as "firstName", last_name as "lastName", email, phone, designation, division, company, department, joining_date as "joiningDate" FROM employees ${query}`, params);
    auditExternal(req, 'READ', 'employees', { count: result.rows.length, filter: { company: req.apiConnection.company || null } });
    res.json({ success: true, source: req.apiConnection.name, count: result.rows.length, data: result.rows });
  } catch (err) { serverError(res, err); }
});

router.post('/employees', async (req, res) => {
  try {
    if (!hasScope(req.apiConnection, 'employees', 'write')) {
      return res.status(403).json({ success: false, message: 'This connection does not have write access to employees data. Required scope: "employees:write".' });
    }
    const records = Array.isArray(req.body) ? req.body : [req.body];
    // Reject oversized payloads up-front. Without this cap a single call
    // could fan out into thousands of sequential queries on the pool.
    if (records.length > MAX_BULK_RECORDS) {
      return res.status(413).json({
        success: false,
        message: `Bulk payload too large. Max ${MAX_BULK_RECORDS} records per request, got ${records.length}. Split into batches.`,
      });
    }
    const results = { created: 0, updated: 0, errors: [] };

    for (const record of records) {
      if (!record.email || !record.firstName || !record.lastName) {
        results.errors.push({ record, reason: 'Missing required fields: email, firstName, lastName' });
        continue;
      }
      try {
        const existing = await pool.query('SELECT id FROM employees WHERE email = $1', [record.email.toLowerCase()]);
        if (existing.rows.length > 0) {
          await pool.query(`UPDATE employees SET first_name = COALESCE($1, first_name), last_name = COALESCE($2, last_name), company = COALESCE($3, company), phone = COALESCE($4, phone), designation = COALESCE($5, designation), department = COALESCE($6, department), division = COALESCE($7, division) WHERE email = $8`, [record.firstName, record.lastName, record.company || req.apiConnection.company, record.phone, record.designation, record.department, record.division, record.email.toLowerCase()]);
          results.updated++;
        } else {
          await pool.query(`INSERT INTO employees (email, first_name, last_name, company, phone, designation, department, division, registration_status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')`, [record.email.toLowerCase(), record.firstName, record.lastName, record.company || req.apiConnection.company, record.phone, record.designation, record.department, record.division]);
          results.created++;
        }
      } catch (e) { results.errors.push({ record, reason: e.message }); }
    }
    auditExternal(req, 'BULK_UPSERT', 'employees', {
      total: records.length,
      created: results.created,
      updated: results.updated,
      errorCount: results.errors.length,
    });
    res.json({ success: true, message: 'Sync complete', results });
  } catch (err) { serverError(res, err); }
});

router.post('/login', async (req, res) => {
  try {
    if (!hasScope(req.apiConnection, 'auth', 'write')) {
      return res.status(403).json({ success: false, message: 'This connection does not have permission to authenticate users. Required scope: "auth:write".' });
    }
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, message: 'Email and password are required.' });

    let query = 'WHERE email = $1';
    let params = [email.toLowerCase()];
    if (req.apiConnection.company) {
      query += ' AND company = $2';
      params.push(req.apiConnection.company);
    }
    const result = await pool.query(`SELECT id as "_id", password, registration_status, has_accepted, employee_id as "employeeId", first_name as "firstName", last_name as "lastName", email, phone, role, designation, department, division, company FROM employees ${query}`, params);
    
    if (result.rows.length === 0) return res.status(404).json({ success: false, code: 'NOT_REGISTERED', message: 'This email is not registered. Please sign up on the main portal first.' });
    
    const emp = result.rows[0];
    if (emp.registration_status === 'pending') return res.status(403).json({ success: false, code: 'PENDING_APPROVAL', message: 'Your account is pending approval. Please wait for admin confirmation.' });
    if (emp.registration_status === 'rejected') return res.status(403).json({ success: false, code: 'REJECTED', message: 'Your registration was not approved. Please contact HR.' });
    if (emp.registration_status === 'approved' && !emp.has_accepted) return res.status(403).json({ success: false, code: 'TERMS_PENDING', message: 'Please complete your account setup on the main portal before logging in here.' });
    if (emp.registration_status !== 'active') return res.status(403).json({ success: false, code: 'NOT_ACTIVE', message: 'Your account is not active. Please contact HR.' });

    if (!emp.password || !(await bcrypt.compare(password, emp.password))) {
      auditExternal(req, 'LOGIN_FAILED', 'auth', { email: email.toLowerCase(), reason: 'bad_password' });
      return res.status(401).json({ success: false, code: 'WRONG_PASSWORD', message: 'Incorrect password.' });
    }

    auditExternal(req, 'LOGIN_SUCCESS', 'auth', { email: email.toLowerCase(), employeeId: emp.employeeId });
    res.json({
      success: true, message: 'Login successful',
      user: { id: emp._id, employeeId: emp.employeeId, firstName: emp.firstName, lastName: emp.lastName, email: emp.email, phone: emp.phone, role: emp.role, designation: emp.designation, department: emp.department, division: emp.division, company: emp.company }
    });
  } catch (err) { serverError(res, err); }
});

router.get('/status', (req, res) => {
  res.json({
    success: true,
    connection: { name: req.apiConnection.name, company: req.apiConnection.company, allowedDataTypes: req.apiConnection.allowed_data_types, lastSyncAt: req.apiConnection.last_sync_at }
  });
});

module.exports = router;
