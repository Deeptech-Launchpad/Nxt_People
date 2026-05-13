/**
 * Zoho People sync — admin-triggered, one-way (Zoho → Nxt-People).
 *
 * Two-pass:
 *   Pass 1 — upsert every employee. New rows start with role='employee'.
 *   Pass 2 — resolve "ReportingTo" → reporting_manager_id (foreign key into our table).
 *
 * Never touches: role, password, MFA settings, leave balances, attendance.
 * Promotion to manager/admin is a separate manual step in Employee Master.
 */

const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const logger  = require('../logger');
const { protect, authorize } = require('../middleware/auth');
const { iterateEmployees, iteratePayroll, listEmployeeFiles, downloadFile } = require('../utils/zoho');
const fs = require('fs');
const path = require('path');

router.use(protect, authorize('admin'));

/* ── Field mapping ─────────────────────────────────────────────────────────
 * Zoho's field names vary slightly across orgs. Try the standard Zoho People
 * names first, then a few common aliases. Returns `undefined` if no field
 * holds a non-empty value.
 */
const pick = (record, ...candidates) => {
  for (const k of candidates) {
    const v = record[k];
    if (v !== undefined && v !== null && String(v).trim() !== '' && String(v).trim() !== '-') {
      return String(v).trim();
    }
  }
  return undefined;
};

/** Convert various date strings Zoho returns into 'YYYY-MM-DD' or null. */
const toIsoDate = (raw) => {
  if (!raw) return null;
  // Zoho commonly returns dd-MMM-yyyy ("15-Aug-2024") or dd/MM/yyyy.
  const tryParse = (s) => {
    const d = new Date(s);
    return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
  };
  return tryParse(raw) || tryParse(String(raw).replace(/-/g, ' ')) || null;
};

