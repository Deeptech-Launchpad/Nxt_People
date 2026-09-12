/* ── Whose record is this read for? ───────────────────────────────────────
 *  Every read endpoint that accepts ?employeeId= should resolve it here.
 *
 *  These guards used to end `: req.user._id` — a caller who was not allowed
 *  to name somebody else was not refused, they were silently handed their OWN
 *  rows back. Point a reportee card at one of them and a manager opens
 *  Balaji's page and reads their own days under Balaji's name, with nothing on
 *  screen to say so. A wrong answer that looks right is worse than an error,
 *  so the fallback is gone.
 *
 *  Scope is the authority model the leave and regularization approvals
 *  already use — canActOnEmployee(), i.e. reporting manager OR approving
 *  authority — rather than a second definition of "my team" per route file.
 * ───────────────────────────────────────────────────────────────────────── */

const pool = require('../db');
const { isFullAccess, canActOnEmployee } = require('./roles');

const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));

/**
 * Resolve the employee id a read should run against.
 *
 * @returns {Promise<string|null>} the id to query, or null once it has
 *   already answered on `res` — callers must `if (!empId) return;`.
 */
async function resolveEmployeeId(req, res, employeeId) {
  // No employeeId is self-service, exactly as before these guards existed.
  if (!employeeId) return req.user._id;
  if (String(employeeId) === String(req.user._id)) return req.user._id;

  if (!isUuid(employeeId)) {
    res.status(400).json({ success: false, message: 'employeeId must be an employee UUID' });
    return null;
  }
  if (isFullAccess(req.user.role)) return employeeId;

  const tgt = await pool.query(
    `SELECT reporting_manager_id, approving_authority_id
       FROM employees WHERE id = $1::uuid AND deleted_at IS NULL`,
    [employeeId]
  );
  // A missing employee answers 403 rather than 404 on purpose: telling a
  // caller which ids exist is itself a disclosure they have no claim to.
  if (!tgt.rows[0] || !canActOnEmployee(req.user, tgt.rows[0])) {
    res.status(403).json({
      success: false,
      message: 'You can only view records for yourself and the people who report to you.',
    });
    return null;
  }
  return employeeId;
}

module.exports = { resolveEmployeeId, isUuid };
