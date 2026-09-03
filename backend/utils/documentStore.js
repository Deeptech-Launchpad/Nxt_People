/* Where an employee's documents live, what they are called, and how they are
 * kept.
 *
 * WHAT WAS WRONG
 *
 * Every document in the system landed in one flat directory under a random
 * name — c6800f94050c490f6807f2b8b8655872.pdf. Three consequences, and the
 * third is the one that bites:
 *
 *   - the directory is unreadable to a human, so nobody can find or check
 *     anybody's papers without querying the database
 *   - lose the database and the files are anonymous rubble
 *   - the URL was the only secret. /uploads/<name> checked that you held SOME
 *     valid token, not that the file was yours, so any signed-in employee
 *     could read a colleague's Aadhaar given the filename
 *
 * WHAT THIS DOES
 *
 *   uploads/employees/ANXT2600149_Balaji_D/
 *       ANXT2600149_2026-09-03_10th-certificate.pdf
 *
 * The folder is FOUND by employee id and only decorated with the name, so
 * correcting somebody's spelling cannot orphan their papers. The date in the
 * filename is the UPLOAD date, never the date of birth: a filename travels —
 * into a downloads folder, an email, a chat — and a birth date in it leaks a
 * personal detail every time the file is forwarded.
 *
 * ENCRYPTION
 *
 * AES-256-GCM, with a key from the environment. The server decrypts on the
 * way out, so an administrator downloads an ordinary PDF and never knows.
 * What it protects is the disk and the backups: a copied volume is noise
 * without the key.
 *
 * It is deliberately OPTIONAL. With no key configured, files are stored as
 * they always were and the row records that they are not encrypted, so:
 *
 *   - a missing key cannot stop somebody uploading their certificate
 *   - turning encryption on later does not strand the files already there
 *
 * THE KEY IS THE WHOLE THING. Lose DOCUMENT_ENCRYPTION_KEY and every
 * encrypted document is unrecoverable — there is no back door and no reset.
 * It belongs in the root .env beside JWT_SECRET, and in whatever backs that
 * up.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', 'uploads');
const EMPLOYEE_ROOT = path.join(ROOT, 'employees');

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/* The key, derived once. A hex or base64 key of the right length is used as
 * it stands; anything else is stretched with scrypt so a human-typed
 * passphrase still produces a valid 32-byte key rather than an error at the
 * moment somebody uploads a file. */
let cachedKey = null;
function encryptionKey() {
  if (cachedKey !== null) return cachedKey;
  const raw = process.env.DOCUMENT_ENCRYPTION_KEY;
  if (!raw || !String(raw).trim()) { cachedKey = false; return cachedKey; }
  const s = String(raw).trim();
  if (/^[0-9a-f]{64}$/i.test(s)) cachedKey = Buffer.from(s, 'hex');
  else if (/^[A-Za-z0-9+/=]{44}$/.test(s)) cachedKey = Buffer.from(s, 'base64');
  else cachedKey = crypto.scryptSync(s, 'nxtpeople-documents', 32);
  return cachedKey;
}
const encryptionAvailable = () => encryptionKey() !== false;

/* How good the key actually is.
 *
 * scryptSync will stretch ANY string into a valid 32-byte key, so a
 * four-character passphrase produces a working cipher and a screen that
 * reports "encryption key configured: true". It is configured; it is not
 * protecting anything. Someone who takes the disk tries every short string
 * in minutes.
 *
 * Reported rather than refused, because refusing at the point of upload would
 * cost somebody their certificate over a configuration mistake they cannot
 * fix. Said loudly at boot and in the migration instead, while it is still
 * cheap to change — once files are encrypted, changing the key means
 * re-encrypting all of them. */
function encryptionStrength() {
  const raw = String(process.env.DOCUMENT_ENCRYPTION_KEY || '').trim();
  if (!raw) return { ok: false, kind: 'none', detail: 'no key set' };
  if (/^[0-9a-f]{64}$/i.test(raw)) return { ok: true, kind: 'hex-256', detail: '256-bit hex key' };
  if (/^[A-Za-z0-9+/=]{44}$/.test(raw)) return { ok: true, kind: 'base64-256', detail: '256-bit base64 key' };
  if (raw.length >= 32) return { ok: true, kind: 'passphrase', detail: `${raw.length}-character passphrase (stretched)` };
  return {
    ok: false, kind: 'weak',
    detail: `only ${raw.length} character${raw.length === 1 ? '' : 's'} — guessable in minutes`,
  };
}

/* A filename that cannot escape its folder or surprise a filesystem.
 *
 * Originals arrive with spaces, unicode, emoji, 200 characters, and
 * occasionally "../". Everything outside a small safe set becomes a hyphen,
 * runs collapse, and the length is capped — the extension is kept separately
 * so a long name cannot eat it. */
function safeName(original, fallback = 'document') {
  const ext = path.extname(String(original || '')).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 10);
  const base = path.basename(String(original || ''), path.extname(String(original || '')))
    .normalize('NFKD')
    .replace(/[^\w\s.-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60);
  return `${base || fallback}${ext}`;
}