/** Map a single Zoho record to the columns we write. */
function mapEmployee(rec) {
  const email = pick(rec, 'EmailID', 'Email', 'Email_ID', 'Workemail');
  if (!email) return null; // can't import without an email — it's our login key

  const status = (pick(rec, 'Employeestatus', 'EmployeeStatus') || '').toLowerCase();
  const ourStatus = status.includes('active') ? 'active' : 'inactive';

  return {
    // ── Identity ──────────────────────────────────────────────────────
    email:        email.toLowerCase(),
    employeeId:   pick(rec, 'EmployeeID', 'Employee_ID', 'employee_id'),
    firstName:    pick(rec, 'FirstName', 'First_Name') || '',
    lastName:     pick(rec, 'LastName', 'Last_Name') || '',
    nickName:     pick(rec, 'Nickname', 'NickName', 'Nick_Name'),
    // ── Work ──────────────────────────────────────────────────────────
    department:        pick(rec, 'Department'),
    designation:       pick(rec, 'Designation', 'JobTitle'),
    // Zoho often omits Company when there's only one in the workspace.
    // Fall back to ZOHO_DEFAULT_COMPANY (set in .env) so the Employee ID
    // sequence + company-based reports work out of the box. Default to
    // 'AltiusNxt' if that env var is also unset.
    company:           pick(rec, 'Company', 'LegalEntity', 'OrganizationName') ||
                       process.env.ZOHO_DEFAULT_COMPANY ||
                       'AltiusNxt',
    division:          pick(rec, 'Division', 'BusinessUnit'),
    // Zoho People is case-sensitive on JSON keys, and the AltiusNxt form
    // uses keys like "Work_location" (lowercase l) and "Employee_type"
    // (lowercase t) instead of the CamelCase variants. Try all common forms.
    workLocation:      pick(rec, 'Work_location', 'WorkLocation', 'Work_Location', 'Location', 'LocationName', 'Office'),
    employmentType:    pick(rec, 'Employee_type', 'EmploymentType', 'Employment_Type', 'EmployeeType'),
    sourceOfHire:      pick(rec, 'Source_of_hire', 'SourceOfHire', 'Source_Of_Hire'),
    joiningDate:       toIsoDate(pick(rec, 'Dateofjoining', 'Date_of_joining', 'DateOfJoining', 'JoiningDate')),
    status:            ourStatus,
    reportsToEmail:    (pick(rec, 'Reporting_To.MailID', 'Reporting_To', 'ReportingTo', 'ManagerEmail') || '').toLowerCase() || null,
    secondaryReportsToEmail: (pick(rec, 'Second_Reporting_To.MailID', 'Second_Reporting_To', 'SecondaryReportingTo', 'Secondary_Reporting_To') || '').toLowerCase() || null,
    // ── Personal ──────────────────────────────────────────────────────
    dateOfBirth:    toIsoDate(pick(rec, 'Date_of_birth', 'Dateofbirth', 'DateOfBirth', 'DOB')),
    gender:         pick(rec, 'Gender'),
    maritalStatus:  pick(rec, 'Marital_status', 'MaritalStatus', 'Marital_Status'),
    bloodGroup:     pick(rec, 'Blood_group', 'BloodGroup', 'Blood_Group'),
    nationality:    pick(rec, 'Nationality'),
    aboutMe:        pick(rec, 'AboutMe', 'About_Me'),
    // ── Contact ───────────────────────────────────────────────────────
    phone:          pick(rec, 'Mobile', 'MobileNumber', 'PersonalMobile', 'Phone'),
    workPhone:      pick(rec, 'Work_phone', 'WorkPhone', 'Work_Phone', 'OfficePhone'),
    extension:      pick(rec, 'Extension', 'Ext'),
    // Zoho's AltiusNxt form names the personal-email field "Other_Email".
    personalEmail:  (pick(rec, 'Other_Email', 'PersonalEmail', 'Personal_Email') || '').toLowerCase() || null,
    address:           pick(rec, 'Present_Address', 'Presentaddress', 'PresentAddress', 'CurrentAddress', 'Address'),
    permanentAddress:  pick(rec, 'Permanent_Address', 'Permanentaddress', 'PermanentAddress'),
    // ── Identity documents (PII) ──────────────────────────────────────
    panNumber:     pick(rec, 'Pan_Number', 'PAN_Number', 'PAN', 'PANNumber'),
    aadhaarNumber: pick(rec, 'Aadhaar_Number', 'AadhaarNumber', 'Aadhar_Number', 'AadharNumber', 'Aadhaar'),
    uanNumber:     pick(rec, 'UAN_Number', 'UANNumber', 'UAN'),
    // ── Bank ──────────────────────────────────────────────────────────
    bankName:    pick(rec, 'BankName', 'Bank_Name'),
    bankAccount: pick(rec, 'BankAccountNumber', 'AccountNumber', 'Bank_Account_Number'),
    bankIfsc:    pick(rec, 'IFSC', 'IFSCCode', 'IFSC_Code'),
    // ── Emergency contact ─────────────────────────────────────────────
    emergencyContactName:     pick(rec, 'EmergencyContactName', 'Emergency_Contact_Name'),
    emergencyContactPhone:    pick(rec, 'EmergencyContactNumber', 'EmergencyContactPhone', 'Emergency_Contact_Number'),
    emergencyContactRelation: pick(rec, 'EmergencyContactRelationship', 'EmergencyContactRelation'),
    // ── Photo ─────────────────────────────────────────────────────────
    // Photo_downloadUrl is Zoho's CDN URL; preferred over the raw Photo field
    // (which is sometimes just an id or base64 blob).
    photoUrl: pick(rec, 'Photo_downloadUrl', 'PhotoURL', 'PhotoUrl', 'Photo', 'EmployeePhoto'),
    // ── Exit / experience / expertise ─────────────────────────────────
    exitDate:        toIsoDate(pick(rec, 'Dateofexit', 'Date_of_exit', 'DateOfExit', 'ExitDate')),
    // Zoho exposes both a numeric (months?) and a formatted "5 years 3 months"
    // string via the .displayValue suffix. The formatted version is friendlier.
    totalExperience: pick(rec, 'total_experience.displayValue', 'Experience.displayValue', 'total_experience', 'Experience', 'TotalExperience'),
    expertise:       pick(rec, 'Expertise', 'Skills', 'expertise'),
  };
}

