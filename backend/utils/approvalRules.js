/**
 * utils/approvalRules.js
 * Picking which approval applies to a request, and turning its approver levels
 * into actual people.
 *
 * A form can have several approvals. The one that runs is the first active rule
 * in sort order whose criteria match the request — a rule with no criteria
 * matches everything, so it acts as the fallback for its form. That is what the
 * six seeded rules are, which is why adding this changed nobody's routing.
 *
 * Approver types mirror the reference's list. The three that need a department
 * resolve through departments.head_id, which has existed since the first schema
 * and, until Manage Accounts filled it in, was never populated.
 */
// ── Criteria ───────────────────────────────────────────────────────────────
// Fields a condition can test, per form. Kept to what the request actually
// carries: a criterion on a field the submission does not have could never
// match, and would look like a rule that silently never fires.
const CRITERIA_FIELDS = {
  regularization: [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'reason', label: 'Reason', type: 'text' },
    { key: 'ageInDays', label: 'Days since the date', type: 'number' },
  ],
  on_duty: [
    { key: 'startDate', label: 'From date', type: 'date' },
    { key: 'endDate', label: 'To date', type: 'date' },
    { key: 'requestType', label: 'Type', type: 'text' },
    { key: 'days', label: 'Number of days', type: 'number' },
  ],
  leave: [
    { key: 'startDate', label: 'From date', type: 'date' },
    { key: 'endDate', label: 'To date', type: 'date' },
    { key: 'leaveType', label: 'Leave type', type: 'text' },
    { key: 'days', label: 'Number of days', type: 'number' },
  ],
  comp_off: [{ key: 'date', label: 'Date', type: 'date' }],
  wfh: [
    { key: 'startDate', label: 'From date', type: 'date' },
    { key: 'endDate', label: 'To date', type: 'date' },
  ],
  timesheet: [{ key: 'date', label: 'Date', type: 'date' }],
  shift_change: [
    { key: 'changeType', label: 'Kind of change', type: 'text' },
    { key: 'startDate', label: 'From date', type: 'date' },
    { key: 'endDate', label: 'To date', type: 'date' },
    { key: 'days', label: 'Number of days', type: 'number' },
    { key: 'toShift', label: 'Requested shift', type: 'text' },
  ],
};

const OPERATORS = [
  { key: 'is', label: 'is' },
  { key: 'is_not', label: 'is not' },
  { key: 'contains', label: 'contains' },
  { key: 'gt', label: 'is greater than' },
  { key: 'gte', label: 'is greater than or equal to' },
  { key: 'lt', label: 'is less than' },
  { key: 'lte', label: 'is less than or equal to' },
];

function testCondition(cond, context) {
  const actual = context?.[cond.field];
  if (actual === undefined || actual === null) return false;
  const expected = cond.value;

  // Dates compare as ISO strings and numbers as numbers; everything else as
  // lower-cased text, so "WFH" matches "wfh".
  const bothNumeric = Number.isFinite(Number(actual)) && Number.isFinite(Number(expected));
  const a = bothNumeric ? Number(actual) : String(actual).toLowerCase();
  const b = bothNumeric ? Number(expected) : String(expected).toLowerCase();

  switch (cond.operator) {
    case 'is': return a === b;
    case 'is_not': return a !== b;
    case 'contains': return String(a).includes(String(b));
    case 'gt': return a > b;
    case 'gte': return a >= b;
    case 'lt': return a < b;
    case 'lte': return a <= b;
    default: return false;
  }
}

const matches = (rule, context) => {
  const conditions = Array.isArray(rule.criteria) ? rule.criteria : [];
  if (!conditions.length) return true;
  return rule.criteria_match === 'OR'
    ? conditions.some(c => testCondition(c, context))
    : conditions.every(c => testCondition(c, context));
};

/**
 * The approval that governs this request, or null when the table is missing.
 * Ordered by sort_order so a narrower rule can be placed above the catch-all.
 */
