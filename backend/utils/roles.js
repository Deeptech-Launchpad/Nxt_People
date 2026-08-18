/* ── Central RBAC role model ──────────────────────────────────────────────
 *  The app enforces a 6-role model. This module is the single source of
 *  truth — every route guard and data-scoping check should go through it
 *  instead of hard-coding role strings, so the model can't drift again.
 *
 *    admin, director   → full system access (org-wide visibility + management)
 *    hr_admin          → HR & Administration — full access; Level 3 approver for all leaves
 *    manager           → own data + direct-reports approvals & visibility
 *    team_incharge     → same as manager (team-lead level)
 *    team_member       → own data & requests only
 *
 *  Note: `req.user.role` is re-fetched from the DB on every request
 *  (see middleware/auth.js), so role changes take effect immediately.
 * ───────────────────────────────────────────────────────────────────────── */

const { roleCan } = require('./permissions');

const ROLES = {
  ADMIN:         'admin',
  DIRECTOR:      'director',
  HR_ADMIN:      'hr_admin',
  MANAGER:       'manager',
  TEAM_INCHARGE: 'team_incharge',
  TEAM_MEMBER:   'team_member',
};

// Roles that see and manage everything, org-wide.
const FULL_ACCESS = [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.HR_ADMIN];

// Roles allowed past an approver route guard. Managers are further restricted
// to their direct reports by reportsScope() at the data layer.
const APPROVERS = [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.HR_ADMIN, ROLES.MANAGER, ROLES.TEAM_INCHARGE];

// These two decide which rows a caller sees, in twenty-two files. They keep
// their signatures and stay synchronous — the permission map is held in
// memory for exactly this reason — but they now answer from a role's
// permissions rather than from a list of six names, so a role created in the
// UI scopes data the same way the role it was cloned from does.
//
// FULL_ACCESS and APPROVERS below are left as they were: they are still the
// truth for the six system roles, and permissions.js falls back to them if the
// roles table cannot be read.
const isFullAccess = (role) => roleCan(role, 'people.viewAll');
const isManager    = (role) => roleCan(role, 'people.viewReports');

/**
 * Returns a SQL fragment to AND into a query so the caller only sees the
 * employees they're allowed to. The query's employees table must be aliased
 * as `alias`.
 *
 *   - Full-access (super_admin/hr): no restriction (sees everyone).
 *   - Manager: only direct reports — employees whose reporting_manager_id OR
 *     approving_authority_id is the manager (matches the leave/attendance
 *     authority model already used elsewhere).
 *   - Any other role: no employees (defensive — these endpoints are guarded
 *     by APPROVERS, so this branch shouldn't be reached).
 *
 * @param {object} user        req.user ({ _id, role })
 * @param {string} alias       employees table alias used in the query
 * @param {number} paramIndex  next positional placeholder index ($N)
 * @returns {{clause: string, params: any[]}}
 */
function reportsScope(user, alias, paramIndex) {
  if (isFullAccess(user.role)) return { clause: '', params: [] };
  if (isManager(user.role)) {
    return {
      clause: ` AND (${alias}.reporting_manager_id = $${paramIndex} OR ${alias}.approving_authority_id = $${paramIndex})`,
      params: [user._id],
    };
  }
  // Non-approver fallthrough: match nothing.
  return { clause: ' AND 1=0', params: [] };
}

/**
 * True when `user` may approve/act on a request belonging to the employee
 * described by `target` ({ reporting_manager_id, approving_authority_id }).
 * Full-access can act on anyone; a manager only on their direct reports.
 */
function canActOnEmployee(user, target) {
  if (isFullAccess(user.role)) return true;
  if (!target) return false;
  return String(target.reporting_manager_id) === String(user._id)
      || String(target.approving_authority_id) === String(user._id);
}

module.exports = {
  ROLES, FULL_ACCESS, APPROVERS,
  isFullAccess, isManager, reportsScope, canActOnEmployee,
};
