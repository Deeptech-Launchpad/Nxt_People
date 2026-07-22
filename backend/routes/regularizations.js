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
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
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
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST submit request
router.post('/', [
  body('date').isISO8601().withMessage('Date must be YYYY-MM-DD'),
  body('reason').isString().trim().isLength({ min: 3, max: 500 }).withMessage('Reason must be 3–500 characters'),
  body('checkIn').optional({ nullable: true }).matches(/^([01]\d|2[0-3]):[0-5]\d$/).withMessage('checkIn must be HH:MM'),
  body('checkOut').optional({ nullable: true }).matches(/^([01]\d|2[0-3]):[0-5]\d$/).withMessage('checkOut must be HH:MM'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, message: errors.array()[0].msg, errors: errors.array() });
  try {
    const { date, checkIn, checkOut, reason } = req.body;
    // No back-fill more than 90 days old, and no future dates.
    const d = new Date(`${date}T00:00:00`);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const ninetyAgo = new Date(today); ninetyAgo.setDate(ninetyAgo.getDate() - 90);
    if (d > today) return res.status(400).json({ success: false, message: 'Cannot regularize a future date' });
    if (d < ninetyAgo) return res.status(400).json({ success: false, message: 'Cannot regularize older than 90 days' });

    let reg;
    let levels = [];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO attendance_regularizations (employee_id, date, check_in, check_out, reason)
         VALUES ($1, $2, $3, $4, $5) RETURNING id as "_id", date, check_in as "checkIn", check_out as "checkOut", reason, status, created_at as "createdAt"`,
        [req.user._id, date, checkIn || null, checkOut || null, reason]
      );
      reg = result.rows[0];
      levels = await createLevels(client, 'regularization', reg._id, req.user._id);
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
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
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
          client.query('SELECT half_day_hours, late_after_minutes FROM settings LIMIT 1'),
          client.query(
            'SELECT s.start_time FROM employees e LEFT JOIN shifts s ON s.id = e.shift_id WHERE e.id = $1',
            [reg.employee_id]
          ),
        ]);
        const halfDayHours = parseFloat(settingsRes.rows[0]?.half_day_hours) || 4;
        const lateAfterMins = parseInt(settingsRes.rows[0]?.late_after_minutes, 10) || 570;
        const shiftStartRaw = shiftRes.rows[0]?.start_time || null;
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
              } else if (workingHours < 7.5) {
                newStatus = 'half-day';
              } else {
                newStatus = (minsLate > 15) ? 'late' : 'present';
              }
            }
          } else {
            newStatus = (minsLate > 15) ? 'late' : 'present';
          }
        }

        const exists = await client.query('SELECT id FROM attendance WHERE employee_id=$1 AND date=$2', [reg.employee_id, reg.date]);
        if (exists.rows.length > 0) {
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
    return res.json({ success: true, status: 'rejected', message: 'Regularization rejected.' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
