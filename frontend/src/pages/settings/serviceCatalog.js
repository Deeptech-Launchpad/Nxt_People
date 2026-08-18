// The Settings service catalogue.
//
// Settings is a hub of services, and each service opens a workspace with its
// own tab bar and, inside a tab, its own left rail. This file is the single
// description of that: the hub grid reads it, and so does the workspace shell,
// so a section cannot exist in one and be missing from the other.
//
// A service appears here only when opening it leads somewhere. The reference
// shows nineteen tiles; most of them are modules we have not built a
// configuration for, and a tile opening onto an empty workspace is the same
// dead entry point we keep refusing to ship. They get added as they gain
// something to configure.
//
// The reference also gives every service five tabs — Configuration, Extend
// Service, Approvals, Automation, Permissions. Extend Service is a custom-form
// and custom-button builder, empty in the reference org and a project of its
// own, so no service here declares it. A service only declares the tabs it has.

export const SERVICE_TABS = [
  { key: 'users', label: 'Users' },
  { key: 'configuration', label: 'Configuration' },
  { key: 'approvals', label: 'Approvals' },
  { key: 'automation', label: 'Automation' },
  { key: 'permissions', label: 'Permissions' },
];

// Sections are declared here by key; the workspace maps a key to a screen.
// Keeping the elements out of this file lets the hub import it without
// pulling in every settings screen in the app.
export const SERVICES = [
  {
    key: 'accounts',
    label: 'Manage Accounts',
    // The reference calls this tab Organization Setup here and Configuration
    // everywhere else. Renaming it globally is exactly the mistake this
    // override exists to prevent.
    tabLabels: { configuration: 'Organization Setup', permissions: 'User Access Control' },
    icon: 'Users',
    description: 'People, locations, departments and designations',
    roles: ['admin', 'director', 'hr_admin'],
    tabs: {
      users: [
        { key: 'users', label: 'Users' },
      ],
      configuration: [
        { key: 'organization-details', label: 'Organization Details' },
        { key: 'organization-policy', label: 'Organization Policy' },
        // A section with children renders as a collapsible group in the rail,
        // the way the reference nests Organization Structure.
        {
          key: 'organization-structure', label: 'Organization Structure',
          children: [
            { key: 'structure-configuration', label: 'Configuration' },
            { key: 'companies', label: 'Company' },
            { key: 'business-units', label: 'Business Unit' },
            { key: 'divisions', label: 'Division' },
            { key: 'manage-structure', label: 'Manage Structure' },
          ],
        },
        { key: 'locations', label: 'Locations' },
        { key: 'departments', label: 'Departments' },
        { key: 'designations', label: 'Designations' },
      ],
      // The reference calls this tab User Access Control. Roles is a group in
      // the rail, the way Organization Structure is.
      permissions: [
        {
          key: 'roles', label: 'Roles',
          children: [
            { key: 'general-role', label: 'General Role' },
            { key: 'specific-role', label: 'Specific Role' },
            { key: 'specific-role-assignment', label: 'Specific Role Assignment' },
          ],
        },
        { key: 'function-permissions', label: 'Function Based Permissions' },
        { key: 'administrator', label: 'Administrator' },
        { key: 'applicability-groups', label: 'Applicability groups' },
      ],
      // The reference's Automation tab, minus Blueprints, Checklists & Tasks,
      // Webhooks, Custom Functions, E-Sign Flow and the two document template
      // kinds — see utils/workflowCatalog.js for why each was left out.
      automation: [
        { key: 'workflows', label: 'Workflows' },
        {
          key: 'actions', label: 'Actions',
          children: [
            { key: 'email-alerts', label: 'Email Alerts' },
            { key: 'field-updates', label: 'Field Updates' },
          ],
        },
        {
          key: 'templates', label: 'Templates',
          children: [
            { key: 'email-templates', label: 'Email Templates' },
          ],
        },
        { key: 'workflow-logs', label: 'Workflow Logs' },
        { key: 'scheduler-logs', label: 'Scheduler Logs' },
      ],
    },
  },
  {
    key: 'attendance',
    label: 'Attendance',
    icon: 'CalendarCheck',
    description: 'Methods, policy, check-in rules and pay periods',
    roles: ['admin', 'director', 'hr_admin'],
    tabs: {
      configuration: [
        { key: 'methods', label: 'Methods' },
        { key: 'attendance-policy', label: 'Attendance Policy' },
        { key: 'check-in-out', label: 'Check In and Check Out' },
        { key: 'regularization', label: 'Regularization' },
        { key: 'on-duty', label: 'On Duty' },
        { key: 'pay-periods', label: 'Pay Period' },
        { key: 'reports', label: 'Reports' },
        { key: 'additional-options', label: 'Additional Options' },
      ],
      approvals: [
        { key: 'approvals', label: 'Approvals' },
      ],
      automation: [
        { key: 'absent-scheduler', label: 'Absent Scheduler' },
        { key: 'email-alerts', label: 'Email Alerts' },
        { key: 'email-templates', label: 'Email Templates' },
      ],
      permissions: [
        { key: 'geo-restriction', label: 'Geo Restriction' },
      ],
    },
  },
  {
    key: 'shifts',
    label: 'Shifts',
    icon: 'Clock',
    description: 'Shift timings and the default new employees start on',
    roles: ['admin', 'director', 'hr_admin'],
    tabs: {
      // Auto Shift Assignment and Shift Patterns are absent: both need a
      // rostering engine that does not exist here, and a builder whose output
      // nothing reads is worse than no builder.
      configuration: [
        { key: 'general', label: 'General' },
        { key: 'manage-shifts', label: 'Manage Shifts' },
      ],
    },
  },
  {
    key: 'leave',
    label: 'Leave Tracker',
    icon: 'CalendarDays',
    description: 'Leave policy, comp-off, work calendar and holidays',
    roles: ['admin', 'director', 'hr_admin'],
    tabs: {
      configuration: [
        { key: 'methods', label: 'Methods' },
        { key: 'leave-policy', label: 'Leave Policy' },
        { key: 'leave-accrual', label: 'Leave Accrual' },
        { key: 'comp-off-policy', label: 'Compensatory Off' },
        { key: 'work-calendar', label: 'Work Calendar' },
        { key: 'pay-periods', label: 'Pay Period' },
        { key: 'reports', label: 'Reports' },
        { key: 'leave-request', label: 'Leave Request' },
        { key: 'holidays', label: 'Holidays' },
        { key: 'additional-options', label: 'Additional Options' },
      ],
      approvals: [
        { key: 'approvals', label: 'Approvals' },
      ],
    },
  },
];

export const BASE = '/settings/service';

export const serviceByKey = key => SERVICES.find(s => s.key === key) || null;

// The tabs a service actually has, in the catalogue's order, with any
// per-service renaming applied.
export const tabsOf = service =>
  SERVICE_TABS
    .filter(t => (service?.tabs?.[t.key] || []).length > 0)
    .map(t => (service?.tabLabels?.[t.key] ? { ...t, label: service.tabLabels[t.key] } : t));

export const sectionsOf = (service, tabKey) => service?.tabs?.[tabKey] || [];

// The rail shows groups; routing needs the leaves. A group is never itself a
// destination — landing on one would be a page with no content.
export const flatSectionsOf = (service, tabKey) =>
  sectionsOf(service, tabKey).flatMap(s => (s.children ? s.children : [s]));

export const visibleServices = role =>
  SERVICES.filter(s => !s.roles || s.roles.includes(role));
