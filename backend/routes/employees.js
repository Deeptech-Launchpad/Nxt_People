const express = require('express');
const router = express.Router();
const pool = require('../db');
const { fire } = require('../utils/workflowEngine');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { protect, authorize } = require('../middleware/auth');
const { isFullAccess } = require('../utils/roles');
const { sendOnboardingEmail } = require('../utils/mailer');
const { logAudit } = require('../utils/audit');
const { buildCriteria, buildOrder, buildPaging } = require('../utils/listQuery');
const { hiddenFieldsFor } = require('./employee-info-permissions');

/* What the Employees list tab may filter and sort on. The SQL always uses
 * `column` from here, never anything from the request, because neither a
 * column name nor a sort direction can be a bound parameter. */
const EMPLOYEE_FIELDS = {
  employeeId:    { column: 'e.employee_id',   label: 'Employee ID',        type: 'text' },
  firstName:     { column: 'e.first_name',    label: 'First Name',         type: 'text' },
  lastName:      { column: 'e.last_name',     label: 'Last Name',          type: 'text' },
  nickName:      { column: 'e.nick_name',     label: 'Nick name',          type: 'text' },
  email:         { column: 'e.email',         label: 'Email address',      type: 'text' },
  department:    { column: 'e.department',    label: 'Department',         type: 'text' },
  designation:   { column: 'e.designation',   label: 'Designation',        type: 'text' },
  role:          { column: 'e.role',          label: 'Role',               type: 'text' },
  employmentType:{ column: 'e.employment_type', label: 'Employment Type',  type: 'text' },
  status:        { column: 'e.status',        label: 'Employee Status',    type: 'text' },
  sourceOfHire:  { column: 'e.source_of_hire', label: 'Source of Hire',    type: 'text' },
  joiningDate:   { column: 'e.date_of_joining', label: 'Date of Joining',  type: 'date' },
  totalExperience:{ column: 'e.total_experience', label: 'Total Experience', type: 'text' },
  reportingManager: { column: "TRIM(CONCAT(m.first_name, ' ', m.last_name))", label: 'Reporting Manager', type: 'text' },
  dateOfBirth:   { column: 'e.date_of_birth', label: 'Date of Birth',      type: 'date' },
  gender:        { column: 'e.gender',        label: 'Gender',             type: 'text' },
  maritalStatus: { column: 'e.marital_status', label: 'Marital Status',    type: 'text' },
  aboutMe:       { column: 'e.about_me',      label: 'About Me',           type: 'text' },
  expertise:     { column: 'e.expertise',     label: 'Ask me about/Expertise', type: 'text' },
  workPhone:     { column: 'e.work_phone',    label: 'Work Phone Number',  type: 'text' },
  extension:     { column: 'e.extension',     label: 'Extension',          type: 'text' },
  workLocation:  { column: 'e.work_location', label: 'Location',           type: 'text' },
  personalEmail: { column: 'e.personal_email', label: 'Personal Email Address', type: 'text' },
  phone:         { column: 'e.phone',         label: 'Personal Mobile Number', type: 'text' },
  exitDate:      { column: 'e.exit_date',     label: 'Date of Exit',       type: 'date' },
  addedTime:     { column: 'e.created_at',    label: 'Added Time',         type: 'datetime' },
  modifiedTime:  { column: 'e.updated_at',    label: 'Modified Time',      type: 'datetime' },
  seatingLocation:{ column: 'e.seating_location', label: 'Seating Location', type: 'text' },
  tags:          { column: 'e.tags',          label: 'Tags',               type: 'text' },
  onboardingStatus: { column: 'e.onboarding_status', label: 'Onboarding Status', type: 'text' },
  presentAddress:{ column: 'e.current_address', label: 'Present Address',  type: 'text' },
  permanentAddress: { column: 'e.permanent_address', label: 'Permanent Address', type: 'text' },
};

/* The All Data dropdown. Anything narrower than the caller's own visibility is
 * fine; nothing here may WIDEN it, which is why each branch only ever adds a
 * predicate on top of the reporting-line clause the route already applies. */
function scopeClause(scope, user, idx) {
  switch (scope) {
    case 'my':
      return { clause: ` AND e.id = $${idx}`, params: [user._id] };
    case 'direct':
      return { clause: ` AND e.reporting_manager_id = $${idx}`, params: [user._id] };
    case 'reportees':
      // Everyone below them in the tree, at any depth.
      return { clause: ` AND e.id IN (
        WITH RECURSIVE tree AS (
          SELECT id FROM employees WHERE reporting_manager_id = $${idx}
          UNION ALL
          SELECT c.id FROM employees c JOIN tree t ON c.reporting_manager_id = t.id
        ) SELECT id FROM tree)`, params: [user._id] };
    case 'reportees_and_me':
      return { clause: ` AND (e.id = $${idx} OR e.id IN (
        WITH RECURSIVE tree AS (
          SELECT id FROM employees WHERE reporting_manager_id = $${idx}
          UNION ALL
          SELECT c.id FROM employees c JOIN tree t ON c.reporting_manager_id = t.id
        ) SELECT id FROM tree))`, params: [user._id] };
    default:
      return { clause: '', params: [] };
  }
}

