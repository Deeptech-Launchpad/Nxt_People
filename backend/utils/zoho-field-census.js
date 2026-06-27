/**
 * Scan EVERY employee in Zoho People and report which fields exist + how
 * many employees have each one filled. Tells you definitively:
 *   • The full list of fields available in your tenant (standard + custom)
 *   • Which sections (Education / Family / Bank / etc.) actually have data
 *   • Which fields are EMPTY for most employees (low data quality)
 *   • Which fields are RICH (filled across the org — worth pulling)
 *
 * Usage (run inside the backend container):
 *   docker compose -f docker-compose.prod.yml --env-file backend/.env \
 *     exec backend node utils/zoho-field-census.js
 *
 * Output: three tables — top-level fields, tabular section coverage,
 * and a recommendation list of high-value fields we're NOT yet mapping.
 */
require('dotenv').config();
const { iterateEmployees } = require('./zoho');

// Fields the existing mapper already pulls — anything else is a candidate.
const ALREADY_MAPPED = new Set([
  'EmailID','Email','Email_ID','Workemail',
  'EmployeeID','Employee_ID','employee_id',
  'FirstName','First_Name','LastName','Last_Name',
  'Nickname','NickName','Nick_Name',
  'Department','Designation','JobTitle',
  'Company','LegalEntity','OrganizationName',
  'Division','BusinessUnit',
  'Work_location','WorkLocation','Work_Location','Location','LocationName','Office',
  'Employee_type','EmploymentType','Employment_Type','EmployeeType',
  'Source_of_hire','SourceOfHire','Source_Of_Hire',
  'Dateofjoining','Date_of_joining','DateOfJoining','JoiningDate',
  'Dateofexit','Date_of_exit','DateOfExit','ExitDate',
  'Employeestatus','EmployeeStatus',
  'Reporting_To','Reporting_To.MailID','ReportingTo','ManagerEmail',
  'Second_Reporting_To','Second_Reporting_To.MailID','SecondaryReportingTo','Secondary_Reporting_To',
  'Date_of_birth','Dateofbirth','DateOfBirth','DOB',
  'Gender','Marital_status','MaritalStatus','Marital_Status',
  'Blood_group','BloodGroup','Blood_Group',
  'Nationality','AboutMe','About_Me',
  'Mobile','MobileNumber','PersonalMobile','Phone',
  'Work_phone','WorkPhone','Work_Phone','OfficePhone',
  'Extension','Ext',
  'Other_Email','PersonalEmail','Personal_Email',
  'Present_Address','Presentaddress','PresentAddress','CurrentAddress','Address',
  'Permanent_Address','Permanentaddress','PermanentAddress',
  'Pan_Number','PAN_Number','PAN','PANNumber',
  'Aadhaar_Number','AadhaarNumber','Aadhar_Number','AadharNumber','Aadhaar',
  'UAN_Number','UANNumber','UAN',
  'BankName','Bank_Name','BankAccountNumber','AccountNumber','Bank_Account_Number',
  'IFSC','IFSCCode','IFSC_Code',
  'EmergencyContactName','Emergency_Contact_Name',
  'EmergencyContactNumber','EmergencyContactPhone','Emergency_Contact_Number',
  'EmergencyContactRelationship','EmergencyContactRelation',
  'Photo','PhotoURL','PhotoUrl','Photo_downloadUrl','EmployeePhoto',
  'total_experience','Experience','TotalExperience',
  'Expertise','Skills','expertise',
]);

// Fields that are Zoho metadata we don't care about — exclude from "missing" suggestions.
const ZOHO_INTERNALS = new Set([
  'AddedBy','AddedBy.ID','AddedTime','ApprovalStatus','CreatedTime',
  'ModifiedBy','ModifiedBy.ID','ModifiedTime','Tags','Role','Role.ID',
  'ZUID','Zoho_ID','Employeestatus.type',
  // .ID / .id companions are usually internal references, not useful values
]);

const isInternalSuffix = (key) => /\.(ID|id|displayValue|country_code|type)$/.test(key);

