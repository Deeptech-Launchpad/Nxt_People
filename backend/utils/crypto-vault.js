/**
 * Symmetric encryption for sensitive secrets we need to read back later
 * (API keys, OAuth tokens, etc.). Uses AES-256-GCM via Node's crypto.
 *
 * Why this over plaintext storage:
 *   A DB-only leak (snapshot, replication exposure, log mining) gives the
 *   attacker ciphertext but no usable keys unless they ALSO have JWT_SECRET.
 *
 * Why this over bcrypt-style one-way hashing:
 *   The admin needs to read the value back to copy/paste it. One-way
 *   hashing fits passwords (compare via re-hash); it doesn't fit
 *   API keys that you have to display to humans later.
 *
 * Encryption key: SHA-256(JWT_SECRET). Reuses the existing server secret
 * — no new env var needed, no separate KMS to manage.
 * Output format: <iv>:<authTag>:<ciphertext>, all hex.
 */
const crypto = require('crypto');

const ALGO = 'aes-256-gcm';

function getKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is required for crypto-vault');
  return crypto.createHash('sha256').update(secret).digest();
}

function encrypt(plaintext) {
  if (plaintext == null) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

function decrypt(blob) {
  if (!blob) return null;
  try {
    const [ivHex, tagHex, dataHex] = String(blob).split(':');
    if (!ivHex || !tagHex || !dataHex) return null;
    const decipher = crypto.createDecipheriv(ALGO, getKey(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const dec = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
    return dec.toString('utf8');
  } catch (err) {
    // Tampered ciphertext, wrong secret, etc. — return null rather than throw
    // so a single bad row doesn't break the whole list query.
    return null;
  }
}

module.exports = { encrypt, decrypt };
