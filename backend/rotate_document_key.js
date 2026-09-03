/* Change the document encryption key without losing the documents.
 *
 * A key that has been through a chat window or an email is not secret any
 * more, and deleting the message does not recall the copies on two mail
 * servers and in somebody else's history. The answer is a new key, and the
 * old files re-encrypted under it — not deleting the documents to be allowed
 * to change it.
 *
 * HOW IT WORKS
 *
 *   DOCUMENT_ENCRYPTION_KEY_OLD   the key the files are encrypted with now
 *   DOCUMENT_ENCRYPTION_KEY       the key you want them under
 *
 * Each file is read with the old key, verified against the checksum in its
 * row, written under the new one, and verified again. A file that fails
 * either check is LEFT ALONE and reported: half a rotation is worse than
 * none, and a document nobody can open is not a recoverable mistake.
 *
 *   docker compose -f docker-compose.prod.yml exec backend node rotate_document_key.js
 *   docker compose -f docker-compose.prod.yml exec backend node rotate_document_key.js --apply
 *
 * DRY RUN BY DEFAULT.
 *
 * AFTERWARDS: remove DOCUMENT_ENCRYPTION_KEY_OLD from backend/.env. Leaving
 * it there keeps the compromised key on the server for no reason.
 */
require('dotenv').config();
process.env.LOG_LEVEL = 'silent';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = require('./db');
const store = require('./utils/documentStore');

const APPLY = process.env.APPLY === '1' || process.argv.includes('--apply');
const ALGO = 'aes-256-gcm';
const IV = 12, TAG = 16;

/* Same derivation as documentStore, applied to whichever key is named. Kept
 * here rather than exported so the rotation cannot accidentally use the
 * process-wide cached key for both halves. */
function keyFrom(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^[0-9a-f]{64}$/i.test(s)) return Buffer.from(s, 'hex');
  if (/^[A-Za-z0-9+/=]{44}$/.test(s)) return Buffer.from(s, 'base64');
  return crypto.scryptSync(s, 'nxtpeople-documents', 32);
}
const decryptWith = (key, stored) => {
  const d = crypto.createDecipheriv(ALGO, key, stored.subarray(0, IV));
  d.setAuthTag(stored.subarray(IV, IV + TAG));
  return Buffer.concat([d.update(stored.subarray(IV + TAG)), d.final()]);
};
const encryptWith = (key, plain) => {
  const iv = crypto.randomBytes(IV);
  const c = crypto.createCipheriv(ALGO, key, iv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]);
};

(async () => {
  const oldKey = keyFrom(process.env.DOCUMENT_ENCRYPTION_KEY_OLD);
  const newKey = keyFrom(process.env.DOCUMENT_ENCRYPTION_KEY);

  console.log(`\n  ROTATE DOCUMENT ENCRYPTION KEY  ${APPLY ? '*** APPLYING ***' : '(dry run)'}\n`);

  if (!oldKey) {
    console.error('  DOCUMENT_ENCRYPTION_KEY_OLD is not set. Put the CURRENT key there,');
    console.error('  and the NEW key in DOCUMENT_ENCRYPTION_KEY, then run this again.\n');
    await pool.end(); process.exitCode = 1; return;
  }
  if (!newKey) {
    console.error('  DOCUMENT_ENCRYPTION_KEY is not set. Generate one with:\n');
    console.error('      openssl rand -hex 32\n');
    await pool.end(); process.exitCode = 1; return;
  }
  if (oldKey.equals(newKey)) {
    console.error('  The old and new keys are identical. Nothing to rotate.\n');
    await pool.end(); process.exitCode = 1; return;
  }
  const strength = store.encryptionStrength();
  if (!strength.ok) {
    console.error(`  The new key is ${strength.detail}. Rotating onto a weak key is not an improvement.\n`);
    await pool.end(); process.exitCode = 1; return;
  }

  const rows = (await pool.query(
    `SELECT d.id, d.name, d.folder, d.stored_name AS "storedName", d.checksum,
            e.employee_id AS code
       FROM employee_documents d
       LEFT JOIN employees e ON e.id = d.employee_id
      WHERE d.is_encrypted = TRUE AND d.folder IS NOT NULL AND d.stored_name IS NOT NULL
        AND d.file_missing = FALSE
      ORDER BY e.employee_id, d.created_at`)).rows;

  console.log(`  ${rows.length} encrypted document(s) to re-encrypt.`);
  console.log('  ' + '-'.repeat(84));

  let done = 0, skipped = 0;
  for (const r of rows) {
    const full = path.join(store.EMPLOYEE_ROOT, r.folder, r.storedName);
    const label = `${r.code || '?'}  ${String(r.name || '').slice(0, 30)}`;

    if (!fs.existsSync(full)) {
      console.log(`  SKIP    ${label} — file is not on disk`);
      skipped++; continue;
    }

    let plain;
    try {
      plain = decryptWith(oldKey, fs.readFileSync(full));
    } catch {
      /* Either it was never encrypted with this key, or the file is damaged.
       * Overwriting it would destroy the only copy. */
      console.log(`  SKIP    ${label} — will not open with the old key, left untouched`);
      skipped++; continue;
    }

    if (r.checksum) {
      const got = crypto.createHash('sha256').update(plain).digest('hex');
      if (got !== r.checksum) {
        console.log(`  SKIP    ${label} — decrypts, but does not match its recorded checksum`);
        skipped++; continue;
      }
    }

    if (!APPLY) { console.log(`  WOULD   ${label}`); done++; continue; }

    /* Written beside the original and swapped in, so an interruption leaves
     * the original intact rather than a half-written file. */
    const tmp = `${full}.rotating`;
    fs.writeFileSync(tmp, encryptWith(newKey, plain));
    const back = decryptWith(newKey, fs.readFileSync(tmp));
    if (crypto.createHash('sha256').update(back).digest('hex') !== crypto.createHash('sha256').update(plain).digest('hex')) {
      fs.unlinkSync(tmp);
      console.log(`  FAILED  ${label} — re-encrypted copy did not verify, original kept`);
      skipped++; continue;
    }
    fs.renameSync(tmp, full);
    console.log(`  DONE    ${label}`);
    done++;
  }

  console.log('  ' + '-'.repeat(84));
  console.log(`  ${done} ${APPLY ? 're-encrypted' : 'would be re-encrypted'}, ${skipped} skipped.`);

  if (!APPLY) {
    console.log('\n  Dry run. Nothing was changed. Re-run with --apply.\n');
  } else if (skipped === 0) {
    console.log('\n  Now REMOVE DOCUMENT_ENCRYPTION_KEY_OLD from backend/.env and restart.');
    console.log('  Leaving it there keeps the old key on the server for no reason.\n');
  } else {
    console.log('\n  Some files were skipped — do NOT remove DOCUMENT_ENCRYPTION_KEY_OLD yet,');
    console.log('  or those documents become unopenable. Work out why they were skipped first.\n');
  }
  await pool.end();
})().catch(async e => { console.error(e.message); await pool.end().catch(() => {}); });