async function pickRule(db, requestType, context = {}) {
  try {
    const r = await db.query(
      `SELECT * FROM approval_rules
        WHERE request_type = $1 AND is_active = TRUE
        ORDER BY sort_order, created_at`,
      [requestType]
    );
    return r.rows.find(rule => matches(rule, context)) || null;
  } catch {
    return null;
  }
}

// ── Approver levels ────────────────────────────────────────────────────────
const APPROVER_TYPES = [
  { key: 'reporting_to', label: 'Reporting To', valueType: 'levels' },
  { key: 'department_head_of_owner', label: 'Department head of the record owner', valueType: 'none' },
  { key: 'role', label: 'Approver based on Role', valueType: 'role' },
  { key: 'department_head', label: 'Department head', valueType: 'department' },
  { key: 'department_members', label: 'Department Members', valueType: 'department' },
  { key: 'user', label: 'Employee', valueType: 'employee' },
];

/**
 * Turn a rule's levels into an ordered, de-duplicated list of approvers.
 *
 * De-duplication matters: a chain asking for two reporting levels and then HR
 * gives two approvers, not three, when the manager IS the HR admin. Renumbering
 * afterwards keeps levels contiguous, which the approve and reject logic relies
 * on.
 */
async function resolveLevels(db, employeeId, ancestors, levels) {
  const picks = [];
  const seen = new Set([String(employeeId)]);
  const add = id => {
    if (id && !seen.has(String(id))) { seen.add(String(id)); picks.push(id); }
  };

  // The Business Unit Head exception the built-in chain has always applied.
  let managerIsBuHead = false;
  if (ancestors.length) {
    const d = await db.query(`SELECT designation FROM employees WHERE id = $1 LIMIT 1`, [ancestors[0]]);
    managerIsBuHead = (d.rows[0]?.designation || '').toLowerCase() === 'business unit head';
  }

  for (const step of (levels || [])) {
    if (step?.skipWhenManagerIsBuHead && managerIsBuHead) continue;

    if (step?.kind === 'reporting_to') {
      const count = Math.max(1, Math.min(Number(step.count) || 1, 6));
      for (let i = 0; i < count && i < ancestors.length; i += 1) add(ancestors[i]);

    } else if (step?.kind === 'role' && step.role) {
      const r = await db.query(
        `SELECT id FROM employees
          WHERE role = $1 AND COALESCE(status,'active') = 'active' AND deleted_at IS NULL
          ORDER BY created_at LIMIT 1`,
        [step.role]
      );
      if (r.rows.length) add(r.rows[0].id);
      else if (ancestors.length) add(ancestors[ancestors.length - 1]);

    } else if (step?.kind === 'department_head_of_owner') {
      // The head of whichever department the requester belongs to.
      const r = await db.query(
        `SELECT d.head_id FROM employees e JOIN departments d ON d.id = e.department_id
          WHERE e.id = $1 AND d.head_id IS NOT NULL LIMIT 1`,
        [employeeId]
      );
      if (r.rows.length) add(r.rows[0].head_id);

    } else if (step?.kind === 'department_head' && step.departmentId) {
      const r = await db.query(`SELECT head_id FROM departments WHERE id = $1`, [step.departmentId]);
      if (r.rows[0]?.head_id) add(r.rows[0].head_id);

    } else if (step?.kind === 'department_members' && step.departmentId) {
      // Everyone in the department becomes a level of their own, in join order,
      // so the request walks the team rather than waiting on all of them.
      const r = await db.query(
        `SELECT id FROM employees
          WHERE department_id = $1 AND COALESCE(status,'active') = 'active' AND deleted_at IS NULL
          ORDER BY created_at`,
        [step.departmentId]
      );
      r.rows.forEach(x => add(x.id));

    } else if (step?.kind === 'user' && step.userId) {
      const r = await db.query(`SELECT id FROM employees WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [step.userId]);
      if (r.rows.length) add(r.rows[0].id);
    }
  }

  return picks.map((approverId, i) => ({ level: i + 1, approverId }));
}

module.exports = { CRITERIA_FIELDS, OPERATORS, APPROVER_TYPES, pickRule, matches, resolveLevels };
