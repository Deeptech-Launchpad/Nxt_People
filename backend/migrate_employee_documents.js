/* ── Documents move into their owner's folder ─────────────────────────────
 *  Everything lived in one flat directory under a random name. This gives
 *  each employee a folder, renames their papers so a human can read them,
 *  and encrypts them where a key is configured.
 *
 *  It is careful with what is already there:
 *
 *    - a file that cannot be found is REPORTED, never deleted, and its row is
 *      marked missing rather than quietly rewritten to point somewhere new
 *    - the original is only removed once the copy is written and verified by
 *      checksum, so an interruption leaves two copies rather than none
 *    - re-running it skips anything already moved
 *
 *  Idempotent. Safe to re-run.
 *      docker compose exec backend node migrate_employee_documents.js
 *      docker compose exec backend node migrate_employee_documents.js --apply
 *
 *  DRY RUN BY DEFAULT: it reports what it would move and touches nothing.
 * ───────────────────────────────────────────────────────────────────────── */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = require('./db');
const store = require('./utils/documentStore');

const APPLY = process.env.APPLY === '1' || process.argv.includes('--apply');
const UPLOADS = path.join(__dirname, 'uploads');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    /* Where the file is now, and whether it is scrambled. file_url stays as
     * it was so nothing that still reads it breaks mid-deploy. */
    /* What the person actually called the file before it was sanitised.
     *
     * This one was ASSUMED to exist rather than added, because it exists on my
     * local database — and live is older and does not have it. The upload
     * answered 500 with `column "original_name" ... does not exist`, and the
     * onboarding form would have done the same to a candidate midway through
     * submitting their papers.
     *
     * The lesson is in the migration now rather than in a comment: every
     * column the routes write is created here, whether or not some database
     * somewhere already had it. Checking one environment's schema and
     * assuming the others match is how this happened. */
    await client.query(`ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS original_name VARCHAR(255)`);
    await client.query(`ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS folder VARCHAR(200)`);
    await client.query(`ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS stored_name VARCHAR(255)`);
    await client.query(`ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS is_encrypted BOOLEAN NOT NULL DEFAULT FALSE`);
    await client.query(`ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS checksum VARCHAR(64)`);
    /* Set when the bytes cannot be found. A row that points at nothing is a
     * fact worth recording: the alternative is a screen that offers a
     * download and answers with a 404, which is what live does today. */
    await client.query(`ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS file_missing BOOLEAN NOT NULL DEFAULT FALSE`);
    await client.query(`ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS migrated_at TIMESTAMP`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_employee_documents_employee ON employee_documents (employee_id)`);

    /* The folder an employee's papers live in, recorded on the employee so a
     * later rename cannot orphan them. */
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS document_folder VARCHAR(200)`);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('  Schema step failed:', err.message);
    client.release();
    await pool.end();
    process.exitCode = 1;
    return;
  }
  client.release();

  /* Prove the table can take what the routes write, before anybody uploads.
   *
   * A missing column surfaces as a 500 at the worst possible moment — for a
   * candidate this is the onboarding form, halfway through submitting their
   * certificates. Checking it here means the answer arrives during a deploy,
   * to somebody who can act on it, rather than to a stranger filling in a
   * form. */
  const NEEDED = ['employee_id', 'name', 'type', 'file_url', 'file_size', 'uploaded_by',
    'folder', 'stored_name', 'is_encrypted', 'checksum', 'original_name', 'file_missing'];
  const present = new Set((await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='employee_documents'`)).rows.map(r => r.column_name));
  const absent = NEEDED.filter(c => !present.has(c));
  if (absent.length) {
    console.error(`\n  employee_documents is missing: ${absent.join(', ')}`);
    console.error('  Uploads will fail with a 500 until this migration adds them.\n');
    await pool.end();
    process.exitCode = 1;
    return;
  }

  console.log(`\n  EMPLOYEE DOCUMENTS  ${APPLY ? '*** APPLYING ***' : '(dry run — nothing will be moved)'}`);
  console.log(`  employee_documents: every column the upload writes is present`);
  const strength = store.encryptionStrength();
  console.log(`  encryption key: ${strength.detail}`);
  if (strength.kind === 'none') {
    console.log('  Files will be stored unencrypted and marked as such. Set');
    console.log('  DOCUMENT_ENCRYPTION_KEY in backend/.env to encrypt them.');
  } else if (!strength.ok) {
    console.log('');
    console.log('  *** THIS KEY IS TOO SHORT TO PROTECT ANYTHING ***');
    console.log('  It produces a working cipher, so everything reports as encrypted,');
    console.log('  but anybody who copies the disk can guess it. Replace it NOW while');
    console.log('  nothing is encrypted yet — changing it later means re-encrypting');
    console.log('  every document, and any file encrypted with the old key is lost.');
    console.log('');
    console.log('      openssl rand -hex 32');
    console.log('');
  }
  console.log('  ' + '-'.repeat(88));

  const rows = (await pool.query(
    `SELECT d.id, d.employee_id AS "employeeId", d.name, d.type,
            d.file_url AS "fileUrl", d.folder, d.stored_name AS "storedName",
            e.employee_id AS "employeeCode", e.first_name AS "firstName", e.last_name AS "lastName",
            e.document_folder AS "employeeFolder"
       FROM employee_documents d
       LEFT JOIN employees e ON e.id = d.employee_id
      ORDER BY d.created_at NULLS LAST`)).rows;

  if (!rows.length) {
    console.log('  No documents recorded.\n');
    await pool.end();
    return;
  }

  let moved = 0, already = 0, missing = 0, orphaned = 0;
  const missingList = [];

  for (const r of rows) {
    if (r.folder && r.storedName) { already++; continue; }
    if (!r.employeeId || !r.employeeCode) {
      orphaned++;
      console.log(`  ORPHAN  ${String(r.name || '').slice(0, 40).padEnd(42)} no employee on this row`);
      continue;
    }

    /* file_url is "/uploads/<name>". Resolved against the uploads directory
     * rather than trusted as a path. */
    const source = path.join(UPLOADS, path.basename(String(r.fileUrl || '')));
    if (!r.fileUrl || !fs.existsSync(source)) {
      missing++;
      missingList.push(`${r.employeeCode}  ${String(r.name || 'unnamed').slice(0, 34)}  ${r.fileUrl || '(no path)'}`);
      if (APPLY) {
        await pool.query(`UPDATE employee_documents SET file_missing = TRUE WHERE id = $1`, [r.id]);
      }
      continue;
    }

    const employee = {
      employeeId: r.employeeCode, firstName: r.firstName, lastName: r.lastName,
    };
    const folderName = r.employeeFolder || store.folderNameFor(employee);

    if (!APPLY) {
      const target = store.storedNameFor({
        employeeId: r.employeeCode, originalName: r.fileUrl, label: r.name, dir: null,
      });
      console.log(`  MOVE    ${folderName}/`);
      console.log(`          ${path.basename(source)}  ->  ${target}`);
      moved++;
      continue;
    }

    const buffer = fs.readFileSync(source);
    const written = store.storeDocument({
      employee, folder: folderName, buffer,
      originalName: r.fileUrl, label: r.name,
    });

    /* Verified before the original is let go. A move that loses a
     * certificate is worse than one that leaves a duplicate behind. */
    const back = store.readDocument({
      folder: written.folder, storedName: written.storedName, encrypted: written.encrypted,
    });
    const ok = back && crypto.createHash('sha256').update(back).digest('hex') === written.checksum;
    if (!ok) {
      console.log(`  FAILED  ${r.employeeCode}  ${r.name} — copy did not verify, original left alone`);
      continue;
    }

    await pool.query(
      `UPDATE employee_documents
          SET folder = $1, stored_name = $2, is_encrypted = $3, checksum = $4,
              file_size = COALESCE(file_size, $5), file_missing = FALSE, migrated_at = NOW()
        WHERE id = $6`,
      [written.folder, written.storedName, written.encrypted, written.checksum, written.size, r.id]);
    await pool.query(
      `UPDATE employees SET document_folder = $1 WHERE id = $2 AND document_folder IS NULL`,
      [written.folder, r.employeeId]);

    fs.unlinkSync(source);
    moved++;
    console.log(`  MOVED   ${written.folder}/${written.storedName}${written.encrypted ? '  (encrypted)' : ''}`);
  }

  console.log('  ' + '-'.repeat(88));
  console.log(`  ${moved} to move, ${already} already in place, ${missing} with no file, ${orphaned} orphaned`);

  if (missingList.length) {
    console.log('\n  ROWS WHOSE FILE IS NOT ON DISK');
    console.log('  These are the downloads that answer with a 404. The record survives;');
    console.log('  the bytes do not. Nothing here was deleted by this script.');
    console.log('  ' + '-'.repeat(88));
    missingList.slice(0, 40).forEach(l => console.log('    ' + l));
    if (missingList.length > 40) console.log(`    ... and ${missingList.length - 40} more`);
  }

  if (!APPLY) {
    console.log('\n  Dry run. Nothing was moved. Re-run with --apply once the list looks right.\n');
  } else {
    console.log('');
  }
  await pool.end();
}

migrate();
