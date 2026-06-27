/**
 * Dump EVERY field Zoho People has for ONE employee. Use this to answer
 * "is field X really missing for this person in Zoho, or is it a sync
 * mapping issue on our side?"
 *
 * Usage (inside the backend container):
 *   docker compose -f docker-compose.prod.yml --env-file backend/.env \
 *     exec backend node utils/zoho-employee-dump.js balaji@altiusnxt.com
 *
 * Output (one line per field):
 *   ✓ FirstName              = Balaji
 *   ✓ Date_of_birth          = 19-Mar-2004
 *   ✗ Aadhaar_Number         (empty)
 *   ...
 *   📂 Dependent Details      (0 rows)
 *   📂 Education Details      (1 row)
 *      • Degree              = BE
 *      ...
 */
require('dotenv').config();
const { iterateEmployees } = require('./zoho');

const targetEmail = (process.argv[2] || '').trim().toLowerCase();
if (!targetEmail) {
  console.error('Usage: node utils/zoho-employee-dump.js <email>');
  process.exit(2);
}

const isFilled = (v) =>
  v !== null && v !== undefined && v !== '' && v !== '<empty>';

(async () => {
  console.log(`Looking up Zoho record for: ${targetEmail}\n`);

  let found = null;
  for await (const rec of iterateEmployees()) {
    const emails = [rec.EmailID, rec.Email, rec.Email_ID, rec.Workemail]
      .filter(Boolean)
      .map(e => String(e).toLowerCase());
    if (emails.includes(targetEmail)) {
      found = rec;
      break;
    }
  }

  if (!found) {
    console.error(`❌ No Zoho record found with EmailID = ${targetEmail}`);
    console.error('   Tip: check the spelling, or look for the email under a');
    console.error('   different field (Other_Email isn\'t used for the search).');
    process.exit(1);
  }

  // ── Top-level fields ────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('  TOP-LEVEL FIELDS — what Zoho actually has for this employee');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  const entries = Object.entries(found)
    .filter(([k]) => k !== 'tabularSections')
    // Hide Zoho's internal .ID / .id / .displayValue companions — they
    // clutter the output and aren't real data fields.
    .filter(([k]) => !/\.(ID|id|displayValue|country_code|type)$/.test(k))
    .sort(([a], [b]) => a.localeCompare(b));

  for (const [key, val] of entries) {
    const filled = isFilled(val);
    const tag    = filled ? '✓' : '✗';
    const shown  = filled ? `= ${val}` : '(empty)';
    console.log(`  ${tag} ${key.padEnd(34)} ${shown}`);
  }

  // ── Tabular sections (Education, Family, Work experience, etc.) ─────────
  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log('  TABULAR SECTIONS — nested rows (education, family, prev jobs)');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  const sections = found.tabularSections || {};
  if (Object.keys(sections).length === 0) {
    console.log('  (no tabularSections present on this record)');
  } else {
    for (const [name, rows] of Object.entries(sections)) {
      const count = Array.isArray(rows) ? rows.length : 0;
      console.log(`\n  📂 ${name}  (${count} row${count === 1 ? '' : 's'})`);
      if (count === 0) continue;
      // Dump the raw row structure so we can see EXACTLY what Zoho returns.
      // Some tabular rows are flat objects, others are wrapped — printing
      // the raw JSON is the only way to be sure of the field names + values.
      rows.forEach((row, idx) => {
        console.log(`     — row ${idx + 1} (raw JSON) —`);
        console.log(JSON.stringify(row, null, 2).split('\n').map(l => '     ' + l).join('\n'));
      });
    }
  }

  console.log('\n───────────────────────────────────────────────────────────────────────');
  console.log('How to read this:');
  console.log('  ✓ = field has a value in Zoho → should sync into NxtPeople');
  console.log('  ✗ = field is empty in Zoho   → no sync can populate it; fill in Zoho');
  console.log('───────────────────────────────────────────────────────────────────────\n');

  process.exit(0);
})().catch(err => {
  console.error('❌ Lookup failed:', err.message);
  process.exit(1);
});