(async () => {
  const fieldStats   = new Map();  // top-level field → { filled, total }
  const sectionStats = new Map();  // section name → { rowsTotal, employeesWithRows, fieldsSeen: Map(field → fillCount) }
  let totalEmployees = 0;

  console.log('Scanning Zoho People — this may take 30-60 seconds for a full tenant…\n');

  for await (const rec of iterateEmployees()) {
    totalEmployees++;

    // Top-level fields
    for (const [key, val] of Object.entries(rec)) {
      if (key === 'tabularSections') continue;
      if (!fieldStats.has(key)) fieldStats.set(key, { filled: 0, total: 0 });
      const stat = fieldStats.get(key);
      stat.total++;
      const filled = val !== null && val !== undefined && val !== '' && val !== '<empty>';
      if (filled) stat.filled++;
    }

    // Tabular sections
    const sections = rec.tabularSections || {};
    for (const [sectionName, sectionData] of Object.entries(sections)) {
      if (!sectionStats.has(sectionName)) {
        sectionStats.set(sectionName, { rowsTotal: 0, employeesWithRows: 0, fieldsSeen: new Map() });
      }
      const ss = sectionStats.get(sectionName);
      if (Array.isArray(sectionData) && sectionData.length > 0) {
        ss.employeesWithRows++;
        ss.rowsTotal += sectionData.length;
        for (const row of sectionData) {
          if (row && typeof row === 'object') {
            for (const [k, v] of Object.entries(row)) {
              const filled = v !== null && v !== undefined && v !== '' && v !== '<empty>';
              const prev = ss.fieldsSeen.get(k) || 0;
              if (filled) ss.fieldsSeen.set(k, prev + 1);
              else if (!ss.fieldsSeen.has(k)) ss.fieldsSeen.set(k, 0);
            }
          }
        }
      }
    }
  }

  console.log(`✓ Scanned ${totalEmployees} employees.\n`);

  // ── Top-level field census ──────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('  TOP-LEVEL FIELDS — coverage across all employees');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  const sorted = [...fieldStats.entries()]
    .filter(([k]) => !isInternalSuffix(k))
    .sort((a, b) => b[1].filled - a[1].filled);

  const rows = sorted.map(([field, { filled, total }]) => {
    const pct = total > 0 ? Math.round((filled / total) * 100) : 0;
    const mappedTag = ALREADY_MAPPED.has(field) ? '✓ mapped' : ZOHO_INTERNALS.has(field) ? '(meta)' : '⚠ NEW';
    return {
      field,
      filled: `${filled}/${total}`,
      coverage: `${pct}%`.padStart(4),
      status: mappedTag,
    };
  });
  console.table(rows);

  // ── Tabular sections census ─────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log('  TABULAR SECTIONS — nested data (education, family, bank, etc.)');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  for (const [sectionName, ss] of sectionStats) {
    const pct = totalEmployees > 0 ? Math.round((ss.employeesWithRows / totalEmployees) * 100) : 0;
    console.log(`\n  📂 ${sectionName}`);
    console.log(`     ${ss.employeesWithRows} of ${totalEmployees} employees have rows (${pct}% coverage, ${ss.rowsTotal} total rows)`);
    if (ss.fieldsSeen.size > 0) {
      const fields = [...ss.fieldsSeen.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([k, c]) => `       • ${k.padEnd(35)} ${c} filled`)
        .join('\n');
      console.log(fields);
    }
  }

  // ── Recommendations ────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log('  💡 RECOMMENDATIONS — fields worth pulling that we DON\'T currently sync');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  const candidates = sorted
    .filter(([k, s]) =>
      !ALREADY_MAPPED.has(k) &&
      !ZOHO_INTERNALS.has(k) &&
      !isInternalSuffix(k) &&
      s.filled >= Math.max(1, Math.floor(totalEmployees * 0.1))  // at least 10% have it
    );

  if (candidates.length === 0) {
    console.log('  None — every well-populated field is already in the mapping.\n');
  } else {
    console.log('  These fields have data in your tenant but aren\'t synced into NxtPeople yet.');
    console.log('  Tell me which ones matter and I\'ll add them to the mapping.\n');
    candidates.forEach(([k, s]) => {
      const pct = Math.round((s.filled / s.total) * 100);
      console.log(`    • ${k.padEnd(35)} — ${s.filled} / ${s.total} employees (${pct}%)`);
    });
  }
  console.log('');

  process.exit(0);
})().catch(err => {
  console.error('❌ Zoho field census failed:', err.message);
  if (err.message.includes('ZOHO_')) {
    console.error('   Check that ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN,');
    console.error('   ZOHO_API_DOMAIN are set in backend/.env');
  }
  process.exit(1);
});
