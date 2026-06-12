/* ── Central RBAC role model (frontend) ───────────────────────────────────
 *  Mirror of backend/utils/roles.js. Every role-gated piece of UI should go
 *  through these helpers instead of comparing role strings inline, so the
 *  4-role model stays consistent across the app.
 *
 *    super_admin / hr  → full access (sees & manages everything)
 *    manager           → own data + direct-reports approvals/visibility
 *    employee          → own data only
 *
 *  Note: the frontend only HIDES UI for roles that lack access; the backend
 *  is the real authority and scopes/blocks every request server-side.
 * ───────────────────────────────────────────────────────────────────────── */

export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  HR:          'hr',
  MANAGER:     'manager',
  EMPLOYEE:    'employee',
};

// Accepts either a user object ({ role }) or a raw role string.
const roleOf = (u) => (typeof u === 'string' ? u : u?.role);

/** Super Admin or HR — sees/manages everything. */
export const isFullAccess = (u) => [ROLES.SUPER_ADMIN, ROLES.HR].includes(roleOf(u));

/** Anyone who can reach an approver screen (full access or a team manager). */
export const isApprover = (u) =>
  [ROLES.SUPER_ADMIN, ROLES.HR, ROLES.MANAGER].includes(roleOf(u));

export const isManager  = (u) => roleOf(u) === ROLES.MANAGER;
export const isEmployee = (u) => roleOf(u) === ROLES.EMPLOYEE;

/** Human-readable label for a role value. The 'manager' role is surfaced to
 *  users as "Team Lead" (display label only — the stored role value stays
 *  'manager' so permissions/workflows are unaffected). */
export const roleLabel = (r) => ({
  super_admin: 'Super Admin',
  hr:          'HR',
  manager:     'Team Lead',
  employee:    'Employee',
}[roleOf(r)] || roleOf(r));

/** Role values assignable to an employee (for admin role dropdowns). */
export const ASSIGNABLE_ROLES = [
  ROLES.SUPER_ADMIN, ROLES.HR, ROLES.MANAGER, ROLES.EMPLOYEE,
];
