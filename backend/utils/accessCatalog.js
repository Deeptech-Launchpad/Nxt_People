/* ── What User Access Control can talk about ───────────────────────────────
 *  Two catalogues, kept out of the route so the frontend and the seed read the
 *  same list.
 *
 *  FUNCTIONS is the reference's Function Based Permissions table: sixteen
 *  rows, in its order, with its labels and its sub-controls. `wired` says
 *  whether this application has the feature to switch off. The ones marked
 *  false are stored and returned faithfully but enforce nothing — the screen
 *  says so on the row rather than implying a switch that does something.
 *
 *  SERVICES is the Administrator matrix's columns. The reference lists the
 *  modules its org has; these are the modules ours has.
 * ───────────────────────────────────────────────────────────────────────── */

const FUNCTIONS = [
  { key: 'search_employee', label: 'Search Employee', wired: true },
  { key: 'delegation', label: 'Delegation', wired: false },
  { key: 'quick_links', label: 'Quick Links', wired: true },
  { key: 'tags', label: 'Tags', wired: false },
  { key: 'api_access', label: 'API Access', wired: false },
  { key: 'designation_by_permission', label: 'Show designation based on permission', wired: false },
  {
    key: 'announcements', label: 'Announcements', wired: true,
    control: { type: 'check', key: 'manage', label: 'Add / Edit / Delete' },
  },
  { key: 'department_tree', label: 'Department Tree', wired: true },
  { key: 'department_data', label: 'Department data', wired: true },
  {
    key: 'employee_tree', label: 'Employee Tree', wired: true,
    control: {
      type: 'radio', key: 'tree',
      options: [
        { value: 'organization', label: 'Organization Tree' },
        { value: 'reportee', label: 'Reportee Tree' },
      ],
    },
  },
  { key: 'birthday_buddy', label: 'Birthday Buddy', wired: true },
  { key: 'new_joinee_list', label: 'New joinee list', wired: true },
  { key: 'favorites', label: 'Favorites', wired: true },
  {
    key: 'work_anniversary', label: 'Work Anniversary', wired: true,
    control: {
      type: 'check', key: 'showYearsOfExperience', label: 'Show year of experience',
      hint: 'Shows how long the person has been with the organization beside the anniversary.',
    },
  },
  { key: 'wedding_anniversary', label: 'Wedding Anniversary', wired: false },
  { key: 'location_in_org_tab', label: 'Show location details in the organization tab', wired: true },
];

const FUNCTION_KEYS = new Set(FUNCTIONS.map(f => f.key));

// The services an administrator can be given access to. Settings and Data are
// asked separately for each, as the reference does.
const SERVICES = [
  { key: 'accounts', label: 'Manage Accounts' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'shifts', label: 'Shifts' },
  { key: 'leave', label: 'Leave Tracker' },
  { key: 'payroll', label: 'Payroll' },
  { key: 'performance', label: 'Performance' },
  { key: 'documents', label: 'Files' },
  { key: 'onboarding', label: 'Onboarding' },
  { key: 'offboarding', label: 'Offboarding' },
  { key: 'time_tracker', label: 'Time Tracker' },
];

const SERVICE_KEYS = new Set(SERVICES.map(s => s.key));

const ACCESS_LEVELS = ['full', 'partial', 'none'];

// The permissions a role can hold, and what each actually gates. Shown on the
// role editor so an administrator granting one can see what it opens.
const PERMISSIONS = [
  { key: 'org.manage', label: 'Manage the organization',
    hint: 'Settings, org setup, users, payroll configuration and every other full-access route.' },
  { key: 'team.manage', label: 'Manage a team',
    hint: 'Team attendance, team records and the manager-level routes.' },
  { key: 'team.approve', label: 'Approve requests',
    hint: 'Leave, attendance regularization, on duty, comp off and WFH approvals.' },
  { key: 'people.viewAll', label: 'See every employee',
    hint: 'Reports and listings return the whole organization rather than a scoped set.' },
  { key: 'people.viewReports', label: 'See direct reports',
    hint: 'Reports and listings return the people who report to this user.' },
];

const PERMISSION_KEYS = new Set(PERMISSIONS.map(p => p.key));

// The five levels an applicability line can be scoped by — the same five the
// reference lists, and the same five Organization Structure defines.
const APPLICABILITY_FIELDS = [
  { key: 'companyId', label: 'Company', resource: 'companies' },
  { key: 'businessUnitId', label: 'Business Unit', resource: 'business_units' },
  { key: 'divisionId', label: 'Division', resource: 'divisions' },
  { key: 'departmentId', label: 'Department', resource: 'departments' },
  { key: 'locationId', label: 'Location', resource: 'locations' },
];

// What an applicability group can be built from.
const CRITERIA_FIELDS = [
  { key: 'role', label: 'Role', column: 'e.role' },
  { key: 'designation', label: 'Designation', column: 'e.designation' },
  { key: 'department', label: 'Department', column: 'e.department' },
  { key: 'location', label: 'Location', column: 'e.work_location' },
  { key: 'employmentType', label: 'Employee type', column: 'e.employment_type' },
];

module.exports = {
  FUNCTIONS, FUNCTION_KEYS, SERVICES, SERVICE_KEYS, ACCESS_LEVELS,
  PERMISSIONS, PERMISSION_KEYS, APPLICABILITY_FIELDS, CRITERIA_FIELDS,
};
