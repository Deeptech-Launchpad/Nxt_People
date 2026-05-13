/**
 * Dump the raw Zoho People record for a single employee so we can see EXACTLY
 * what field names Zoho returns — useful when a field shows up in the Zoho
 * UI but stays blank in our DB after a sync (it means our mapping aliases
 * don't match Zoho's actual field names).
 *
 * Usage:
 *   npm run zoho:debug -- ANXT220005
 *   npm run zoho:debug -- naveen.jayaraman@altiusnxt.com
 *
 * Output: every key/value Zoho returns for that employee, sorted alphabetically.
 * Once you see the real field name, add it to the `pick()` aliases in
 * routes/admin-zoho.js mapEmployee() and re-sync.
 */
require('dotenv').config();
const { iterateEmployees } = require('./zoho');

const arg = (process.argv[2] || '').trim();
if (!arg) {
  console.error('Usage: npm run zoho:debug -- <employee_id_or_email>');
  process.exit(1);
}

const argLower = arg.toLowerCase();

(async () => {
  let found = null;
  let scanned = 0;

  for await (const rec of iterateEmployees()) {
    scanned++;
    const eid    = String(rec.EmployeeID || rec.Employee_ID || rec.employee_id || '').toLowerCase();
    const email  = String(rec.EmailID || rec.Email || rec.Email_ID || rec.Workemail || '').toLowerCase();
    if (eid === argLower || email === argLower) {
      found = rec;
      break;
    }
  }

  if (!found) {
    console.error(`\nNo Zoho record matched "${arg}" after scanning ${scanned} record(s).`);
    console.error('Check the spelling. The match looks at EmployeeID and email.');
    process.exit(1);
  }

  console.log(`\nRaw Zoho record (scanned ${scanned} record(s) to find this one):\n`);

  // Top-level fields first — sort alphabetically so similar names cluster.
  console.log('── TOP-LEVEL FIELDS ──');
  const sorted = Object.keys(found).filter(k => k !== 'tabularSections').sort();
  const rows = sorted.map(k => {
    const v = found[k];
    let display;
    if (v === null || v === undefined || v === '') display = '<empty>';
    else if (typeof v === 'object') display = JSON.stringify(v).slice(0, 100);
    else display = String(v).slice(0, 100);
    return { field: k, value: display };
  });
  console.table(rows);

  // tabularSections has the nested data — bank, identity, family, etc.
  // Dump every section in full so we can see what's in there.
  if (found.tabularSections && typeof found.tabularSections === 'object') {
    console.log('\n── TABULAR SECTIONS (nested) ──');
    for (const [sectionName, sectionData] of Object.entries(found.tabularSections)) {
      console.log(`\n  Section: ${sectionName}`);
      if (Array.isArray(sectionData)) {
        if (sectionData.length === 0) {
          console.log('    (empty)');
        } else {
          sectionData.forEach((row, i) => {
            console.log(`    Row ${i + 1}:`);
            for (const [k, v] of Object.entries(row)) {
              const display = v === null || v === undefined || v === '' ? '<empty>'
                : typeof v === 'object' ? JSON.stringify(v).slice(0, 80)
                : String(v).slice(0, 80);
              console.log(`      ${k}: ${display}`);
            }
          });
        }
      } else {
        console.log(`    ${JSON.stringify(sectionData).slice(0, 200)}`);
      }
    }
  } else {
    console.log('\n── TABULAR SECTIONS ──\n  (none in this response)');
  }

  console.log(`\nTotal top-level fields: ${sorted.length}`);
  console.log('\nNow look for the missing data:');
  console.log('  • Blood Group, Nationality, Passport — check section names like SS_PERSONAL or any "extra info" tab');
  console.log('  • Bank Name, Account, IFSC — check SS_BANK_DETAILS or SS_FINANCE');
  console.log('  • Documents — check SS_DOCUMENTS / SS_FILES (file IDs we can fetch separately)');
  console.log('\nPaste the section names + the field names INSIDE them to extend the parser.\n');

  process.exit(0);
})().catch(err => {
  console.error('❌ Zoho debug failed:', err.message);
  if (err.message.includes('ZOHO_')) {
    console.error('   Make sure ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, ZOHO_API_DOMAIN are set in backend/.env');
  }
  process.exit(1);
});
