const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { isFullAccess } = require('../utils/roles');
const { createNotification } = require('./notifications');
const { createLevels, canUserAct, applyApproval, applyRejection, approvalLevelsJson } = require('../utils/leaveApproval');
const { sendLeaveApprovalEmail } = require('../utils/mailer');
const logger = require('../logger');
router.use(protect);

// On Duty is work done away from the usual place of work — a client visit, or
// a day worked from home. The employee is working, so the day is payable and
// counts as worked; it is not leave and draws on no balance.
//
// Approval runs on the same hierarchy engine as leave and regularization
// (approval_levels, request_type='on_duty'), so there is one implementation of
// "who may approve this", not three.
const OD_LEVELS_JSON = approvalLevelsJson('on_duty', 'o');

const TYPES = ['client_visit', 'work_from_home'];
const TYPE_LABEL = { client_visit: 'Client visit', work_from_home: 'Work from home' };

const SELECT_FIELDS = `
  o.id as "_id", o.start_date::text as "startDate", o.end_date::text as "endDate",
  o.unit, o.start_time as "startTime", o.end_time as "endTime", o.hours,
  o.request_type as "requestType", o.reason, o.status,
  o.rejection_reason as "rejectionReason", o.created_at as "createdAt"`;

// Whole days between two dates, inclusive. An hours request is a slice of one
// day, so it never counts as more than that day.
const daySpan = (start, end) =>
  Math.round((new Date(`${end}T00:00:00`) - new Date(`${start}T00:00:00`)) / 86400000) + 1;

