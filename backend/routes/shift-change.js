/**
 * routes/shift-change.js
 * Shift Change Request — the form the reference's Shifts → Approvals hangs
 * off, and the reason that tab could not be built until now.
 *
 * An employee asks to move from one shift to another. It routes through the
 * approval chain every other request uses, and on approval the shift ACTUALLY
 * CHANGES — which is the part that makes it more than a record.
 *
 *   temporary  writes shift_roster rows for the dates asked for. Attendance
 *              resolves against the roster, so the change applies to exactly
 *              those days and the standing shift is untouched.
 *   permanent  writes employees.shift_id, the same thing assigning a shift by
 *              hand does.
 *
 * "Approved" and "applied" are recorded separately. A change that was approved
 * but could not be applied — because the shift was deleted in between — must
 * be visible as exactly that, not as a success.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const logger = require('../logger');
const { protect, authorize } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const {
  createLevels, canUserAct, applyApproval, applyRejection, approvalLevelsJson,
} = require('../utils/leaveApproval');
const { isFullAccess, reportsScope } = require('../utils/roles');
const { fire } = require('../utils/workflowEngine');
const { shiftConfig } = require('../utils/shiftConfig');
const { createNotification } = require('./notifications');
const { sendMail } = require('../utils/mailer');

router.use(protect);

const APPROVERS = ['admin', 'director', 'hr_admin', 'manager', 'team_incharge'];

class Invalid extends Error {
  constructor(message) { super(message); this.expected = true; }
}
const bad = m => new Invalid(m);

const fail = (res, err) => {
  if (err.expected) return res.status(400).json({ success: false, message: err.message });
  logger.error({ err: err.message, code: err.code }, 'Shift change request failed');
  return res.status(500).json({ success: false, message: 'An internal server error occurred' });
};

const ROW = `
  r.id, r.employee_id AS "employeeId", r.from_shift_id AS "fromShiftId",
  r.to_shift_id AS "toShiftId", r.change_type AS "changeType",
  r.start_date AS "startDate", r.end_date AS "endDate", r.reason, r.status,
  r.rejection_reason AS "rejectionReason", r.applied_at AS "appliedAt",
  r.applied_note AS "appliedNote", r.created_at AS "createdAt",
  f.name AS "fromShift", t.name AS "toShift", t.color AS "toColor",
  TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS "employeeName",
  e.employee_id AS "employeeCode"`;

const FROM = `
  FROM shift_change_requests r
  JOIN employees e ON e.id = r.employee_id
  LEFT JOIN shifts f ON f.id = r.from_shift_id
  LEFT JOIN shifts t ON t.id = r.to_shift_id`;

// Local date parts, never toISOString. pg hands back a DATE as a Date at
// LOCAL midnight; toISOString converts to UTC, which east of Greenwich is the
// previous day — so a change asked for on the 1st rostered the 31st.
const ymd = d => (d instanceof Date
  ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  : String(d).slice(0, 10));

// And a plain 'YYYY-MM-DD' parses as UTC midnight, so it is built from parts
// too — otherwise the loop below starts a day early all over again.
const localDate = str => {
  const [y, m, d] = String(str).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** What an approval rule tests a request against. */
const contextOf = row => ({
  changeType: row.changeType,
  startDate: ymd(row.startDate),
  endDate: row.endDate ? ymd(row.endDate) : null,
  toShift: row.toShift,
  days: row.endDate
    ? Math.round((localDate(ymd(row.endDate)) - localDate(ymd(row.startDate))) / 86400000) + 1
    : 1,
});

