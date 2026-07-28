/**
 * Zoho People sync — admin-triggered, one-way (Zoho → Nxt-People).
 *
 * Two-pass:
 *   Pass 1 — upsert every employee. New rows start with role='team_member'.
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

router.use(protect, authorize('admin', 'director'));

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
// Parse the date formats Zoho actually returns and produce yyyy-MM-dd.
// new Date() alone is dangerous for our case: it parses dd/MM/yyyy as
// MM/dd/yyyy (US locale), which silently swaps day/month when the day is
// 1-12 and returns Invalid Date when the day is >12 — meaning dd/MM dates
// like "19/03/2004" were being dropped completely by the previous parser,
// while "01/03/2026" was being stored as Jan 3 instead of Mar 1.
const toIsoDate = (raw) => {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // ISO 8601: yyyy-MM-dd (also handles "2024-08-15T00:00:00Z" prefixes).
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const [, y, mo, d] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // dd/MM/yyyy or dd-MM-yyyy (the format Zoho People's UI shows + their API
  // often returns). Validate ranges so 31/13/2024 doesn't silently coerce.
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const d = +m[1], mo = +m[2], y = m[3];
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) {
      return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  // dd-MMM-yyyy / dd MMM yyyy / dd/MMM/yyyy (the older Zoho v1 format).
  const monthMap = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  m = s.match(/^(\d{1,2})[\/\-\s]([A-Za-z]{3})[\/\-\s](\d{4})$/);
  if (m) {
    const d = +m[1], mo = monthMap[m[2].toLowerCase()], y = m[3];
    if (mo && d >= 1 && d <= 31) {
      return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  // Last resort — native Date for RFC / locale strings we didn't anticipate.
  const dt = new Date(s);
  return Number.isFinite(dt.getTime()) ? dt.toISOString().slice(0, 10) : null;
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
    // Structured address parts from the *.childValues object. Zoho returns
    // these as a SIBLING field keyed with a literal dot in the name, not
    // as a nested property — access via bracket notation.
    addressParts:          parseAddressChildValues(rec['Present_Address.childValues']),
    permanentAddressParts: parseAddressChildValues(rec['Permanent_Address.childValues']),
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
    // Zoho's photo URLs (`https://contacts.zoho.in/file?ID=…`) require a
    // logged-in Zoho session — browsers can't load them anonymously, so
    // they render as broken-image icons. Skip those entirely; let the UI
    // show its initials/avatar fallback. Only accept URLs that are clearly
    // public (a real https URL not pointing at Zoho's authenticated CDN).
    photoUrl: (() => {
      const raw = pick(rec, 'Photo_downloadUrl', 'PhotoURL', 'PhotoUrl', 'Photo', 'EmployeePhoto');
      if (!raw) return null;
      if (/contacts\.zoho\.|people\.zoho\./i.test(raw)) return null;
      return raw;
    })(),
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
    qualification:    pick(row, 'Highest_Qualification', 'Qualification', 'Level'),
    degree:           pick(row, 'Degree', 'Course'),
    course:           pick(row, 'Specialization', 'Field_Of_Study', 'Stream', 'Major'),
    institute:        pick(row, 'College', 'Institute_Name', 'Institution', 'University', 'School'),
    yearOfPassing:    pick(row, 'Yearofgraduation', 'Year_Of_Passing', 'Year_of_passing', 'YearOfPassing', 'Passing_Year'),
    percentageOrCgpa: pick(row, 'Marks_Or_CGPA', 'Percentage', 'CGPA', 'Marks', 'Grade'),
  })).filter(r => r.institute || r.qualification || r.degree || r.course);

  const prevEmployment = empHistoryRows.map(row => ({
    // Aliases now cover the AltiusNxt tenant's exact field names: Jobtitle
    // (lowercase t), Todate (lowercase d), Previous_JobDesc — all three
    // were being silently dropped before. The census tool revealed 39 / 33
    // / 18 employees were affected respectively.
    company:      pick(row, 'Previous_Company', 'Company_Name', 'Company', 'Employer', 'PreviousCompany'),
    designation:  pick(row, 'Designation', 'Job_Title', 'Jobtitle', 'Role', 'Position'),
    fromDate:     toIsoDate(pick(row, 'From_Date', 'From', 'Start_Date', 'Joining_Date', 'FromDate', 'Fromdate')),
    toDate:       toIsoDate(pick(row, 'To_Date', 'To', 'End_Date', 'Relieving_Date', 'ToDate', 'Todate')),
    description:  pick(row, 'Job_Description', 'Description', 'Responsibilities', 'Previous_JobDesc', 'JobDesc'),
  })).filter(r => r.company || r.designation);

  // Emergency / family contact: first row of the dependent / family section.
  // DependentDOB is now also pulled — useful for dependent insurance,
  // school-fee deductions, gift schemes triggered by family birthdays.
  const first = familyRows[0];
  const emergency = first ? {
    name:     pick(first, 'Name', 'First_Name', 'Contact_Name', 'Full_Name', 'DependentName'),
    phone:    pick(first, 'Mobile_no', 'Mobile', 'Phone', 'Contact_Number', 'Mobile_Number', 'DependentMobile', 'DependentContact'),
    relation: pick(first, 'DependentRelationship', 'Relationship', 'Relation', 'Type'),
    dob:      toIsoDate(pick(first, 'DependentDOB', 'DateOfBirth', 'Date_Of_Birth', 'DOB')),
  } : null;

  return { education, prevEmployment, emergency };
}

/**
 * Extract structured address parts from Zoho's <field>.childValues object.
 * Returns { line1, line2, city, state, pincode, country } with whichever
 * keys Zoho's response actually contains (variants vary by tenant config).
 */