/* Columns whose VALUES must never reach the audit trail. The fact that one
 * changed is worth recording; what it changed to is not, because the audit
 * page is readable by every admin and these are identity documents and
 * credentials. Column names, not camelCase body keys — the diff runs against
 * the table. */
const REDACTED_AUDIT_COLUMNS = new Set([
  'pan_number', 'aadhaar_number', 'uan_number', 'passport_number',
  'driving_license', 'voter_id', 'bank_account', 'bank_ifsc',
  'password', 'reset_password_token', 'mfa_secret', 'mfa_backup_codes',
  'calendar_token',
]);
const logger = require('../logger');

router.use(protect);

const { nextIdForCompany } = require('../utils/employeeId');
const { mergeRows } = require('../utils/mergeRows');
const { orgPolicy, applyPrivacy } = require('../utils/orgPolicy');
const { serverError } = require('../utils/serverError');
const { announceNewJoiner } = require('../utils/newJoinerNotice');

// GET next suggested employee_id — used by Confirm Registration + Add Employee
// modals to prefill. Pass ?company=AltiusNxt for the per-company format
// (e.g. ANXT2600150). See utils/employeeId.js for the format rules.
router.get('/next-id', async (req, res) => {
  try {
    const suggested = await nextIdForCompany(pool, req.query.company);
    res.json({ success: true, data: { suggested } });
  } catch (err) {
    serverError(res, err);
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
       AND (role IN ('admin', 'manager', 'director') OR designation ILIKE '%Lead%' OR designation ILIKE '%Manager%' OR designation ILIKE '%Head%')
       ORDER BY first_name ASC`
    );

    // Add approving authorities list (managers who can approve leaves)
    const approvingAuthoritiesResult = await pool.query(
      'SELECT id as "_id", first_name as "firstName", last_name as "lastName", email, designation FROM employees WHERE (role = \'super_admin\' OR role = \'manager\' OR role = \'hr\') AND status = \'active\' ORDER BY first_name ASC'
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
    serverError(res, err);
  }
});

// GET all employees
router.get('/', async (req, res) => {
  try {
    const { department, role, designation, status, search, page = 1, limit = 20, includeDeleted } = req.query;
    let query = 'WHERE 1=1';
    let params = [];
    let paramIndex = 1;

    // Soft-delete: hide archived employees unless the caller is an admin who
    // explicitly asks for them (e.g. an "Archived" tab in Employee Master).
    if (!(includeDeleted === 'true' && isFullAccess(req.user.role))) {
      query += ' AND e.deleted_at IS NULL';
    }

    // Managers can only see their direct reports — never the full org.
    // Admins (and the elevated 'director' role if used) see everyone.
    if (req.user.role === 'manager') {
      query += ` AND e.reporting_manager_id = $${paramIndex++}`;
      params.push(req.user._id);
    }

    if (department)  { query += ` AND e.department = $${paramIndex++}`;  params.push(department); }
    if (role)        { query += ` AND e.role = $${paramIndex++}`;        params.push(role); }
    if (designation) { query += ` AND e.designation = $${paramIndex++}`; params.push(designation); }
    // 'inactive' is the tab's umbrella filter for "not currently active"
    // (notice_period / resigned / terminated / inactive) — matches the
    // intent already documented on the frontend's statusFilter state, not
    // a literal status value. Any other status is matched exactly.
    if (status === 'inactive') { query += ` AND e.status <> 'active'`; }
    else if (status)           { query += ` AND e.status = $${paramIndex++}`; params.push(status); }
    if (search && search.trim()) {
      // Untrimmed input used to build the wildcard pattern directly — a
      // search of " Balaji " (stray leading/trailing space, easy to type
      // or paste by accident) required that literal space to appear next
      // to the match inside the stored value, so it silently found
      // nothing even though "Balaji" existed.
      // "Allow employee information to be searched using mobile number" on
      // Organization > Policy. Off by default, and off means a phone number
      // typed into search finds nobody rather than quietly matching.
      const byMobile = !!(await orgPolicy())?.employeeSearch?.byMobileNumber;
      query += ` AND (e.first_name ILIKE $${paramIndex} OR e.last_name ILIKE $${paramIndex} OR e.email ILIKE $${paramIndex} OR e.employee_id ILIKE $${paramIndex}${byMobile ? ` OR e.phone ILIKE $${paramIndex}` : ''})`;
      params.push(`%${search.trim()}%`);
      paramIndex++;
    }

    /* Employee Information's filter panel. Additive to everything above: the
     * reporting-line restriction has already been applied, so criteria can
     * only ever narrow further. */
    const crit = buildCriteria(EMPLOYEE_FIELDS, req.query.criteria, paramIndex);
    if (crit.clause) { query += crit.clause; params.push(...crit.params); paramIndex = crit.nextIdx; }

    // The All Data dropdown. Same rule: narrows, never widens.
    const sc = scopeClause(req.query.scope, req.user, paramIndex);
    if (sc.clause) { query += sc.clause; params.push(...sc.params); paramIndex += sc.params.length; }

    // Bug #2 fix: capture filter params BEFORE adding limit/offset
    const filterParams = [...params];

    const limitNum = Math.min(500, Math.max(1, Number(limit) || 50));
    const offsetNum = (Number(page) - 1) * limitNum;
    params.push(limitNum, offsetNum);

    const employeesResult = await pool.query(
      `SELECT e.id as "_id", e.first_name AS "firstName", e.last_name AS "lastName", e.email, e.role, e.department, e.designation, e.company, e.division, e.employee_id AS "employeeId", e.status, e.joining_date AS "joiningDate", e.phone, e.privacy_prefs AS "privacyPrefs", e.reporting_manager_id AS "reportingManagerId", e.approving_authority_id AS "approvingAuthorityId",
       e.monthly_ctc AS "monthlyCTC", e.basic_salary AS "basicSalary",
       e.casual_leave AS "casualLeave", e.sick_leave AS "sickLeave", e.earned_leave AS "earnedLeave",
       e.photo_url AS "photoUrl", e.exit_date AS "exitDate", e.total_experience AS "totalExperience", e.expertise,
       e.is_blacklisted AS "isBlacklisted", e.notice_period_end_date AS "noticePeriodEndDate", e.rehire_eligibility AS "rehireEligibility",
       e.nick_name AS "nickName", e.work_location AS "workLocation", e.employment_type AS "employmentType",
       e.seating_location AS "seatingLocation", e.tags, e.onboarding_status AS "onboardingStatus",
       e.source_of_hire AS "sourceOfHire", e.date_of_joining AS "dateOfJoining", e.date_of_birth AS "dateOfBirth",
       e.gender, e.marital_status AS "maritalStatus", e.about_me AS "aboutMe",
       e.work_phone AS "workPhone", e.extension, e.personal_email AS "personalEmail",
       e.current_address AS "presentAddress", e.permanent_address AS "permanentAddress",
       e.created_at AS "addedTime", e.updated_at AS "modifiedTime",
       e.secondary_manager_id AS "secondaryManagerId",
       /* Identity numbers never leave as values in a list. The column says
        * whether one is on file so the UI can show the dots and an eye, and
        * revealing a single person's is a separate, audited request. */
       (e.aadhaar_number IS NOT NULL AND e.aadhaar_number <> '') AS "hasAadhaar",
       (e.pan_number     IS NOT NULL AND e.pan_number     <> '') AS "hasPan",
       (e.uan_number     IS NOT NULL AND e.uan_number     <> '') AS "hasUan",
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
       ORDER BY ${buildOrder(EMPLOYEE_FIELDS, req.query.sortBy, req.query.sortDir, 'e.created_at')}
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      params
    );

    /* The count must join exactly what the WHERE can reference. It used to be
     * `FROM employees e` alone, which was fine while every filter was on `e`;
     * the moment the filter panel could sort or filter on the reporting
     * manager's name that became "missing FROM-clause entry for table m" and
     * took the whole list down, not just the count. */
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM employees e
         LEFT JOIN employees m ON e.reporting_manager_id = m.id
         ${query.replace(/LIMIT.*/s, '')}`,
      filterParams
    );
    const total = parseInt(countResult.rows[0].count, 10);

    const canSeeSalary = ['admin', 'director', 'hr_admin'].includes(req.user.role);
    let visible = canSeeSalary ? employeesResult.rows : employeesResult.rows.map(({ monthlyCTC, basicSalary, ...rest }) => rest);

    /* Settings -> Employee Information -> Access Control -> Field Permissions.
     * It can only take fields away: an empty configuration leaves the response
     * exactly as it was, and full access is exempt because locking an
     * administrator out of the record they administer makes the product
     * unusable by its own owner. */
    if (!canSeeSalary) {
      const hidden = await hiddenFieldsFor(req.user.role, 'employee');
      if (hidden.size) {
        visible = visible.map(row => {
          const out = { ...row };
          for (const k of hidden) delete out[k];
          return out;
        });
      }
    }

    // A person always sees their own record whole; the preference governs what
    // OTHER people see, and hiding a field from its owner would leave them
    // unable to tell what they had chosen. Full-access roles keep the whole
    // record too — HR has to be able to reach a phone number in an emergency.
    const policy = await orgPolicy();
    const data = visible.map(row =>
      (canSeeSalary || String(row._id) === String(req.user._id))
        ? (({ privacyPrefs, ...rest }) => rest)(row)
        : applyPrivacy(row, policy));

    res.json({ success: true, data, total, page: Number(page), pages: Math.ceil(total / limitNum) });
  } catch (err) {
    serverError(res, err);
  }
});

// GET single employee — Bug #9 fix: include leave balance columns
router.get('/:id', async (req, res) => {
  // Full-access roles (admin/director/hr_admin) may fetch any employee's PII.
  // All other roles may only fetch their own record (needed for the profile page).
  if (!isFullAccess(req.user.role) && String(req.params.id) !== String(req.user._id)) {
    return res.status(403).json({ success: false, message: 'Access denied.' });
  }
  try {
    // SELECT every column on employees so the Edit modal can populate fields
    // like nickName, personalEmail, workPhone, PAN, Aadhaar, bank, emergency
    // contact, etc. The aliased columns below are kept for backward compat
    // with existing consumers that read camelCase keys; `e.*` adds the
    // snake_case originals so my get(camel, snake) helper in the frontend
    // resolves either form.
    const result = await pool.query(
      `SELECT e.*,
              e.id            AS "_id",
              e.first_name    AS "firstName",
              e.last_name     AS "lastName",
              e.nick_name     AS "nickName",
              e.employee_id   AS "employeeId",
              e.joining_date  AS "joiningDate",
              e.date_of_birth AS "dateOfBirth",
              e.marital_status AS "maritalStatus",
              e.blood_group   AS "bloodGroup",
              e.personal_email AS "personalEmail",
              e.work_phone    AS "workPhone",
              e.permanent_address AS "permanentAddress",
              e.pan_number    AS "panNumber",
              e.aadhaar_number AS "aadhaarNumber",
              e.uan_number    AS "uanNumber",
              e.bank_name     AS "bankName",
              e.bank_account  AS "bankAccount",
              e.bank_ifsc     AS "bankIfsc",
              e.emergency_contact_name     AS "emergencyContactName",
              e.emergency_contact_phone    AS "emergencyContactPhone",
              e.emergency_contact_relation AS "emergencyContactRelation",
              e.work_location AS "workLocation",
              e.employment_type AS "employmentType",
              e.reporting_manager_id   AS "reportingManagerId",
              e.approving_authority_id AS "approvingAuthorityId",
              e.casual_leave  AS "casualLeave",
              e.sick_leave    AS "sickLeave",
              e.earned_leave  AS "earnedLeave",
              e.unpaid_leave  AS "unpaidLeave",
              e.monthly_ctc   AS "monthlyCTC",
              e.basic_salary  AS "basicSalary",
              e.photo_url     AS "photoUrl",
              e.notice_period_end_date AS "noticePeriodEndDate",
              e.status_reason          AS "statusReason",
              e.rehire_eligibility     AS "rehireEligibility",
              e.is_blacklisted         AS "isBlacklisted",
              e.status_applied_at      AS "statusAppliedAt",
              e.exit_date              AS "exitDate",
              e.total_experience       AS "totalExperience",
              e.attendance_tracked     AS "attendanceTracked",
              e.about_me               AS "aboutMe",
              e.seating_location       AS "seatingLocation",
              e.onboarding_status      AS "onboardingStatus",
              e.current_address        AS "currentAddress",
              e.source_of_hire         AS "sourceOfHire",
              e.date_of_joining        AS "dateOfJoining",
              e.secondary_manager_id   AS "secondaryManagerId",
              e.created_at             AS "createdAt",
              e.updated_at             AS "updatedAt",
              /* Identity numbers come back for the record view, which is full
               * access only — but the has-flags are sent too so a viewer can
               * render the dots without reading the value. */
              (e.aadhaar_number IS NOT NULL AND e.aadhaar_number <> '') AS "hasAadhaar",
              (e.pan_number     IS NOT NULL AND e.pan_number     <> '') AS "hasPan",
              (e.uan_number     IS NOT NULL AND e.uan_number     <> '') AS "hasUan",
              CASE WHEN sm.id IS NOT NULL THEN json_build_object(
                'id', sm.id, 'firstName', sm.first_name, 'lastName', sm.last_name,
                'employeeId', sm.employee_id) END AS "secondaryManager",
              CASE WHEN cb.id IS NOT NULL THEN json_build_object(
                'id', cb.id, 'firstName', cb.first_name, 'lastName', cb.last_name) END AS "createdBy",
              CASE WHEN ub.id IS NOT NULL THEN json_build_object(
                'id', ub.id, 'firstName', ub.first_name, 'lastName', ub.last_name) END AS "updatedBy",
              json_build_object('name', s.name, 'startTime', s.start_time, 'endTime', s.end_time) AS shift,
              json_build_object('firstName', m.first_name, 'lastName', m.last_name, 'email', m.email, 'id', m.id, 'employeeId', m.employee_id, 'designation', m.designation) AS manager,
              json_build_object('firstName', aa.first_name, 'lastName', aa.last_name, 'email', aa.email, 'id', aa.id, 'employeeId', aa.employee_id, 'designation', aa.designation) AS "approvingAuthority"
         FROM employees e
         LEFT JOIN shifts s ON e.shift_id = s.id
         LEFT JOIN employees m ON e.reporting_manager_id = m.id
         LEFT JOIN employees aa ON e.approving_authority_id = aa.id
         LEFT JOIN employees sm ON e.secondary_manager_id = sm.id
         LEFT JOIN employees cb ON e.created_by = cb.id
         LEFT JOIN employees ub ON e.updated_by = ub.id
        WHERE e.id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Employee not found' });

    const empData = result.rows[0];
    // Never expose security-sensitive columns regardless of caller role
    delete empData.password;
    delete empData.mfa_secret;
    delete empData.mfa_backup_codes;
    delete empData.reset_password_token;
    delete empData.reset_password_expires;
    const eduRes = await pool.query('SELECT * FROM employee_education WHERE employee_id = $1 ORDER BY year_of_passing DESC', [req.params.id]);
    // Collapse partial duplicate education rows (same institute + year) so each
    // qualification shows once — same fix as the own-Profile page.
    empData.education = mergeRows(
      eduRes.rows,
      (r) => `${String(r.university_or_institution || '').trim().toLowerCase()}|${r.year_of_passing || ''}`,
      ['highest_qualification', 'degree', 'course', 'university_or_institution', 'year_of_passing', 'percentage_or_cgpa']
    );
    
    // employee_documents was migrated from (document_type, file_path,
    // original_name, mime_type, size) to (type, file_url, name, file_size).
    // Fresh deploys only have the new columns — alias them to the legacy
    // names the frontend's profile view expects so we don't churn the UI.
    const docsRes = await pool.query(
      `SELECT id,
              type      AS "documentType",
              file_url  AS "filePath",
              name      AS "originalName",
              NULL      AS "mimeType",
              file_size AS "size"
         FROM employee_documents WHERE employee_id = $1`,
      [req.params.id]
    );
    empData.documents = docsRes.rows;
    
    res.json({ success: true, data: empData });
  } catch (err) {
    serverError(res, err);
  }
});