router.get('/my', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT ${ROW} ${FROM} WHERE r.employee_id = $1 ORDER BY r.created_at DESC LIMIT 100`,
      [req.user._id]);
    res.json({ success: true, data: r.rows });
  } catch (err) { fail(res, err); }
});

router.get('/pending', authorize(...APPROVERS), async (req, res) => {
  try {
    // Managers see their own reports, full access sees everyone — the same
    // scoping every other pending list uses.
    const scope = reportsScope(req.user, 'e', 1);
    const r = await pool.query(
      `SELECT ${ROW} ${FROM} WHERE r.status = 'pending'${scope.clause}
        ORDER BY r.created_at`, scope.params);
    const out = [];
    for (const row of r.rows) {
      out.push({ ...row, approvals: await approvalLevelsJson(pool, 'shift_change', row.id) });
    }
    res.json({ success: true, data: out });
  } catch (err) { fail(res, err); }
});

router.post('/', audit('CREATE', 'shift_change_request'), async (req, res) => {
  const client = await pool.connect();
  try {
    const b = req.body || {};
    const changeType = b.changeType === 'permanent' ? 'permanent' : 'temporary';
    const toShiftId = b.toShiftId;
    if (!toShiftId) throw bad('Choose the shift to move to');
    if (!b.startDate) throw bad('A start date is required');
    if (changeType === 'temporary' && !b.endDate) {
      throw bad('A temporary change needs an end date, or it never ends');
    }
    if (b.endDate && b.endDate < b.startDate) throw bad('The end date cannot be before the start date');

    // Shifts > General > "Make reason mandatory for shift change". Stored and
    // ignored until now, so the switch changed nothing either way.
    const cfg = await shiftConfig();
    if (cfg.reasonMandatoryOnShiftChange && !String(b.reason || '').trim()) {
      throw bad('A reason for the shift change is required');
    }

    const me = (await client.query(
      `SELECT shift_id FROM employees WHERE id = $1`, [req.user._id])).rows[0];
    if (me?.shift_id === toShiftId) throw bad('You are already on that shift');

    const shift = await client.query(`SELECT id FROM shifts WHERE id = $1`, [toShiftId]);
    if (!shift.rows.length) throw bad('That shift no longer exists');

    // Overlapping pending requests would race each other at approval time.
    const clash = await client.query(
      `SELECT 1 FROM shift_change_requests
        WHERE employee_id = $1 AND status = 'pending'
          AND start_date <= COALESCE($3::date, $2::date)
          AND COALESCE(end_date, start_date) >= $2::date
        LIMIT 1`,
      [req.user._id, b.startDate, b.endDate || null]);
    if (clash.rows.length) throw bad('You already have a shift change request pending over those dates');

    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO shift_change_requests
         (employee_id, from_shift_id, to_shift_id, change_type, start_date, end_date, reason)
       VALUES ($1, $2, $3, $4, $5::date, $6, $7) RETURNING id`,
      [req.user._id, me?.shift_id || null, toShiftId, changeType,
       b.startDate, b.endDate || null, String(b.reason || '').trim() || null]
    );
    const id = ins.rows[0].id;

    const full = (await client.query(`SELECT ${ROW} ${FROM} WHERE r.id = $1`, [id])).rows[0];
    // The approval chain is derived from the rule for this form, exactly as it
    // is for leave. An auto-approve rule settles it inside createLevels.
    await createLevels(client, 'shift_change', id, req.user._id, contextOf(full));
    await client.query('COMMIT');

    // An auto rule may already have settled it, in which case the change has
    // to be applied now rather than waiting for an approval that never comes.
    const settled = (await pool.query(`SELECT status FROM shift_change_requests WHERE id = $1`, [id])).rows[0];
    if (settled.status === 'approved') await applyChange(id);

    fire('shift_change', 'created', { recordId: id, actorId: req.user._id });
    const out = (await pool.query(`SELECT ${ROW} ${FROM} WHERE r.id = $1`, [id])).rows[0];
    res.status(201).json({ success: true, data: out });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    fail(res, err);
  } finally { client.release(); }
});

/**
 * Shifts > General > "Notify employees on a shift change". Two independent
 * switches, both off by default, and both were stored and never read.
 *
 * Fire-and-forget on purpose: the shift has already been applied and committed
 * by the time this runs, so a mail server that is down must not turn a change
 * that happened into an error that says it did not.
 */
