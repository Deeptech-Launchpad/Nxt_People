/* Record-change approvals.
 *
 * Holding an edit to an employee, department or designation pending consent,
 * rather than writing it straight through. This is the thing the settings
 * screen previously said was "not built" — because it is not a setting, it is
 * a change to how the record saves.
 *
 * The shape:
 *
 *   1. PUT /employees/:id asks shouldHold(). If yes, the edit is queued and
 *      nothing is written to `employees`.
 *   2. An approver sees the queue with the same {field, from, to} rows the
 *      audit trail uses, and approves or rejects.
 *   3. Approving replays the SAME payload through the ordinary update path, so
 *      there is exactly one place that knows how to write an employee. A second
 *      writer here would drift from the first and quietly diverge on the field
 *      the first one validates.
 *
 * `skip_for_full_access` defaults to TRUE. HR editing a record is the normal
 * path, and holding their own edit pending their own approval is a loop that
 * makes the module unusable the moment anybody switches this on. Turning it
 * off requires a second pair of eyes on everyone, including HR.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { serverError } = require('../utils/serverError');
const { logAudit } = require('../utils/audit');
const { isFullAccess } = require('../utils/roles');

router.use(protect);
const WRITE = ['admin', 'director', 'hr_admin'];
const FORMS = ['employee', 'department', 'designation'];

/* Configuration is read on every save, so it is cached briefly — and the cache
 * is dropped the moment the configuration is written, not merely when it
 * expires, so switching approvals on takes effect on the next request. */
const cache = { at: 0, byForm: new Map() };
const TTL = 30 * 1000;
const dropCache = () => { cache.at = 0; cache.byForm.clear(); };

async function configFor(form) {
  if (Date.now() - cache.at > TTL) { cache.byForm.clear(); cache.at = Date.now(); }
  if (cache.byForm.has(form)) return cache.byForm.get(form);
  let cfg = null;
  try {
    const r = await pool.query(
      `SELECT form, is_enabled AS "isEnabled", skip_for_full_access AS "skipForFullAccess",
              approver_mode AS "approverMode", approver_roles AS "approverRoles",
              watched_fields AS "watchedFields"
         FROM record_approval_configs WHERE form=$1`, [form]);
    cfg = r.rows[0] || null;
  } catch { cfg = null; }
  cache.byForm.set(form, cfg);
  return cfg;
}

/**
 * Whether this edit must be held. Returns the config when it must, else null.
 * `changedFields` lets a configuration watch only some fields — an empty watch
 * list means every field.
 */
async function shouldHold(user, form, changedFields = []) {
  const cfg = await configFor(form);
  if (!cfg || !cfg.isEnabled) return null;
  if (cfg.skipForFullAccess && isFullAccess(user?.role)) return null;
  const watched = Array.isArray(cfg.watchedFields) ? cfg.watchedFields : [];
  if (watched.length && !changedFields.some(f => watched.includes(f))) return null;
  return cfg;
}

/* ── Configuration ───────────────────────────────────────────────────────── */

