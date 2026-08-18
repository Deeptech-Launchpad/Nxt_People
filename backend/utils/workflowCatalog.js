/* ── What a workflow can be about ──────────────────────────────────────────
 *  The reference's workflows target a *form* — its Forms engine lets an admin
 *  define record types, so its dropdown lists Appraisees List, Goals, Jobs,
 *  Asset, Address Proof and a dozen more. We have fixed tables, and half of
 *  those modules do not exist here. Offering them would be a picker full of
 *  things that can never fire.
 *
 *  So a "form" here is a record type this application actually has AND can
 *  hook. A record type appears only when something calls the engine for it —
 *  a trigger nothing raises is the same dead entry point.
 *
 *  Writable fields are a whitelist. A field update that could name any column
 *  is an arbitrary write to any table, reachable by anyone who can edit a
 *  workflow.
 * ───────────────────────────────────────────────────────────────────────── */

// The eight trigger events the reference offers. All eight are expressible
// against our records, so all eight are here.
const ACTION_EVENTS = [
  { key: 'created', label: 'New record is created' },
  { key: 'edited', label: 'Existing record is edited' },
  { key: 'deleted', label: 'Existing record is deleted' },
  { key: 'approved', label: 'New or existing record is approved' },
  { key: 'rejected', label: 'New or existing record is rejected' },
  { key: 'created_or_edited', label: 'Record is created or edited' },
  { key: 'field_updated', label: 'Specific field is updated' },
  { key: 'cancelled', label: 'Record is cancelled' },
];

const OCCURRENCES = [
  { key: 'one_time', label: 'One Time' },
  { key: 'daily', label: 'Every Day' },
  { key: 'monthly', label: 'Every Month' },
  { key: 'yearly', label: 'Every Year' },
];

const DIRECTIONS = [
  { key: 'on', label: 'on event date' },
  { key: 'before', label: 'before event date' },
  { key: 'after', label: 'after event date' },
];

// Reused from approvalRules so a condition means the same thing in both places.
const OPERATORS = [
  { key: 'is', label: 'is' },
  { key: 'is_not', label: 'is not' },
  { key: 'contains', label: 'contains' },
  { key: 'gt', label: 'is greater than' },
  { key: 'gte', label: 'is greater than or equal to' },
  { key: 'lt', label: 'is less than' },
  { key: 'lte', label: 'is less than or equal to' },
];

// Who an alert can be addressed to. Resolved by the engine against the record.
const RECIPIENT_KINDS = [
  { key: 'record_owner', label: 'The employee the record is about' },
  { key: 'reporting_manager', label: "That employee's reporting manager" },
  { key: 'approving_authority', label: "That employee's approving authority" },
  { key: 'department_head', label: "That employee's department lead" },
  { key: 'actor', label: 'The person who performed the action' },
  { key: 'role', label: 'Everyone in a role' },
  { key: 'all_employees', label: 'Every current employee' },
  { key: 'specific', label: 'Specific email addresses' },
];

const FROM_KINDS = [
  { key: 'actor', label: 'Person performing this action' },
  { key: 'organization', label: 'Organization email address' },
];