function parseAddressChildValues(childValues) {
  if (!childValues || typeof childValues !== 'object') return null;
  // Zoho's address childValues use UPPERCASE keys (CITY, STATE, COUNTRY,
  // ADDRESS1, ADDRESS2, PINCODE, STATE_CODE, COUNTRY_CODE). Earlier guesses
  // (Address_Line_1, Pincode, etc.) didn't match — verified by inspecting
  // a real record. Keep the title-case variants too so other tenants with
  // different forms still work.
  const out = {
    line1:   pick(childValues, 'ADDRESS1', 'Address_Line_1', 'AddressLine1', 'Line1', 'Address1', 'Line_1'),
    line2:   pick(childValues, 'ADDRESS2', 'Address_Line_2', 'AddressLine2', 'Line2', 'Address2', 'Line_2', 'Street'),
    city:    pick(childValues, 'CITY', 'City', 'Town', 'city'),
    state:   pick(childValues, 'STATE', 'State', 'state', 'Province', 'Region'),
    pincode: pick(childValues, 'PINCODE', 'Pincode', 'PIN', 'PinCode', 'ZipCode', 'Zip', 'Postal_Code', 'PostalCode'),
    country: pick(childValues, 'COUNTRY', 'Country', 'country', 'Nation'),
  };
  // Bail out if every field is empty — keep nulls so we don't overwrite
  // a manually edited row with empties.
  return Object.values(out).some(v => v) ? out : null;
}

/**
 * Upsert one mapped employee. Returns `'inserted'`, `'updated'`, or throws.
 * Never overwrites: role, password, MFA, leave balances.
 */
