/* Executes the reviewed decision on uploads/_quarantine_legacy_orphans/:
 *
 *   DELETE (after a verified archive exists):
 *     - the 26 Aug cluster, 91 files (Logasundar T duplicates)
 *     - the 28 Aug placeholder-graphic group (10 files, .png)
 *     - the 28 Aug app-screenshot group (2 files, .png)
 *   MIGRATE:
 *     - one of the 2 identical 28 Aug resume PDFs into employee_documents
 *       for ANXT2600149 (Balaji D), properly encrypted; both quarantine
 *       copies removed once the migrated copy is verified to read back
 *       correctly.
 *
 * Every group is RE-DERIVED from what's actually on disk right now — this
 * does not trust a hardcoded file list from an earlier run. If what's
 * actually there doesn't match the expected shape (91 files on 26 Aug;
 * exactly a 10-file .png group, a 2-file .png group and a 2-file .pdf group
 * on 28 Aug), it stops and reports the mismatch rather than guessing.
 *
 * Order of operations, each gated on the previous step succeeding:
 *   1. Re-derive and sanity-check all four groups.
 *   2. Archive the 103 delete-candidates to a .tar.gz and verify its
 *      contents match exactly before anything is deleted.
 *   3. Verify the two resume PDFs are byte-identical (SHA-256) before
 *      treating one as disposable.
 *   4. Migrate one resume into employee_documents, then read it back
 *      through the normal decrypt path and compare its checksum against
 *      the original — only proceeds to delete once that matches.
 *   5. Delete the 91 + 10 + 2 = 103 archived files, and the 2 quarantined
 *      resume copies.
 *   6. Report what's left in the quarantine folder.
 *
 *   docker compose exec backend node execute_quarantine_decision.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const archiver = require('archiver');
const pool = require('./db');
const store = require('./utils/documentStore');

const QUARANTINE = path.join(__dirname, 'uploads', '_quarantine_legacy_orphans');
const ARCHIVE_DIR = path.join(__dirname, 'uploads', '_archives');
const TODAY = new Date().toLocaleDateString('en-CA');
const ARCHIVE_PATH = path.join(ARCHIVE_DIR, `legacy_orphans_reviewed_${TODAY}.tar.gz`);
const BALAJI_EMPLOYEE_ID = 'ANXT2600149';

const dayOf = (d) => d.toISOString().slice(0, 10);
const human = (n) => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`);
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const fail = (msg) => { console.error(`\nABORTED: ${msg}\n`); process.exitCode = 1; return false; };

function listQuarantine() {
  return fs.readdirSync(QUARANTINE, { withFileTypes: true })
    .filter(e => e.isFile())
    .map(e => {
      const full = path.join(QUARANTINE, e.name);
      const stat = fs.statSync(full);
      return { name: e.name, full, size: stat.size, mtime: stat.mtime, ext: path.extname(e.name).toLowerCase() };
    });
}

function archiveFiles(files, outPath) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const out = fs.createWriteStream(outPath);
    const archive = archiver('tar', { gzip: true, gzipOptions: { level: 9 } });
    let settled = false;
    const ok = () => { if (!settled) { settled = true; resolve(archive.pointer()); } };
    const bad = (e) => { if (!settled) { settled = true; reject(e); } };
    out.on('close', ok);
    out.on('error', bad);
    archive.on('error', bad);
    archive.pipe(out);
    files.forEach(f => archive.file(f.full, { name: f.name }));
    archive.finalize();
  });
}

(async () => {
  console.log('\n=== Executing reviewed quarantine decision ===\n');

  if (!fs.existsSync(QUARANTINE)) return fail('Quarantine folder does not exist.');

  const all = listQuarantine();
  const byDay = new Map();
  for (const f of all) {
    const key = dayOf(f.mtime);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(f);
  }

  // ── 1. Re-derive and sanity-check every group ─────────────────────────
  const cluster26 = byDay.get('2026-08-26') || [];
  const cluster28 = byDay.get('2026-08-28') || [];

  console.log(`  26 Aug cluster: ${cluster26.length} file(s) found (expected 91)`);
  console.log(`  28 Aug cluster: ${cluster28.length} file(s) found (expected 14)`);

  if (cluster26.length !== 91) return fail(`26 Aug cluster has ${cluster26.length} files, expected exactly 91 — stopping rather than deleting an unexpected set.`);
  if (cluster28.length !== 14) return fail(`28 Aug cluster has ${cluster28.length} files, expected exactly 14 — stopping rather than deleting an unexpected set.`);

  const bySig = new Map();
  for (const f of cluster28) {
    const key = `${f.ext}|${f.size}`;
    if (!bySig.has(key)) bySig.set(key, []);
    bySig.get(key).push(f);
  }
  const groups = [...bySig.values()];
  const placeholderGroup = groups.find(g => g.length === 10 && g[0].ext === '.png');
  const screenshotGroup = groups.find(g => g.length === 2 && g[0].ext === '.png' && g !== placeholderGroup);
  const resumeGroup = groups.find(g => g.length === 2 && g[0].ext === '.pdf');

  if (!placeholderGroup) return fail('Could not find a 10-file .png group in the 28 Aug cluster — expected the placeholder graphic group.');
  if (!screenshotGroup) return fail('Could not find a 2-file .png group (distinct from the placeholder group) — expected the app-screenshot group.');
  if (!resumeGroup) return fail('Could not find a 2-file .pdf group — expected the resume duplicates.');

  console.log(`  28 Aug sub-groups confirmed: placeholder (${placeholderGroup.length} .png, ${human(placeholderGroup[0].size)} each), ` +
    `screenshot (${screenshotGroup.length} .png, ${human(screenshotGroup[0].size)} each), resume (${resumeGroup.length} .pdf, ${human(resumeGroup[0].size)} each)`);

  const toDelete = [...cluster26, ...placeholderGroup, ...screenshotGroup];
  console.log(`\n  Delete-candidates: ${toDelete.length} file(s) (expected 103)`);
  if (toDelete.length !== 103) return fail(`Delete-candidate count is ${toDelete.length}, expected exactly 103 — stopping.`);

  // ── 2. Archive the 103, then verify before deleting anything ──────────
  console.log(`\n  Archiving ${toDelete.length} file(s) to ${ARCHIVE_PATH} ...`);
  let archiveBytes;
  try {
    archiveBytes = await archiveFiles(toDelete, ARCHIVE_PATH);
  } catch (e) {
    return fail(`Could not create the archive: ${e.message}. Nothing was deleted.`);
  }
  console.log(`  Archive written: ${human(archiveBytes)}`);

  // Verify: every one of the 103 filenames is actually inside the archive,
  // by re-listing it rather than trusting that archiver reported success.
  const { execFileSync } = require('child_process');
  let archivedNames;
  try {
    archivedNames = new Set(
      execFileSync('tar', ['-tzf', ARCHIVE_PATH]).toString().trim().split('\n').map(s => s.trim())
    );
  } catch (e) {
    return fail(`Could not verify the archive with tar -tzf (${e.message}). Nothing was deleted — check ${ARCHIVE_PATH} manually before re-running.`);
  }
  const missing = toDelete.filter(f => !archivedNames.has(f.name));
  if (missing.length) {
    return fail(`${missing.length} file(s) expected in the archive are not actually in it (e.g. ${missing[0].name}). Nothing was deleted.`);
  }
  if (archivedNames.size !== toDelete.length) {
    return fail(`Archive contains ${archivedNames.size} entries, expected exactly ${toDelete.length}. Nothing was deleted.`);
  }
  console.log(`  Verified: all ${toDelete.length} filenames confirmed present inside the archive.`);

  // ── 3. Verify the two "identical" resumes really are byte-identical ───
  const [resumeA, resumeB] = resumeGroup;
  const bufA = fs.readFileSync(resumeA.full);
  const bufB = fs.readFileSync(resumeB.full);
  const hashA = sha256(bufA), hashB = sha256(bufB);
  console.log(`\n  Resume copy 1 (${resumeA.name}): sha256 ${hashA}`);
  console.log(`  Resume copy 2 (${resumeB.name}): sha256 ${hashB}`);
  if (hashA !== hashB) {
    return fail('The two resume files are NOT byte-identical. Not safe to treat one as a disposable duplicate — stopping before migrating or deleting either. Archive of the 103 above was still created and is safe to keep.');
  }
  console.log('  Confirmed byte-identical. Safe to migrate one and discard the other.');

  // ── 4. Migrate Balaji D's resume ───────────────────────────────────────
  const emp = (await pool.query(
    `SELECT id, employee_id AS "employeeId", first_name AS "firstName", last_name AS "lastName",
            document_folder AS "folder"
       FROM employees WHERE employee_id = $1`, [BALAJI_EMPLOYEE_ID]
  )).rows[0];
  if (!emp) return fail(`No employee found with employee_id = ${BALAJI_EMPLOYEE_ID}. Archive of the 103 above was still created. Resumes left untouched.`);

  const existingDocs = await pool.query(`SELECT COUNT(*)::int AS n FROM employee_documents WHERE employee_id = $1`, [emp.id]);
  if (existingDocs.rows[0].n > 0) {
    return fail(`${BALAJI_EMPLOYEE_ID} now has ${existingDocs.rows[0].n} document row(s) — expected 0. ` +
      'Something changed since the investigation; stopping before creating a possibly-duplicate row. Archive of the 103 above was still created.');
  }

  console.log(`\n  Migrating resume for ${emp.firstName} ${emp.lastName} (${emp.employeeId}) ...`);
  const written = store.storeDocument({
    employee: emp, folder: emp.folder, buffer: bufA,
    originalName: resumeA.name, label: 'Resume', when: resumeA.mtime,
  });

  let row;
  try {
    row = (await pool.query(
      `INSERT INTO employee_documents
         (employee_id, name, type, file_url, file_size, uploaded_by,
          folder, stored_name, is_encrypted, checksum, original_name)
       VALUES ($1,$2,$3,$4,$5,$1,$6,$7,$8,$9,$10)
       RETURNING id`,
      [emp.id, 'Resume', 'resume', `/uploads/${written.relativePath}`,
       written.size, written.folder, written.storedName, written.encrypted, written.checksum, resumeA.name]
    )).rows[0];
  } catch (e) {
    store.deleteDocument({ folder: written.folder, storedName: written.storedName });
    return fail(`Could not insert the employee_documents row (${e.message}). The written file was removed. Archive of the 103 above was still created. Resumes left untouched.`);
  }

  // Verify the round trip before anything is deleted: read it back through
  // the exact same decrypt path the real download route uses.
  const readBack = store.readDocument({ folder: written.folder, storedName: written.storedName, encrypted: written.encrypted });
  if (!readBack || sha256(readBack) !== hashA) {
    return fail(`Migrated document did not read back correctly (checksum mismatch). ` +
      `employee_documents row #${row.id} and the written file were left in place for inspection — do not delete the quarantined resumes yet.`);
  }
  console.log(`  Migrated and verified: employee_documents#${row.id}, encrypted=${written.encrypted}, ` +
    `stored at employees/${written.folder}/${written.storedName}. Read-back checksum matches.`);

  // ── 5. Delete — only now, after every verification above passed ───────
  console.log('\n  Deleting the 103 archived files ...');
  let deleted = 0;
  for (const f of toDelete) {
    try { fs.unlinkSync(f.full); deleted++; } catch (e) { console.log(`    could not delete ${f.name}: ${e.message}`); }
  }
  console.log(`  ${deleted}/${toDelete.length} deleted.`);

  console.log('  Deleting both quarantined resume copies (content now safely migrated) ...');
  let resumesDeleted = 0;
  for (const f of resumeGroup) {
    try { fs.unlinkSync(f.full); resumesDeleted++; } catch (e) { console.log(`    could not delete ${f.name}: ${e.message}`); }
  }
  console.log(`  ${resumesDeleted}/2 resume copies deleted.`);

  // ── 6. Final state ──────────────────────────────────────────────────
  const remaining = fs.existsSync(QUARANTINE) ? fs.readdirSync(QUARANTINE).filter(n => fs.statSync(path.join(QUARANTINE, n)).isFile()) : [];

  console.log('\n=== Summary ===');
  console.log(`  Deleted: ${deleted + resumesDeleted} file(s) total (${deleted} archived duplicates/non-documents + ${resumesDeleted} superseded resume copies)`);
  console.log(`  Archive: ${ARCHIVE_PATH}  (${human(archiveBytes)}, ${toDelete.length} files, verified before delete)`);
  console.log(`  Migrated: 1 document -> employee_documents#${row.id} for ${emp.firstName} ${emp.lastName} (${emp.employeeId}), type=resume, encrypted=${written.encrypted}`);
  console.log(`  Quarantine folder now contains: ${remaining.length} file(s)${remaining.length ? ' — UNEXPECTED, listed below:' : ' (empty, as expected)'}`);
  remaining.forEach(n => console.log(`    ${n}`));

  await pool.end();
  console.log('\n=== done ===\n');
})().catch(async (e) => { console.error(e); await pool.end().catch(() => {}); process.exit(1); });
