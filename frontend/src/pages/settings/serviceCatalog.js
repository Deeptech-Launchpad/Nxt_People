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
    icon: 'Users',
    description: 'People, locations, departments and designations',
    roles: ['admin', 'director', 'hr_admin'],
    tabs: {
      configuration: [
        { key: 'organization-details', label: 'Organization Details' },
        { key: 'organization-policy', label: 'Organization Policy' },
        { key: 'locations', label: 'Locations' },
        { key: 'departments', label: 'Departments' },
        { key: 'designations', label: 'Designations' },
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

// The tabs a service actually has, in the catalogue's order.
export const tabsOf = service =>
  SERVICE_TABS.filter(t => (service?.tabs?.[t.key] || []).length > 0);

export const sectionsOf = (service, tabKey) => service?.tabs?.[tabKey] || [];

export const visibleServices = role =>
  SERVICES.filter(s => !s.roles || s.roles.includes(role));