async function upsertEmployee(client, mapped) {
  let existing = await client.query(
    `SELECT id FROM employees WHERE LOWER(email) = $1`,
    [mapped.email]
  );

  // Fall back to matching by Employee ID when the email lookup finds
  // nothing. Without this, an employee whose email in Zoho differs even
  // slightly from what's already stored (typo fix, personal→work swap,
  // etc.) gets treated as a brand-new hire — and the INSERT below then
  // collides on the employee_id unique constraint, since that ID already
  // belongs to their existing row. The email itself is deliberately left
  // untouched here (not in the UPDATE column list below) so this never
  // silently changes anyone's login email.
  if (existing.rows.length === 0 && mapped.employeeId) {
    existing = await client.query(
      `SELECT id FROM employees WHERE employee_id = $1`,
      [mapped.employeeId]
    );
  }

  // Build a single COALESCE-based UPDATE / explicit INSERT so we never wipe
  // a value we don't have. Listed in the same order so the param indexes stay aligned.
  // Extract address parts if Zoho returned childValues — null otherwise.
  const ap = mapped.addressParts          || {};
  const pp = mapped.permanentAddressParts || {};

  const cols = [
    'first_name', 'last_name', 'nick_name',
    'department', 'designation', 'company', 'division', 'work_location', 'employment_type', 'source_of_hire',
    'date_of_birth', 'gender', 'marital_status', 'blood_group', 'nationality', 'about_me',
    'phone', 'work_phone', 'extension', 'personal_email',
    'address', 'permanent_address',
    // Structured address components from Zoho childValues.
    'address_line1', 'address_line2', 'address_city', 'address_state', 'address_pincode', 'address_country',
    'permanent_address_line1', 'permanent_address_line2', 'permanent_address_city', 'permanent_address_state', 'permanent_address_pincode', 'permanent_address_country',
    'pan_number', 'aadhaar_number', 'uan_number',
    'bank_name', 'bank_account', 'bank_ifsc',
    'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relation', 'emergency_contact_dob',
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
    ap.line1 || null, ap.line2 || null, ap.city || null, ap.state || null, ap.pincode || null, ap.country || null,
    pp.line1 || null, pp.line2 || null, pp.city || null, pp.state || null, pp.pincode || null, pp.country || null,
    mapped.panNumber || null, mapped.aadhaarNumber || null, mapped.uanNumber || null,
    mapped.bankName || null, mapped.bankAccount || null, mapped.bankIfsc || null,
    mapped.emergencyContactName || null, mapped.emergencyContactPhone || null, mapped.emergencyContactRelation || null, mapped.emergencyContactDob || null,
    mapped.photoUrl || null,
    mapped.joiningDate,
    mapped.employeeId || null,
    mapped.exitDate, mapped.totalExperience || null, mapped.expertise || null,
  ];
  // joining_date, date_of_birth, exit_date, emergency_contact_dob need ::date cast in the SQL.
  const DATE_CAST_COLS = new Set(['date_of_birth', 'joining_date', 'exit_date', 'emergency_contact_dob']);

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

  // INSERT — always role='team_member'. They set their password via "Forgot password".
  const placeholders = cols.map((c, i) => DATE_CAST_COLS.has(c) ? `$${i + 1}::date` : `$${i + 1}`).join(', ');
  const colList = cols.join(', ');
  await client.query(
    `INSERT INTO employees
       (${colList}, email, role, status, registration_status, has_accepted, accepted_at)
     VALUES (${placeholders}, $${values.length + 1}, 'team_member', $${values.length + 2}, 'active', TRUE, NOW())`,
    [...values, mapped.email, mapped.status]
  );
  return 'inserted';
}

/* ── POST /api/admin/zoho-sync ───────────────────────────────────────────── */
/**
 * Run the Zoho People → NxtPeople employee sync once. Extracted from the
 * route handler so the cron in server.js (and any future scheduled job)
 * can invoke it directly without going through HTTP. Returns the stats
 * object; throws on hard failure.
 *
 * @param {string|null} initiatedBy  — the admin id (if user-triggered) or
 *   'cron' (if scheduled). Only used for log correlation.
 */