// POST create employee — full-access only (managers have no employee CRUD)
router.post('/', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  try {
    let { firstName, lastName, email, password, phone, role, department, designation, company, division, joiningDate, monthlyCTC, basicSalary, casualLeave, sickLeave, earnedLeave, reportingManagerId, approvingAuthorityId, employeeId: providedId } = req.body;
    let hashedPassword = null;
    if (password) hashedPassword = await bcrypt.hash(password, 12);
    const createdBy = req.user._id;   // System Fields: Added By

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
      // shift_id is taken from the shift marked default in
      // Settings -> Shifts -> Configuration. Without it a new employee had no
      // shift at all, and their expected hours and late marking silently fell
      // back to org-wide values — the only reason nobody had hit this is that
      // migrate_default_shift.js linked every existing employee by hand.
      `INSERT INTO employees (first_name, last_name, email, password, phone, role, department, designation, company, division, joining_date, employee_id, registration_status, has_accepted, monthly_ctc, basic_salary, casual_leave, sick_leave, earned_leave, reporting_manager_id, approving_authority_id, shift_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'active', true, $13, $14, $15, $16, $17, $18, $19,
               (SELECT id FROM shifts WHERE is_default = TRUE ORDER BY created_at LIMIT 1))
       RETURNING id as "_id", first_name AS "firstName", last_name AS "lastName", email, role, department, designation, employee_id AS "employeeId"`,
      [firstName, lastName, email.toLowerCase(), hashedPassword, phone, role || 'team_member', department, designation, company, division, joiningDate || new Date(), employeeId,
       // monthly_ctc and basic_salary are nullable — "" / 0 / undefined all collapse to NULL.
       monthlyCTC || null, basicSalary || null,
       // Leave-balance columns are NOT NULL with table-level defaults; we keep
       // the same defaults here. `??` alone treats "" as a valid value and
       // pg rejects it for NUMERIC columns ("invalid input syntax for type
       // integer: ''") — so guard empty strings too.
       (casualLeave === '' || casualLeave == null) ? 12 : Number(casualLeave),
       (sickLeave   === '' || sickLeave   == null) ? 10 : Number(sickLeave),
       (earnedLeave === '' || earnedLeave == null) ? 15 : Number(earnedLeave),
       reportingManagerId || null, approvingAuthorityId || null]
    );

    await logAudit(req, {
      action: 'CREATE',
      resource: 'Employee',
      resourceId: result.rows[0]._id,
      changes: { email: email.toLowerCase(), role, department }
    });

    // Fire-and-forget: the employee exists, and a workflow must never be able
    // to fail or delay creating one.
    fire('employee', 'created', { recordId: result.rows[0]._id, actorId: req.user._id });
    res.status(201).json({ success: true, data: result.rows[0] });

    /* An employee added here is a new joiner too, so colleagues hear about it
     * the same way. After the response and never able to fail the create.
     * Bulk loading goes through /org-users/import instead, which does NOT
     * announce — importing a hundred and fifty people would otherwise write
     * twenty-two thousand notifications. */
    announceNewJoiner(result.rows[0]._id).catch(() => {});
  } catch (err) {
    // The pre-check above closes most races, but two submissions using the
    // same server-suggested employee_id (double-click, or two admins adding
    // someone at once) can both pass it before either INSERTs — the DB's
    // own unique index is the real backstop for that case. Previously any
    // 23505 was reported as "Email already exists" regardless of which
    // constraint actually fired, which is simply wrong when the real
    // collision is on employee_id, not email — sends whoever's debugging it
    // looking for a duplicate email that was never the problem.
    if (err.code === '23505') {
      if (err.constraint && err.constraint.includes('employee_id')) {
        return res.status(400).json({ success: false, message: 'That Employee ID was just taken by another submission. Please try again.' });
      }
      return res.status(400).json({ success: false, message: 'Email already exists' });
    }
    serverError(res, err);
  }
});


