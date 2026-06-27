/**
 * Centralized role definitions and checks.
 * Maps new role names to their permission levels.
 *
 * Role hierarchy:
 * - admin, director → full website access (super_admin level)
 * - manager, team_incharge → Team Lead permissions
 * - team_member → employee permissions
 */

// Full admin access roles
const ADMIN_ROLES = ['admin', 'director'];

// Manager / Team Lead access roles
const MANAGER_ROLES = ['manager', 'team_incharge'];

// Employee / Basic access roles
const EMPLOYEE_ROLES = ['team_member'];

// All valid roles
const ALL_ROLES = [...ADMIN_ROLES, ...MANAGER_ROLES, ...EMPLOYEE_ROLES];

// Check if a role has admin access
const isAdmin = (role) => ADMIN_ROLES.includes(role);

// Check if a role has manager access
const isManager = (role) => MANAGER_ROLES.includes(role);

// Check if a role has employee access
const isEmployee = (role) => EMPLOYEE_ROLES.includes(role);

// Check if a role has admin OR manager access
const isAdminOrManager = (role) => isAdmin(role) || isManager(role);

module.exports = {
  ADMIN_ROLES,
  MANAGER_ROLES,
  EMPLOYEE_ROLES,
  ALL_ROLES,
  isAdmin,
  isManager,
  isEmployee,
  isAdminOrManager,
};