/**
 * Parse Zoho's tabularSections — nested child records inside the main
 * employee response. Returns { education, prevEmployment, emergency } where:
 *   • education      = array of education rows
 *   • prevEmployment = array of past-job rows
 *   • emergency      = first emergency-contact row (we store one flat)
 *
 * Zoho section names vary per org (SS_FAMILY / Family / familyMembers / etc.).
 * We do case-insensitive substring matching on the section key, then a
 * flexible pick() on row fields so different field-name variants all work.
 */
function parseTabularSections(rec) {
  const sections = rec && rec.tabularSections;
  if (!sections || typeof sections !== 'object') {
    return { education: [], prevEmployment: [], emergency: null };
  }

  // Find a section by keyword(s) — case-insensitive, matches any of the names.
  const findSection = (...keywords) => {
    for (const key of Object.keys(sections)) {
      const kLower = key.toLowerCase();
      if (keywords.some(k => kLower.includes(k))) {
        const arr = sections[key];
        return Array.isArray(arr) ? arr : [];
      }
    }
    return [];
  };

  const familyRows    = findSection('family', 'dependent', 'emergency');
  const educationRows = findSection('education', 'qualification');
  const empHistoryRows = findSection('emp_history', 'employment', 'experience', 'previous');

  const education = educationRows.map(row => ({
    qualification:    pick(row, 'Highest_Qualification', 'Qualification', 'Degree', 'Level'),
    degree:           pick(row, 'Degree', 'Course', 'Specialization'),
    institute:        pick(row, 'Institute_Name', 'Institution', 'University', 'School', 'College'),
    yearOfPassing:    pick(row, 'Year_Of_Passing', 'Year_of_passing', 'YearOfPassing', 'Passing_Year'),
    percentageOrCgpa: pick(row, 'Marks_Or_CGPA', 'Percentage', 'CGPA', 'Marks', 'Grade'),
  })).filter(r => r.institute || r.qualification || r.degree);

  const prevEmployment = empHistoryRows.map(row => ({
    company:      pick(row, 'Previous_Company', 'Company_Name', 'Company', 'Employer'),
    designation:  pick(row, 'Designation', 'Job_Title', 'Role', 'Position'),
    fromDate:     toIsoDate(pick(row, 'From_Date', 'From', 'Start_Date', 'Joining_Date')),
    toDate:       toIsoDate(pick(row, 'To_Date', 'To', 'End_Date', 'Relieving_Date')),
    description:  pick(row, 'Job_Description', 'Description', 'Responsibilities'),
  })).filter(r => r.company || r.designation);

  // Emergency contact: first row of family-type section, if any.
  const first = familyRows[0];
  const emergency = first ? {
    name:     pick(first, 'Name', 'First_Name', 'Contact_Name', 'Full_Name'),
    phone:    pick(first, 'Mobile_no', 'Mobile', 'Phone', 'Contact_Number', 'Mobile_Number'),
    relation: pick(first, 'Relationship', 'Relation', 'Type'),
  } : null;

  return { education, prevEmployment, emergency };
}

/**
 * Upsert one mapped employee. Returns `'inserted'`, `'updated'`, or throws.
 * Never overwrites: role, password, MFA, leave balances.
 */
