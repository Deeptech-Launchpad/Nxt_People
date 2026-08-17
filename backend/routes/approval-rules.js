/**
 * routes/approval-rules.js
 * Settings → <service> → Approvals.
 *
 * One rule per request type, describing who approves it. The rule is what
 * utils/leaveApproval.js reads when a request is submitted, so editing it here
 * changes the chain for every request filed afterwards — and only afterwards.
 * Requests already in flight keep the approvers they were given, because their
 * approval_levels rows were written at submission.
 *
 * The reference also attaches trigger criteria to an approval ("only when the
 * date is more than N days ago"). There is none here: the one approval
 * configured in the reference org has no criteria set either, and a condition
 * builder nothing uses is worse than none.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

// Only the request types the shared engine actually serves. Anything else
// would create a rule that is never read.
const REQUEST_TYPES = new Set(['leave', 'regularization', 'comp_off', 'wfh', 'timesheet', 'on_duty']);

// Which service's Approvals tab a request type belongs to.
const SERVICE_OF = {
  regularization: 'attendance',
  on_duty: 'attendance',
  leave: 'leave',
  comp_off: 'leave',
  wfh: 'leave',
  timesheet: 'time',
};

const STEP_KINDS = new Set(['reporting_to', 'role', 'user']);
const ROLES = new Set(['admin', 'director', 'hr_admin', 'manager', 'team_incharge']);

function cleanLevels(input) {
  const list = Array.isArray(input) ? input : [];
  if (!list.length) throw new Error('An approval needs at least one approver level');
  if (list.length > 5) throw new Error('No more than 5 approver levels can be configured');

  return list.map(raw => {
    const step = raw || {};
    if (!STEP_KINDS.has(step.kind)) throw new Error('Approver type is not valid');

    if (step.kind === 'reporting_to') {
      const count = Number(step.count);
      if (!Number.isInteger(count) || count < 1 || count > 5) {
        throw new Error('Reporting levels must be between 1 and 5');
      }
      return { kind: 'reporting_to', count };
    }

    if (step.kind === 'role') {
      if (!ROLES.has(step.role)) throw new Error('Approver role is not valid');
      // Carried through because the built-in chain has always applied it: an
      // employee whose manager is the Business Unit Head does not also go to HR.
      return { kind: 'role', role: step.role, skipWhenManagerIsBuHead: !!step.skipWhenManagerIsBuHead };
    }

    const id = String(step.userId || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new Error('Approver is not valid');
    }
    return { kind: 'user', userId: id };
  });
}

// Readable by any signed-in user: the request forms show who a request will go
// to before it is submitted.
router.get('/', async (req, res) => {
  try {
    const service = req.query.service;
    const r = await pool.query(
      `SELECT id, request_type AS "requestType", name, is_active AS "isActive", levels,
              updated_at AS "updatedAt"
         FROM approval_rules ORDER BY name`
    );
    const rows = service
      ? r.rows.filter(x => SERVICE_OF[x.requestType] === service)
      : r.rows;
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  }
});

router.put('/:requestType', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  const { requestType } = req.params;
  if (!REQUEST_TYPES.has(requestType)) {
    return res.status(404).json({ success: false, message: 'Unknown request type' });
  }

  const body = req.body || {};
  let levels;
  try { levels = cleanLevels(body.levels); }
  catch (err) { return res.status(400).json({ success: false, message: err.message }); }

  const name = String(body.name || '').trim();
  if (!name) return res.status(400).json({ success: false, message: 'An approval name is required' });
  if (name.length > 150) return res.status(400).json({ success: false, message: 'The name must be 150 characters or fewer' });

  try {
    const r = await pool.query(
      `INSERT INTO approval_rules (request_type, name, is_active, levels)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (request_type) DO UPDATE
          SET name = EXCLUDED.name, is_active = EXCLUDED.is_active,
              levels = EXCLUDED.levels, updated_at = NOW()
       RETURNING id, request_type AS "requestType", name, is_active AS "isActive", levels,
                 updated_at AS "updatedAt"`,
      [requestType, name, body.isActive !== false, JSON.stringify(levels)]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  }
});

// A preview of who would approve for one employee under the saved rule. This is
// what makes the screen trustworthy: the chain is derived, not described, so an
// admin can see the effect of a change on a real person before relying on it.
router.get('/:requestType/preview', async (req, res) => {
  const { requestType } = req.params;
  if (!REQUEST_TYPES.has(requestType)) {
    return res.status(404).json({ success: false, message: 'Unknown request type' });
  }
  const employeeId = req.query.employeeId || req.user._id;
  try {
    const { deriveLevels } = require('../utils/leaveApproval');
    const levels = await deriveLevels(pool, employeeId, requestType);
    if (!levels.length) return res.json({ success: true, data: [] });

    const r = await pool.query(
      `SELECT id, TRIM(CONCAT(first_name, ' ', last_name)) AS name, designation, role
         FROM employees WHERE id = ANY($1::uuid[])`,
      [levels.map(l => l.approverId)]
    );
    const byId = new Map(r.rows.map(x => [String(x.id), x]));
    res.json({
      success: true,
      data: levels.map(l => {
        const e = byId.get(String(l.approverId)) || {};
        return { level: l.level, name: e.name || 'Unknown', designation: e.designation || null, role: e.role || null };
      }),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  }
});

module.exports = router;