// GET my on-duty requests
router.get('/my', async (req, res) => {
  try {
    const { status, from, to } = req.query;
    const params = [req.user._id];
    let clause = '';
    if (status && status !== 'all') { params.push(status); clause += ` AND o.status = $${params.length}`; }
    if (from) { params.push(from); clause += ` AND o.end_date >= $${params.length}::date`; }
    if (to) { params.push(to); clause += ` AND o.start_date <= $${params.length}::date`; }

    const result = await pool.query(
      `SELECT ${SELECT_FIELDS},
              json_build_object('firstName', m.first_name, 'lastName', m.last_name) as "approvedBy",
              ${OD_LEVELS_JSON} as "approvalLevels"
         FROM on_duty_requests o
         LEFT JOIN employees m ON o.approved_by = m.id
        WHERE o.employee_id = $1${clause}
        ORDER BY o.start_date DESC, o.created_at DESC`,
      params
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET pending on-duty requests for the current approver (hierarchy-scoped).
router.get('/pending', authorize('admin', 'director', 'hr_admin', 'manager', 'team_incharge'), async (req, res) => {
  try {
    const full = isFullAccess(req.user.role);
    const result = await pool.query(
      `SELECT ${SELECT_FIELDS},
              json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name,
                                'employeeId', e.employee_id, 'department', e.department) as employee,
              ${OD_LEVELS_JSON} as "approvalLevels",
              ($2::boolean OR EXISTS (
                 SELECT 1 FROM approval_levels x
                  WHERE x.request_type = 'on_duty' AND x.request_id = o.id AND x.approver_id = $1 AND x.status = 'pending'
              )) as "canAct"
         FROM on_duty_requests o
         JOIN employees e ON o.employee_id = e.id
        WHERE o.status = 'pending'
          AND ($2::boolean OR EXISTS (
               SELECT 1 FROM approval_levels x
                WHERE x.request_type = 'on_duty' AND x.request_id = o.id AND x.approver_id = $1 AND x.status = 'pending'
          ))
        ORDER BY o.start_date DESC`,
      [req.user._id, full]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST submit a request
router.post('/', [
  body('startDate').isISO8601().withMessage('Start date must be YYYY-MM-DD'),
  body('endDate').isISO8601().withMessage('End date must be YYYY-MM-DD'),
  body('unit').optional().isIn(['days', 'hours']).withMessage('Unit must be days or hours'),
  body('requestType').optional().isIn(TYPES).withMessage('Unknown on-duty type'),
  body('reason').optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
  body('startTime').optional({ nullable: true }).matches(/^([01]\d|2[0-3]):[0-5]\d$/).withMessage('startTime must be HH:MM'),
  body('endTime').optional({ nullable: true }).matches(/^([01]\d|2[0-3]):[0-5]\d$/).withMessage('endTime must be HH:MM'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, message: errors.array()[0].msg, errors: errors.array() });
  try {
    const { startDate, endDate, reason } = req.body;
    const unit = req.body.unit === 'hours' ? 'hours' : 'days';
    const requestType = TYPES.includes(req.body.requestType) ? req.body.requestType : 'client_visit';
    if (endDate < startDate) {
      return res.status(400).json({ success: false, message: 'End date cannot be before the start date' });
    }

    let startTime = null, endTime = null, hours = null;
    if (unit === 'hours') {
      startTime = req.body.startTime || null;
      endTime = req.body.endTime || null;
      if (!startTime || !endTime) {
        return res.status(400).json({ success: false, message: 'An hours request needs a start and end time' });
      }
      if (endTime <= startTime) {
        return res.status(400).json({ success: false, message: 'End time must be after the start time' });
      }
      if (endDate !== startDate) {
        return res.status(400).json({ success: false, message: 'An hours request covers a single day' });
      }
      const [sh, sm] = startTime.split(':').map(Number);
      const [eh, em] = endTime.split(':').map(Number);
      hours = parseFloat((((eh * 60 + em) - (sh * 60 + sm)) / 60).toFixed(2));
    }

    // One approved or pending request per stretch of days — two overlapping
    // claims on the same day would double-count it as worked.
    const clash = await pool.query(
      `SELECT 1 FROM on_duty_requests
        WHERE employee_id = $1 AND status IN ('pending','approved')
          AND start_date <= $3::date AND end_date >= $2::date LIMIT 1`,
      [req.user._id, startDate, endDate]
    );
    if (clash.rows.length) {
      return res.status(400).json({ success: false, message: 'You already have an on-duty request covering those dates' });
    }

    let od, levels = [];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO on_duty_requests (employee_id, start_date, end_date, unit, start_time, end_time, hours, request_type, reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id as "_id", start_date::text as "startDate", end_date::text as "endDate",
                   unit, start_time as "startTime", end_time as "endTime", hours,
                   request_type as "requestType", reason, status, created_at as "createdAt"`,
        [req.user._id, startDate, endDate, unit, startTime, endTime, hours, requestType, reason || null]
      );
      od = result.rows[0];
      levels = await createLevels(client, 'on_duty', od._id, req.user._id);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Notifications are best-effort: a mail server having a bad day must not
    // lose a request that is already committed.
    try {
      const empName = `${req.user.firstName} ${req.user.lastName}`;
      const label = startDate === endDate ? startDate : `${startDate} to ${endDate}`;
      const approverIds = levels.map(l => l.approverId).filter(Boolean);
      const approvers = approverIds.length
        ? (await pool.query(`SELECT id, email, first_name AS "firstName" FROM employees WHERE id = ANY($1::uuid[])`, [approverIds])).rows
        : (await pool.query(
            `SELECT id, email, first_name AS "firstName" FROM employees
              WHERE role IN ('admin','hr_admin') AND COALESCE(status,'active')='active' AND deleted_at IS NULL`
          )).rows;

      await Promise.all(approvers.map(a => createNotification(
        a.id, 'approval', 'On Duty Approval Required',
        `${empName} requested on duty (${TYPE_LABEL[requestType]}) for ${label}.`,
        `/approvals?tab=onduty&openId=${od._id}`
      ).catch(err => logger.warn({ err: err.message }, '[on-duty] notify approver failed'))));

      const baseUrl = process.env.APP_URL || 'https://nxtpeople.altiusnxt.tech';
      await Promise.all(approvers.filter(a => a.email).map(a => sendLeaveApprovalEmail({
        to: a.email,
        employeeName: empName,
        leaveType: `On Duty — ${TYPE_LABEL[requestType]}`,
        startDate, endDate,
        totalDays: unit === 'hours' ? 0 : daySpan(startDate, endDate),
        reason: reason || '',
        approvalLink: `${baseUrl}/approvals?tab=onduty`,
        customSubject: `[Action Required] ${empName} - On Duty`,
      }).catch(err => logger.warn({ err: err.message }, '[on-duty] approver email failed'))));
    } catch (e) { logger.error({ err: e.message }, '[on-duty] notify soft-fail'); }

    res.status(201).json({ success: true, data: od });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// PUT approve/reject — same engine as leave and regularization.
router.put('/:id/action', authorize('admin', 'director', 'hr_admin', 'manager', 'team_incharge'), async (req, res) => {
  const { action, rejectionReason } = req.body;
  if (!['approved', 'rejected'].includes(action)) {
    return res.status(400).json({ success: false, message: 'Invalid action. Use: approved or rejected' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const odRes = await client.query(`SELECT * FROM on_duty_requests WHERE id = $1 FOR UPDATE`, [req.params.id]);
    const od = odRes.rows[0];
    if (!od) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Request not found' }); }

    if (String(od.employee_id) === String(req.user._id)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, message: 'You cannot act on your own on-duty request.' });
    }
    if (od.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: `This request has already been ${od.status}.` });
    }
    if (!(await canUserAct(client, 'on_duty', od.id, req.user))) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, message: 'You are not an approver for this request.' });
    }

    const label = String(od.start_date).slice(0, 10) === String(od.end_date).slice(0, 10)
      ? new Date(od.start_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
      : `${new Date(od.start_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${new Date(od.end_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;

    if (action === 'approved') {
      const result = await applyApproval(client, 'on_duty', od.id, req.user);
      if (!result.ok) { await client.query('ROLLBACK'); return res.status(403).json({ success: false, message: result.message }); }

      if (result.allApproved) {
        // No attendance rows are written. The day is resolved from the approved
        // request when a report asks, the same way leave is — writing punches
        // nobody made would put invented times in the Early/Late report.
        await client.query(
          `UPDATE on_duty_requests SET status='approved', approved_by=$1, approved_at=NOW(),
                  rejection_reason=COALESCE($2, rejection_reason), updated_at=NOW() WHERE id=$3`,
          [req.user._id, rejectionReason || null, od.id]
        );
      } else {
        await client.query(
          `UPDATE on_duty_requests SET rejection_reason=COALESCE($1, rejection_reason), updated_at=NOW() WHERE id=$2`,
          [rejectionReason || null, od.id]
        );
      }
      await client.query('COMMIT');

      if (result.allApproved) {
        await createNotification(od.employee_id, 'info', 'On Duty Approved ✓',
          `Your on-duty request for ${label} has been approved.`, '/attendance/on-duty');
      }
      return res.json({
        success: true,
        status: result.status,
        message: result.allApproved ? 'On duty approved.' : 'Your approval has been recorded. Awaiting the remaining level(s).',
      });
    }

    const result = await applyRejection(client, 'on_duty', od.id, req.user);
    if (!result.ok) { await client.query('ROLLBACK'); return res.status(403).json({ success: false, message: result.message }); }
    await client.query(
      `UPDATE on_duty_requests SET status='rejected', approved_by=$1, approved_at=NOW(), rejection_reason=$2, updated_at=NOW() WHERE id=$3`,
      [req.user._id, rejectionReason || null, od.id]
    );
    await client.query('COMMIT');

    await createNotification(od.employee_id, 'info', 'On Duty Rejected',
      `Your on-duty request for ${label} was rejected.${rejectionReason ? ` Reason: ${rejectionReason}` : ''}`, '/attendance/on-duty');
    return res.json({ success: true, status: 'rejected', message: 'On duty rejected.' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

// DELETE — withdraw your own request while it is still pending.
router.delete('/:id', async (req, res) => {
  try {
    const r = await pool.query(
      `DELETE FROM on_duty_requests WHERE id = $1 AND employee_id = $2 AND status = 'pending' RETURNING id`,
      [req.params.id, req.user._id]
    );
    if (!r.rows.length) {
      return res.status(400).json({ success: false, message: 'Only your own pending requests can be withdrawn' });
    }
    await pool.query(`DELETE FROM approval_levels WHERE request_type = 'on_duty' AND request_id = $1`, [req.params.id]);
    res.json({ success: true, message: 'Request withdrawn' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