// PUT update employee — full-access only (managers have no employee CRUD)
router.put('/:id', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
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
      // Zoho-synced extras
      exitDate, totalExperience, expertise,
      /* Fields the employee record shows but the update route never accepted,
       * so editing them silently did nothing. aboutMe in particular was not
       * read or written anywhere despite being populated by the migration. */
      aboutMe, seatingLocation, tags, onboardingStatus, secondaryManagerId, extension,
      // Employment status workflow (post-meeting feature)
      noticePeriodEndDate, statusReason, rehireEligibility, isBlacklisted, statusAppliedAt,
      // Whether attendance applies to this person at all — independent of
      // login. See migrate_attendance_tracked.js.
      attendanceTracked,
    } = req.body;

    // Nothing prevented setting someone as their own reporting manager —
    // trivial to do via this endpoint even though there's no UI path to it
    // deliberately, and it feeds directly into deriveLevels' approval-chain
    // walk (leaveApproval.js), which resolves reporting_manager_id upward.
    // That walk has its own depth<20 cycle guard so a self-reference can't
    // hang the server, but the employee would still end up as their own
    // Level-1 approver — reject it outright instead.
    if (reportingManagerId && String(reportingManagerId) === String(req.params.id)) {
      return res.status(400).json({ success: false, message: 'An employee cannot be their own reporting manager.' });
    }
    if (approvingAuthorityId && String(approvingAuthorityId) === String(req.params.id)) {
      return res.status(400).json({ success: false, message: 'An employee cannot be their own approving authority.' });
    }

    // Uniqueness guard if admin is changing employee_id. Unique index would
    // also catch it, but a friendly message is better.
    if (employeeId !== undefined && employeeId !== '' && employeeId !== null) {
      const clash = await pool.query('SELECT id FROM employees WHERE employee_id = $1 AND id <> $2', [employeeId, req.params.id]);
      if (clash.rows.length > 0) {
        return res.status(400).json({ success: false, message: `Employee ID "${employeeId}" is already in use` });
      }
    }

    // ⚠️ DO NOT interpolate caller-supplied strings as column names below.
    // Every `updates.push(...)` line uses a hardcoded snake_case column literal
    // and parameterises the VALUE only ($1, $2, ...). Treat the block as a
    // closed allowlist — adding a new field means adding a new literal line
    // here, never pulling the column name from req.body.
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
    // Postgres rejects "" for DATE / TIMESTAMP columns with
    // "invalid input syntax for type timestamp: ''" — coerce blanks to NULL.
    if (joiningDate !== undefined) { updates.push(`joining_date = $${i++}`); params.push(joiningDate || null); }
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
    if (exitDate !== undefined)                 { updates.push(`exit_date = $${i++}`);                 params.push(exitDate || null); }
    if (totalExperience !== undefined)          { updates.push(`total_experience = $${i++}`);          params.push(totalExperience || null); }
    if (expertise !== undefined)                { updates.push(`expertise = $${i++}`);                 params.push(expertise || null); }
    if (aboutMe !== undefined)                  { updates.push(`about_me = $${i++}`);                  params.push(aboutMe || null); }
    if (seatingLocation !== undefined)          { updates.push(`seating_location = $${i++}`);          params.push(seatingLocation || null); }
    if (tags !== undefined)                     { updates.push(`tags = $${i++}`);                      params.push(tags || null); }
    if (onboardingStatus !== undefined)         { updates.push(`onboarding_status = $${i++}`);         params.push(onboardingStatus || null); }
    if (secondaryManagerId !== undefined)       { updates.push(`secondary_manager_id = $${i++}`);      params.push(secondaryManagerId || null); }
    if (extension !== undefined)                { updates.push(`extension = $${i++}`);                 params.push(extension || null); }
    if (bloodGroup !== undefined)               { updates.push(`blood_group = $${i++}`);               params.push(bloodGroup || null); }
    if (nationality !== undefined)              { updates.push(`nationality = $${i++}`);               params.push(nationality || null); }
    // Who last touched the record, for the System Fields block.
    updates.push(`updated_by = $${i++}`);        params.push(req.user._id);
    // Employment status workflow fields
    if (noticePeriodEndDate !== undefined)      { updates.push(`notice_period_end_date = $${i++}`);    params.push(noticePeriodEndDate || null); }
    if (statusReason !== undefined)             { updates.push(`status_reason = $${i++}`);             params.push(statusReason || null); }
    if (rehireEligibility !== undefined)        { updates.push(`rehire_eligibility = $${i++}`);        params.push(rehireEligibility || null); }
    if (isBlacklisted !== undefined)            { updates.push(`is_blacklisted = $${i++}`);            params.push(!!isBlacklisted); }
    if (statusAppliedAt !== undefined)          { updates.push(`status_applied_at = $${i++}`);         params.push(statusAppliedAt || null); }
    // Per person, not per role — a title is not a promise about whether
    // someone punches a clock. Independent of login: is_user/login_enabled
    // are untouched here.
    if (attendanceTracked !== undefined)        { updates.push(`attendance_tracked = $${i++}`);        params.push(!!attendanceTracked); }

    if (updates.length === 0) return res.json({ success: true, message: 'Nothing to update' });

    /* Read the row as it stands so the audit entry can record old -> new.
     * It previously logged req.body, i.e. the new values only, which meant the
     * trail could say what a field became but never what it had been — and an
     * "Employee Status: Active" line tells you nothing on its own. The whole
     * Audit History timeline depends on this pair. */
    const beforeRes = await pool.query('SELECT * FROM employees WHERE id = $1', [req.params.id]);
    const before = beforeRes.rows[0] || {};

    updates.push(`updated_at = NOW()`);

    params.push(req.params.id);

    const result = await pool.query(
      `UPDATE employees SET ${updates.join(', ')} WHERE id = $${i}
       RETURNING id as "_id", first_name AS "firstName", last_name AS "lastName", email, role, department, designation, employee_id AS "employeeId"`,
      params
    );

    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Employee not found' });

    /* {field, from, to} is the shape AuditLog.jsx already renders, so employee
     * edits now appear there as a real before/after rather than a blob. */
    const after = (await pool.query('SELECT * FROM employees WHERE id = $1', [req.params.id])).rows[0] || {};
    const written = updates
      .map(u => String(u).split('=')[0].trim())
      .filter(c => c && c !== 'updated_at');

    const auditFields = [];
    for (const col of written) {
      // Identity and credential columns are recorded as having changed, never
      // with their values — an audit trail that leaks a PAN is worse than one
      // that is vague, and it is readable by anyone who can open the page.
      if (REDACTED_AUDIT_COLUMNS.has(col)) {
        auditFields.push({ field: col, from: '(hidden)', to: '(hidden)' });
        continue;
      }
      const from = before[col] ?? null;
      const to   = after[col] ?? null;
      // Dates come back as Date objects and numerics as strings, so compare
      // rendered values or every save looks like it changed everything.
      const same = (from instanceof Date && to instanceof Date)
        ? from.getTime() === to.getTime()
        : String(from ?? '') === String(to ?? '');
      if (!same) auditFields.push({ field: col, from, to });
    }

    if (auditFields.length) {
      await logAudit(req, {
        action: 'UPDATE',
        resource: 'Employee',
        resourceId: req.params.id,
        changes: {
          summary: `${auditFields.length} field(s) changed`,
          fields: auditFields,
        },
      });
    }

    // The column names that were actually written, so a "specific field is
    // updated" workflow can tell whether its field was one of them. Derived
    // from the update list the query was built from, not from req.body — the
    // body carries keys that were ignored.
    fire('employee', 'edited', {
      recordId: req.params.id,
      actorId: req.user._id,
      changedFields: updates.map(u => u.split(' = ')[0].trim()),
    });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ success: false, message: 'Email already exists' });
    serverError(res, err);
  }
});

