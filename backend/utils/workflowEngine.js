/* ── The workflow engine ───────────────────────────────────────────────────
 *  A route calls fire() when something happens. The engine finds the active
 *  workflows for that record type and event, tests their criteria, and runs
 *  their actions.
 *
 *  THE RULE THAT MATTERS: a workflow can never fail the thing that triggered
 *  it. Approving a leave request must approve the leave request, whatever a
 *  badly-written workflow does afterwards. So fire() is not awaited by its
 *  caller, every stage is wrapped, and the outcome — including "the criteria
 *  did not match" — is written to workflow_logs instead of thrown. A workflow
 *  that silently did nothing and a workflow that blew up look identical from
 *  the outside otherwise.
 *
 *  Field updates are restricted to the whitelist in workflowCatalog. Anything
 *  else would let whoever can edit a workflow write any column of any table.
 * ───────────────────────────────────────────────────────────────────────── */

const pool = require('../db');
const logger = require('../logger');
const { recordType, isWritable } = require('./workflowCatalog');
const { render } = require('./automationConfig');

// ── Criteria ───────────────────────────────────────────────────────────────
// Same shape and the same operators as approvalRules, so a condition means one
// thing across the application.
function testCondition(cond, context) {
  const actual = context?.[cond.field];
  if (actual === undefined || actual === null) return false;
  const expected = cond.value;

  const bothNumeric = !Number.isNaN(Number(actual)) && !Number.isNaN(Number(expected))
    && String(actual).trim() !== '' && String(expected).trim() !== '';
  const a = bothNumeric ? Number(actual) : String(actual).toLowerCase();
  const b = bothNumeric ? Number(expected) : String(expected).toLowerCase();

  switch (cond.operator) {
    case 'is':       return a === b;
    case 'is_not':   return a !== b;
    case 'contains': return String(actual).toLowerCase().includes(String(expected).toLowerCase());
    case 'gt':       return a > b;
    case 'gte':      return a >= b;
    case 'lt':       return a < b;
    case 'lte':      return a <= b;
    default:         return false;
  }
}

// Every condition must hold. No criteria means the workflow matches everything,
// which is what an empty Criteria section in the reference means.
const criteriaMatch = (criteria, context) =>
  !Array.isArray(criteria) || criteria.length === 0
    ? true
    : criteria.every(c => testCondition(c, context));