const RECORD_TYPES = [
  {
    key: 'employee',
    label: 'Employee',
    table: 'employees',
    criteria: [
      { key: 'department', label: 'Department', type: 'text' },
      { key: 'designation', label: 'Designation', type: 'text' },
      { key: 'workLocation', label: 'Location', type: 'text' },
      { key: 'role', label: 'Role', type: 'text' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'employmentType', label: 'Employee type', type: 'text' },
    ],
    dateFields: [
      { key: 'joining_date', label: 'Date of joining' },
      { key: 'date_of_birth', label: 'Date of birth' },
      { key: 'exit_date', label: 'Exit date' },
    ],
    // Columns a "specific field is updated" trigger can watch. These are real
    // column names, because that is what the route reports as having changed —
    // the camelCase criteria keys below would never match.
    watchableFields: [
      { key: 'status', label: 'Status' },
      { key: 'department', label: 'Department' },
      { key: 'designation', label: 'Designation' },
      { key: 'employment_type', label: 'Employee type' },
      { key: 'work_location', label: 'Location' },
      { key: 'role', label: 'Role' },
      { key: 'reporting_manager_id', label: 'Reporting manager' },
    ],
    // Only these can be written by a field update.
    writableFields: [
      { key: 'status', label: 'Status', values: ['active', 'inactive', 'resigned', 'terminated'] },
      { key: 'employment_type', label: 'Employee type' },
      { key: 'designation', label: 'Designation' },
      { key: 'department', label: 'Department' },
    ],
    mergeFields: [
      'employeeName', 'employeeId', 'email', 'department', 'designation',
      'workLocation', 'joiningDate', 'managerName',
    ],
  },
  {
    key: 'leave',
    label: 'Leave Request',
    table: 'leaves',
    criteria: [
      { key: 'leaveType', label: 'Leave type', type: 'text' },
      { key: 'days', label: 'Number of days', type: 'number' },
      { key: 'startDate', label: 'From date', type: 'date' },
      { key: 'endDate', label: 'To date', type: 'date' },
      { key: 'status', label: 'Status', type: 'text' },
    ],
    dateFields: [
      { key: 'start_date', label: 'From date' },
      { key: 'end_date', label: 'To date' },
    ],
    watchableFields: [],
    writableFields: [],
    mergeFields: ['employeeName', 'employeeId', 'leaveType', 'startDate', 'endDate', 'days', 'status', 'reason', 'managerName'],
  },
  {
    key: 'regularization',
    label: 'Attendance Regularization',
    table: 'attendance_regularizations',
    criteria: [
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'reason', label: 'Reason', type: 'text' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'ageInDays', label: 'Days since the date', type: 'number' },
    ],
    dateFields: [{ key: 'date', label: 'Date' }],
    watchableFields: [],
    writableFields: [],
    mergeFields: ['employeeName', 'employeeId', 'date', 'reason', 'status', 'managerName'],
  },
  {
    key: 'on_duty',
    label: 'On Duty',
    table: 'on_duty_requests',
    criteria: [
      { key: 'startDate', label: 'From date', type: 'date' },
      { key: 'endDate', label: 'To date', type: 'date' },
      { key: 'requestType', label: 'Type', type: 'text' },
      { key: 'status', label: 'Status', type: 'text' },
    ],
    dateFields: [{ key: 'start_date', label: 'From date' }, { key: 'end_date', label: 'To date' }],
    watchableFields: [],
    writableFields: [],
    mergeFields: ['employeeName', 'employeeId', 'startDate', 'endDate', 'requestType', 'status', 'managerName'],
  },
  {
    key: 'comp_off',
    label: 'Comp Off',
    table: 'comp_off_requests',
    criteria: [
      { key: 'date', label: 'Worked date', type: 'date' },
      { key: 'daysEarned', label: 'Days earned', type: 'number' },
      { key: 'status', label: 'Status', type: 'text' },
    ],
    // The column is worked_date, not date. Naming the wrong one here would
    // store a date-based workflow that could never find its field.
    dateFields: [{ key: 'worked_date', label: 'Worked date' }],
    watchableFields: [],
    writableFields: [],
    mergeFields: ['employeeName', 'employeeId', 'date', 'daysEarned', 'status', 'managerName'],
  },
  {
    key: 'wfh',
    label: 'Work From Home',
    table: 'wfh_requests',
    // One day, not a range: the table has a single `date`.
    criteria: [
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'status', label: 'Status', type: 'text' },
    ],
    dateFields: [{ key: 'date', label: 'Date' }],
    watchableFields: [],
    writableFields: [],
    mergeFields: ['employeeName', 'employeeId', 'date', 'status', 'managerName'],
  },
];

const byKey = new Map(RECORD_TYPES.map(r => [r.key, r]));
const recordType = key => byKey.get(key) || null;

const ACTION_EVENT_KEYS = new Set(ACTION_EVENTS.map(e => e.key));
const OPERATOR_KEYS = new Set(OPERATORS.map(o => o.key));
const OCCURRENCE_KEYS = new Set(OCCURRENCES.map(o => o.key));
const RECIPIENT_KEYS = new Set(RECIPIENT_KINDS.map(r => r.key));
const FROM_KEYS = new Set(FROM_KINDS.map(f => f.key));

/** True when `field` may be written on `recordTypeKey`. */
const isWritable = (recordTypeKey, field) =>
  !!recordType(recordTypeKey)?.writableFields.some(f => f.key === field);

module.exports = {
  RECORD_TYPES, ACTION_EVENTS, OCCURRENCES, DIRECTIONS, OPERATORS,
  RECIPIENT_KINDS, FROM_KINDS,
  recordType, isWritable,
  ACTION_EVENT_KEYS, OPERATOR_KEYS, OCCURRENCE_KEYS, RECIPIENT_KEYS, FROM_KEYS,
};