async function runEmployeeSync(initiatedBy = 'cron') {
  const stats = { inserted: 0, updated: 0, skipped: 0, managersResolved: 0, secondaryManagersResolved: 0, errors: [] };
  const managerLinks = [];
  const secondaryManagerLinks = [];
  const syncedEmails = [];

  const client = await pool.connect();
  try {
    logger.info({ initiatedBy }, 'Zoho sync started');

    for await (const rec of iterateEmployees()) {
      const mapped = mapEmployee(rec);
      if (!mapped) { stats.skipped++; continue; }

      const tabular = parseTabularSections(rec);
      if (tabular.emergency) {
        mapped.emergencyContactName     = mapped.emergencyContactName     || tabular.emergency.name;
        mapped.emergencyContactPhone    = mapped.emergencyContactPhone    || tabular.emergency.phone;
        mapped.emergencyContactRelation = mapped.emergencyContactRelation || tabular.emergency.relation;
        mapped.emergencyContactDob      = mapped.emergencyContactDob      || tabular.emergency.dob;
      }

      try {
        const op = await upsertEmployee(client, mapped);
        stats[op]++;

        const idRow = await client.query(`SELECT id FROM employees WHERE LOWER(email) = $1`, [mapped.email]);
        const empId = idRow.rows[0]?.id;

        if (empId && tabular.education.length > 0) {
          for (const ed of tabular.education) {
            await client.query(
              `INSERT INTO employee_education
                 (employee_id, highest_qualification, degree, course,
                  university_or_institution, year_of_passing, percentage_or_cgpa)
               SELECT $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::int, $7::text
                WHERE NOT EXISTS (
                  SELECT 1 FROM employee_education
                   WHERE employee_id = $1::uuid
                     AND COALESCE(university_or_institution, '') = COALESCE($5::text, '')
                     AND COALESCE(year_of_passing, 0) = COALESCE($6::int, 0)
                )`,
              [empId, ed.qualification, ed.degree, ed.course, ed.institute,
               ed.yearOfPassing ? parseInt(ed.yearOfPassing, 10) || null : null,
               ed.percentageOrCgpa]
            );
          }
        }
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

        syncedEmails.push(mapped.email);
        if (mapped.reportsToEmail)            managerLinks.push({ employeeEmail: mapped.email, managerEmail: mapped.reportsToEmail });
        if (mapped.secondaryReportsToEmail)   secondaryManagerLinks.push({ employeeEmail: mapped.email, managerEmail: mapped.secondaryReportsToEmail });
      } catch (err) {
        stats.errors.push({ email: mapped.email, message: err.message });
      }
    }

    // Clear reporting_manager_id for every synced employee before re-applying
    // the links from Zoho. This ensures the hierarchy in NxtPeople always
    // matches Zoho exactly — employees whose ReportingTo was removed in Zoho
    // (e.g. the CEO) correctly become root nodes instead of keeping a stale link.
    if (syncedEmails.length > 0) {
      await client.query(
        `UPDATE employees SET reporting_manager_id = NULL
          WHERE LOWER(email) = ANY($1::text[])`,
        [syncedEmails]
      );
    }

    for (const link of managerLinks) {
      const r = await client.query(
        `UPDATE employees e SET reporting_manager_id = m.id, updated_at = NOW()
           FROM employees m WHERE LOWER(e.email) = $1 AND LOWER(m.email) = $2`,
        [link.employeeEmail, link.managerEmail]
      );
      if (r.rowCount > 0) stats.managersResolved++;
    }
    for (const link of secondaryManagerLinks) {
      const r = await client.query(
        `UPDATE employees e SET secondary_manager_id = m.id, updated_at = NOW()
           FROM employees m WHERE LOWER(e.email) = $1 AND LOWER(m.email) = $2`,
        [link.employeeEmail, link.managerEmail]
      );
      if (r.rowCount > 0) stats.secondaryManagersResolved++;
    }

    logger.info({ stats }, 'Zoho sync complete');
    return stats;
  } finally {
    client.release();
  }
}

router.post('/zoho-sync', async (req, res) => {
  try {
    const stats = await runEmployeeSync(req.user._id);
    res.json({ success: true, stats });
  } catch (err) {
    logger.error({ err }, 'Zoho sync failed');
    res.status(500).json({ success: false, message: err.message });
  }
});

// Old in-route implementation removed — see runEmployeeSync() above.

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

// Expose the sync function so server.js / cron jobs can run it without
// going through HTTP. Default export stays the router for app.js mounting.
module.exports = router;
module.exports.runEmployeeSync = runEmployeeSync;