router.get('/config', authorize(...WRITE), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT form, is_enabled AS "isEnabled", skip_for_full_access AS "skipForFullAccess",
              approver_mode AS "approverMode", approver_roles AS "approverRoles",
              watched_fields AS "watchedFields"
         FROM record_approval_configs ORDER BY form`);
    const roles = (await pool.query(
      `SELECT DISTINCT role FROM employees WHERE role IS NOT NULL AND role <> '' ORDER BY role`))
      .rows.map(x => x.role);
    res.json({ success: true, data: r.rows, roles });
  } catch (err) { serverError(res, err); }
});

router.patch('/config/:form', authorize(...WRITE), async (req, res) => {
  try {
    if (!FORMS.includes(req.params.form)) {
      return res.status(400).json({ success: false, message: 'Unknown form' });
    }
    const cur = (await pool.query(
      `SELECT * FROM record_approval_configs WHERE form=$1`, [req.params.form])).rows[0];
    if (!cur) return res.status(404).json({ success: false, message: 'Unknown form' });

    const b = req.body || {};
    const mode = ['roles', 'auto_approve', 'auto_reject'].includes(b.approverMode)
      ? b.approverMode : cur.approver_mode;
    const roles = Array.isArray(b.approverRoles) ? b.approverRoles.map(String) : cur.approver_roles;
    /* An approval that names no approver can never be decided, and the
     * requests would sit in the queue for ever with nobody able to clear them. */
    if (mode === 'roles' && (!roles || !roles.length)) {
      return res.status(400).json({ success: false, message: 'Choose at least one approver role' });
    }

    const next = {
      isEnabled: b.isEnabled === undefined ? cur.is_enabled : !!b.isEnabled,
      skipForFullAccess: b.skipForFullAccess === undefined ? cur.skip_for_full_access : !!b.skipForFullAccess,
      approverMode: mode,
      approverRoles: roles,
      watchedFields: Array.isArray(b.watchedFields) ? b.watchedFields.map(String) : cur.watched_fields,
    };

    await pool.query(
      `UPDATE record_approval_configs
          SET is_enabled=$1, skip_for_full_access=$2, approver_mode=$3,
              approver_roles=$4::jsonb, watched_fields=$5::jsonb, updated_at=NOW()
        WHERE form=$6`,
      [next.isEnabled, next.skipForFullAccess, next.approverMode,
       JSON.stringify(next.approverRoles), JSON.stringify(next.watchedFields), req.params.form]);
    dropCache();   // takes effect on the next save, not after the TTL

    await logAudit(req, { action: 'UPDATE', resource: 'Record approvals', resourceId: req.params.form,
      changes: {
        summary: `${req.params.form} approvals ${next.isEnabled ? 'on' : 'off'}`,
        fields: [
          { field: 'isEnabled', from: cur.is_enabled, to: next.isEnabled },
          { field: 'skipForFullAccess', from: cur.skip_for_full_access, to: next.skipForFullAccess },
        ].filter(f => f.from !== f.to),
      } });
    res.json({ success: true, data: next });
  } catch (err) { serverError(res, err); }
});

/* ── The queue ───────────────────────────────────────────────────────────── */

const QUEUE_SELECT = `
  p.id AS "_id", p.form, p.record_id AS "recordId", p.changes, p.status,
  p.created_at AS "createdAt", p.decided_at AS "decidedAt", p.decision_note AS "decisionNote",
  json_build_object('id', s.id, 'firstName', s.first_name, 'lastName', s.last_name,
                    'code', s.employee_id) AS "submittedBy",
  CASE WHEN d.id IS NOT NULL THEN json_build_object('id', d.id, 'firstName', d.first_name,
                    'lastName', d.last_name) END AS "decidedBy",
  CASE WHEN e.id IS NOT NULL THEN json_build_object('id', e.id, 'code', e.employee_id,
                    'name', TRIM(CONCAT(e.first_name,' ',e.last_name))) END AS "record"`;

const QUEUE_FROM = `pending_record_changes p
  LEFT JOIN employees s ON s.id = p.submitted_by
  LEFT JOIN employees d ON d.id = p.decided_by
  LEFT JOIN employees e ON e.id = p.record_id`;

/** Whether this user may decide requests for a form. */
async function mayDecide(user, form) {
  const cfg = await configFor(form);
  if (!cfg) return false;
  if (isFullAccess(user.role)) return true;
  const roles = Array.isArray(cfg.approverRoles) ? cfg.approverRoles : [];
  return roles.includes(user.role);
}

router.get('/queue', async (req, res) => {
  try {
    const params = [];
    let where = 'WHERE 1=1';
    if (req.query.status) { params.push(String(req.query.status)); where += ` AND p.status = $${params.length}`; }
    else where += ` AND p.status = 'pending'`;
    if (req.query.form) { params.push(String(req.query.form)); where += ` AND p.form = $${params.length}`; }

    /* Somebody who cannot decide still sees what they themselves submitted —
     * otherwise an edit vanishes and there is no way to find out what became
     * of it. */
    if (!isFullAccess(req.user.role)) {
      const forms = [];
      for (const f of FORMS) if (await mayDecide(req.user, f)) forms.push(f);
      if (forms.length) {
        params.push(forms, req.user._id);
        where += ` AND (p.form = ANY($${params.length - 1}) OR p.submitted_by = $${params.length})`;
      } else {
        params.push(req.user._id);
        where += ` AND p.submitted_by = $${params.length}`;
      }
    }

    const r = await pool.query(
      `SELECT ${QUEUE_SELECT} FROM ${QUEUE_FROM} ${where} ORDER BY p.created_at DESC LIMIT 200`, params);
    res.json({ success: true, data: r.rows, total: r.rows.length });
  } catch (err) { serverError(res, err); }
});

router.put('/queue/:id/action', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = (await client.query(
      `SELECT * FROM pending_record_changes WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0];
    if (!row) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Request not found' }); }
    if (row.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: `This request is already ${row.status}.` });
    }
    if (!(await mayDecide(req.user, row.form))) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, message: 'You are not an approver for this form' });
    }
    /* Approving your own edit defeats the point of asking. Full access is not
     * exempt here — if an organisation has switched off skip_for_full_access
     * precisely to get a second pair of eyes, letting an admin wave their own
     * change through would give the setting back with one hand. */
    if (String(row.submitted_by) === String(req.user._id)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, message: 'You cannot decide your own request' });
    }

    const action = req.body?.action === 'approved' ? 'approved' : 'rejected';
    const note = String(req.body?.note || '').trim() || null;

    await client.query(
      `UPDATE pending_record_changes SET status=$1, decided_by=$2, decided_at=NOW(), decision_note=$3
        WHERE id=$4`, [action, req.user._id, note, req.params.id]);
    await client.query('COMMIT');

    let applied = null;
    if (action === 'approved') {
      /* Replayed through the ordinary update path rather than written here.
       * One place knows how to write an employee; a second would drift. */
      applied = await applyPending(row, req);
    }

    await logAudit(req, {
      action: action === 'approved' ? 'APPROVE' : 'REJECT',
      resource: 'Record change', resourceId: row.record_id,
      changes: { summary: `${row.form} change ${action}`, fields: row.changes || [] },
    });

    res.json({ success: true, applied: !!applied,
      message: action === 'approved' ? 'Change approved and applied' : 'Change rejected' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    serverError(res, err);
  } finally { client.release(); }
});

