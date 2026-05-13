const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { protect, authorize } = require('../middleware/auth');
const { sendOnboardingEmail } = require('../utils/mailer');
const { logAudit } = require('../utils/audit');

router.use(protect);

const { nextIdForCompany } = require('../utils/employeeId');

// GET next suggested employee_id — used by Confirm Registration + Add Employee
// modals to prefill. Pass ?company=AltiusNxt for the per-company format
// (e.g. ANXT2600150). See utils/employeeId.js for the format rules.
router.get('/next-id', async (req, res) => {
  try {
    const suggested = await nextIdForCompany(pool, req.query.company);
    res.json({ success: true, data: { suggested } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET metadata (departments, designations, roles, managers)
router.get('/metadata', async (req, res) => {
  try {
    const deptsResult = await pool.query('SELECT DISTINCT department FROM employees WHERE department IS NOT NULL AND department != \'\'');
    const desigsResult = await pool.query('SELECT DISTINCT designation FROM employees WHERE designation IS NOT NULL AND designation != \'\'');
    const rolesResult = await pool.query('SELECT DISTINCT role FROM employees WHERE role IS NOT NULL AND role != \'\'');
    
    // Add managers list (filtered for high-level users)
    const managersResult = await pool.query(
      `SELECT id as "_id", first_name as "firstName", last_name as "lastName", email, designation 
       FROM employees 
       WHERE status = 'active' 
       AND (role IN ('admin', 'manager', 'hr') OR designation ILIKE '%Lead%' OR designation ILIKE '%Manager%' OR designation ILIKE '%Head%') 
       ORDER BY first_name ASC`
    );

    // Add approving authorities list (managers who can approve leaves)
    const approvingAuthoritiesResult = await pool.query(
      'SELECT id as "_id", first_name as "firstName", last_name as "lastName", email, designation FROM employees WHERE (role = \'admin\' OR role = \'manager\' OR role = \'hr\') AND status = \'active\' ORDER BY first_name ASC'
    );

    res.json({
      success: true,
      data: {
        departments: deptsResult.rows.map(r => r.department).sort(),
        designations: desigsResult.rows.map(r => r.designation).sort(),
        roles: rolesResult.rows.map(r => r.role).sort(),
        managers: managersResult.rows,
        approvingAuthorities: approvingAuthoritiesResult.rows
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET all employees
router.get('/', async (req, res) => {
  try {
    const { department, role, designation, status, search, page = 1, limit = 20 } = req.query;
    let query = 'WHERE 1=1';
    let params = [];
    let paramIndex = 1;

    if (department)  { query += ` AND e.department = $${paramIndex++}`;  params.push(department); }
    if (role)        { query += ` AND e.role = $${paramIndex++}`;        params.push(role); }
    if (designation) { query += ` AND e.designation = $${paramIndex++}`; params.push(designation); }
    if (status)      { query += ` AND e.status = $${paramIndex++}`;      params.push(status); }
    if (search) {
      query += ` AND (e.first_name ILIKE $${paramIndex} OR e.last_name ILIKE $${paramIndex} OR e.email ILIKE $${paramIndex} OR e.employee_id ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    // Bug #2 fix: capture filter params BEFORE adding limit/offset
    const filterParams = [...params];

    const limitNum = Number(limit);
    const offsetNum = (Number(page) - 1) * limitNum;
    params.push(limitNum, offsetNum);

    const employeesResult = await pool.query(
      `SELECT e.id as "_id", e.first_name AS "firstName", e.last_name AS "lastName", e.email, e.role, e.department, e.designation, e.company, e.division, e.employee_id AS "employeeId", e.status, e.joining_date AS "joiningDate", e.phone, e.reporting_manager_id AS "reportingManagerId", e.approving_authority_id AS "approvingAuthorityId",
       e.monthly_ctc AS "monthlyCTC", e.basic_salary AS "basicSalary",
       e.casual_leave AS "casualLeave", e.sick_leave AS "sickLeave", e.earned_leave AS "earnedLeave",
       (a.check_in IS NOT NULL AND a.check_out IS NULL) as "isCheckedIn",
       CASE
         WHEN a.check_in IS NULL  THEN 'yetToCheckIn'
         WHEN a.check_out IS NULL THEN 'in'
         ELSE                          'out'
       END as presence,
       json_build_object('name', s.name, 'startTime', s.start_time, 'endTime', s.end_time) as shift,
       json_build_object('firstName', m.first_name, 'lastName', m.last_name) as manager
       FROM employees e
       LEFT JOIN shifts s ON e.shift_id = s.id
       LEFT JOIN employees m ON e.reporting_manager_id = m.id
       LEFT JOIN attendance a ON a.employee_id = e.id AND a.date = CURRENT_DATE
       ${query}
       ORDER BY e.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      params
    );

    // Bug #2 fix: use filterParams (without limit/offset) for the count query
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM employees e ${query.replace(/LIMIT.*/s, '')}`,
      filterParams
    );
    const total = parseInt(countResult.rows[0].count, 10);

    res.json({ success: true, data: employeesResult.rows, total, page: Number(page), pages: Math.ceil(total / limitNum) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET single employee — Bug #9 fix: include leave balance columns
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT e.id as "_id", e.first_name AS "firstName", e.last_name AS "lastName", e.email, e.role, e.department, e.designation, e.company, e.division, e.employee_id AS "employeeId", e.status, e.joining_date AS "joiningDate", e.phone, e.reporting_manager_id AS "reportingManagerId",
       e.gender, e.date_of_birth, e.marital_status, e.blood_group, e.aadhaar_number, e.pan_number, e.uan_number, e.current_address, e.pin_code, e.city, e.state, e.country,
       e.casual_leave AS "casualLeave", e.sick_leave AS "sickLeave", e.earned_leave AS "earnedLeave", e.unpaid_leave AS "unpaidLeave",
       e.approving_authority_id AS "approvingAuthorityId",
       json_build_object('name', s.name, 'startTime', s.start_time, 'endTime', s.end_time) as shift,
       json_build_object('firstName', m.first_name, 'lastName', m.last_name, 'email', m.email, 'id', m.id) as manager,
       json_build_object('firstName', aa.first_name, 'lastName', aa.last_name, 'email', aa.email, 'id', aa.id, 'designation', aa.designation) as approvingAuthority
       FROM employees e
       LEFT JOIN shifts s ON e.shift_id = s.id
       LEFT JOIN employees m ON e.reporting_manager_id = m.id
       LEFT JOIN employees aa ON e.approving_authority_id = aa.id
       WHERE e.id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Employee not found' });
    
    const empData = result.rows[0];
    const eduRes = await pool.query('SELECT * FROM employee_education WHERE employee_id = $1 ORDER BY year_of_passing DESC', [req.params.id]);
    empData.education = eduRes.rows;
    
    const docsRes = await pool.query('SELECT id, document_type as "documentType", file_path as "filePath", original_name as "originalName", mime_type as "mimeType", size FROM employee_documents WHERE employee_id = $1', [req.params.id]);
    empData.documents = docsRes.rows;
    
    res.json({ success: true, data: empData });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST create employee
router.post('/', authorize('admin', 'manager'), async (req, res) => {
  try {
    let { firstName, lastName, email, password, phone, role, department, designation, company, division, joiningDate, monthlyCTC, basicSalary, casualLeave, sickLeave, earnedLeave, reportingManagerId, approvingAuthorityId, employeeId: providedId } = req.body;
    let hashedPassword = null;
    if (password) hashedPassword = await bcrypt.hash(password, 12);

    // Use admin-supplied ID when provided; otherwise auto-generate the next
    // per-company sequence (e.g. ANXT2600150 for AltiusNxt, dtlp-015 for DTLP).
    // Uniqueness is enforced by the partial unique index + the clash check below.
    let employeeId = (providedId || '').trim();
    if (!employeeId) {
      employeeId = await nextIdForCompany(pool, company);
    } else {
      const clash = await pool.query('SELECT id FROM employees WHERE employee_id = $1', [employeeId]);
      if (clash.rows.length > 0) {
        return res.status(400).json({ success: false, message: `Employee ID "${employeeId}" is already in use` });
      }
    }

    const result = await pool.query(
      `INSERT INTO employees (first_name, last_name, email, password, phone, role, department, designation, company, division, joining_date, employee_id, registration_status, has_accepted, monthly_ctc, basic_salary, casual_leave, sick_leave, earned_leave, reporting_manager_id, approving_authority_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'active', true, $13, $14, $15, $16, $17, $18, $19)
       RETURNING id as "_id", first_name AS "firstName", last_name AS "lastName", email, role, department, designation, employee_id AS "employeeId"`,
      [firstName, lastName, email.toLowerCase(), hashedPassword, phone, role || 'employee', department, designation, company, division, joiningDate || new Date(), employeeId,
       monthlyCTC || null, basicSalary || null, casualLeave ?? 12, sickLeave ?? 10, earnedLeave ?? 15, reportingManagerId || null, approvingAuthorityId || null]
    );

    await logAudit(req, {
      action: 'CREATE',
      resource: 'Employee',
      resourceId: result.rows[0]._id,
      changes: { email: email.toLowerCase(), role, department }
    });

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ success: false, message: 'Email already exists' });
    res.status(500).json({ success: false, message: err.message });
  }
});


// PUT update employee
router.put('/:id', authorize('admin', 'manager'), async (req, res) => {
  try {
    const {
      firstName, lastName, email, phone, role, department, designation, company, division,
      joiningDate, employeeId, monthlyCTC, basicSalary, casualLeave, sickLeave, earnedLeave,
      reportingManagerId, approvingAuthorityId,
      // Personal / identity (added so admin can edit everything Zoho-imported)
      nickName, dateOfBirth, gender, maritalStatus, bloodGroup, nationality,
      personalEmail, workPhone, address, permanentAddress,
      panNumber, aadhaarNumber, uanNumber,
      bankName, bankAccount, bankIfsc,
      emergencyContactName, emergencyContactPhone, emergencyContactRelation,
      workLocation, employmentType, status,
    } = req.body;

    // Uniqueness guard if admin is changing employee_id. Unique index would
    // also catch it, but a friendly message is better.
    if (employeeId !== undefined && employeeId !== '' && employeeId !== null) {
      const clash = await pool.query('SELECT id FROM employees WHERE employee_id = $1 AND id <> $2', [employeeId, req.params.id]);
      if (clash.rows.length > 0) {
        return res.status(400).json({ success: false, message: `Employee ID "${employeeId}" is already in use` });
      }
    }

    let updates = [];
    let params = [];
    let i = 1;
    if (firstName !== undefined) { updates.push(`first_name = $${i++}`); params.push(firstName); }
    if (lastName !== undefined) { updates.push(`last_name = $${i++}`); params.push(lastName); }
    if (email !== undefined) { updates.push(`email = $${i++}`); params.push(email.toLowerCase()); }
    if (phone !== undefined) { updates.push(`phone = $${i++}`); params.push(phone); }
    if (role !== undefined) { updates.push(`role = $${i++}`); params.push(role); }
    if (department !== undefined) { updates.push(`department = $${i++}`); params.push(department); }
    if (designation !== undefined) { updates.push(`designation = $${i++}`); params.push(designation); }
    if (company !== undefined) { updates.push(`company = $${i++}`); params.push(company); }
    if (division !== undefined) { updates.push(`division = $${i++}`); params.push(division); }
    if (joiningDate !== undefined) { updates.push(`joining_date = $${i++}`); params.push(joiningDate); }
    if (employeeId !== undefined) { updates.push(`employee_id = $${i++}`); params.push(employeeId || null); }
    if (monthlyCTC !== undefined && monthlyCTC !== '') { updates.push(`monthly_ctc = $${i++}`); params.push(parseFloat(monthlyCTC) || null); }
    if (basicSalary !== undefined && basicSalary !== '') { updates.push(`basic_salary = $${i++}`); params.push(parseFloat(basicSalary) || null); }
    if (casualLeave !== undefined && casualLeave !== '') { updates.push(`casual_leave = $${i++}`); params.push(parseFloat(casualLeave)); }
    if (sickLeave !== undefined && sickLeave !== '') { updates.push(`sick_leave = $${i++}`); params.push(parseFloat(sickLeave)); }
    if (earnedLeave !== undefined && earnedLeave !== '') { updates.push(`earned_leave = $${i++}`); params.push(parseFloat(earnedLeave)); }
    if (reportingManagerId !== undefined) { updates.push(`reporting_manager_id = $${i++}`); params.push(reportingManagerId || null); }
    if (approvingAuthorityId !== undefined) { updates.push(`approving_authority_id = $${i++}`); params.push(approvingAuthorityId || null); }

    // Personal / identity / contact / bank / emergency contact fields.
    if (nickName !== undefined)                 { updates.push(`nick_name = $${i++}`);                 params.push(nickName || null); }
    if (dateOfBirth !== undefined)              { updates.push(`date_of_birth = $${i++}`);             params.push(dateOfBirth || null); }
    if (gender !== undefined)                   { updates.push(`gender = $${i++}`);                    params.push(gender || null); }
    if (maritalStatus !== undefined)            { updates.push(`marital_status = $${i++}`);            params.push(maritalStatus || null); }
    if (bloodGroup !== undefined)               { updates.push(`blood_group = $${i++}`);               params.push(bloodGroup || null); }
    if (nationality !== undefined)              { updates.push(`nationality = $${i++}`);               params.push(nationality || null); }
    if (personalEmail !== undefined)            { updates.push(`personal_email = $${i++}`);            params.push(personalEmail ? personalEmail.toLowerCase() : null); }
    if (workPhone !== undefined)                { updates.push(`work_phone = $${i++}`);                params.push(workPhone || null); }
    if (address !== undefined)                  { updates.push(`address = $${i++}`);                   params.push(address || null); }
    if (permanentAddress !== undefined)         { updates.push(`permanent_address = $${i++}`);         params.push(permanentAddress || null); }
    if (panNumber !== undefined)                { updates.push(`pan_number = $${i++}`);                params.push(panNumber || null); }
    if (aadhaarNumber !== undefined)            { updates.push(`aadhaar_number = $${i++}`);            params.push(aadhaarNumber || null); }
    if (uanNumber !== undefined)                { updates.push(`uan_number = $${i++}`);                params.push(uanNumber || null); }
    if (bankName !== undefined)                 { updates.push(`bank_name = $${i++}`);                 params.push(bankName || null); }
    if (bankAccount !== undefined)              { updates.push(`bank_account = $${i++}`);              params.push(bankAccount || null); }
    if (bankIfsc !== undefined)                 { updates.push(`bank_ifsc = $${i++}`);                 params.push(bankIfsc || null); }
    if (emergencyContactName !== undefined)     { updates.push(`emergency_contact_name = $${i++}`);    params.push(emergencyContactName || null); }
    if (emergencyContactPhone !== undefined)    { updates.push(`emergency_contact_phone = $${i++}`);   params.push(emergencyContactPhone || null); }
    if (emergencyContactRelation !== undefined) { updates.push(`emergency_contact_relation = $${i++}`); params.push(emergencyContactRelation || null); }
    if (workLocation !== undefined)             { updates.push(`work_location = $${i++}`);             params.push(workLocation || null); }
    if (employmentType !== undefined)           { updates.push(`employment_type = $${i++}`);           params.push(employmentType || null); }
    if (status !== undefined)                   { updates.push(`status = $${i++}`);                    params.push(status || 'active'); }

    if (updates.length === 0) return res.json({ success: true, message: 'Nothing to update' });

    updates.push(`updated_at = NOW()`);

    params.push(req.params.id);

    const result = await pool.query(
      `UPDATE employees SET ${updates.join(', ')} WHERE id = $${i}
       RETURNING id as "_id", first_name AS "firstName", last_name AS "lastName", email, role, department, designation, employee_id AS "employeeId"`,
      params
    );

    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Employee not found' });

    await logAudit(req, {
      action: 'UPDATE',
      resource: 'Employee',
      resourceId: req.params.id,
      changes: req.body // simplified, passing the requested changes
    });

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ success: false, message: 'Email already exists' });
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST send onboarding email
router.post('/send-onboarding', authorize('admin', 'manager'), async (req, res) => {
  try {
    const { email, candidateName, dueDate } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Candidate email is required' });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const companyName = process.env.COMPANY_NAME || 'AltiusNxt';

    const hrRes = await pool.query('SELECT first_name, last_name, email, phone FROM employees WHERE id = $1', [req.user._id]);
    const hrEmployee = hrRes.rows[0];
    const hrName = hrEmployee ? `${hrEmployee.first_name} ${hrEmployee.last_name}` : 'HR Team';
    const hrEmail = hrEmployee?.email || process.env.EMAIL_USER;
    const hrPhone = hrEmployee?.phone || '';

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await pool.query(
      'INSERT INTO onboarding_tokens (token, email, created_by, expires_at) VALUES ($1, $2, $3, $4)',
      [token, email, req.user._id, expiresAt]
    );

    await sendOnboardingEmail({
      to: email,
      candidateName: candidateName || '',
      dueDate: dueDate || null,
      registrationLink: `${frontendUrl}/onboarding/${token}`,
      companyName,
      hrName,
      hrEmail,
      hrPhone,
    });

    res.json({ success: true, message: `Onboarding email sent to ${email}` });
  } catch (err) {
    console.error('Onboarding email error:', err);
    res.status(500).json({ success: false, message: err.message || 'Failed to send email' });
  }
});

// DELETE employee
router.delete('/:id', authorize('admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM employees WHERE id = $1', [req.params.id]);
    
    await logAudit(req, {
      action: 'DELETE',
      resource: 'Employee',
      resourceId: req.params.id
    });

    res.json({ success: true, message: 'Employee deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
