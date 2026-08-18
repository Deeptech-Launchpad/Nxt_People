/**
 * Multi-factor authentication (TOTP).
 *
 * Flow:
 *   1.  POST /api/mfa/setup            (authed) → returns base32 secret + QR data URL
 *   2.  POST /api/mfa/verify-setup     (authed) → { code } → persists, marks enabled, returns 10 backup codes (shown once)
 *   3.  POST /api/mfa/disable          (authed) → { code | backupCode } → clears
 *   4.  POST /api/auth/login           (public) → still username+password.
 *       If `mfa_enabled`, response is `{ requiresMfa: true, mfaTicket }` instead of full tokens.
 *   5.  POST /api/auth/login-mfa       (public) → { mfaTicket, code | backupCode } → returns the real { token, refreshToken }.
 *   6.  POST /api/mfa/reset/:employeeId (admin) → wipe an employee's MFA so they can re-enrol.
 *
 * Secrets are stored base32-encoded. Backup codes are stored as bcrypt hashes
 * so a DB leak doesn't expose them. Each backup code is single-use.
 */

const express  = require('express');
const router   = express.Router();
const crypto   = require('crypto');
const bcrypt   = require('bcryptjs');
const QRCode   = require('qrcode');
const { authenticator } = require('otplib');
const pool     = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { serverError } = require('../utils/serverError');

const ISSUER = process.env.MFA_ISSUER || 'Nxt People';

// Allow ±1 step (≈30 s) of clock drift between the user's authenticator and the server.
authenticator.options = { window: 1 };

/** Generate 10 single-use, human-readable backup codes (e.g. `A4F2-9KQX`). */
function makeBackupCodes(n = 10) {
  return Array.from({ length: n }, () => {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase(); // 10 hex chars
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;                  // ABCD-EFGH
  });
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Authed endpoints — caller must already have a session.                     */
/* ─────────────────────────────────────────────────────────────────────────── */

// POST /api/mfa/setup — generate a pending secret + QR. NOT yet persisted as enabled.
router.post('/setup', protect, async (req, res) => {
  try {
    const secret = authenticator.generateSecret();
    const label  = `${ISSUER}:${req.user.email}`;
    const otpauth = authenticator.keyuri(req.user.email, ISSUER, secret);
    const qrDataUrl = await QRCode.toDataURL(otpauth);

    // Stage the secret in the row so verify-setup can find it. mfa_enabled stays false
    // until the user proves they can produce a valid code.
    await pool.query(
      'UPDATE employees SET mfa_secret = $1 WHERE id = $2',
      [secret, req.user._id]
    );

    res.json({ success: true, secret, otpauth, qrDataUrl, label });
  } catch (err) {
    serverError(res, err);
  }
});

// POST /api/mfa/verify-setup — { code } → flip mfa_enabled and return backup codes.
router.post('/verify-setup', protect, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ success: false, message: 'Code required' });

    const r = await pool.query('SELECT mfa_secret FROM employees WHERE id = $1', [req.user._id]);
    const secret = r.rows[0]?.mfa_secret;
    if (!secret) return res.status(400).json({ success: false, message: 'Start MFA setup first' });

    if (!authenticator.check(String(code).trim(), secret)) {
      return res.status(401).json({ success: false, message: 'Invalid code' });
    }

    // Generate + hash backup codes. Return the plaintext to the user ONCE.
    const backupCodes = makeBackupCodes(10);
    const hashed = await Promise.all(backupCodes.map(c => bcrypt.hash(c, 10)));

    await pool.query(
      `UPDATE employees
         SET mfa_enabled = TRUE,
             mfa_enabled_at = NOW(),
             mfa_backup_codes = $1::jsonb
       WHERE id = $2`,
      [JSON.stringify(hashed), req.user._id]
    );

    res.json({ success: true, backupCodes });
  } catch (err) {
    serverError(res, err);
  }
});

// POST /api/mfa/disable — { code | backupCode }. Requires a valid factor to disable.
router.post('/disable', protect, async (req, res) => {
  try {
    const { code, backupCode } = req.body;
    const r = await pool.query(
      'SELECT mfa_enabled, mfa_secret, mfa_backup_codes FROM employees WHERE id = $1',
      [req.user._id]
    );
    const row = r.rows[0];
    if (!row?.mfa_enabled) return res.json({ success: true, message: 'MFA was not enabled' });

    let ok = false;
    if (code && authenticator.check(String(code).trim(), row.mfa_secret)) ok = true;
    else if (backupCode) {
      const codes = row.mfa_backup_codes || [];
      for (const hash of codes) {
        if (await bcrypt.compare(String(backupCode).trim(), hash)) { ok = true; break; }
      }
    }
    if (!ok) return res.status(401).json({ success: false, message: 'Invalid code' });

    await pool.query(
      `UPDATE employees
         SET mfa_enabled = FALSE,
             mfa_secret = NULL,
             mfa_backup_codes = '[]'::jsonb,
             mfa_enabled_at = NULL
       WHERE id = $1`,
      [req.user._id]
    );
    res.json({ success: true });
  } catch (err) {
    serverError(res, err);
  }
});