// POST send onboarding email — full-access only (onboarding = HR function)
router.post('/send-onboarding', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
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

    /* The candidate is emailed the raw token; the table stores only its hash.
     *
     * That is deliberate — a leaked row must not be a usable invite — and both
     * readers, validate-token and submit, hash the token out of the URL before
     * looking it up. This route stored the RAW value, so the lookup searched
     * for a hash, found nothing, and every invite sent from Send Preboarding
     * came back "Invalid token." It had never worked. The Registrations page
     * hashes correctly, which is why the bug hid. */
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await pool.query(
      'INSERT INTO onboarding_tokens (token, email, created_by, expires_at) VALUES ($1, $2, $3, $4)',
      [tokenHash, email, req.user._id, expiresAt]
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
    logger.error({ err: err?.message }, 'Onboarding email failed');
    /* Was `'An internal server error occurred' || 'Failed to send email'` — a
     * non-empty string is truthy, so the second half could never be reached.
     * The real detail is in the log line above; the caller gets the one
     * sentence every other handler gives. */
    serverError(res, err);
  }
});

// DELETE employee — soft-delete. ON DELETE CASCADE would wipe attendance,
// leaves, payslips, audit trail, etc. Instead, mark the row deleted_at = NOW()
// and rely on SELECT-side filters to hide it. Hard delete is intentionally
// removed; admins who *really* want to purge can do so directly in the DB
// after reviewing what CASCADEs.
router.delete('/:id', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  try {
    // Soft-deleting someone who's still another active employee's manager/
    // approving authority previously went through silently — the reports'
    // reporting_manager_id kept pointing at an archived, can't-log-in
    // employee. deriveLevels (leaveApproval.js) still walks that chain
    // regardless of deleted_at, so those employees' leave requests would
    // route to an approver who can never act on them — a stuck request
    // with no visible error anywhere. Block the delete instead and make
    // the admin reassign reports first.
    const stillManages = await pool.query(
      `SELECT COUNT(*)::int AS n FROM employees
        WHERE (reporting_manager_id = $1 OR approving_authority_id = $1) AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (stillManages.rows[0].n > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot deactivate — ${stillManages.rows[0].n} active employee(s) still report to this person. Reassign their reporting manager/approving authority first.`,
      });
    }

    const r = await pool.query(
      `UPDATE employees
          SET deleted_at = NOW(),
              status = 'inactive',
              registration_status = 'deleted',
              updated_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING id`,
      [req.params.id]
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Employee not found or already deleted' });
    }

    await logAudit(req, {
      action: 'SOFT_DELETE',
      resource: 'Employee',
      resourceId: req.params.id
    });

    res.json({ success: true, message: 'Employee archived' });
  } catch (err) {
    serverError(res, err);
  }
});