/* ANXT2600149_Balaji_D — id first, because the id is what the folder is
 * looked up by and the name is only there so a person browsing the server can
 * tell whose papers these are. */
function folderNameFor(employee) {
  /* safeName's fallback exists for a FILE with no usable name. Applied to a
   * name part it turns an absent surname into the word "document", which is
   * how ANXT220016_Balaji became ANXT220016_Balaji_document. An empty part
   * has to stay empty and drop out. */
  const part = (v) => (String(v || '').trim() ? safeName(v, '').replace(/\.+$/, '') : '');
  const id = part(employee?.employeeId || employee?.employee_id) || 'unknown';
  const first = part(employee?.firstName || employee?.first_name);
  const last = part(employee?.lastName || employee?.last_name);
  const person = [first, last].filter(Boolean).join('_');
  return person ? `${id}_${person}` : id;
}

/* The folder a person's documents belong in, found by ID.
 *
 * `existing` is the folder already recorded against them. It wins, so a
 * renamed employee keeps their papers where they are rather than growing a
 * second folder and leaving the first behind. */
function ensureFolder(employee, existing = null) {
  const name = existing || folderNameFor(employee);
  const dir = path.join(EMPLOYEE_ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  return { name, dir };
}

/* ANXT2600149_2026-09-03_10th-certificate.pdf
 *
 * The upload date, not the birth date. A counter is appended only where the
 * name is already taken, so re-uploading the same certificate twice in a day
 * does not silently overwrite the first. */
function storedNameFor({ employeeId, originalName, label, dir, when = new Date() }) {
  const date = when.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const id = safeName(employeeId || 'unknown').replace(/\.+$/, '');
  const ext = path.extname(String(originalName || '')).toLowerCase();
  const stem = safeName(label || path.basename(String(originalName || ''), ext) || 'document')
    .replace(new RegExp(`${ext.replace('.', '\\.')}$`), '');

  let candidate = `${id}_${date}_${stem}${ext}`;
  let n = 2;
  while (dir && fs.existsSync(path.join(dir, candidate))) {
    candidate = `${id}_${date}_${stem}-${n}${ext}`;
    n++;
  }
  return candidate;
}

/* [ 12-byte IV ][ 16-byte auth tag ][ ciphertext ]
 *
 * GCM rather than CBC so a tampered file fails to decrypt instead of quietly
 * producing rubbish. The tag is what makes that true, and it is stored with
 * the file because it is useless to an attacker and essential to us. */
function encryptBuffer(plain) {
  const key = encryptionKey();
  if (key === false) return { data: plain, encrypted: false };
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { data: Buffer.concat([iv, cipher.getAuthTag(), body]), encrypted: true };
}

function decryptBuffer(stored) {
  const key = encryptionKey();
  if (key === false) throw new Error('This document is encrypted but no encryption key is configured');
  const iv = stored.subarray(0, IV_BYTES);
  const tag = stored.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const body = stored.subarray(IV_BYTES + TAG_BYTES);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

/* Write one document into its owner's folder, encrypted if a key is set.
 * Returns everything the row needs to find it again. */
function storeDocument({ employee, folder, buffer, originalName, label }) {
  const { name: folderName, dir } = ensureFolder(employee, folder);
  const storedName = storedNameFor({
    employeeId: employee?.employeeId || employee?.employee_id,
    originalName, label, dir,
  });
  const { data, encrypted } = encryptBuffer(buffer);
  fs.writeFileSync(path.join(dir, storedName), data);
  return {
    folder: folderName,
    storedName,
    encrypted,
    size: buffer.length,
    checksum: crypto.createHash('sha256').update(buffer).digest('hex'),
    relativePath: path.join('employees', folderName, storedName).split(path.sep).join('/'),
  };
}

/* Read one back. `encrypted` comes from the row rather than being guessed
 * from the bytes, so a file stored before a key existed still opens. */
function readDocument({ folder, storedName, encrypted }) {
  const full = path.join(EMPLOYEE_ROOT, folder || '', storedName || '');
  /* Nothing addressed from outside this tree, whatever the row says. A
   * corrupted or crafted folder value must not be able to read /etc/passwd. */
  const resolved = path.resolve(full);
  if (!resolved.startsWith(path.resolve(EMPLOYEE_ROOT))) {
    throw new Error('That document is not where it claims to be');
  }
  if (!fs.existsSync(resolved)) return null;
  const raw = fs.readFileSync(resolved);
  return encrypted ? decryptBuffer(raw) : raw;
}

function deleteDocument({ folder, storedName }) {
  try {
    const resolved = path.resolve(path.join(EMPLOYEE_ROOT, folder || '', storedName || ''));
    if (!resolved.startsWith(path.resolve(EMPLOYEE_ROOT))) return false;
    if (fs.existsSync(resolved)) { fs.unlinkSync(resolved); return true; }
  } catch { /* a file already gone is not a failure to delete it */ }
  return false;
}

module.exports = {
  ROOT, EMPLOYEE_ROOT,
  safeName, folderNameFor, ensureFolder, storedNameFor,
  encryptBuffer, decryptBuffer, encryptionAvailable, encryptionStrength,
  storeDocument, readDocument, deleteDocument,
};