// ── Logging ────────────────────────────────────────────────────────────────
async function log(entry) {
  try {
    await pool.query(
      `INSERT INTO workflow_logs
         (workflow_id, workflow_name, record_type, record_id, subject_name,
          trigger_kind, trigger_event, action_kind, action_name, status, message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [entry.workflowId || null, entry.workflowName, entry.recordType, entry.recordId || null,
       entry.subjectName || null, entry.triggerKind || null, entry.triggerEvent || null,
       entry.actionKind || null, entry.actionName || null, entry.status, entry.message || null]
    );
  } catch (err) {
    // The log failing must not take the engine down with it.
    logger.error({ err: err.message }, 'Could not write a workflow log entry');
  }
}

// ── Recipients ─────────────────────────────────────────────────────────────
// An address list built from the record, not from a stored copy of it — a
// manager who changed since the workflow was written must get the mail.
async function resolveRecipients(spec, ctx) {
  const emails = new Set();
  const add = rows => rows.forEach(r => r.email && emails.add(r.email));

  const kinds = Array.isArray(spec?.kinds) ? spec.kinds : [];

  if (kinds.includes('record_owner') && ctx.employeeId) {
    add((await pool.query(
      `SELECT email FROM employees WHERE id = $1 AND deleted_at IS NULL`, [ctx.employeeId])).rows);
  }
  if (kinds.includes('reporting_manager') && ctx.employeeId) {
    add((await pool.query(
      `SELECT m.email FROM employees e JOIN employees m ON m.id = e.reporting_manager_id
        WHERE e.id = $1 AND m.deleted_at IS NULL AND m.status = 'active'`, [ctx.employeeId])).rows);
  }
  if (kinds.includes('approving_authority') && ctx.employeeId) {
    add((await pool.query(
      `SELECT a.email FROM employees e JOIN employees a ON a.id = e.approving_authority_id
        WHERE e.id = $1 AND a.deleted_at IS NULL AND a.status = 'active'`, [ctx.employeeId])).rows);
  }
  if (kinds.includes('department_head') && ctx.employeeId) {
    add((await pool.query(
      `SELECT h.email FROM employees e
         JOIN departments d ON d.id = e.department_id
         JOIN employees h ON h.id = d.head_id
        WHERE e.id = $1 AND h.deleted_at IS NULL AND h.status = 'active'`, [ctx.employeeId])).rows);
  }
  if (kinds.includes('actor') && ctx.actorId) {
    add((await pool.query(
      `SELECT email FROM employees WHERE id = $1 AND deleted_at IS NULL`, [ctx.actorId])).rows);
  }
  if (kinds.includes('role') && spec.roles?.length) {
    add((await pool.query(
      `SELECT email FROM employees
        WHERE role = ANY($1) AND deleted_at IS NULL AND status = 'active' AND email <> ''`,
      [spec.roles])).rows);
  }
  if (kinds.includes('all_employees')) {
    add((await pool.query(
      `SELECT email FROM employees
        WHERE deleted_at IS NULL AND status = 'active' AND email IS NOT NULL AND email <> ''`)).rows);
  }
  if (kinds.includes('specific') && spec.emails?.length) {
    spec.emails.forEach(e => String(e).trim() && emails.add(String(e).trim()));
  }

  return [...emails];
}

// ── Actions ────────────────────────────────────────────────────────────────
async function runEmailAlert(alert, wf, ctx) {
  const to = await resolveRecipients(alert.to_recipients, ctx);
  if (!to.length) {
    return { status: 'skipped', message: 'The alert resolved to nobody, so nothing was sent' };
  }

  const subject = render(alert.subject || '', ctx.merge);
  const body = render(alert.body || '', ctx.merge);

  // Required lazily: pulling the mailer in at module load drags nodemailer
  // into every process that touches the engine, including the migrations.
  const { sendMail } = require('./mailer');
  if (typeof sendMail !== 'function') {
    return { status: 'failed', message: 'No mail transport is configured' };
  }
  // Arrays, not joined strings: the mailer's sanitiser validates each address
  // and hands nodemailer the list, which is what closes the header-injection
  // hole a comma-joined string reopens.
  await sendMail({
    to,
    cc: alert.cc || [],
    bcc: alert.bcc || [],
    replyTo: alert.reply_to ? [alert.reply_to] : [],
    subject,
    html: body,
  });
  return { status: 'success', message: `Sent to ${to.length} recipient(s)` };
}

async function runFieldUpdate(update, wf, ctx) {
  const type = recordType(wf.record_type);
  if (!type) return { status: 'failed', message: `Unknown record type '${wf.record_type}'` };

  // The whitelist is the whole point. A stored field update whose target has
  // since been taken off the list must stop working, not keep writing.
  if (!isWritable(wf.record_type, update.target_field)) {
    return { status: 'failed', message: `'${update.target_field}' is not a field a workflow may write` };
  }
  if (!ctx.recordId) {
    return { status: 'skipped', message: 'No record id was supplied for this trigger' };
  }

  const allowed = type.writableFields.find(f => f.key === update.target_field);
  if (allowed?.values && !allowed.values.includes(update.target_value)) {
    return { status: 'failed', message: `'${update.target_value}' is not a value ${allowed.label} accepts` };
  }

  const r = await pool.query(
    `UPDATE ${type.table} SET ${update.target_field} = $1, updated_at = NOW() WHERE id = $2 RETURNING id`,
    [update.target_value, ctx.recordId]
  );
  return r.rows.length
    ? { status: 'success', message: `${allowed.label} set to ${update.target_value}` }
    : { status: 'skipped', message: 'The record was gone by the time the workflow ran' };
}

// ── Context ────────────────────────────────────────────────────────────────
// Loaded here rather than by the caller, so a hook in a route is one line with
// no await: `fire('leave', 'approved', { recordId, actorId })`. A route that
// had to assemble this itself is a route that will assemble it differently in
// the next place.
const iso = d => (d instanceof Date ? d.toISOString().slice(0, 10) : (d ? String(d).slice(0, 10) : null));

const SELECTS = {
  employee: `SELECT e.id, e.id AS employee_id, e.department, e.designation,
                    e.work_location, e.role, e.status, e.employment_type,
                    e.joining_date, e.employee_id AS code, e.email
               FROM employees e WHERE e.id = $1`,
  leave: `SELECT l.id, l.employee_id, l.leave_type, l.start_date, l.end_date,
                 l.total_days, l.reason, l.status
            FROM leaves l WHERE l.id = $1`,
  regularization: `SELECT r.id, r.employee_id, r.date, r.reason, r.status
                     FROM attendance_regularizations r WHERE r.id = $1`,
  on_duty: `SELECT o.id, o.employee_id, o.start_date, o.end_date, o.request_type, o.status
              FROM on_duty_requests o WHERE o.id = $1`,
  comp_off: `SELECT c.id, c.employee_id, c.worked_date, c.days_earned, c.status
               FROM comp_off_requests c WHERE c.id = $1`,
  wfh: `SELECT w.id, w.employee_id, w.date, w.status FROM wfh_requests w WHERE w.id = $1`,
};

const CRITERIA_OF = {
  employee: r => ({
    department: r.department, designation: r.designation, workLocation: r.work_location,
    role: r.role, status: r.status, employmentType: r.employment_type,
  }),
  leave: r => ({
    leaveType: r.leave_type, days: Number(r.total_days) || 0,
    startDate: iso(r.start_date), endDate: iso(r.end_date), status: r.status,
  }),
  regularization: r => ({
    date: iso(r.date), reason: r.reason, status: r.status,
    ageInDays: r.date ? Math.floor((Date.now() - new Date(iso(r.date)).getTime()) / 86400000) : null,
  }),
  on_duty: r => ({
    startDate: iso(r.start_date), endDate: iso(r.end_date),
    requestType: r.request_type, status: r.status,
  }),
  comp_off: r => ({ date: iso(r.worked_date), daysEarned: Number(r.days_earned) || 0, status: r.status }),
  wfh: r => ({ date: iso(r.date), status: r.status }),
};

async function loadContext(recordTypeKey, ctx) {
  const out = { ...ctx, criteria: {}, merge: {} };
  const sql = SELECTS[recordTypeKey];
  if (!sql || !ctx.recordId) return out;

  const row = (await pool.query(sql, [ctx.recordId])).rows[0];
  if (!row) return out;

  out.employeeId = row.employee_id;
  out.criteria = CRITERIA_OF[recordTypeKey](row);

  // Whoever the record is about, plus their manager — the two names nearly
  // every alert wants to say.
  let who = null;
  if (row.employee_id) {
    who = (await pool.query(
      `SELECT TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS name, e.employee_id AS code,
              e.email, e.department, e.designation, e.work_location,
              e.joining_date,
              TRIM(CONCAT(m.first_name, ' ', m.last_name)) AS manager
         FROM employees e LEFT JOIN employees m ON m.id = e.reporting_manager_id
        WHERE e.id = $1`, [row.employee_id])).rows[0];
  }
  out.subjectName = who?.name || null;
  out.merge = {
    ...out.criteria,
    employeeName: who?.name || '', employeeId: who?.code || '', email: who?.email || '',
    department: who?.department || '', designation: who?.designation || '',
    workLocation: who?.work_location || '', joiningDate: iso(who?.joining_date) || '',
    managerName: who?.manager || '',
  };
  return out;
}

// ── Running a workflow's actions ───────────────────────────────────────────
// Shared by both paths. Two copies of this loop is two places for "one action
// failing must not stop the others" to stop being true.
async function runActions(wf, ctx, base, preloaded) {
  const actions = preloaded || (await pool.query(
    `SELECT kind, ref_id FROM workflow_actions WHERE workflow_id = $1 ORDER BY sort_order`,
    [wf.id])).rows;

  if (!actions.length) {
    await log({ ...base, status: 'skipped', message: 'The workflow has no actions' });
    return;
  }

  for (const action of actions) {
    let name = null;
    try {
      if (action.kind === 'email_alert') {
        const a = (await pool.query(`SELECT * FROM email_alerts WHERE id = $1`, [action.ref_id])).rows[0];
        if (!a) { await log({ ...base, actionKind: action.kind, status: 'failed', message: 'The email alert has been deleted' }); continue; }
        name = a.name;
        await log({ ...base, actionKind: action.kind, actionName: name, ...(await runEmailAlert(a, wf, ctx)) });
      } else if (action.kind === 'field_update') {
        const u = (await pool.query(`SELECT * FROM workflow_field_updates WHERE id = $1`, [action.ref_id])).rows[0];
        if (!u) { await log({ ...base, actionKind: action.kind, status: 'failed', message: 'The field update has been deleted' }); continue; }
        name = u.name;
        await log({ ...base, actionKind: action.kind, actionName: name, ...(await runFieldUpdate(u, wf, ctx)) });
      }
    } catch (err) {
      // One action failing must not stop the others, and must not reach the
      // caller. It is recorded and the loop carries on.
      await log({ ...base, actionKind: action.kind, actionName: name, status: 'failed', message: err.message });
    }
  }
}

// ── Firing ─────────────────────────────────────────────────────────────────
/**
 * Run the workflows for one event.
 *
 * Deliberately returns a promise nobody has to await. Callers use
 * `fireAndForget`, so an approval route answers the moment the approval is
 * committed and a slow SMTP server cannot hold it open.
 */
async function run(recordTypeKey, event, rawCtx = {}) {
  const workflows = await pool.query(
    `SELECT * FROM workflows
      WHERE record_type = $1 AND trigger_kind = 'action' AND is_active = TRUE
        AND (trigger_event = $2 OR (trigger_event = 'created_or_edited' AND $2 IN ('created', 'edited')))
      ORDER BY sort_order, created_at`,
    [recordTypeKey, event]
  );
  // Nothing to do is the overwhelmingly common case — there are no workflows
  // until somebody makes one — so the record is not loaded until it is needed.
  if (!workflows.rows.length) return;

  const ctx = await loadContext(recordTypeKey, rawCtx);

  for (const wf of workflows.rows) {
    const base = {
      workflowId: wf.id, workflowName: wf.name, recordType: wf.record_type,
      recordId: ctx.recordId, subjectName: ctx.subjectName,
      triggerKind: 'action', triggerEvent: event,
    };

    // "Specific field is updated" only fires for that field.
    if (wf.trigger_event === 'field_updated'
        && wf.trigger_field && !(ctx.changedFields || []).includes(wf.trigger_field)) {
      continue;
    }

    if (!criteriaMatch(wf.criteria, ctx.criteria || {})) {
      await log({ ...base, status: 'skipped', message: 'The criteria did not match this record' });
      continue;
    }

    const actions = await pool.query(
      `SELECT a.kind, a.ref_id FROM workflow_actions a
        WHERE a.workflow_id = $1 ORDER BY a.sort_order`, [wf.id]);

    if (!actions.rows.length) {
      await log({ ...base, status: 'skipped', message: 'The workflow has no actions' });
      continue;
    }

    await runActions(wf, ctx, base, actions.rows);
  }
}

/**
 * What routes call. Never throws, never has to be awaited.
 *
 * The whole reason this wrapper exists: `await fire(...)` inside an approval
 * route would let a slow or broken workflow delay — or with an unhandled
 * rejection, fail — the approval itself.
 */
function fire(recordTypeKey, event, ctx = {}) {
  Promise.resolve()
    .then(() => run(recordTypeKey, event, ctx))
    .catch(err => logger.error(
      { err: err.message, recordTypeKey, event }, 'Workflow run failed outright'));
}

// ── Date-based workflows ───────────────────────────────────────────────────
// A date workflow says "one day before the exit date, at 09:00". The sweep
// turns that around: for each workflow, work out which date a record must
// carry for today to be its firing day, then find the records carrying it.
//
// Runs on a schedule rather than continuously, so it fires for any workflow
// whose time of execution falls inside the window since the last run. Without
// the window a sweep that ran a minute late would skip the whole day.
const { recordType: typeOf } = require('./workflowCatalog');

const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function targetDateFor(wf, today) {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  // "1 day BEFORE the exit date" fires today for a record dated tomorrow, so
  // the offset is added; "after" looks backwards. Getting this the wrong way
  // round is the classic way these fire on the wrong day.
  const sign = wf.date_direction === 'before' ? 1 : wf.date_direction === 'after' ? -1 : 0;
  if (sign) {
    d.setMonth(d.getMonth() + sign * (wf.date_months || 0));
    d.setDate(d.getDate() + sign * (wf.date_days || 0));
  }
  return ymd(d);
}

/**
 * @param windowMinutes how far back to look for a workflow's execution time.
 *        Should match the interval this is called on.
 */
async function sweepDateWorkflows({ now = new Date(), windowMinutes = 60 } = {}) {
  const summary = { considered: 0, fired: 0, skipped: 0 };
  const workflows = await pool.query(
    `SELECT * FROM workflows WHERE trigger_kind = 'date' AND is_active = TRUE ORDER BY sort_order`
  );
  if (!workflows.rows.length) return summary;

  const minutesNow = now.getHours() * 60 + now.getMinutes();

  for (const wf of workflows.rows) {
    const [h, m] = String(wf.execute_at || '09:00').split(':').map(Number);
    const due = h * 60 + m;
    // Inside the window that has elapsed since the previous sweep.
    if (!(due <= minutesNow && due > minutesNow - windowMinutes)) continue;

    const type = typeOf(wf.record_type);
    if (!type || !type.dateFields.some(f => f.key === wf.date_field)) {
      await log({
        workflowId: wf.id, workflowName: wf.name, recordType: wf.record_type,
        triggerKind: 'date', status: 'failed',
        message: `'${wf.date_field}' is not a date field on this record type`,
      });
      continue;
    }

    const target = targetDateFor(wf, now);
    // Only live records. A resigned employee's joining anniversary is not an
    // anniversary, and a soft-deleted one is not there at all.
    const scope = type.key === 'employee'
      ? `AND t.deleted_at IS NULL AND t.status = 'active'`
      : '';
    const rows = await pool.query(
      `SELECT t.id FROM ${type.table} t WHERE t.${wf.date_field}::date = $1::date ${scope}`,
      [target]
    );

    for (const row of rows.rows) {
      summary.considered++;
      // Same workflow, same record, already handled today. A sweep that
      // overlaps its predecessor must not send the mail twice.
      const already = await pool.query(
        `SELECT 1 FROM workflow_logs
          WHERE workflow_id = $1 AND record_id = $2 AND executed_at::date = CURRENT_DATE
          LIMIT 1`,
        [wf.id, row.id]
      );
      if (already.rows.length) { summary.skipped++; continue; }

      const ctx = await loadContext(wf.record_type, { recordId: row.id });
      const base = {
        workflowId: wf.id, workflowName: wf.name, recordType: wf.record_type,
        recordId: row.id, subjectName: ctx.subjectName, triggerKind: 'date',
      };
      if (!criteriaMatch(wf.criteria, ctx.criteria)) {
        await log({ ...base, status: 'skipped', message: 'The criteria did not match this record' });
        summary.skipped++;
        continue;
      }
      await runActions(wf, ctx, base);
      summary.fired++;
    }
  }
  return summary;
}

module.exports = { fire, run, loadContext, sweepDateWorkflows, targetDateFor, criteriaMatch, testCondition, resolveRecipients, log };
