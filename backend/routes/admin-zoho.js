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
const { iterateEmployees } = require('../utils/zoho');

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

        // Replace-on-sync: delete existing Zoho-sourced rows then re-insert.
        // Education rows go to employee_education.
        if (empId && tabular.education.length > 0) {
          for (const ed of tabular.education) {
            // Don't duplicate — only insert if no row with the same institute
            // and year exists for this employee.
            await client.query(
              `INSERT INTO employee_education
                 (employee_id, highest_qualification, degree,
                  university_or_institution, year_of_passing, percentage_or_cgpa)
               SELECT $1, $2, $3, $4, $5, $6
                WHERE NOT EXISTS (
                  SELECT 1 FROM employee_education
                   WHERE employee_id = $1
                     AND COALESCE(university_or_institution, '') = COALESCE($4, '')
                     AND COALESCE(year_of_passing, 0) = COALESCE($5, 0)
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
               SELECT $1, $2, $3, $4::date, $5::date, $6
                WHERE NOT EXISTS (
                  SELECT 1 FROM employee_previous_employment
                   WHERE employee_id = $1
                     AND COALESCE(company, '') = COALESCE($2, '')
                     AND COALESCE(designation, '') = COALESCE($3, '')
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

module.exports = router;
