/**
 * Zoho forms discovery — lists every form available in your Zoho People
 * account, then for each one fetches the first record and prints its top-
 * level field names. This is how we find where the "missing" data lives.
 *
 * Zoho People allows admins to create custom forms beyond the standard
 * `employee` form. Bank details, passport info, training records, etc. often
 * live in their own forms — each with its own API endpoint:
 *
 *   forms/{customFormName}/getRecords
 *
 * Once you see a form like `bank_details` or `id_proofs` in the output, tell
 * me the form name + the fields it exposes, and I'll wire it into the sync.
 *
 * Usage:
 *   cd backend
 *   npm run zoho:forms
 */

require('dotenv').config();
const { zohoApi } = require('./zoho');

(async () => {
  console.log('\n🔍 Discovering Zoho People forms…\n');

  // Step 1 — list all forms.
  // Zoho's endpoint is `forms` returning either { response: { result: [...] } }
  // or the array directly, depending on tenant. Try the documented path.
  let forms = [];
  try {
    const body = await zohoApi('forms');
    forms = body?.response?.result || body?.result || body?.forms || [];
    if (!Array.isArray(forms)) {
      // Some tenants return an object keyed by form id — flatten.
      forms = Object.values(forms);
    }
  } catch (err) {
    console.error('❌ Could not list forms:', err.message);
    console.error('   Your Zoho subscription may not expose the forms-listing endpoint.');
    console.error('   Falling back: probing common form names directly.\n');

    // Probe common form names individually.
    const candidates = [
      'employee', 'bank_details', 'bankdetails', 'BankDetails',
      'id_proofs', 'identification', 'documents', 'passport',
      'family', 'dependents', 'emergency_contact',
      'previous_employment', 'work_experience', 'employment_history',
      'education', 'skills', 'training',
      'assets', 'salary', 'payroll', 'compensation',
      'health', 'medical', 'insurance',
    ];
    for (const name of candidates) {
      try {
        const r = await zohoApi(`forms/${name}/getRecords?sIndex=1&rec_limit=1`);
        const rows = r?.response?.result;
        if (Array.isArray(rows) && rows.length > 0) {
          forms.push({ formName: name, displayName: name });
          console.log(`  ✓ ${name} — works`);
        }
      } catch { /* form doesn't exist on this tenant — skip silently */ }
    }
  }

  if (!Array.isArray(forms) || forms.length === 0) {
    console.error('\nNo forms found via discovery OR probing. Your Zoho tenant might restrict the forms API entirely.');
    process.exit(1);
  }

  console.log(`\nFound ${forms.length} form(s). Sampling first record of each…\n`);

  // Step 2 — for each form, fetch its first record and dump the field names.
  for (const f of forms) {
    const formName    = f.formName    || f.form_name    || f.name || f.displayName;
    const displayName = f.displayName || f.display_name || formName;
    if (!formName) continue;

    console.log(`\n── FORM: ${displayName} (api name: ${formName}) ──`);
    try {
      const r = await zohoApi(`forms/${formName}/getRecords?sIndex=1&rec_limit=1`);
      const rows = r?.response?.result;
      if (!Array.isArray(rows) || rows.length === 0) {
        console.log('  (no records in this form)');
        continue;
      }
      const row = rows[0];
      const id = Object.keys(row)[0];
      const fields = Array.isArray(row[id]) ? row[id][0] : row[id];
      if (!fields || typeof fields !== 'object') {
        console.log('  (unable to parse record)');
        continue;
      }
      const keys = Object.keys(fields).filter(k => k !== 'tabularSections').sort();
      console.log(`  ${keys.length} top-level fields:`);
      keys.forEach(k => {
        const v = fields[k];
        const display = v === null || v === undefined || v === ''
          ? '<empty>'
          : typeof v === 'object'
            ? JSON.stringify(v).slice(0, 60)
            : String(v).slice(0, 60);
        console.log(`    ${k.padEnd(35)} = ${display}`);
      });
      if (fields.tabularSections) {
        console.log(`  + tabularSections with keys: ${Object.keys(fields.tabularSections).join(', ')}`);
      }
    } catch (err) {
      console.log(`  ⚠️  Could not fetch records: ${err.message}`);
    }
  }

  console.log('\n\nNext: tell me which form(s) contain Bank / Passport / Blood Group / Nationality');
  console.log('and the exact field names inside them. I\'ll add a sync for each.\n');
  process.exit(0);
})().catch(err => {
  console.error('❌ Failed:', err.message);
  process.exit(1);
});