// POST /api/mfa/regenerate-backup-codes — { code } → returns new set, invalidates old.
router.post('/regenerate-backup-codes', protect, async (req, res) => {
  try {
    const { code } = req.body;
    const r = await pool.query('SELECT mfa_enabled, mfa_secret FROM employees WHERE id = $1', [req.user._id]);
    const row = r.rows[0];
    if (!row?.mfa_enabled) return res.status(400).json({ success: false, message: 'MFA not enabled' });
    if (!authenticator.check(String(code || '').trim(), row.mfa_secret)) {
      return res.status(401).json({ success: false, message: 'Invalid code' });
    }
    const backupCodes = makeBackupCodes(10);
    const hashed = await Promise.all(backupCodes.map(c => bcrypt.hash(c, 10)));
    await pool.query(
      'UPDATE employees SET mfa_backup_codes = $1::jsonb WHERE id = $2',
      [JSON.stringify(hashed), req.user._id]
    );
    res.json({ success: true, backupCodes });
  } catch (err) {
    serverError(res, err);
  }
});

// POST /api/mfa/reset/:employeeId — admin only. Wipes MFA for the target user so they
// can re-enrol after losing their device. Audited.
router.post('/reset/:employeeId', protect, authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE employees
         SET mfa_enabled = FALSE,
             mfa_secret = NULL,
             mfa_backup_codes = '[]'::jsonb,
             mfa_enabled_at = NULL
       WHERE id = $1
       RETURNING id, first_name AS "firstName", last_name AS "lastName"`,
      [req.params.employeeId]
    );
    if (r.rows.length === 0) return res.status(404).json({ success: false, message: 'Employee not found' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    serverError(res, err);
  }
});

/* ─────────────────────────────────────────────────────────────────────────── */
/* Helpers used by /api/auth/login and /api/auth/login-mfa                    */
/* ─────────────────────────────────────────────────────────────────────────── */

/**
 * Verify a TOTP code or single-use backup code against the stored values.
 * On backup-code success, the matching entry is removed from the array so it
 * can't be reused.
 *
 * Returns { ok: true } or { ok: false, reason }.
 */
async function verifyMfaCode({ employeeId, code, backupCode }) {
  const r = await pool.query(
    'SELECT mfa_enabled, mfa_secret, mfa_backup_codes FROM employees WHERE id = $1',
    [employeeId]
  );
  const row = r.rows[0];
  if (!row || !row.mfa_enabled) return { ok: false, reason: 'MFA not enabled' };

  // Defensive: mfa_enabled=true with mfa_secret=NULL shouldn't happen through
  // any normal app flow (they're always set/cleared together), but if that
  // inconsistent state ever occurs, short-circuit before calling
  // authenticator.check() with a null secret rather than risk it throwing
  // and surfacing as an unhandled 500 with a raw error message.
  if (code && row.mfa_secret && authenticator.check(String(code).trim(), row.mfa_secret)) {
    return { ok: true };
  }
  if (backupCode) {
    // Row-locked read-modify-write: two concurrent requests presenting the
    // SAME backup code used to both be able to read the pre-consumption
    // array before either wrote it back, letting one code be accepted
    // twice. FOR UPDATE serializes them — the second request re-reads the
    // already-shortened array and correctly finds no match.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const lockRes = await client.query(
        'SELECT mfa_backup_codes FROM employees WHERE id = $1 FOR UPDATE',
        [employeeId]
      );
      const codes = lockRes.rows[0]?.mfa_backup_codes || [];
      for (let i = 0; i < codes.length; i++) {
        if (await bcrypt.compare(String(backupCode).trim(), codes[i])) {
          const remaining = [...codes.slice(0, i), ...codes.slice(i + 1)];
          await client.query(
            'UPDATE employees SET mfa_backup_codes = $1::jsonb WHERE id = $2',
            [JSON.stringify(remaining), employeeId]
          );
          await client.query('COMMIT');
          return { ok: true, usedBackupCode: true, remainingBackupCodes: remaining.length };
        }
      }
      await client.query('ROLLBACK');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
  return { ok: false, reason: 'Invalid code' };
}

/* In-memory MFA ticket store. Tickets are short-lived (5 min) opaque tokens
 * that link a verified password to a pending MFA step. Don't need DB — if the
 * server restarts the user just logs in again.                              */
const tickets = new Map();
const TICKET_TTL_MS = 5 * 60 * 1000;

function issueMfaTicket(employeeId) {
  const t = crypto.randomBytes(32).toString('hex');
  tickets.set(t, { employeeId, expiresAt: Date.now() + TICKET_TTL_MS });
  return t;
}
function consumeMfaTicket(t) {
  const v = tickets.get(t);
  if (!v) return null;
  tickets.delete(t);
  if (v.expiresAt < Date.now()) return null;
  return v.employeeId;
}
// Cheap GC — runs once on module load and every 10 min after.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of tickets) if (v.expiresAt < now) tickets.delete(k);
}, 10 * 60 * 1000).unref?.();

module.exports = router;
module.exports.verifyMfaCode = verifyMfaCode;
module.exports.issueMfaTicket = issueMfaTicket;
module.exports.consumeMfaTicket = consumeMfaTicket;
