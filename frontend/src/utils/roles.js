/* ── Central RBAC role model (frontend) ───────────────────────────────────
 *  Mirror of backend/roles.js. Every role-gated piece of UI should go
 *  through these helpers instead of comparing role strings inline, so the
 *  5-role model stays consistent across the app.
 *
 *    admin, director    → full access (sees & manages everything)
 *    manager, team_incharge → Team Lead permissions (own data + direct-reports)
 *    team_member        → own data only
 *
 *  Note: the frontend only HIDES UI for roles that lack access; the backend
 *  is the real authority and scopes/blocks every request server-side.
 * ───────────────────────────────────────────────────────────────────────── */

export const ROLES = {
  ADMIN:           'admin',
  DIRECTOR:        'director',
  MANAGER:         'manager',
  TEAM_INCHARGE:   'team_incharge',
  TEAM_MEMBER:     'team_member',
};

// Accepts either a user object ({ role }) or a raw role string.
const roleOf = (u) => (typeof u === 'string' ? u : u?.role);

/** Admin or Director — sees/manages everything (full access). */
export const isFullAccess = (u) =>
  [ROLES.ADMIN, ROLES.DIRECTOR].includes(roleOf(u));

/** Anyone who can reach an approver screen (full access or a team manager). */
export const isApprover = (u) =>
  [ROLES.ADMIN, ROLES.DIRECTOR, ROLES.MANAGER, ROLES.TEAM_INCHARGE].includes(roleOf(u));

export const isManager  = (u) =>
  [ROLES.MANAGER, ROLES.TEAM_INCHARGE].includes(roleOf(u));
export const isEmployee = (u) => roleOf(u) === ROLES.TEAM_MEMBER;

/** Human-readable label for a role value. */
export const roleLabel = (r) => ({
  admin:          'Admin',
  director:       'Director',
  manager:        'Manager',
  team_incharge:  'Team Incharge',
  team_member:    'Team member',
}[roleOf(r)] || roleOf(r));

/** Role values assignable to an employee (for admin role dropdowns). */
export const ASSIGNABLE_ROLES = [
  ROLES.ADMIN, ROLES.DIRECTOR, ROLES.MANAGER, ROLES.TEAM_INCHARGE, ROLES.TEAM_MEMBER,
];
