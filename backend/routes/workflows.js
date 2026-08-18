/**
 * routes/workflows.js
 * Manage Accounts → Automation.
 *
 *   Workflows        a trigger, optional criteria, and the actions that follow
 *   Email Alerts     reusable named alerts a workflow can run
 *   Field Updates    reusable named writes, restricted to a whitelist
 *   Email Templates  the wording, with merge fields
 *   Logs             what ran, and what happened
 *
 * The reference's Blueprints, Checklists & Tasks, Webhooks, Custom Functions,
 * E-Sign Flow, Letter Templates and Mail Merge Templates are not here — see the
 * note in utils/workflowCatalog.js for why.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const logger = require('../logger');
const { protect, authorize } = require('../middleware/auth');
const { invalidate } = require('../utils/automationConfig');
const {
  RECORD_TYPES, ACTION_EVENTS, OCCURRENCES, DIRECTIONS, OPERATORS,
  RECIPIENT_KINDS, FROM_KINDS, recordType,
  ACTION_EVENT_KEYS, OPERATOR_KEYS, OCCURRENCE_KEYS, RECIPIENT_KEYS, FROM_KEYS,
} = require('../utils/workflowCatalog');

router.use(protect);

const WRITE = ['admin', 'director', 'hr_admin'];

class Invalid extends Error {
  constructor(message) { super(message); this.expected = true; }
}
const bad = message => new Invalid(message);

const fail = (res, err) => {
  if (err.expected) return res.status(400).json({ success: false, message: err.message });
  logger.error({ err: err.message, code: err.code, stack: err.stack }, 'Automation request failed');
  return res.status(500).json({ success: false, message: 'An internal server error occurred' });
};

const str = (v, label, max, { required = true } = {}) => {
  const s = String(v ?? '').trim();
  if (!s) {
    if (required) throw bad(`${label} is required`);
    return null;
  }
  if (s.length > max) throw bad(`${label} must be ${max} characters or fewer`);
  return s;
};

const uuidOrNull = (v, label) => {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
    throw bad(`${label} is not valid`);
  }
  return s;
};

const requireType = key => {
  const t = recordType(key);
  if (!t) throw bad('That is not a record type a workflow can be about');
  return t;
};

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

// ── The catalogue every Automation screen is drawn from ────────────────────
router.get('/catalog', (req, res) => {
  res.json({
    success: true,
    data: {
      // Trimmed of the server-only bits: a screen has no use for the table
      // name, and shipping it invites a client that thinks it can name one.
      recordTypes: RECORD_TYPES.map(({ table, ...rest }) => rest),
      actionEvents: ACTION_EVENTS,
      occurrences: OCCURRENCES,
      directions: DIRECTIONS,
      operators: OPERATORS,
      recipientKinds: RECIPIENT_KINDS,
      fromKinds: FROM_KINDS,
    },
  });
});

// ── Workflows ──────────────────────────────────────────────────────────────
const WORKFLOW_ROW = `
  w.id, w.record_type AS "recordType", w.name, w.description,
  w.is_active AS "isActive", w.trigger_kind AS "triggerKind",
  w.trigger_event AS "triggerEvent", w.trigger_field AS "triggerField",
  w.date_field AS "dateField", w.date_direction AS "dateDirection",
  w.date_months AS "dateMonths", w.date_days AS "dateDays",
  w.execute_at AS "executeAt", w.occurrence, w.timezone,
  w.criteria, w.sort_order AS "sortOrder"`;

const actionsOf = async workflowId => {
  const r = await pool.query(
    `SELECT a.id, a.kind, a.ref_id AS "refId", a.sort_order AS "sortOrder",
            COALESCE(e.name, f.name) AS name
       FROM workflow_actions a
       LEFT JOIN email_alerts e ON a.kind = 'email_alert' AND e.id = a.ref_id
       LEFT JOIN workflow_field_updates f ON a.kind = 'field_update' AND f.id = a.ref_id
      WHERE a.workflow_id = $1 ORDER BY a.sort_order`,
    [workflowId]
  );
  return r.rows;
};

router.get('/workflows', async (req, res) => {
  try {
    const type = req.query.recordType && req.query.recordType !== 'all'
      ? requireType(req.query.recordType).key : null;
    const r = await pool.query(
      `SELECT ${WORKFLOW_ROW} FROM workflows w
        ${type ? 'WHERE w.record_type = $1' : ''}
        ORDER BY w.sort_order, w.created_at`,
      type ? [type] : []
    );
    const withActions = [];
    for (const w of r.rows) withActions.push({ ...w, actions: await actionsOf(w.id) });
    res.json({ success: true, data: withActions });
  } catch (err) { fail(res, err); }
});

router.get('/workflows/:id', async (req, res) => {
  try {
    const r = await pool.query(`SELECT ${WORKFLOW_ROW} FROM workflows w WHERE w.id = $1`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Workflow not found' });
    res.json({ success: true, data: { ...r.rows[0], actions: await actionsOf(req.params.id) } });
  } catch (err) { fail(res, err); }
});

function cleanWorkflow(b) {
  const type = requireType(b.recordType);
  const kind = b.triggerKind === 'date' ? 'date' : 'action';

  const out = {
    record_type: type.key,
    name: str(b.name, 'Workflow name', 150),
    description: str(b.description, 'Description', 500, { required: false }),
    is_active: b.isActive !== false,
    trigger_kind: kind,
    trigger_event: null,
    trigger_field: null,
    date_field: null,
    date_direction: 'on',
    date_months: 0,
    date_days: 0,
    execute_at: '09:00',
    occurrence: 'one_time',
    timezone: 'Asia/Kolkata',
    criteria: [],
    sort_order: Number.isInteger(b.sortOrder) ? b.sortOrder : 0,
  };

  if (kind === 'action') {
    if (!ACTION_EVENT_KEYS.has(b.triggerEvent)) throw bad('Choose a trigger event');
    out.trigger_event = b.triggerEvent;
    if (b.triggerEvent === 'field_updated') {
      // Only where the route reports which columns it wrote. Accepting this
      // elsewhere would store a workflow that can never fire.
      if (!type.watchableFields.length) {
        throw bad(`${type.label} cannot report which field changed, so it has no "specific field" trigger`);
      }
      // Without a field it would fire on every edit, which is a different
      // workflow than the one being asked for.
      const field = str(b.triggerField, 'Field', 60);
      if (!type.watchableFields.some(f => f.key === field)) {
        throw bad(`'${field}' is not a field that can be watched on ${type.label}`);
      }
      out.trigger_field = field;
    }
  } else {
    const field = str(b.dateField, 'Event date field', 60);
    if (!type.dateFields.some(d => d.key === field)) {
      throw bad(`${type.label} has no date field called '${field}'`);
    }
    out.date_field = field;
    out.date_direction = DIRECTIONS.some(d => d.key === b.dateDirection) ? b.dateDirection : 'on';
    out.date_months = Math.max(0, Math.min(120, Number(b.dateMonths) || 0));
    out.date_days = Math.max(0, Math.min(365, Number(b.dateDays) || 0));
    if (b.executeAt && !HHMM.test(b.executeAt)) throw bad('Time of execution must be HH:MM');
    out.execute_at = b.executeAt || '09:00';
    if (b.occurrence && !OCCURRENCE_KEYS.has(b.occurrence)) throw bad('That is not an execution occurrence');
    out.occurrence = b.occurrence || 'one_time';
    // On the event date itself, an offset would contradict the direction.
    if (out.date_direction === 'on') { out.date_months = 0; out.date_days = 0; }
  }

  const criteria = Array.isArray(b.criteria) ? b.criteria : [];
  for (const c of criteria) {
    if (!type.criteria.some(f => f.key === c.field)) throw bad(`'${c.field}' is not a field on ${type.label}`);
    if (!OPERATOR_KEYS.has(c.operator)) throw bad('That is not a condition operator');
    if (String(c.value ?? '').trim() === '') throw bad('A condition needs a value');
  }
  out.criteria = criteria.map(c => ({ field: c.field, operator: c.operator, value: String(c.value).trim() }));

  return out;
}

const saveActions = async (client, workflowId, actions) => {
  await client.query(`DELETE FROM workflow_actions WHERE workflow_id = $1`, [workflowId]);
  let order = 0;
  for (const a of Array.isArray(actions) ? actions : []) {
    if (!['email_alert', 'field_update'].includes(a.kind)) throw bad('That is not an action kind');
    const refId = uuidOrNull(a.refId, 'Action');
    if (!refId) throw bad('An action needs something to run');
    const table = a.kind === 'email_alert' ? 'email_alerts' : 'workflow_field_updates';
    const exists = await client.query(`SELECT 1 FROM ${table} WHERE id = $1`, [refId]);
    if (!exists.rows.length) throw bad('That action no longer exists');
    await client.query(
      `INSERT INTO workflow_actions (workflow_id, kind, ref_id, sort_order)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [workflowId, a.kind, refId, order++]
    );
  }
};

router.post('/workflows', authorize(...WRITE), async (req, res) => {
  const client = await pool.connect();
  try {
    const v = cleanWorkflow(req.body || {});
    await client.query('BEGIN');
    const cols = Object.keys(v);
    const created = await client.query(
      `INSERT INTO workflows (${cols.join(', ')})
       VALUES (${cols.map((c, i) => (c === 'criteria' ? `$${i + 1}::jsonb` : `$${i + 1}`)).join(', ')})
       RETURNING id`,
      cols.map(c => (c === 'criteria' ? JSON.stringify(v[c]) : v[c]))
    );
    await saveActions(client, created.rows[0].id, req.body?.actions);
    await client.query('COMMIT');
    const r = await pool.query(`SELECT ${WORKFLOW_ROW} FROM workflows w WHERE w.id = $1`, [created.rows[0].id]);
    res.status(201).json({ success: true, data: { ...r.rows[0], actions: await actionsOf(created.rows[0].id) } });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    fail(res, err);
  } finally { client.release(); }
});

router.put('/workflows/:id', authorize(...WRITE), async (req, res) => {
  const client = await pool.connect();
  try {
    const v = cleanWorkflow(req.body || {});
    await client.query('BEGIN');
    const cols = Object.keys(v);
    const upd = await client.query(
      `UPDATE workflows SET ${cols.map((c, i) => `${c} = $${i + 1}${c === 'criteria' ? '::jsonb' : ''}`).join(', ')},
              updated_at = NOW()
        WHERE id = $${cols.length + 1} RETURNING id`,
      [...cols.map(c => (c === 'criteria' ? JSON.stringify(v[c]) : v[c])), req.params.id]
    );
    if (!upd.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Workflow not found' }); }
    await saveActions(client, req.params.id, req.body?.actions);
    await client.query('COMMIT');
    const r = await pool.query(`SELECT ${WORKFLOW_ROW} FROM workflows w WHERE w.id = $1`, [req.params.id]);
    res.json({ success: true, data: { ...r.rows[0], actions: await actionsOf(req.params.id) } });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    fail(res, err);
  } finally { client.release(); }
});

// The inline toggle in the list. Separate from the full save so flipping a
// workflow off does not have to re-post and re-validate the whole thing.
router.patch('/workflows/:id/status', authorize(...WRITE), async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE workflows SET is_active = $1, updated_at = NOW() WHERE id = $2
       RETURNING id, is_active AS "isActive"`,
      [!!req.body?.isActive, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Workflow not found' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { fail(res, err); }
});

// The duplicate icon the reference shows on hover.
router.post('/workflows/:id/duplicate', authorize(...WRITE), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = await client.query(
      `INSERT INTO workflows (record_type, name, description, is_active, trigger_kind,
                              trigger_event, trigger_field, date_field, date_direction,
                              date_months, date_days, execute_at, occurrence, timezone,
                              criteria, sort_order)
       SELECT record_type, LEFT(name || ' (copy)', 150), description,
              -- A copy arrives switched off. Duplicating a live workflow and
              -- having the copy start sending the same mail is not what the
              -- icon promises.
              FALSE, trigger_kind, trigger_event, trigger_field, date_field,
              date_direction, date_months, date_days, execute_at, occurrence,
              timezone, criteria, sort_order
         FROM workflows WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (!created.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Workflow not found' }); }
    await client.query(
      `INSERT INTO workflow_actions (workflow_id, kind, ref_id, sort_order)
       SELECT $1, kind, ref_id, sort_order FROM workflow_actions WHERE workflow_id = $2`,
      [created.rows[0].id, req.params.id]
    );
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: { id: created.rows[0].id } });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    fail(res, err);
  } finally { client.release(); }
});

router.delete('/workflows/:id', authorize(...WRITE), async (req, res) => {
  try {
    const r = await pool.query(`DELETE FROM workflows WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Workflow not found' });
    res.json({ success: true, message: 'Workflow deleted' });
  } catch (err) { fail(res, err); }
});

// ── Email Alerts ───────────────────────────────────────────────────────────
// The rows with an event are the scheduled reminders the Attendance screen
// owns. Automation only ever shows and writes the ones without.
const ALERT_ROW = `
  a.id, a.record_type AS "recordType", a.name, a.description,
  a.from_kind AS "fromKind", a.to_recipients AS "toRecipients",
  a.cc, a.bcc, a.reply_to AS "replyTo", a.subject, a.body,
  a.template_id AS "templateId", t.name AS "templateName"`;

router.get('/alerts', async (req, res) => {
  try {
    const type = req.query.recordType && req.query.recordType !== 'all'
      ? requireType(req.query.recordType).key : null;
    const r = await pool.query(
      `SELECT ${ALERT_ROW} FROM email_alerts a
         LEFT JOIN email_templates t ON t.id = a.template_id
        WHERE a.event IS NULL ${type ? 'AND a.record_type = $1' : ''}
        ORDER BY a.name`,
      type ? [type] : []
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { fail(res, err); }
});

function cleanAlert(b) {
  const type = requireType(b.recordType);
  const kinds = Array.isArray(b.toRecipients?.kinds) ? b.toRecipients.kinds : [];
  for (const k of kinds) if (!RECIPIENT_KEYS.has(k)) throw bad(`'${k}' is not a recipient`);
  if (!kinds.length) throw bad('An alert needs at least one recipient');
  if (kinds.includes('specific') && !(b.toRecipients.emails || []).length) {
    throw bad('Add at least one email address, or the alert reaches nobody');
  }
  if (kinds.includes('role') && !(b.toRecipients.roles || []).length) {
    throw bad('Choose at least one role, or the alert reaches nobody');
  }
  if (b.fromKind && !FROM_KEYS.has(b.fromKind)) throw bad('That is not a From option');

  const addresses = list => (Array.isArray(list) ? list : [])
    .map(e => String(e).trim()).filter(Boolean).slice(0, 25);

  return {
    record_type: type.key,
    name: str(b.name, 'Email alert name', 150),
    description: str(b.description, 'Description', 500, { required: false }),
    from_kind: b.fromKind || 'actor',
    to_recipients: {
      kinds,
      roles: Array.isArray(b.toRecipients.roles) ? b.toRecipients.roles : [],
      emails: addresses(b.toRecipients.emails),
    },
    cc: addresses(b.cc),
    bcc: addresses(b.bcc),
    reply_to: str(b.replyTo, 'Reply To', 255, { required: false }),
    subject: str(b.subject, 'Subject', 255),
    body: String(b.body ?? '').slice(0, 20000) || null,
    template_id: uuidOrNull(b.templateId, 'Template'),
  };
}

const saveAlert = async (values, id) => {
  const cols = Object.keys(values);
  const jsonb = new Set(['to_recipients', 'cc', 'bcc']);
  const val = c => (jsonb.has(c) ? JSON.stringify(values[c]) : values[c]);
  const cast = (c, i) => `$${i + 1}${jsonb.has(c) ? '::jsonb' : ''}`;

  if (id) {
    const r = await pool.query(
      `UPDATE email_alerts SET ${cols.map((c, i) => `${c} = ${cast(c, i)}`).join(', ')}, updated_at = NOW()
        WHERE id = $${cols.length + 1} AND event IS NULL RETURNING id`,
      [...cols.map(val), id]
    );
    return r.rows[0];
  }
  const r = await pool.query(
    `INSERT INTO email_alerts (${cols.join(', ')}) VALUES (${cols.map(cast).join(', ')}) RETURNING id`,
    cols.map(val)
  );
  return r.rows[0];
};

router.post('/alerts', authorize(...WRITE), async (req, res) => {
  try {
    const row = await saveAlert(cleanAlert(req.body || {}));
    invalidate();
    res.status(201).json({ success: true, data: row });
  } catch (err) { fail(res, err); }
});

router.put('/alerts/:id', authorize(...WRITE), async (req, res) => {
  try {
    const row = await saveAlert(cleanAlert(req.body || {}), req.params.id);
    // Guarded on event IS NULL, so this cannot reach a scheduled reminder and
    // rewrite it into a workflow action.
    if (!row) return res.status(404).json({ success: false, message: 'Email alert not found' });
    invalidate();
    res.json({ success: true, data: row });
  } catch (err) { fail(res, err); }
});

router.delete('/alerts/:id', authorize(...WRITE), async (req, res) => {
  try {
    const used = await pool.query(
      `SELECT COUNT(*)::int AS n FROM workflow_actions WHERE kind = 'email_alert' AND ref_id = $1`,
      [req.params.id]
    );
    if (used.rows[0].n > 0) {
      throw bad(`${used.rows[0].n} workflow(s) still run this alert. Remove it from them first.`);
    }
    const r = await pool.query(`DELETE FROM email_alerts WHERE id = $1 AND event IS NULL RETURNING id`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Email alert not found' });
    invalidate();
    res.json({ success: true, message: 'Email alert deleted' });
  } catch (err) { fail(res, err); }
});

// ── Field Updates ──────────────────────────────────────────────────────────
router.get('/field-updates', async (req, res) => {
  try {
    const type = req.query.recordType && req.query.recordType !== 'all'
      ? requireType(req.query.recordType).key : null;
    const r = await pool.query(
      `SELECT id, record_type AS "recordType", name, description,
              target_field AS "targetField", target_value AS "targetValue"
         FROM workflow_field_updates ${type ? 'WHERE record_type = $1' : ''} ORDER BY name`,
      type ? [type] : []
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { fail(res, err); }
});

function cleanFieldUpdate(b) {
  const type = requireType(b.recordType);
  if (!type.writableFields.length) {
    throw bad(`Nothing on ${type.label} can be written by a workflow`);
  }
  const field = str(b.targetField, 'Field', 60);
  const allowed = type.writableFields.find(f => f.key === field);
  if (!allowed) throw bad(`'${field}' is not a field a workflow may write on ${type.label}`);
  const value = str(b.targetValue, 'Value', 255);
  if (allowed.values && !allowed.values.includes(value)) {
    throw bad(`${allowed.label} accepts ${allowed.values.join(', ')}`);
  }
  return {
    record_type: type.key,
    name: str(b.name, 'Field update name', 150),
    description: str(b.description, 'Description', 500, { required: false }),
    target_field: field,
    target_value: value,
  };
}

router.post('/field-updates', authorize(...WRITE), async (req, res) => {
  try {
    const v = cleanFieldUpdate(req.body || {});
    const cols = Object.keys(v);
    const r = await pool.query(
      `INSERT INTO workflow_field_updates (${cols.join(', ')})
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      cols.map(c => v[c])
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) { fail(res, err); }
});

router.put('/field-updates/:id', authorize(...WRITE), async (req, res) => {
  try {
    const v = cleanFieldUpdate(req.body || {});
    const cols = Object.keys(v);
    const r = await pool.query(
      `UPDATE workflow_field_updates SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')}, updated_at = NOW()
        WHERE id = $${cols.length + 1} RETURNING id`,
      [...cols.map(c => v[c]), req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Field update not found' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { fail(res, err); }
});

router.delete('/field-updates/:id', authorize(...WRITE), async (req, res) => {
  try {
    const used = await pool.query(
      `SELECT COUNT(*)::int AS n FROM workflow_actions WHERE kind = 'field_update' AND ref_id = $1`,
      [req.params.id]
    );
    if (used.rows[0].n > 0) {
      throw bad(`${used.rows[0].n} workflow(s) still run this field update. Remove it from them first.`);
    }
    const r = await pool.query(`DELETE FROM workflow_field_updates WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Field update not found' });
    res.json({ success: true, message: 'Field update deleted' });
  } catch (err) { fail(res, err); }
});

// ── Email Templates ────────────────────────────────────────────────────────
// The same table the Attendance screen uses. `service` is what that screen
// scopes by and `record_type` is what this one does; a template can carry
// either, and the list shows whichever it has.
router.get('/templates', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, name, subject, body, service, record_type AS "recordType",
              is_system AS "isSystem"
         FROM email_templates ORDER BY name`
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { fail(res, err); }
});

router.post('/templates', authorize(...WRITE), async (req, res) => {
  try {
    const b = req.body || {};
    const type = b.recordType ? requireType(b.recordType) : null;
    const r = await pool.query(
      `INSERT INTO email_templates (name, subject, body, service, record_type, is_system)
       VALUES ($1, $2, $3, $4, $5, FALSE) RETURNING id`,
      [str(b.name, 'Email template name', 150), str(b.subject, 'Subject', 255),
       String(b.body ?? '').slice(0, 20000), b.service || null, type?.key || null]
    );
    invalidate();
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) { fail(res, err); }
});

router.put('/templates/:id', authorize(...WRITE), async (req, res) => {
  try {
    const b = req.body || {};
    const type = b.recordType ? requireType(b.recordType) : null;
    const r = await pool.query(
      `UPDATE email_templates SET name = $1, subject = $2, body = $3, record_type = $4, updated_at = NOW()
        WHERE id = $5 RETURNING id`,
      [str(b.name, 'Email template name', 150), str(b.subject, 'Subject', 255),
       String(b.body ?? '').slice(0, 20000), type?.key || null, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Template not found' });
    invalidate();
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { fail(res, err); }
});

router.delete('/templates/:id', authorize(...WRITE), async (req, res) => {
  try {
    const t = await pool.query(`SELECT is_system FROM email_templates WHERE id = $1`, [req.params.id]);
    if (!t.rows.length) return res.status(404).json({ success: false, message: 'Template not found' });
    // A system template is one a scheduled reminder is written against.
    if (t.rows[0].is_system) throw bad('That is a built-in template and cannot be deleted');
    const used = await pool.query(`SELECT COUNT(*)::int AS n FROM email_alerts WHERE template_id = $1`, [req.params.id]);
    if (used.rows[0].n > 0) throw bad(`${used.rows[0].n} alert(s) still use this template`);
    await pool.query(`DELETE FROM email_templates WHERE id = $1`, [req.params.id]);
    invalidate();
    res.json({ success: true, message: 'Template deleted' });
  } catch (err) { fail(res, err); }
});

// ── Logs ───────────────────────────────────────────────────────────────────
router.get('/logs', async (req, res) => {
  try {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
    const r = await pool.query(
      `SELECT id, workflow_id AS "workflowId", workflow_name AS "workflowName",
              record_type AS "recordType", record_id AS "recordId",
              subject_name AS "subjectName", trigger_kind AS "triggerKind",
              trigger_event AS "triggerEvent", action_kind AS "actionKind",
              action_name AS "actionName", status, message,
              executed_at AS "executedAt"
         FROM workflow_logs ORDER BY executed_at DESC LIMIT $1`,
      [limit]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { fail(res, err); }
});

router.get('/scheduler-logs', async (req, res) => {
  try {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
    const r = await pool.query(
      `SELECT id, job_key AS "jobKey", name, kind, status, message,
              duration_ms AS "durationMs", executed_at AS "executedAt"
         FROM scheduler_logs ORDER BY executed_at DESC LIMIT $1`,
      [limit]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { fail(res, err); }
});

module.exports = router;
