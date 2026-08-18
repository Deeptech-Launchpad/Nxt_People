const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const pool = require('../db');
const { fire } = require('../utils/workflowEngine');
const { protect, authorize } = require('../middleware/auth');
const { isFullAccess } = require('../utils/roles');
const { createNotification } = require('./notifications');
const { createLevels, canUserAct, applyApproval, applyRejection, approvalLevelsJson } = require('../utils/leaveApproval');
const { sendLeaveApprovalEmail } = require('../utils/mailer');
const attendanceConfig = require('../utils/attendanceConfig');
const logger = require('../logger');
const { serverError } = require('../utils/serverError');
router.use(protect);

// Regularization can be switched off in Attendance → Configuration → Methods.
// The check lives on the write, not only in the UI, so a tab left open on the
// request form cannot still file one.
async function requireRegularizationEnabled(req, res, next) {
  if (await attendanceConfig.methodEnabled('regularization')) return next();
  res.status(403).json({ success: false, message: 'Regularization is switched off for this organization' });
}

// The rules the request form renders against.
router.get('/config', async (req, res) => {
  try {
    const cfg = await attendanceConfig.section('regularization');
    res.json({
      success: true,
      data: {
        enabled: await attendanceConfig.methodEnabled('regularization'),
        entryMode: cfg.entryMode,
        reasons: cfg.reasons || [],
        reasonMandatory: !!cfg.reasonMandatory,
        fields: cfg.fields,
        restrictions: cfg.restrictions,
      },
    });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// Regularizations use the SAME hierarchy approval engine as leaves
// (utils/leaveApproval.js + the shared approval_levels table, request_type='regularization').
const REG_LEVELS_JSON = approvalLevelsJson('regularization', 'r');

// GET my regularization requests
router.get('/my', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.id as "_id", r.date, r.check_in as "checkIn", r.check_out as "checkOut",
       r.reason, r.status, r.rejection_reason as "rejectionReason", r.created_at as "createdAt",
       json_build_object('firstName', m.first_name, 'lastName', m.last_name) as "approvedBy",
       ${REG_LEVELS_JSON} as "approvalLevels"
       FROM attendance_regularizations r
       LEFT JOIN employees m ON r.approved_by = m.id
       WHERE r.employee_id = $1 ORDER BY r.created_at DESC`,
      [req.user._id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { serverError(res, err); }
});

// GET pending regularizations for the current approver (hierarchy-scoped).
router.get('/pending', authorize('admin', 'director', 'hr_admin', 'manager', 'team_incharge'), async (req, res) => {
  try {
    // Full-access sees the whole pending queue; everyone else sees regularizations
    // where they are an assigned approver of a still-pending hierarchy level.
    const full = isFullAccess(req.user.role);
    const result = await pool.query(
      `SELECT r.id as "_id", r.date, r.check_in as "checkIn", r.check_out as "checkOut",
       r.reason, r.status, r.created_at as "createdAt",
       json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name, 'employeeId', e.employee_id, 'department', e.department) as employee,
       ${REG_LEVELS_JSON} as "approvalLevels",
       ($2::boolean OR EXISTS (
          SELECT 1 FROM approval_levels x
           WHERE x.request_type = 'regularization' AND x.request_id = r.id AND x.approver_id = $1 AND x.status = 'pending'
       )) as "canAct"
       FROM attendance_regularizations r
       JOIN employees e ON r.employee_id = e.id
       WHERE r.status = 'pending'
         AND ($2::boolean OR EXISTS (
              SELECT 1 FROM approval_levels x
               WHERE x.request_type = 'regularization' AND x.request_id = r.id AND x.approver_id = $1 AND x.status = 'pending'
         ))
       ORDER BY r.date DESC`,
      [req.user._id, full]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { serverError(res, err); }
});

// POST submit request
router.post('/', requireRegularizationEnabled, [
  body('date').isISO8601().withMessage('Date must be YYYY-MM-DD'),
  body('reason').optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
  body('checkIn').optional({ nullable: true }).matches(/^([01]\d|2[0-3]):[0-5]\d$/).withMessage('checkIn must be HH:MM'),
  body('checkOut').optional({ nullable: true }).matches(/^([01]\d|2[0-3]):[0-5]\d$/).withMessage('checkOut must be HH:MM'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, message: errors.array()[0].msg, errors: errors.array() });
  try {
    const { date, checkIn, checkOut, reason } = req.body;
    const cfg = await attendanceConfig.section('regularization');
    const restrictions = cfg.restrictions || {};

    // Date strings throughout. new Date('YYYY-MM-DD') is UTC midnight while the
    // working day is local, which east of Greenwich makes today look future.
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    if (!restrictions.allowFutureDates && date > today) {
      return res.status(400).json({ success: false, message: 'Cannot regularize a future date' });
    }

    const within = restrictions.withinDays || {};
    if (within.enabled) {
      const limit = new Date(`${today}T00:00:00Z`);
      limit.setUTCDate(limit.getUTCDate() - Number(within.days || 0));
      const earliest = limit.toISOString().slice(0, 10);
      if (date < earliest) {
        return res.status(400).json({
          success: false,
          message: `Regularization must be raised within ${within.days} day(s) of the date being regularized`,
        });
      }
    }

    const reasonText = String(reason || '').trim();
    if (cfg.reasonMandatory && !reasonText) {
      return res.status(400).json({ success: false, message: 'A reason is required for a regularization request' });
    }
    // A configured reason list is a closed set. Free text alongside it would
    // make the list decorative and the reports ungroupable.
    if (reasonText && Array.isArray(cfg.reasons) && cfg.reasons.length && !cfg.reasons.includes(reasonText)) {
      return res.status(400).json({ success: false, message: 'Choose one of the configured reasons' });
    }

    const perPeriod = restrictions.perPeriod || {};
    if (perPeriod.enabled) {
      // Counted over the calendar period the requested date falls in, not a
      // rolling window — "1 per month" has to mean the month on the form.
      const starts = { week: "date_trunc('week', $2::date)", month: "date_trunc('month', $2::date)", year: "date_trunc('year', $2::date)" };
      const start = starts[perPeriod.period] || starts.month;
      const used = await pool.query(
        `SELECT COUNT(*)::int AS n FROM attendance_regularizations
          WHERE employee_id = $1 AND status IN ('pending','approved')
            AND date >= ${start} AND date < (${start} + ('1 ' || $3)::interval)`,
        [req.user._id, date, perPeriod.period || 'month']
      );
      if (used.rows[0].n >= Number(perPeriod.count || 0)) {
        return res.status(400).json({
          success: false,
          message: `Only ${perPeriod.count} regularization request(s) are allowed per ${perPeriod.period}`,
        });
      }
    }

    let reg;
    let levels = [];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO attendance_regularizations (employee_id, date, check_in, check_out, reason)
         VALUES ($1, $2, $3, $4, $5) RETURNING id as "_id", date, check_in as "checkIn", check_out as "checkOut", reason, status, created_at as "createdAt"`,
        [req.user._id, date, checkIn || null, checkOut || null, reasonText || null]
      );
      reg = result.rows[0];
      levels = await createLevels(client, 'regularization', reg._id, req.user._id, {
        date,
        reason: reasonText,
        // How stale the entry is, which is the condition an org most often
        // wants to route on.
        ageInDays: Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000),
      });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // ── Notify all levels ──

    try {
      const empName = `${req.user.firstName} ${req.user.lastName}`;
      const dateLabel = new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      const approverIds = levels.map(l => l.approverId).filter(Boolean);
      let hierarchyApprovers = [];
      if (approverIds.length > 0) {
        const r = await pool.query(`SELECT id, email, first_name AS "firstName" FROM employees WHERE id = ANY($1::uuid[])`, [approverIds]);
        hierarchyApprovers = r.rows;
      } else {
        const r = await pool.query(
          `SELECT id, email, first_name AS "firstName" FROM employees
            WHERE role IN ('admin','hr_admin') AND COALESCE(status,'active')='active' AND deleted_at IS NULL`
        );
        hierarchyApprovers = r.rows;
      }

      // Broadcast: Admin + HR & Administration + employees with designation 'Business Unit Head'. Director excluded for now.
      const broadcastRes = await pool.query(
        `SELECT id, email, first_name AS "firstName" FROM employees
          WHERE (role IN ('admin','hr_admin') OR LOWER(designation) = 'business unit head')
            AND COALESCE(status,'active')='active' AND deleted_at IS NULL`
      );
      const BLOCKED_EMAILS = new Set(['vellayan@altiusnxt.com']);
      const seenIds = new Set();
      const allRecipients = [];
      for (const a of [...hierarchyApprovers, ...broadcastRes.rows]) {
        if (!seenIds.has(String(a.id)) && !BLOCKED_EMAILS.has((a.email || '').toLowerCase())) {
          seenIds.add(String(a.id));
          allRecipients.push(a);
        }
      }

      await Promise.all(allRecipients.map(a => createNotification(
        a.id, 'approval', 'Regularization Approval Required',
        `${empName} requested an attendance regularization for ${dateLabel}.`,
        `/approvals?tab=regularizations&openId=${reg._id}`
      ).catch(err => logger.warn({ err: err.message }, '[regularizations] notify approver failed'))));

      const baseUrl = process.env.APP_URL || 'https://nxtpeople.altiusnxt.tech';
      const approvalLink = `${baseUrl}/approvals?tab=regularizations`;
      const regReason = `${reason}${checkIn ? ` | Check-in: ${checkIn}` : ''}${checkOut ? ` | Check-out: ${checkOut}` : ''}`;
      await Promise.all(allRecipients.filter(a => a.email).map(a => sendLeaveApprovalEmail({
        to: a.email,
        employeeName: empName,
        leaveType: 'Attendance Regularization',
        startDate: date,
        endDate: date,
        totalDays: 1,
        reason: regReason,
        approvalLink,
        customSubject: `[Action Required] ${empName} - Attendance Regularization`,
      }).catch(err => logger.warn({ err: err.message }, '[regularizations] approver email failed'))));
    } catch (e) { logger.error({ err: e.message }, '[regularizations] notify soft-fail'); }

    res.status(201).json({ success: true, data: reg });
  } catch (err) { serverError(res, err); }
});

