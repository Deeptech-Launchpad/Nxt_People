/* Read-only inventory of backend/uploads/: what's in each subfolder, what the
 * loose top-level files are, and — the important part — whether every
 * hash-named legacy document (the old pre-migration naming scheme,
 * c6800f94050c490f6807f2b8b8655872.pdf) is still referenced by a row in
 * employee_documents, or is an orphan nobody's code points at any more.
 *
 * Complements inspect_orphan_documents.js, which only checks the organized
 * employees/ folders (matched by folder+stored_name). This one checks the
 * flat legacy files at uploads/ root (matched by the older file_url column) —
 * run both for the complete picture.
 *
 * Touches nothing. Run on the server:
 *   docker compose exec backend node inspect_uploads_inventory.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./db');

const ROOT = path.join(__dirname, 'uploads');
const HEX32 = /^[0-9a-f]{32}(\.\w+)?$/i;

// Known diagnostic/migration script output patterns — writes to uploads/
// only because it's the one directory the container can reliably write to,
// not because these are document-system files.
const KNOWN_TOOL_OUTPUT = [
  { re: /^leave_review_\d{4}\.csv$/, from: 'inspect_leave_review_sheet.js' },
  { re: /^leave_data_audit_\d{4}\.csv$/, from: 'inspect_leave_data_audit.js' },
  { re: /^zoho_balance_plan_\d{4}\.csv$/, from: 'inspect_zoho_balance_plan.js' },
  { re: /^photo_fetch_\d+\.json$/, from: 'migrate_employee_photos.js' },
];
// regularization/on-duty/comp-off/etc attachments: a different, legitimate
// feature's uploads, not identity documents, not diagnostic output.
const KNOWN_FEATURE_UPLOAD = [
  { re: /^regularization-\d+-\w+\.\w+$/, from: 'routes/regularizations.js' },
  { re: /^onduty-\d+-\w+\.\w+$/, from: 'routes/on-duty.js' },
  { re: /^receipt-\d+-\w+\.\w+$/, from: 'routes/compensation.js' },
  { re: /^letter-\d+-\w+\.\w+$/, from: 'routes/hr-letters.js' },
  { re: /^kb-\d+-\w+\.\w+$/, from: 'routes/employee-info-settings.js' },
];

function walk(dir) {
  let files = 0, bytes = 0;
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, name.name);
    if (name.isDirectory()) {
      const sub = walk(p);
      files += sub.files; bytes += sub.bytes;
    } else {
      files++; bytes += fs.statSync(p).size;
    }
  }
  return { files, bytes };
}

const human = (n) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
};

(async () => {
  console.log('\n=== backend/uploads/ inventory ===\n');

  if (!fs.existsSync(ROOT)) { console.log('uploads/ does not exist.'); process.exit(1); }

  // ── 1. Subfolder breakdown ────────────────────────────────────────────
  console.log('--- Subfolders ---');
  const entries = fs.readdirSync(ROOT, { withFileTypes: true });
  const subfolders = entries.filter(e => e.isDirectory()).map(e => e.name);
  for (const name of subfolders) {
    const stat = walk(path.join(ROOT, name));
    console.log(`  ${name.padEnd(14)} ${String(stat.files).padStart(5)} files   ${human(stat.bytes)}`);
  }

  // employees/ detail: how many employee folders, and a sample of what's
  // actually inside a few of them (document type labels, from real filenames).
  const empRoot = path.join(ROOT, 'employees');
  if (fs.existsSync(empRoot)) {
    const empFolders = fs.readdirSync(empRoot, { withFileTypes: true }).filter(e => e.isDirectory());
    console.log(`\n  employees/ breakdown: ${empFolders.length} employee folder(s)`);
    const sample = empFolders.slice(0, 5);
    for (const f of sample) {
      const files = fs.readdirSync(path.join(empRoot, f.name)).filter(n => !n.startsWith('.'));
      console.log(`    ${f.name}/  (${files.length} file${files.length === 1 ? '' : 's'})`);
      files.slice(0, 8).forEach(n => console.log(`        ${n}`));
    }
    if (empFolders.length > 5) console.log(`    ...and ${empFolders.length - 5} more folder(s)`);
  }

  // ── 2 & 3. Loose files directly in uploads/ root ──────────────────────
  const looseFiles = entries.filter(e => e.isFile()).map(e => e.name);
  const legacyHashNamed = looseFiles.filter(n => HEX32.test(n));
  const knownTool = looseFiles.filter(n => KNOWN_TOOL_OUTPUT.some(k => k.re.test(n)));
  const knownFeature = looseFiles.filter(n => KNOWN_FEATURE_UPLOAD.some(k => k.re.test(n)));
  const unrecognized = looseFiles.filter(n =>
    !HEX32.test(n) && !KNOWN_TOOL_OUTPUT.some(k => k.re.test(n)) && !KNOWN_FEATURE_UPLOAD.some(k => k.re.test(n)));

  console.log(`\n--- Loose files directly in uploads/ (${looseFiles.length} total) ---`);
  console.log(`  Legacy hash-named (pre-migration identity documents): ${legacyHashNamed.length}`);
  console.log(`  Known diagnostic/migration tool output:                ${knownTool.length}`);
  knownTool.forEach(n => {
    const match = KNOWN_TOOL_OUTPUT.find(k => k.re.test(n));
    const stat = fs.statSync(path.join(ROOT, n));
    console.log(`    ${n}  (${human(stat.size)}, written by ${match.from})`);
  });
  console.log(`  Known other-feature uploads (not identity documents):  ${knownFeature.length}`);
  knownFeature.forEach(n => {
    const match = KNOWN_FEATURE_UPLOAD.find(k => k.re.test(n));
    const stat = fs.statSync(path.join(ROOT, n));
    console.log(`    ${n}  (${human(stat.size)}, uploaded via ${match.from})`);
  });
  console.log(`  Unrecognized (none of the above):                      ${unrecognized.length}`);
  unrecognized.forEach(n => {
    const stat = fs.statSync(path.join(ROOT, n));
    console.log(`    ${n}  (${human(stat.size)})`);
  });

  // ── 4. The important part: is every legacy hash-named file still
  //    referenced by a DB row, or orphaned? ──────────────────────────────
  if (legacyHashNamed.length) {
    console.log(`\n--- Cross-checking ${legacyHashNamed.length} legacy hash-named file(s) against employee_documents ---`);
    let matched = 0, orphaned = 0;
    for (const file of legacyHashNamed) {
      const base = file.replace(/\.\w+$/, '');
      const r = await pool.query(
        `SELECT ed.id, ed.employee_id AS "employeeId", e.first_name AS "firstName", e.last_name AS "lastName",
                ed.name, ed.type, ed.is_encrypted AS "isEncrypted", ed.file_url AS "fileUrl"
           FROM employee_documents ed
           LEFT JOIN employees e ON e.id = ed.employee_id
          WHERE ed.file_url LIKE '%' || $1 || '%'`,
        [base]
      ).catch(() => ({ rows: [] }));
      const stat = fs.statSync(path.join(ROOT, file));
      if (r.rows.length) {
        matched++;
        const d = r.rows[0];
        console.log(`  MATCHED   ${file}  (${human(stat.size)})  -> employee_documents#${d.id}, ` +
          `${d.firstName || '?'} ${d.lastName || ''} (${d.employeeId || 'unknown id'}), ` +
          `"${d.name}", type=${d.type}, encrypted=${d.isEncrypted === true}`);
      } else {
        orphaned++;
        console.log(`  ORPHANED  ${file}  (${human(stat.size)})  -> NO ROW references this file anywhere in employee_documents`);
      }
    }
    console.log(`\n  ${matched} matched to a database row, ${orphaned} orphaned (no record at all)`);
  }

  await pool.end();
  console.log('\n=== done — nothing was modified ===\n');
})().catch(async (e) => { console.error(e); await pool.end().catch(() => {}); process.exit(1); });
