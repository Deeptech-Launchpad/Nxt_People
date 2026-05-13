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

  // Sort keys alphabetically so similarly-named fields cluster together.
  const sorted = Object.keys(found).sort();
  const rows = sorted.map(k => {
    const v = found[k];
    let display;
    if (v === null || v === undefined || v === '') display = '<empty>';
    else if (typeof v === 'object') display = JSON.stringify(v).slice(0, 80);
    else display = String(v).slice(0, 80);
    return { field: k, value: display };
  });
  console.table(rows);

  console.log(`\nTotal fields: ${sorted.length}`);
  console.log('Look for fields like "MaritalStatus", "BloodGroup", "Nationality" — note the exact spelling/casing.');
  console.log('Then add the new alias to routes/admin-zoho.js mapEmployee() and re-run Zoho sync.\n');

  process.exit(0);
})().catch(err => {
  console.error('❌ Zoho debug failed:', err.message);
  if (err.message.includes('ZOHO_')) {
    console.error('   Make sure ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, ZOHO_API_DOMAIN are set in backend/.env');
  }
  process.exit(1);
});
