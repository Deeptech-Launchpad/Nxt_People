/* ── May this user file a request for employee X? ─────────────────────────
 *  One answer for leave, comp-off, regularization and on-duty, so the four
 *  forms cannot drift apart on who may raise a request for somebody else.
 *
 *    yourself        always
 *    full access     anybody who has not been deleted — unchanged from before
 *                    this helper existed, so HR can still file for somebody
 *                    serving notice or already gone for days they worked
 *    a manager role  an active employee whose reporting manager OR approving
 *                    authority is the caller (canActOnEmployee), and nobody
 *                    further down the tree
 *    anyone else     nobody
 *
 *  Filing for somebody changes nothing about how the request is approved: the
 *  callers build the SUBJECT's chain, and no level is approved because of who
 *  typed it.
 * ───────────────────────────────────────────────────────────────────────── */

const { isFullAccess, isManager, canActOnEmployee } = require('./roles');

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * @returns {Promise<{id, name?, onBehalf: boolean} | {error: number, message: string}>}
 */
async function resolveFilingSubject(db, user, employeeId) {
  if (!employeeId || String(employeeId) === String(user._id)) {
    return { id: user._id, onBehalf: false };
  }
  const full = isFullAccess(user.role);
  if (!full && !isManager(user.role)) {
    return { error: 403, message: 'You can only file requests for yourself.' };
  }
  if (!UUID.test(String(employeeId))) {
    return { error: 400, message: 'That is not a valid employee.' };
  }
  const r = await db.query(
    `SELECT id, TRIM(CONCAT(first_name, ' ', last_name)) AS name,
            reporting_manager_id, approving_authority_id,
            COALESCE(status, 'active') AS status
       FROM employees WHERE id = $1 AND deleted_at IS NULL`, [employeeId]);
  const emp = r.rows[0];
  if (full) {
    if (!emp) return { error: 404, message: 'That employee no longer exists.' };
    return { id: emp.id, name: emp.name, onBehalf: true };
  }
  // A missing employee is refused the same way as somebody else's, so the
  // answer does not tell a manager which ids exist.
  if (!emp || !canActOnEmployee(user, emp)) {
    return { error: 403, message: 'You can only file requests for people who report to you.' };
  }
  if (emp.status !== 'active') {
    return { error: 403, message: `${emp.name} is no longer active, so only HR can file a request for them.` };
  }
  return { id: emp.id, name: emp.name, onBehalf: true };
}

module.exports = { resolveFilingSubject };
