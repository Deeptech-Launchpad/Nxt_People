/**
 * Role display labels and mappings.
 * Maps internal role names to user-friendly display labels.
 */

export const ROLE_LABELS = {
  admin: 'Admin',
  director: 'Director',
  manager: 'Manager',
  team_incharge: 'Team Incharge',
  team_member: 'Team member',
};

export const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'director', label: 'Director' },
  { value: 'manager', label: 'Manager' },
  { value: 'team_incharge', label: 'Team Incharge' },
  { value: 'team_member', label: 'Team member' },
];

export const getRoleLabel = (role) => ROLE_LABELS[role] || role;

export const isAdminRole = (role) => ['admin', 'director'].includes(role);
export const isManagerRole = (role) => ['manager', 'team_incharge'].includes(role);
export const isEmployeeRole = (role) => role === 'team_member';
