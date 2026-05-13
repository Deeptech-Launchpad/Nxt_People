const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const pool = require('../db');
const bcrypt = require('bcryptjs');

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

router.get('/employees', async (req, res) => {
  try {
    if (!req.apiConnection.allowed_data_types.includes('employees')) {
      return res.status(403).json({ success: false, message: 'This connection does not have access to employees data.' });
    }
    let query = `WHERE registration_status = 'active' AND status = 'active'`;
    let params = [];
    if (req.apiConnection.company) {
      query += ' AND company = $1';
      params.push(req.apiConnection.company);
    }
    const result = await pool.query(`SELECT employee_id as "employeeId", first_name as "firstName", last_name as "lastName", email, phone, designation, division, company, department, joining_date as "joiningDate" FROM employees ${query}`, params);
    res.json({ success: true, source: req.apiConnection.name, count: result.rows.length, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/employees', async (req, res) => {
  try {
    if (!req.apiConnection.allowed_data_types.includes('employees')) {
      return res.status(403).json({ success: false, message: 'This connection does not have write access to employees data.' });
    }
    const records = Array.isArray(req.body) ? req.body : [req.body];
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
    res.json({ success: true, message: 'Sync complete', results });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/login', async (req, res) => {
  try {
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
      return res.status(401).json({ success: false, code: 'WRONG_PASSWORD', message: 'Incorrect password.' });
    }

    res.json({
      success: true, message: 'Login successful',
      user: { id: emp._id, employeeId: emp.employeeId, firstName: emp.firstName, lastName: emp.lastName, email: emp.email, phone: emp.phone, role: emp.role, designation: emp.designation, department: emp.department, division: emp.division, company: emp.company }
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/status', (req, res) => {
  res.json({
    success: true,
    connection: { name: req.apiConnection.name, company: req.apiConnection.company, allowedDataTypes: req.apiConnection.allowed_data_types, lastSyncAt: req.apiConnection.last_sync_at }
  });
});

module.exports = router;