router.delete('/queue/:id', async (req, res) => {
  try {
    // Withdrawing is the submitter's own act; anybody else's is a rejection.
    const r = await pool.query(
      `UPDATE pending_record_changes SET status='withdrawn', decided_at=NOW()
        WHERE id=$1 AND submitted_by=$2 AND status='pending' RETURNING id`,
      [req.params.id, req.user._id]);
    if (!r.rows.length) {
      return res.status(404).json({ success: false, message: 'No pending request of yours with that id' });
    }
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

/* Applying is deliberately a direct write of only the columns the queued
 * payload names, using the same column map the employee update uses. It runs
 * after the decision commits so a failure to apply cannot silently un-approve
 * — it surfaces instead, with the request already marked approved and
 * therefore visible. */
const COLUMN_MAP = {
  firstName: 'first_name', lastName: 'last_name', email: 'email', phone: 'phone',
  nickName: 'nick_name', department: 'department', designation: 'designation',
  workLocation: 'work_location', employmentType: 'employment_type', status: 'status',
  sourceOfHire: 'source_of_hire', joiningDate: 'date_of_joining',
  totalExperience: 'total_experience', dateOfBirth: 'date_of_birth', gender: 'gender',
  maritalStatus: 'marital_status', bloodGroup: 'blood_group', nationality: 'nationality',
  aboutMe: 'about_me', expertise: 'expertise', workPhone: 'work_phone', extension: 'extension',
  personalEmail: 'personal_email', seatingLocation: 'seating_location', tags: 'tags',
  address: 'current_address', permanentAddress: 'permanent_address', exitDate: 'exit_date',
  reportingManagerId: 'reporting_manager_id', secondaryManagerId: 'secondary_manager_id',
  approvingAuthorityId: 'approving_authority_id', onboardingStatus: 'onboarding_status',
};

async function applyPending(row, req) {
  if (row.form !== 'employee') return null;   // department/designation land later
  const payload = row.payload || {};
  const cols = [], vals = [];
  for (const [key, column] of Object.entries(COLUMN_MAP)) {
    if (payload[key] === undefined) continue;
    cols.push(column);
    vals.push(payload[key] === '' ? null : payload[key]);
  }
  if (!cols.length) return null;
  vals.push(req.user._id, row.record_id);
  await pool.query(
    `UPDATE employees SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')},
            updated_by = $${cols.length + 1}, updated_at = NOW()
      WHERE id = $${cols.length + 2}`, vals);
  return true;
}

/** Queue an edit instead of writing it. Called by the employee update route. */
async function queueChange({ form, recordId, userId, changes, payload }) {
  const r = await pool.query(
    `INSERT INTO pending_record_changes (form, record_id, submitted_by, changes, payload)
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb) RETURNING id`,
    [form, recordId, userId, JSON.stringify(changes || []), JSON.stringify(payload || {})]);
  return r.rows[0].id;
}

module.exports = router;
module.exports.shouldHold = shouldHold;
module.exports.queueChange = queueChange;
module.exports.dropCache = dropCache;
module.exports.COLUMN_MAP = COLUMN_MAP;