async function notifyShiftChange(requestId) {
  try {
    const cfg = await shiftConfig();
    const want = cfg.notifyOnShiftChange || {};
    if (!want.email && !want.feeds) return;

    const r = (await pool.query(
      `SELECT r.employee_id AS "employeeId", r.change_type AS "changeType",
              r.start_date AS "startDate", r.end_date AS "endDate",
              t.name AS "toShift", t.start_time AS "toStart", t.end_time AS "toEnd",
              f.name AS "fromShift",
              e.email, TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS name
         FROM shift_change_requests r
         JOIN employees e ON e.id = r.employee_id
         LEFT JOIN shifts t ON t.id = r.to_shift_id
         LEFT JOIN shifts f ON f.id = r.from_shift_id
        WHERE r.id = $1`, [requestId])).rows[0];
    if (!r) return;

    const when = r.changeType === 'permanent'
      ? `from ${ymd(r.startDate)}`
      : `for ${ymd(r.startDate)} to ${ymd(r.endDate)}`;
    const shift = r.toShift
      ? `${r.toShift} (${String(r.toStart).slice(0, 5)}-${String(r.toEnd).slice(0, 5)})`
      : 'a new shift';
    const line = r.fromShift
      ? `Your shift has changed from ${r.fromShift} to ${shift}, ${when}.`
      : `You have been placed on ${shift}, ${when}.`;

    if (want.feeds) {
      await createNotification(r.employeeId, 'shift', 'Shift Changed', line, '/attendance/shifts')
        .catch(() => {});
      await pool.query(
        `INSERT INTO feeds (employee_id, type, title, body, icon)
         VALUES ($1, 'shift_change', 'Shift Changed', $2, '🕒')`,
        [r.employeeId, line]).catch(() => {});
    }

    if (want.email && r.email) {
      await sendMail({
        to: r.email,
        subject: `Your shift has changed`,
        text: `Hi ${r.name},\n\n${line}\n`,
        html: `<p>Hi ${r.name},</p><p>${line}</p>`,
      });
    }
  } catch (err) {
    logger.warn({ err: err.message, requestId }, '[shift-change] change applied but notification failed');
  }
}

/**
 * Make an approved request real.
 *
 * Separate from approving it, and recorded separately, because they can come
 * apart: a shift deleted between the request and the approval leaves a change
 * that was agreed and cannot be made.
 */
