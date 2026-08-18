/**
 * routes/approval-rules.js
 * Settings → <service> → Approvals.
 *
 * A form can have several approvals. Which one governs a request is decided at
 * submission: the first active rule in sort order whose criteria match. A rule
 * with no criteria matches everything, so it is the fallback for its form —
 * which is exactly what the six seeded rules are.
 *
 * Editing here changes requests filed afterwards. Anything already awaiting
 * approval keeps the approvers it was given, because its approval_levels rows
 * were written at submission.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { CRITERIA_FIELDS, OPERATORS, APPROVER_TYPES, pickRule } = require('../utils/approvalRules');

router.use(protect);

const REQUEST_TYPES = {
  regularization: { label: 'Attendance Regularization', service: 'attendance' },
  on_duty: { label: 'On Duty', service: 'attendance' },
  leave: { label: 'Leave', service: 'leave' },
  comp_off: { label: 'Compensatory Off', service: 'leave' },
  wfh: { label: 'Work From Home', service: 'leave' },
  timesheet: { label: 'Timesheet', service: 'time' },
};

const ROLES = new Set(['admin', 'director', 'hr_admin', 'manager', 'team_incharge', 'team_member']);
const DECISIONS = new Set(['chain', 'auto_approve', 'auto_reject']);
const TYPE_KEYS = new Set(APPROVER_TYPES.map(t => t.key));
const OPERATOR_KEYS = new Set(OPERATORS.map(o => o.key));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanLevels(input, decision) {
  // Auto approve and auto reject settle the request themselves; a chain would
  // never run, so one is not required.
  if (decision !== 'chain') return [];

  const list = Array.isArray(input) ? input : [];
  if (!list.length) throw new Error('An approval needs at least one approver level');
  if (list.length > 6) throw new Error('No more than 6 approver levels can be configured');

  return list.map(raw => {
    const step = raw || {};
    if (!TYPE_KEYS.has(step.kind)) throw new Error('Approver type is not valid');

    if (step.kind === 'reporting_to') {
      const count = Number(step.count);
      if (!Number.isInteger(count) || count < 1 || count > 6) {
        throw new Error('Reporting levels must be between 1 and 6');
      }
      return { kind: 'reporting_to', count };
    }
    if (step.kind === 'role') {
      if (!ROLES.has(step.role)) throw new Error('Approver role is not valid');
      // Carried through because the built-in chain has always applied it.
      return { kind: 'role', role: step.role, skipWhenManagerIsBuHead: !!step.skipWhenManagerIsBuHead };
    }
    if (step.kind === 'department_head_of_owner') return { kind: 'department_head_of_owner' };
    if (step.kind === 'department_head' || step.kind === 'department_members') {
      if (!UUID.test(String(step.departmentId || ''))) throw new Error('Choose a department');
      return { kind: step.kind, departmentId: step.departmentId };
    }
    if (!UUID.test(String(step.userId || ''))) throw new Error('Choose an employee');
    return { kind: 'user', userId: step.userId };
  });
}

function cleanCriteria(input, requestType) {
  const list = Array.isArray(input) ? input : [];
  if (list.length > 10) throw new Error('No more than 10 conditions can be set');
  const allowed = new Set((CRITERIA_FIELDS[requestType] || []).map(f => f.key));

  return list.map(raw => {
    const c = raw || {};
    if (!allowed.has(c.field)) throw new Error('That field cannot be used on this form');
    if (!OPERATOR_KEYS.has(c.operator)) throw new Error('That comparison is not valid');
    const value = String(c.value ?? '').trim();
    // A blank value would match nothing and read as a rule that never fires.
    if (!value) throw new Error('Every condition needs a value');
    if (value.length > 200) throw new Error('A condition value must be 200 characters or fewer');
    return { field: c.field, operator: c.operator, value };
  });
}

function cleanMessages(input) {
  const m = input || {};
  const recipients = Array.isArray(m.to) ? m.to.filter(x => ['current_approver', 'requester', 'reporting_manager'].includes(x)) : [];
  if (!recipients.length) throw new Error('Choose at least one recipient for the approval email');
  const subject = String(m.subject || '').trim();
  if (!subject) throw new Error('The approval email needs a subject');
  if (subject.length > 300) throw new Error('The subject must be 300 characters or fewer');
  return {
    from: m.from === 'performer' ? 'performer' : 'default_address',
    to: [...new Set(recipients)],
    subject,
    templateName: String(m.templateName || '').trim() || null,
    onApproved: { enabled: m.onApproved?.enabled !== false, templateName: m.onApproved?.templateName || null },
    onRejected: { enabled: m.onRejected?.enabled !== false, templateName: m.onRejected?.templateName || null },
  };
}

const FOLLOW_UP_MODES = new Set(['one_time', 'repeat']);
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

// Was a boolean that nothing read. The reference's shape is a schedule, and a
// schedule is what the sweep needs to know when to chase.
function cleanFollowUp(f) {
  if (!f || typeof f !== 'object') return { enabled: false, mode: 'one_time', days: 1, time: '10:00' };
  const days = Math.max(1, Math.min(365, Number(f.days) || 1));
  if (f.time && !HHMM.test(f.time)) throw new Error('The follow-up time is not valid');
  return {
    enabled: !!f.enabled,
    mode: FOLLOW_UP_MODES.has(f.mode) ? f.mode : 'one_time',
    days,
    // The reference notes that the approval request time is used when no
    // follow-up time is given; ours always stores one so the sweep has a
    // window to match rather than a null to guess at.
    time: f.time || '10:00',
  };
}

const ROW = `
  id, request_type AS "requestType", name, description, is_active AS "isActive",
  levels, criteria, criteria_match AS "criteriaMatch", decision, follow_up AS "followUp",
  messages, sort_order AS "sortOrder", updated_at AS "updatedAt"`;

// Everything a form's editor needs to draw itself: the approver types, the
// criteria fields for that form, and the lists those pickers read from.
router.get('/meta', async (req, res) => {
  try {
    const [departments, templates] = await Promise.all([
      pool.query(`SELECT id, name FROM departments ORDER BY name`),
      pool.query(`SELECT id, name, subject, body FROM email_templates ORDER BY name`).catch(() => ({ rows: [] })),
    ]);
    res.json({
      success: true,
      data: {
        forms: Object.entries(REQUEST_TYPES).map(([key, v]) => ({ key, ...v })),
        approverTypes: APPROVER_TYPES,
        operators: OPERATORS,
        criteriaFields: CRITERIA_FIELDS,
        roles: [...ROLES],
        departments: departments.rows,
        templates: templates.rows,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  }
});

router.get('/', async (req, res) => {
  try {
    const r = await pool.query(`SELECT ${ROW} FROM approval_rules ORDER BY request_type, sort_order, created_at`);
    const rows = req.query.service
      ? r.rows.filter(x => REQUEST_TYPES[x.requestType]?.service === req.query.service)
      : r.rows;
    res.json({
      success: true,
      data: rows.map(x => ({ ...x, formLabel: REQUEST_TYPES[x.requestType]?.label || x.requestType })),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  }
});

function readBody(body) {
  const requestType = body.requestType;
  if (!REQUEST_TYPES[requestType]) throw new Error('Choose a form');

  const name = String(body.name || '').trim();
  if (!name) throw new Error('An approval name is required');
  if (name.length > 150) throw new Error('The name must be 150 characters or fewer');

  const decision = DECISIONS.has(body.decision) ? body.decision : 'chain';
  const order = Number.isInteger(Number(body.sortOrder)) ? Number(body.sortOrder) : 100;

  return {
    requestType, name, decision,
    description: String(body.description || '').trim().slice(0, 1000) || null,
    isActive: body.isActive !== false,
    levels: cleanLevels(body.levels, decision),
    criteria: cleanCriteria(body.criteria, requestType),
    criteriaMatch: body.criteriaMatch === 'OR' ? 'OR' : 'AND',
    followUp: cleanFollowUp(body.followUp),
    messages: cleanMessages(body.messages),
    sortOrder: Math.max(1, Math.min(order, 999)),
  };
}

const known = m => /required|not valid|at least|no more than|characters or fewer|Choose|needs a/i.test(m || '');
const fail = (res, err) => res.status(known(err.message) ? 400 : 500)
  .json({ success: false, message: known(err.message) ? err.message : 'An internal server error occurred' });

router.post('/', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  let v;
  try { v = readBody(req.body || {}); } catch (err) { return res.status(400).json({ success: false, message: err.message }); }
  try {
    const r = await pool.query(
      `INSERT INTO approval_rules
         (request_type, name, description, is_active, levels, criteria, criteria_match,
          decision, follow_up, messages, sort_order)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10::jsonb,$11)
       RETURNING ${ROW}`,
      [v.requestType, v.name, v.description, v.isActive, JSON.stringify(v.levels),
       JSON.stringify(v.criteria), v.criteriaMatch, v.decision, v.followUp,
       JSON.stringify(v.messages), v.sortOrder]
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) { fail(res, err); }
});

router.put('/:id', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  let v;
  try { v = readBody(req.body || {}); } catch (err) { return res.status(400).json({ success: false, message: err.message }); }
  try {
    const r = await pool.query(
      `UPDATE approval_rules
          SET request_type = $1, name = $2, description = $3, is_active = $4,
              levels = $5::jsonb, criteria = $6::jsonb, criteria_match = $7,
              decision = $8, follow_up = $9, messages = $10::jsonb, sort_order = $11,
              updated_at = NOW()
        WHERE id = $12 RETURNING ${ROW}`,
      [v.requestType, v.name, v.description, v.isActive, JSON.stringify(v.levels),
       JSON.stringify(v.criteria), v.criteriaMatch, v.decision, v.followUp,
       JSON.stringify(v.messages), v.sortOrder, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Approval not found' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { fail(res, err); }
});

// The copy icon on the reference's hover row.
router.post('/:id/duplicate', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  try {
    const r = await pool.query(
      `INSERT INTO approval_rules (request_type, name, description, is_active, levels,
                                   criteria, criteria_match, decision, follow_up, messages, sort_order)
       SELECT request_type, LEFT(name || ' (copy)', 150), description,
              -- Off on arrival. A copy of a live approval that starts routing
              -- the same requests is not what a copy button promises.
              FALSE, levels, criteria, criteria_match, decision, follow_up, messages, sort_order + 1
         FROM approval_rules WHERE id = $1 RETURNING ${ROW}`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Approval not found' });
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) { fail(res, err); }
});

// The inline toggle, separate from the full save so switching one off does not
// have to re-post and re-validate the whole rule.
router.patch('/:id/status', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE approval_rules SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING ${ROW}`,
      [req.body?.isActive !== false, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Approval not found' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { fail(res, err); }
});

// What the follow-up sweep has actually sent.
router.get('/followups', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT f.id, f.request_type AS "requestType", f.request_id AS "requestId",
              f.level, f.sequence, f.status, f.message, f.sent_at AS "sentAt",
              r.name AS "ruleName",
              TRIM(CONCAT(a.first_name, ' ', a.last_name)) AS "approverName"
         FROM approval_followups f
         LEFT JOIN approval_rules r ON r.id = f.rule_id
         LEFT JOIN employees a ON a.id = f.approver_id
        ORDER BY f.sent_at DESC LIMIT 200`
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { fail(res, err); }
});

router.delete('/:id', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  try {
    const target = await pool.query(`SELECT request_type FROM approval_rules WHERE id = $1`, [req.params.id]);
    if (!target.rows.length) return res.status(404).json({ success: false, message: 'Approval not found' });

    // A form with no approval at all falls back to the built-in chain, which is
    // invisible and unchangeable — the state this screen exists to replace.
    const siblings = await pool.query(
      `SELECT COUNT(*)::int AS n FROM approval_rules WHERE request_type = $1 AND id <> $2`,
      [target.rows[0].request_type, req.params.id]
    );
    if (siblings.rows[0].n === 0) {
      return res.status(400).json({
        success: false,
        message: 'That is the only approval for this form. Add another before deleting it, or switch it off instead.',
      });
    }
    await pool.query(`DELETE FROM approval_rules WHERE id = $1`, [req.params.id]);
    res.json({ success: true, message: 'Approval deleted' });
  } catch (err) { fail(res, err); }
});

// Which approval would govern a request, and who it would go to. This is what
// makes the screen trustworthy: the chain is derived from what is saved, for a
// real person, rather than described.
router.get('/preview/:requestType', async (req, res) => {
  const { requestType } = req.params;
  if (!REQUEST_TYPES[requestType]) return res.status(404).json({ success: false, message: 'Unknown form' });

  const employeeId = req.query.employeeId || req.user._id;
  const context = {};
  Object.entries(req.query).forEach(([k, v]) => { if (k !== 'employeeId') context[k] = v; });

  try {
    const { deriveLevels } = require('../utils/leaveApproval');
    const rule = await pickRule(pool, requestType, context);
    const levels = await deriveLevels(pool, employeeId, requestType, context);

    let approvers = [];
    if (levels.length) {
      const r = await pool.query(
        `SELECT id, TRIM(CONCAT(first_name, ' ', last_name)) AS name, designation, role
           FROM employees WHERE id = ANY($1::uuid[])`,
        [levels.map(l => l.approverId)]
      );
      const byId = new Map(r.rows.map(x => [String(x.id), x]));
      approvers = levels.map(l => {
        const e = byId.get(String(l.approverId)) || {};
        return { level: l.level, name: e.name || 'Unknown', designation: e.designation || null, role: e.role || null };
      });
    }

    res.json({
      success: true,
      data: {
        ruleId: rule?.id || null,
        ruleName: rule?.name || null,
        decision: rule?.decision || 'chain',
        approvers,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  }
});

module.exports = router;