// PUT approve/reject — hierarchy-based, identical engine to leaves.
// The attendance patch runs only on FULL approval (all levels approved) and is
// atomic with the status update.
router.put('/:id/action', authorize('admin', 'director', 'hr_admin', 'manager', 'team_incharge'), async (req, res) => {
  const { action, rejectionReason } = req.body;
  if (!['approved', 'rejected'].includes(action)) {
    return res.status(400).json({ success: false, message: 'Invalid action. Use: approved or rejected' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const regRes = await client.query(`SELECT * FROM attendance_regularizations WHERE id = $1 FOR UPDATE`, [req.params.id]);
    const reg = regRes.rows[0];
    if (!reg) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Request not found' }); }

    if (String(reg.employee_id) === String(req.user._id)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, message: 'You cannot act on your own regularization request.' });
    }
    if (reg.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: `This request has already been ${reg.status}.` });
    }
    if (!(await canUserAct(client, 'regularization', reg.id, req.user))) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, message: 'You are not an approver for this request.' });
    }

    const dateLabel = new Date(reg.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

    if (action === 'approved') {
      const result = await applyApproval(client, 'regularization', reg.id, req.user);
      if (!result.ok) { await client.query('ROLLBACK'); return res.status(403).json({ success: false, message: result.message }); }

      if (result.allApproved) {
        // Final approval — patch attendance + recalculate working_hours, status, late_minutes.
        const [settingsRes, shiftRes] = await Promise.all([
          client.query('SELECT half_day_hours, full_day_hours, late_after_minutes FROM settings LIMIT 1'),
          client.query(
            'SELECT s.start_time, s.grace_minutes FROM employees e LEFT JOIN shifts s ON s.id = e.shift_id WHERE e.id = $1',
            [reg.employee_id]
          ),
        ]);
        const halfDayHours = parseFloat(settingsRes.rows[0]?.half_day_hours) || 4;
        const fullDayHours = parseFloat(settingsRes.rows[0]?.full_day_hours) || 7.5;
        const lateAfterMins = parseInt(settingsRes.rows[0]?.late_after_minutes, 10) || 570;
        const shiftStartRaw = shiftRes.rows[0]?.start_time || null;
        // The shift's own grace period, not a literal 15. The column has always
        // existed and defaulted to 15, so behaviour is unchanged until someone
        // edits a shift — at which point it now takes effect.
        const graceMinutes = Number.isFinite(Number(shiftRes.rows[0]?.grace_minutes))
          ? Number(shiftRes.rows[0].grace_minutes) : 15;
        const shiftStartMins = shiftStartRaw
          ? (() => { const [h, m] = String(shiftStartRaw).split(':').map(Number); return h * 60 + (m || 0); })()
          : lateAfterMins;

        let workingHours = null;
        let newStatus = 'present';
        let newLateMinutes = 0;

        if (reg.check_in) {
          const ciTime = new Date(`${reg.date}T${reg.check_in}`);
          const checkInMins = ciTime.getHours() * 60 + ciTime.getMinutes();
          const minsLate = checkInMins - shiftStartMins;
          if (minsLate > 0) newLateMinutes = minsLate;

          if (reg.check_out) {
            const coTime = new Date(`${reg.date}T${reg.check_out}`);
            const diffMs = coTime - ciTime;
            if (diffMs > 0) {
              workingHours = parseFloat((diffMs / 3600000).toFixed(8));
              if (workingHours < halfDayHours) {
                newStatus = 'absent';
              } else if (workingHours < fullDayHours) {
                newStatus = 'half-day';
              } else {
                newStatus = (minsLate > graceMinutes) ? 'late' : 'present';
              }
            }
          } else {
            newStatus = (minsLate > graceMinutes) ? 'late' : 'present';
          }
        }

        // Configuration → Regularization decides what an approved request does
        // to the day. 'replace' overwrites the first check-in / last check-out;
        // 'create' adds another pair alongside whatever is already there, which
        // is what the reference does by default.
        const regCfg = await attendanceConfig.section('regularization');
        const addsEntry = regCfg.entryMode === 'create';

        const exists = await client.query(
          'SELECT id, check_in, check_out, working_hours FROM attendance WHERE employee_id=$1 AND date=$2',
          [reg.employee_id, reg.date]
        );
        if (exists.rows.length > 0 && addsEntry && exists.rows[0].check_in) {
          const row = exists.rows[0];
          // The day now spans the earliest check-in to the latest check-out,
          // and its hours are the sum of both pairs rather than either one.
          await client.query(
            `INSERT INTO attendance_sessions (attendance_id, employee_id, date, check_in, check_out, session_hours)
             VALUES ($1, $2, $3::date,
               ($3::date + $4::time)::timestamp,
               CASE WHEN $5::time IS NOT NULL THEN ($3::date + $5::time)::timestamp END,
               COALESCE($6, 0))`,
            [row.id, reg.employee_id, reg.date, reg.check_in, reg.check_out, workingHours]
          );
          const combined = workingHours === null
            ? row.working_hours
            : parseFloat(((parseFloat(row.working_hours) || 0) + workingHours).toFixed(8));
          await client.query(
            `UPDATE attendance
             SET check_in = LEAST(check_in, ($2::date + $1::time)::timestamp),
                 check_out = CASE
                   WHEN $3::time IS NULL THEN check_out
                   WHEN check_out IS NULL THEN ($2::date + $3::time)::timestamp
                   ELSE GREATEST(check_out, ($2::date + $3::time)::timestamp) END,
                 working_hours = $5,
                 status = $6,
                 updated_at = NOW()
             WHERE employee_id=$4 AND date=$2`,
            [reg.check_in, reg.date, reg.check_out, reg.employee_id, combined, newStatus]
          );
        } else if (exists.rows.length > 0) {
          await client.query(
            `UPDATE attendance
             SET check_in = CASE WHEN $1::time IS NOT NULL THEN ($2::date + $1::time)::timestamp ELSE check_in END,
                 check_out = CASE WHEN $3::time IS NOT NULL THEN ($2::date + $3::time)::timestamp ELSE check_out END,
                 working_hours = CASE WHEN $5::numeric IS NOT NULL THEN $5 ELSE working_hours END,
                 status = $6,
                 late_minutes = $7,
                 updated_at = NOW()
             WHERE employee_id=$4 AND date=$2`,
            [reg.check_in, reg.date, reg.check_out, reg.employee_id, workingHours, newStatus, newLateMinutes]
          );
        } else {
          await client.query(
            `INSERT INTO attendance (employee_id, date, check_in, check_out, status, working_hours, late_minutes)
             VALUES ($1, $2,
               CASE WHEN $3::time IS NOT NULL THEN ($2::date + $3::time)::timestamp END,
               CASE WHEN $4::time IS NOT NULL THEN ($2::date + $4::time)::timestamp END,
               $5, $6, $7)`,
            [reg.employee_id, reg.date, reg.check_in, reg.check_out, newStatus, workingHours, newLateMinutes]
          );
        }
        await client.query(
          // Optional approver comment reuses rejection_reason; COALESCE keeps any earlier note.
          `UPDATE attendance_regularizations SET status='approved', approved_by=$1, approved_at=NOW(), rejection_reason=COALESCE($2, rejection_reason), updated_at=NOW() WHERE id=$3`,
          [req.user._id, rejectionReason || null, reg.id]
        );
      } else {
        await client.query(
          `UPDATE attendance_regularizations SET rejection_reason=COALESCE($1, rejection_reason), updated_at=NOW() WHERE id=$2`,
          [rejectionReason || null, reg.id]
        );
      }
      await client.query('COMMIT');

      if (result.allApproved) {
        await createNotification(reg.employee_id, 'info', 'Regularization Approved ✓',
          `Your attendance regularization for ${dateLabel} has been approved.`, '/attendance/my');
      }
      // Fire-and-forget: the approval is committed, and a workflow must never
      // be able to fail or delay it. Only when every level has approved.
      if (result.allApproved) fire('regularization', 'approved', { recordId: reg.id, actorId: req.user._id });
      return res.json({
        success: true,
        status: result.status,
        message: result.allApproved ? 'Regularization approved.' : 'Your approval has been recorded. Awaiting the remaining level(s).',
      });
    }

    // Reject — any single rejection rejects the whole request.
    const result = await applyRejection(client, 'regularization', reg.id, req.user);
    if (!result.ok) { await client.query('ROLLBACK'); return res.status(403).json({ success: false, message: result.message }); }
    await client.query(
      `UPDATE attendance_regularizations SET status='rejected', approved_by=$1, approved_at=NOW(), rejection_reason=$2, updated_at=NOW() WHERE id=$3`,
      [req.user._id, rejectionReason || null, reg.id]
    );
    await client.query('COMMIT');

    await createNotification(reg.employee_id, 'info', 'Regularization Rejected',
      `Your regularization for ${dateLabel} was rejected.${rejectionReason ? ` Reason: ${rejectionReason}` : ''}`, '/attendance/my');
    fire('regularization', 'rejected', { recordId: reg.id, actorId: req.user._id });
    return res.json({ success: true, status: 'rejected', message: 'Regularization rejected.' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    serverError(res, err);
  } finally {
    client.release();
  }
});

module.exports = router;