async function applyChange(requestId) {
  const r = (await pool.query(
    `SELECT r.*, t.id AS shift_still_there
       FROM shift_change_requests r
       LEFT JOIN shifts t ON t.id = r.to_shift_id
      WHERE r.id = $1`, [requestId])).rows[0];
  if (!r) return { ok: false, note: 'The request is gone' };

  if (!r.shift_still_there) {
    await pool.query(
      `UPDATE shift_change_requests SET applied_at = NOW(), applied_note = $1 WHERE id = $2`,
      ['The requested shift no longer exists, so nothing was changed', requestId]);
    return { ok: false, note: 'The requested shift no longer exists' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let note;

    if (r.change_type === 'permanent') {
      await client.query(
        `UPDATE employees SET shift_id = $1, updated_at = NOW() WHERE id = $2`,
        [r.to_shift_id, r.employee_id]);
      note = `Standing shift changed from ${ymd(r.start_date)}`;
    } else {
      // One roster row per day, carrying the request that made it so a
      // cancellation can remove exactly its own days.
      let days = 0;
      const end = localDate(ymd(r.end_date));
      for (let d = localDate(ymd(r.start_date)); d <= end; d.setDate(d.getDate() + 1)) {
        await client.query(
          `INSERT INTO shift_roster (employee_id, shift_id, date, request_id)
           VALUES ($1, $2, $3::date, $4)
           ON CONFLICT DO NOTHING`,
          [r.employee_id, r.to_shift_id, ymd(d), requestId]);
        days++;
      }
      note = `${days} day(s) rostered onto the requested shift`;
    }

    await client.query(
      `UPDATE shift_change_requests SET applied_at = NOW(), applied_note = $1, updated_at = NOW()
        WHERE id = $2`, [note, requestId]);
    await client.query('COMMIT');

    // A shift change is what an Automation workflow watching the shift field
    // is for. Fire-and-forget, so a workflow cannot fail the application.
    if (r.change_type === 'permanent') {
      fire('employee', 'field_updated', { recordId: r.employee_id, changedFields: ['shift_id'] });
    }
    notifyShiftChange(requestId);
    return { ok: true, note };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { client.release(); }
}

router.put('/:id/action', authorize(...APPROVERS), audit('ACTION', 'shift_change_request'), async (req, res) => {
  const { action, rejectionReason } = req.body || {};
  if (!['approved', 'rejected'].includes(action)) {
    return res.status(400).json({ success: false, message: 'Use approved or rejected' });
  }

  const client = await pool.connect();
  try {
    const reqRow = (await client.query(
      `SELECT ${ROW} ${FROM} WHERE r.id = $1`, [req.params.id])).rows[0];
    if (!reqRow) return res.status(404).json({ success: false, message: 'Request not found' });
    if (reqRow.status !== 'pending') throw bad(`That request is already ${reqRow.status}`);

    if (!await canUserAct(client, 'shift_change', reqRow.id, req.user)) {
      return res.status(403).json({ success: false, message: 'You are not an approver for this request' });
    }

    await client.query('BEGIN');

    if (action === 'approved') {
      const result = await applyApproval(client, 'shift_change', reqRow.id, req.user);
      if (!result.ok) { await client.query('ROLLBACK'); return res.status(403).json({ success: false, message: result.message }); }
      if (result.allApproved) {
        await client.query(
          `UPDATE shift_change_requests SET status = 'approved', approved_by = $1, approved_at = NOW(),
                  updated_at = NOW() WHERE id = $2`, [req.user._id, reqRow.id]);
      }
      await client.query('COMMIT');

      // Only once every level has approved. Applying per level would move
      // somebody onto a shift the chain has not finished agreeing to.
      let applied = null;
      if (result.allApproved) {
        applied = await applyChange(reqRow.id);
        fire('shift_change', 'approved', { recordId: reqRow.id, actorId: req.user._id });
      }
      return res.json({
        success: true,
        status: result.allApproved ? 'approved' : 'pending',
        message: result.allApproved
          ? `Shift change approved. ${applied?.note || ''}`.trim()
          : 'Your approval has been recorded. Awaiting the remaining level(s).',
      });
    }

    const result = await applyRejection(client, 'shift_change', reqRow.id, req.user);
    if (!result.ok) { await client.query('ROLLBACK'); return res.status(403).json({ success: false, message: result.message }); }
    await client.query(
      `UPDATE shift_change_requests SET status = 'rejected', approved_by = $1, approved_at = NOW(),
              rejection_reason = $2, updated_at = NOW() WHERE id = $3`,
      [req.user._id, String(rejectionReason || '').trim() || null, reqRow.id]);
    await client.query('COMMIT');
    fire('shift_change', 'rejected', { recordId: reqRow.id, actorId: req.user._id });
    res.json({ success: true, status: 'rejected', message: 'Shift change rejected.' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    fail(res, err);
  } finally { client.release(); }
});

router.delete('/:id', async (req, res) => {
  try {
    const r = (await pool.query(
      `SELECT employee_id, status, change_type FROM shift_change_requests WHERE id = $1`,
      [req.params.id])).rows[0];
    if (!r) return res.status(404).json({ success: false, message: 'Request not found' });
    if (String(r.employee_id) !== String(req.user._id) && !isFullAccess(req.user.role)) {
      return res.status(403).json({ success: false, message: 'That is not your request' });
    }
    if (r.status === 'rejected') throw bad('A rejected request cannot be cancelled');

    // An approved temporary change has rostered days to take back. Only its
    // own, and only the ones that have not happened yet — rewriting a day
    // somebody already worked would change what attendance was measured on.
    const removed = await pool.query(
      `DELETE FROM shift_roster WHERE request_id = $1 AND date >= CURRENT_DATE RETURNING id`,
      [req.params.id]);

    await pool.query(
      `UPDATE shift_change_requests SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [req.params.id]);
    await pool.query(
      `UPDATE approval_levels SET status = 'cancelled'
        WHERE request_type = 'shift_change' AND request_id = $1 AND status = 'pending'`,
      [req.params.id]).catch(() => {});

    fire('shift_change', 'cancelled', { recordId: req.params.id, actorId: req.user._id });
    res.json({
      success: true,
      message: removed.rowCount
        ? `Request cancelled, ${removed.rowCount} upcoming rostered day(s) removed`
        : 'Request cancelled',
    });
  } catch (err) { fail(res, err); }
});

// What an employee can ask to move to: every shift they are eligible for,
// minus the one they are already on.
router.get('/options', async (req, res) => {
  try {
    const me = (await pool.query(
      `SELECT shift_id, work_location, department, designation, employment_type
         FROM employees WHERE id = $1`, [req.user._id])).rows[0];
    const shifts = (await pool.query(
      `SELECT id, name, start_time AS "startTime", end_time AS "endTime", color, eligibility
         FROM shifts ORDER BY sort_order, name`)).rows;

    const COLUMN = { location: 'work_location', department: 'department',
                     designation: 'designation', employmentType: 'employment_type' };
    const eligible = shifts.filter(s => {
      if (String(s.id) === String(me?.shift_id)) return false;
      // Empty criteria means anybody, which is what a blank list means on the
      // shift form.
      return (s.eligibility || []).every(c => {
        const col = COLUMN[c.field];
        return !col || String(me?.[col] || '') === String(c.value);
      });
    });
    res.json({
      success: true,
      data: { current: me?.shift_id || null, shifts: eligible.map(({ eligibility, ...s }) => s) },
    });
  } catch (err) { fail(res, err); }
});

module.exports = router;