async function upsertEmployee(client, mapped) {
  const existing = await client.query(
    `SELECT id FROM employees WHERE LOWER(email) = $1`,
    [mapped.email]
  );

  // Build a single COALESCE-based UPDATE / explicit INSERT so we never wipe
  // a value we don't have. Listed in the same order so the param indexes stay aligned.
  const cols = [
    'first_name', 'last_name', 'nick_name',
    'department', 'designation', 'company', 'division', 'work_location', 'employment_type', 'source_of_hire',
    'date_of_birth', 'gender', 'marital_status', 'blood_group', 'nationality', 'about_me',
    'phone', 'work_phone', 'extension', 'personal_email',
    'address', 'permanent_address',
    'pan_number', 'aadhaar_number', 'uan_number',
    'bank_name', 'bank_account', 'bank_ifsc',
    'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relation',
    'photo_url',
    'joining_date',
    'employee_id',
    'exit_date', 'total_experience', 'expertise',
  ];
  const values = [
    mapped.firstName || null, mapped.lastName || null, mapped.nickName || null,
    mapped.department || null, mapped.designation || null, mapped.company || null, mapped.division || null, mapped.workLocation || null, mapped.employmentType || null, mapped.sourceOfHire || null,
    mapped.dateOfBirth, mapped.gender || null, mapped.maritalStatus || null, mapped.bloodGroup || null, mapped.nationality || null, mapped.aboutMe || null,
    mapped.phone || null, mapped.workPhone || null, mapped.extension || null, mapped.personalEmail || null,
    mapped.address || null, mapped.permanentAddress || null,
    mapped.panNumber || null, mapped.aadhaarNumber || null, mapped.uanNumber || null,
    mapped.bankName || null, mapped.bankAccount || null, mapped.bankIfsc || null,
    mapped.emergencyContactName || null, mapped.emergencyContactPhone || null, mapped.emergencyContactRelation || null,
    mapped.photoUrl || null,
    mapped.joiningDate,
    mapped.employeeId || null,
    mapped.exitDate, mapped.totalExperience || null, mapped.expertise || null,
  ];
  // joining_date, date_of_birth, exit_date need a ::date cast in the SQL.
  const DATE_CAST_COLS = new Set(['date_of_birth', 'joining_date', 'exit_date']);

  if (existing.rows.length > 0) {
    // UPDATE — never touches role / password / MFA / leave balances.
    const setClauses = cols.map((c, i) => {
      const cast = DATE_CAST_COLS.has(c) ? '::date' : '';
      return `${c} = COALESCE($${i + 1}${cast}, ${c})`;
    }).join(', ');
    await client.query(
      `UPDATE employees
          SET ${setClauses},
              status = $${values.length + 1},
              updated_at = NOW()
        WHERE id = $${values.length + 2}`,
      [...values, mapped.status, existing.rows[0].id]
    );
    return 'updated';
  }

  // INSERT — always role='employee'. They set their password via "Forgot password".
  const placeholders = cols.map((c, i) => DATE_CAST_COLS.has(c) ? `$${i + 1}::date` : `$${i + 1}`).join(', ');
  const colList = cols.join(', ');
  await client.query(
    `INSERT INTO employees
       (${colList}, email, role, status, registration_status, has_accepted, accepted_at)
     VALUES (${placeholders}, $${values.length + 1}, 'employee', $${values.length + 2}, 'active', TRUE, NOW())`,
    [...values, mapped.email, mapped.status]
  );
  return 'inserted';
}