/* ════════════════════════════════════════════════════════════════════════
 *  App access — used by the Approve Registration modal and the Edit
 *  Employee modal so admin can grant/revoke app access without a second
 *  trip to the API Connections page.
 * ══════════════════════════════════════════════════════════════════════ */

// GET /api/employees/:id/app-access — all user-facing apps with this
// employee's current access status. One query, no N+1.
router.get('/:id/app-access', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT a.id, a.name, a.description,
             a.app_icon  AS "icon",
             a.app_color AS "color",
             a.website_url AS "websiteUrl",
             (ac.id IS NOT NULL AND ac.revoked_at IS NULL) AS "hasAccess"
        FROM api_connections a
        LEFT JOIN application_access ac
          ON ac.api_connection_id = a.id AND ac.employee_id = $1
       WHERE a.is_user_app = TRUE AND a.is_active = TRUE
       ORDER BY a.name ASC
    `, [req.params.id]);
    res.json({ success: true, data: r.rows });
  } catch (err) { serverError(res, err); }
});

// PUT /api/employees/:id/app-access — sync this employee's access list
// to match `apiConnectionIds` exactly: grant new ones, revoke removed ones.
// Idempotent. Used by Approve modal (post-approve) and Edit modal (post-save).
router.put('/:id/app-access', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  const client = await pool.connect();
  try {
    const wanted = Array.isArray(req.body?.apiConnectionIds) ? req.body.apiConnectionIds : [];
    await client.query('BEGIN');

    // Grant or un-revoke everything the admin checked
    if (wanted.length > 0) {
      await client.query(`
        INSERT INTO application_access (api_connection_id, employee_id, granted_by)
        SELECT unnest($1::uuid[]), $2, $3
          ON CONFLICT (api_connection_id, employee_id) DO UPDATE
            SET revoked_at = NULL, revoked_by = NULL, revoke_reason = NULL,
                granted_at = NOW(), granted_by = EXCLUDED.granted_by
      `, [wanted, req.params.id, req.user._id]);
    }

    // Soft-revoke anything previously granted that's no longer checked.
    // ANY() needs a non-empty array — pass a sentinel UUID when wanted is empty.
    const exclusion = wanted.length ? wanted : ['00000000-0000-0000-0000-000000000000'];
    await client.query(`
      UPDATE application_access
         SET revoked_at = NOW(), revoked_by = $1, revoke_reason = 'Removed via employee edit'
       WHERE employee_id = $2
         AND revoked_at IS NULL
         AND NOT (api_connection_id = ANY($3::uuid[]))
    `, [req.user._id, req.params.id, exclusion]);

    await client.query('COMMIT');
    res.json({ success: true, granted: wanted.length });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    serverError(res, err);
  } finally { client.release(); }
});

module.exports = router;