/* ── POST /api/admin/zoho-sync ───────────────────────────────────────────── */
router.post('/zoho-sync', async (req, res) => {
  const stats = { inserted: 0, updated: 0, skipped: 0, managersResolved: 0, secondaryManagersResolved: 0, errors: [] };
  const managerLinks = [];          // [{ employeeEmail, managerEmail }]
  const secondaryManagerLinks = []; // [{ employeeEmail, managerEmail }]

  const client = await pool.connect();
  try {
    logger.info({ initiatedBy: req.user._id }, 'Zoho sync started');

    // ── Pass 1 — upsert every employee + their tabularSections children ─
    for await (const rec of iterateEmployees()) {
      const mapped = mapEmployee(rec);
      if (!mapped) { stats.skipped++; continue; }

      // Pull tabularSections data BEFORE upsert so we can fill emergency
      // contact fields from family rows when Zoho doesn't provide them at
      // the top level.
      const tabular = parseTabularSections(rec);
      if (tabular.emergency) {
        mapped.emergencyContactName     = mapped.emergencyContactName     || tabular.emergency.name;
        mapped.emergencyContactPhone    = mapped.emergencyContactPhone    || tabular.emergency.phone;
        mapped.emergencyContactRelation = mapped.emergencyContactRelation || tabular.emergency.relation;
      }

      try {
        const op = await upsertEmployee(client, mapped);
        stats[op]++;

        // Resolve the new employee id so we can attach education / history rows.
        const idRow = await client.query(
          `SELECT id FROM employees WHERE LOWER(email) = $1`,
          [mapped.email]
        );
        const empId = idRow.rows[0]?.id;

        // Replace-on-sync: insert missing rows only (never overwrites manual edits).
        // Education rows go to employee_education. Explicit ::type casts on
        // every param so Postgres doesn't trip when a row has NULL values
        // ("inconsistent types deduced for parameter $N").
        if (empId && tabular.education.length > 0) {
          for (const ed of tabular.education) {
            await client.query(
              `INSERT INTO employee_education
                 (employee_id, highest_qualification, degree,
                  university_or_institution, year_of_passing, percentage_or_cgpa)
               SELECT $1::uuid, $2::text, $3::text, $4::text, $5::int, $6::text
                WHERE NOT EXISTS (
                  SELECT 1 FROM employee_education
                   WHERE employee_id = $1::uuid
                     AND COALESCE(university_or_institution, '') = COALESCE($4::text, '')
                     AND COALESCE(year_of_passing, 0) = COALESCE($5::int, 0)
                )`,
              [empId, ed.qualification, ed.degree, ed.institute,
               ed.yearOfPassing ? parseInt(ed.yearOfPassing, 10) || null : null,
               ed.percentageOrCgpa]
            );
          }
        }
        // Previous employment rows.
        if (empId && tabular.prevEmployment.length > 0) {
          for (const pe of tabular.prevEmployment) {
            await client.query(
              `INSERT INTO employee_previous_employment
                 (employee_id, company, designation, from_date, to_date, job_description)
               SELECT $1::uuid, $2::text, $3::text, $4::date, $5::date, $6::text
                WHERE NOT EXISTS (
                  SELECT 1 FROM employee_previous_employment
                   WHERE employee_id = $1::uuid
                     AND COALESCE(company, '') = COALESCE($2::text, '')
                     AND COALESCE(designation, '') = COALESCE($3::text, '')
                )`,
              [empId, pe.company, pe.designation, pe.fromDate, pe.toDate, pe.description]
            );
          }
        }

        if (mapped.reportsToEmail) {
          managerLinks.push({
            employeeEmail: mapped.email,
            managerEmail:  mapped.reportsToEmail,
          });
        }
        if (mapped.secondaryReportsToEmail) {
          secondaryManagerLinks.push({
            employeeEmail: mapped.email,
            managerEmail:  mapped.secondaryReportsToEmail,
          });
        }
      } catch (err) {
        stats.errors.push({ email: mapped.email, message: err.message });
      }
    }

    // ── Pass 2 — resolve manager links once everyone exists ──────────────
    for (const link of managerLinks) {
      const r = await client.query(
        `UPDATE employees e
            SET reporting_manager_id = m.id, updated_at = NOW()
           FROM employees m
          WHERE LOWER(e.email) = $1 AND LOWER(m.email) = $2`,
        [link.employeeEmail, link.managerEmail]
      );
      if (r.rowCount > 0) stats.managersResolved++;
    }
    for (const link of secondaryManagerLinks) {
      const r = await client.query(
        `UPDATE employees e
            SET secondary_manager_id = m.id, updated_at = NOW()
           FROM employees m
          WHERE LOWER(e.email) = $1 AND LOWER(m.email) = $2`,
        [link.employeeEmail, link.managerEmail]
      );
      if (r.rowCount > 0) stats.secondaryManagersResolved++;
    }

    logger.info({ stats }, 'Zoho sync complete');
    res.json({ success: true, stats });
  } catch (err) {
    logger.error({ err }, 'Zoho sync failed');
    res.status(500).json({ success: false, message: err.message, stats });
  } finally {
    client.release();
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Phase 2 — Payroll sync. Pulls bank account / IFSC / CTC from the Zoho
// People Payroll form (separate from the employee form). Org needs the
// Payroll module on their Zoho subscription; otherwise this endpoint
// completes with `processed: 0` and no error.
//
// Matches by email — the Payroll form must have an Email or EmployeeID
// column. Never overwrites a value HR has already entered manually.
// ───────────────────────────────────────────────────────────────────────────
router.post('/zoho-sync-payroll', async (req, res) => {
  const stats = { processed: 0, updated: 0, skipped: 0, errors: [] };
  try {
    logger.info({ initiatedBy: req.user._id }, 'Zoho Payroll sync started');

    for await (const rec of iteratePayroll()) {
      stats.processed++;

      const email = (rec.EmailID || rec.Email || rec.Email_ID || rec.Workemail || '').toLowerCase();
      const empCode = rec.EmployeeID || rec.Employee_ID;
      if (!email && !empCode) { stats.skipped++; continue; }

      const bankName    = rec.BankName    || rec.Bank_Name    || rec.Bank;
      const bankAccount = rec.BankAccountNumber || rec.AccountNumber || rec.Bank_Account_Number || rec.Account_Number;
      const bankIfsc    = rec.IFSC || rec.IFSC_Code || rec.IFSCCode;
      const monthlyCTC  = parseFloat(rec.MonthlyCTC || rec.Monthly_CTC || rec.CTC || rec.AnnualCTC && (rec.AnnualCTC / 12)) || null;
      const basicSalary = parseFloat(rec.BasicSalary || rec.Basic_Salary || rec.Basic) || null;

      if (!bankName && !bankAccount && !bankIfsc && !monthlyCTC && !basicSalary) {
        stats.skipped++;
        continue;
      }

      try {
        // COALESCE — only fills NULLs, never overwrites admin-entered values.
        const r = await pool.query(
          `UPDATE employees
              SET bank_name    = COALESCE(bank_name,    $1),
                  bank_account = COALESCE(bank_account, $2),
                  bank_ifsc    = COALESCE(bank_ifsc,    $3),
                  monthly_ctc  = COALESCE(monthly_ctc,  $4),
                  basic_salary = COALESCE(basic_salary, $5),
                  updated_at   = NOW()
            WHERE (LOWER(email) = $6 AND $6 <> '')
               OR (employee_id = $7 AND $7 <> '')
            RETURNING id`,
          [bankName || null, bankAccount || null, bankIfsc || null, monthlyCTC, basicSalary, email, empCode || '']
        );
        if (r.rowCount > 0) stats.updated++;
        else stats.skipped++;
      } catch (err) {
        stats.errors.push({ email: email || empCode, message: err.message });
      }
    }

    logger.info({ stats }, 'Zoho Payroll sync complete');
    res.json({ success: true, stats });
  } catch (err) {
    logger.error({ err }, 'Zoho Payroll sync failed');
    res.status(500).json({ success: false, message: err.message, stats });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Phase 3 — Documents import. For each employee, list their Zoho file
// attachments, download each one into backend/uploads/, and insert a row
// into employee_documents (both legacy + modern column sets so the
// Documents page sees them).
//
// Slow: 70 employees × ~5 files = ~350 API calls. Returns immediately
// after kicking off and reports stats once done. Files that already
// exist (matched by original name + employee) are skipped.
// ───────────────────────────────────────────────────────────────────────────
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Best-effort mapping from Zoho attachment names → our canonical doc types,
// so the Documents page groups them correctly.
function inferDocType(name = '') {
  const n = name.toLowerCase();
  if (/(aadhaar|aadhar)/.test(n))                  return 'id_proof';
  if (/(pan)/.test(n))                             return 'id_proof';
  if (/(offer.*letter|appointment)/.test(n))       return 'offer_letter';
  if (/(experience|relieving)/.test(n))            return 'experience';
  if (/(10th|sslc|tenth)/.test(n))                 return 'educational';
  if (/(12th|hsc|twelfth|plus.?two)/.test(n))      return 'educational';
  if (/(ug|degree|bachelor)/.test(n))              return 'educational';
  if (/(pg|master|mba)/.test(n))                   return 'educational';
  if (/(resume|cv)/.test(n))                       return 'resume';
  if (/(photo|passport)/.test(n))                  return 'photo';
  if (/(address|utility|electricity)/.test(n))     return 'address_proof';
  if (/(payslip|pay.?slip|salary.?slip)/.test(n))  return 'payslip';
  if (/(nda|non.?disclosure)/.test(n))             return 'nda';
  if (/(contract|agreement)/.test(n))              return 'contract';
  return 'other';
}

router.post('/zoho-sync-documents', async (req, res) => {
  const stats = { employees: 0, downloaded: 0, skipped: 0, failed: 0, errors: [] };
  try {
    logger.info({ initiatedBy: req.user._id }, 'Zoho Documents sync started');

    // Walk Zoho employees so we have the recordId for each file lookup.
    for await (const rec of iterateEmployees()) {
      const email = (rec.EmailID || rec.Email || '').toLowerCase();
      const zohoRecordId = rec.ZohoID || rec.Zoho_ID || rec.recordId || rec.id;
      if (!email || !zohoRecordId) { stats.skipped++; continue; }

      // Match local employee row.
      const empRow = await pool.query('SELECT id FROM employees WHERE LOWER(email) = $1', [email]);
      if (empRow.rows.length === 0) { stats.skipped++; continue; }
      const employeeId = empRow.rows[0].id;
      stats.employees++;

      const files = await listEmployeeFiles(zohoRecordId);
      for (const f of files) {
        if (!f.fileName || !f.fileId) continue;

        // Skip if we already imported this file (matched by original name).
        const existing = await pool.query(
          `SELECT id FROM employee_documents
            WHERE employee_id = $1 AND COALESCE(original_name, name) = $2`,
          [employeeId, f.fileName]
        );
        if (existing.rows.length > 0) { stats.skipped++; continue; }

        const buf = await downloadFile(zohoRecordId, f.fileId);
        if (!buf) { stats.failed++; continue; }

        // Save with a unique filename, preserve the original extension.
        const ext = path.extname(f.fileName) || '';
        const localName = `zoho-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
        const localPath = path.join(uploadsDir, localName);
        try {
          fs.writeFileSync(localPath, buf);
          const fileUrl = `/uploads/${localName}`;
          const docType = inferDocType(f.fileName);

          await pool.query(
            `INSERT INTO employee_documents
               (employee_id,
                document_type, file_path, original_name, mime_type, size,
                name, type, file_url, file_size, uploaded_by)
             VALUES ($1, $2, $3, $4, $5, $6, $4, $7, $8, $6, $1)`,
            [
              employeeId,
              docType,                  // legacy document_type
              fileUrl,                  // legacy file_path (using full URL for downloads)
              f.fileName,               // original_name + name
              f.fileType || null,       // mime_type
              f.fileSize ? parseInt(f.fileSize, 10) : buf.length,
              docType,                  // modern type
              fileUrl,                  // modern file_url
            ]
          );
          stats.downloaded++;
        } catch (err) {
          stats.failed++;
          stats.errors.push({ email, file: f.fileName, message: err.message });
          // Clean up the disk file if INSERT failed.
          try { fs.unlinkSync(localPath); } catch {}
        }
      }
    }

    logger.info({ stats }, 'Zoho Documents sync complete');
    res.json({ success: true, stats });
  } catch (err) {
    logger.error({ err }, 'Zoho Documents sync failed');
    res.status(500).json({ success: false, message: err.message, stats });
  }
});

module.exports = router;
