const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { reportsScope, isFullAccess } = require('../utils/roles');
const { createNotification } = require('./notifications');
const { createLevels, getLevels, canUserAct, applyApproval, applyApproveAll, applyRejection, approvalLevelsJson } = require('../utils/leaveApproval');
const { sendMail, sendLeaveApprovalEmail, sendLeaveStatusEmail } = require('../utils/mailer');
const { logAudit } = require('../utils/audit');
const { countWorkingDays } = require('../utils/workingDays');
const logger = require('../logger');

router.use(protect);

const VALID_LEAVE_TYPES = ['casual', 'unpaid', 'permission', 'comp_off'];
// Whitelist mapping leave_type code → physical column name. Defense in
// depth: even though `leave.leave_type` reaches the balance-decrement
// UPDATE from a DB row (not directly from request body), interpolating a
// column name into SQL is dangerous if any future code path stores
// attacker-influenced text in the column. Keep this map exclusive — any
// missing key short-circuits the UPDATE rather than building bad SQL.
const LEAVE_BALANCE_COLUMN = Object.freeze({
  casual: 'casual_leave',
  unpaid: 'unpaid_leave',
});
const VALID_BALANCE_COLUMNS = new Set(Object.values(LEAVE_BALANCE_COLUMN));

// Correlated subquery that materialises a leave's hierarchy approval chain as a
// JSON array for the frontend timeline (the leaves table is aliased `l`).
// Built from the shared engine helper so leaves & regularizations stay in sync.
const APPROVAL_LEVELS_JSON = approvalLevelsJson('leave', 'l');

// ── GET my leaves ──────────────────────────────────────────────────────────────
// Pagination contract: page (1-indexed) + limit (default 50, clamped to 200).
// Response includes { data, total, page, limit } so the client can show
// "Page 1 of N" without a separate count call. Without this the endpoint
// would return every leave ever filed once an employee racks up years of history.
router.get('/my', async (req, res) => {
  try {
    const { status, year } = req.query;
    const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;

    let query = 'WHERE l.employee_id = $1';
    let params = [req.user._id];
    let idx = 2;

    if (status) { query += ` AND l.status = $${idx++}`; params.push(status); }
    if (year) {
      query += ` AND l.start_date >= $${idx++} AND l.start_date <= $${idx++}`;
      params.push(new Date(year, 0, 1), new Date(year, 11, 31));
    }

    // Run COUNT + paged SELECT in parallel — COUNT is on the same WHERE so
    // PG plans both queries against the same index.
    const [countRes, result] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS n FROM leaves l ${query}`, params),
      pool.query(
        `SELECT l.id as "_id", l.leave_type as "leaveType", l.start_date as "startDate",
         l.end_date as "endDate", l.total_days as "totalDays", l.reason, l.status,
         l.rejection_reason as "rejectionReason", l.is_half_day as "isHalfDay",
         l.half_day_type as "halfDayType", l.created_at as "createdAt",
         l.start_time as "startTime", l.end_time as "endTime", l.hours,
         CASE WHEN rm.id IS NOT NULL THEN json_build_object('id', rm.id, 'firstName', rm.first_name, 'lastName', rm.last_name) ELSE NULL END as "reportingManager",
         CASE WHEN aa.id IS NOT NULL THEN json_build_object('id', aa.id, 'firstName', aa.first_name, 'lastName', aa.last_name) ELSE NULL END as "approvingAuthority",
         l.approved_by as "approvedById",
         json_build_object('firstName', a.first_name, 'lastName', a.last_name) as "approvedBy",
         ${APPROVAL_LEVELS_JSON} as "approvalLevels"
         FROM leaves l
         JOIN employees e ON l.employee_id = e.id
         LEFT JOIN employees rm ON e.reporting_manager_id = rm.id
         LEFT JOIN employees aa ON e.approving_authority_id = aa.id
         LEFT JOIN employees a ON l.approved_by = a.id
         ${query}
         ORDER BY l.created_at DESC
         LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, limit, offset]
      ),
    ]);
    res.json({ success: true, data: result.rows, total: countRes.rows[0]?.n || 0, page, limit });
  } catch (err) {
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  }
});

// ── GET all leaves (admin/manager) ────────────────────────────────────────────
// Real pagination — was returning `total: result.rows.length` (just the page
// size), and capping at 1000 when limit='all', which meant large orgs could
// never see their tail. Now: COUNT(*) over the same WHERE for true total,
// limit clamped to 200, no "all" shortcut.
router.get('/', authorize('admin', 'director', 'hr_admin', 'manager', 'team_incharge'), async (req, res) => {
  try {
    const { status, department, employeeId, startDate, endDate } = req.query;
    const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    let query = 'WHERE 1=1';
    let params = [];
    let idx = 1;

    if (status)              { query += ` AND l.status = $${idx++}`;           params.push(status); }
    if (employeeId)          { query += ` AND l.employee_id = $${idx++}`;      params.push(employeeId); }
    if (department)          { query += ` AND e.department = $${idx++}`;       params.push(department); }
    if (startDate)           { query += ` AND l.end_date >= $${idx++}`;        params.push(startDate); }
    if (endDate)             { query += ` AND l.start_date <= $${idx++}`;      params.push(endDate); }
    if (req.query.leaveId)   { query += ` AND l.id = $${idx++}::uuid`;         params.push(req.query.leaveId); }

    // Full-access sees every employee's leaves; managers only their direct
    // reports' (the per-record /:id/action guard still governs who can act).
    const scope = reportsScope(req.user, 'e', idx);
    if (scope.clause) { query += scope.clause; params.push(...scope.params); idx += scope.params.length; }

    const [countRes, result] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS n
           FROM leaves l
           JOIN employees e ON l.employee_id = e.id
          ${query}`,
        params
      ),
      pool.query(
        `SELECT l.id as "_id", l.leave_type as "leaveType", l.start_date as "startDate",
         l.end_date as "endDate", l.total_days as "totalDays", l.reason, l.status,
         l.rejection_reason as "rejectionReason", l.is_half_day as "isHalfDay",
         l.half_day_type as "halfDayType", l.created_at as "createdAt",
         l.start_time as "startTime", l.end_time as "endTime", l.hours,
         json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name,
           'department', e.department, 'employeeId', e.employee_id) as employee,
         CASE WHEN rm.id IS NOT NULL THEN json_build_object('id', rm.id, 'firstName', rm.first_name, 'lastName', rm.last_name) ELSE NULL END as "reportingManager",
         CASE WHEN aa.id IS NOT NULL THEN json_build_object('id', aa.id, 'firstName', aa.first_name, 'lastName', aa.last_name) ELSE NULL END as "approvingAuthority",
         l.approved_by as "approvedById",
         json_build_object('firstName', a.first_name, 'lastName', a.last_name) as "approvedBy",
         ${APPROVAL_LEVELS_JSON} as "approvalLevels"
         FROM leaves l
         JOIN employees e ON l.employee_id = e.id
         LEFT JOIN employees rm ON e.reporting_manager_id = rm.id
         LEFT JOIN employees aa ON e.approving_authority_id = aa.id
         LEFT JOIN employees a ON l.approved_by = a.id
         ${query}
         ORDER BY l.start_date DESC
         LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, limit, offset]
      ),
    ]);

    res.json({ success: true, data: result.rows, total: countRes.rows[0]?.n || 0, page, limit });
  } catch (err) {
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  }
});

// ── POST apply leave ───────────────────────────────────────────────────────────
router.post('/', [
  body('leaveType').isString().trim().notEmpty(),
  body('startDate').isISO8601().withMessage('startDate must be YYYY-MM-DD'),
  body('endDate').isISO8601().withMessage('endDate must be YYYY-MM-DD'),
  body('reason').isString().trim().isLength({ min: 3, max: 500 }).withMessage('Reason must be 3–500 characters'),
  body('isHalfDay').optional().isBoolean(),
  body('halfDayType').optional({ nullable: true }).isIn(['first_half', 'second_half', null, '']),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, message: errors.array()[0].msg, errors: errors.array() });
  try {
    const { leaveType, startDate, endDate, reason, isHalfDay, halfDayType } = req.body;

    if (!VALID_LEAVE_TYPES.includes(leaveType)) {
      return res.status(400).json({ success: false, message: `Invalid leave type. Must be one of: ${VALID_LEAVE_TYPES.join(', ')}` });
    }
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, message: 'Start date and end date are required' });
    }
    // Anchor input dates to local midnight so a YYYY-MM-DD string isn't
    // shifted into the previous day by JS's UTC-by-default Date constructor.
    const start = new Date(`${String(startDate).slice(0, 10)}T00:00:00`);
    const end   = new Date(`${String(endDate).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date format' });
    }
    if (start > end) {
      return res.status(400).json({ success: false, message: 'Start date cannot be after end date' });
    }
    // No back-dated leave. HR can still record historical leaves directly via
    // admin endpoints — but employees can't quietly apply for last year.
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (start < today) {
      return res.status(400).json({ success: false, message: 'Cannot apply for leave in the past' });
    }

    // ── Permission = hourly leave (4h per calendar month, NO carry-forward) ──
    // Captured as a single date + start/end time. Day-based balance machinery
    // below is skipped for permission; the cap is enforced per calendar month.
    const isPermission = leaveType === 'permission';
    const endDateVal = isPermission ? startDate : endDate;   // permission is single-day
    let permStartTime = null, permEndTime = null, permHours = 0;
    if (isPermission) {
      permStartTime = req.body.startTime;
      permEndTime   = req.body.endTime;
      if (!permStartTime || !permEndTime) {
        return res.status(400).json({ success: false, message: 'Permission requires a start time and an end time.' });
      }
      const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
      const diffMin = toMin(permEndTime) - toMin(permStartTime);
      if (diffMin <= 0) {
        return res.status(400).json({ success: false, message: 'Permission end time must be after the start time.' });
      }
      permHours = Math.round((diffMin / 60) * 100) / 100;
      if (permHours > 4) {
        return res.status(400).json({ success: false, message: 'A single permission cannot exceed 4 hours.' });
      }
      // Pending + approved permission hours already used in the SAME calendar
      // month as the requested date. No carry-forward → each month starts at 4h.
      const usedRes = await pool.query(
        `SELECT COALESCE(SUM(hours), 0) AS used FROM leaves
          WHERE employee_id = $1 AND leave_type = 'permission'
            AND status IN ('pending', 'approved')
            AND date_trunc('month', start_date) = date_trunc('month', $2::date)`,
        [req.user._id, startDate]
      );
      const usedHrs = parseFloat(usedRes.rows[0].used) || 0;
      if (usedHrs + permHours > 4) {
        const left = Math.max(0, 4 - usedHrs);
        return res.status(400).json({ success: false, message: `Monthly permission limit is 4 hours. You have ${left.toFixed(2)}h remaining this month.` });
      }
    }

    if (isPermission) {
      const dupPerm = await pool.query(
        `SELECT id FROM leaves
          WHERE employee_id = $1
            AND leave_type = 'permission'
            AND status IN ('pending', 'pending_approval', 'approved')
            AND start_date = $2::date
            AND start_time = $3
            AND end_time = $4
          LIMIT 1`,
        [req.user._id, startDate, permStartTime, permEndTime]
      );
      if (dupPerm.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'You already have a permission request for this time slot.'
        });
      }
    } else {
      const overlap = await pool.query(
        `SELECT id, start_date, end_date FROM leaves
          WHERE employee_id = $1
            AND status IN ('pending', 'pending_approval', 'approved')
            AND start_date <= $3::date AND end_date >= $2::date
          LIMIT 1`,
        [req.user._id, startDate, endDate]
      );
      if (overlap.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'You already have a leave request covering one or more of these dates.'
        });
      }
    }

    // Honour weekend_rules + holidays (no more hardcoded Sat/Sun).
    const workingDays = isPermission ? 0 : await countWorkingDays(start, end);
    const totalDays = isPermission ? 0 : (isHalfDay ? 0.5 : workingDays);
    if (!isPermission && totalDays <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Selected range has no working days (all weekends/holidays).'
      });
    }

    // ── Phase 3: Atomic write — balance decrement + INSERT + approval chain ──────
    // All three operations run in a single transaction. The employee row lock
    // (SELECT ... FOR UPDATE) serialises concurrent leave applications from the
    // same user, closing the TOCTOU race on the permission/overlap pre-checks
    // above. If createLevels fails the entire write is rolled back so no orphaned
    // leave row exists without an approval chain.
    const client = await pool.connect();
    let ins;
    try {
      await client.query('BEGIN');
      await client.query('SELECT 1 FROM employees WHERE id = $1 FOR UPDATE', [req.user._id]);

      // Re-verify inside the lock — catches any race that slipped through the pre-checks.
      if (isPermission) {
        const recheck = await client.query(
          `SELECT COALESCE(SUM(hours), 0) AS used FROM leaves
            WHERE employee_id = $1 AND leave_type = 'permission'
              AND status IN ('pending', 'approved')
              AND date_trunc('month', start_date) = date_trunc('month', $2::date)`,
          [req.user._id, startDate]
        );
        const usedHrs = parseFloat(recheck.rows[0].used) || 0;
        if (usedHrs + permHours > 4) {
          await client.query('ROLLBACK');
          const left = Math.max(0, 4 - usedHrs);
          return res.status(400).json({ success: false, message: `Monthly permission limit is 4 hours. You have ${left.toFixed(2)}h remaining this month.` });
        }
      } else {
        const recheck = await client.query(
          `SELECT id FROM leaves
            WHERE employee_id = $1
              AND status IN ('pending', 'pending_approval', 'approved')
              AND start_date <= $3::date AND end_date >= $2::date
            LIMIT 1`,
          [req.user._id, startDate, endDate]
        );
        if (recheck.rows.length > 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ success: false, message: 'You already have a leave request covering one or more of these dates.' });
        }
      }

      if (!isPermission && leaveType !== 'unpaid') {
        const year = start.getFullYear();
        const dbCode = leaveType === 'comp_off' ? 'compoff' : leaveType;
        const ltRes = await client.query(`SELECT id FROM leave_types WHERE code=$1`, [dbCode]);
        if (ltRes.rows[0]) {
          const updRes = await client.query(
            `UPDATE leave_balances SET available = available - $1
              WHERE employee_id=$2 AND leave_type_id=$3 AND year=$4 AND available >= $1
              RETURNING id`,
            [totalDays, req.user._id, ltRes.rows[0].id, year]
          );
          if (updRes.rows.length === 0) {
            const chk = await client.query(
              `SELECT available FROM leave_balances WHERE employee_id=$1 AND leave_type_id=$2 AND year=$3`,
              [req.user._id, ltRes.rows[0].id, year]
            );
            if (chk.rows.length > 0) {
              await client.query('ROLLBACK');
              return res.status(400).json({
                success: false,
                message: `Insufficient ${leaveType} leave balance. Available: ${parseFloat(chk.rows[0].available) || 0} day(s)`
              });
            }
            const empRes = await client.query(
              'SELECT casual_leave, sick_leave, earned_leave, unpaid_leave FROM employees WHERE id=$1',
              [req.user._id]
            );
            const employee = empRes.rows[0] || {};
            let balance = 0;
            if (leaveType === 'casual') balance = parseFloat(employee.casual_leave) || 0;
            else if (leaveType === 'permission') balance = parseFloat(employee.earned_leave) || 0;
            if (balance < totalDays) {
              await client.query('ROLLBACK');
              return res.status(400).json({
                success: false,
                message: `Insufficient ${leaveType} leave balance. Available: ${balance} day(s)`
              });
            }
          }
        } else {
          const empRes = await client.query(
            'SELECT casual_leave, sick_leave, earned_leave, unpaid_leave FROM employees WHERE id=$1',
            [req.user._id]
          );
          const employee = empRes.rows[0] || {};
          let balance = 0;
          let legacyCol = null;
          if (leaveType === 'casual') { balance = parseFloat(employee.casual_leave) || 0; legacyCol = 'casual_leave'; }
          else if (leaveType === 'permission') { balance = parseFloat(employee.earned_leave) || 0; legacyCol = 'earned_leave'; }
          if (balance < totalDays) {
            await client.query('ROLLBACK');
            return res.status(400).json({
              success: false,
              message: `Insufficient ${leaveType} leave balance. Available: ${balance} day(s)`
            });
          }
          if (legacyCol) {
            await client.query(`UPDATE employees SET ${legacyCol} = ${legacyCol} - $1 WHERE id = $2`, [totalDays, req.user._id]);
          }
        }
      }

      ins = await client.query(
        `INSERT INTO leaves (employee_id, leave_type, start_date, end_date, total_days, reason, is_half_day, half_day_type, start_time, end_time, hours)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING id as "_id", leave_type as "leaveType", start_date as "startDate",
         end_date as "endDate", total_days as "totalDays", reason, status,
         is_half_day as "isHalfDay", half_day_type as "halfDayType", created_at as "createdAt",
         start_time as "startTime", end_time as "endTime", hours`,
        [req.user._id, leaveType, startDate, endDateVal, totalDays, reason, isHalfDay || false, halfDayType || null,
         permStartTime, permEndTime, isPermission ? permHours : null]
      );

      const leaveId = ins.rows[0]._id;

      // ── Build the hierarchy-based approval chain (Employee Tree) ──
      let approverLevels = [];
      try {
        approverLevels = await createLevels(client, 'leave', leaveId, req.user._id);
      } catch (e) {
        await client.query('ROLLBACK');
        logger.error({ err: e.message }, '[leaves] createLevels failed — rolling back leave apply');
        return res.status(500).json({ success: false, message: 'Leave could not be submitted — approval chain setup failed. Please contact HR.' });
      }

      await client.query('COMMIT');

      // ── Notify ALL approval levels immediately (parallel), + employee feed ──
      // Runs after COMMIT so slow email sends don't hold the DB connection.
      try {
        const { createFeedEntry } = require('./feeds');
        const startLabel = new Date(startDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
        const empName = `${req.user.firstName} ${req.user.lastName}`;
        const msg = `${req.user.firstName} applied ${leaveType} leave from ${startLabel} for ${totalDays} day(s).`;

        await createFeedEntry(req.user._id, 'leave', 'Leave Applied', msg, '📅');

        const approverIds = approverLevels.map(l => l.approverId).filter(Boolean);
        let hierarchyApprovers = [];
        if (approverIds.length > 0) {
          const r = await pool.query(
            `SELECT id, email, first_name AS "firstName" FROM employees WHERE id = ANY($1::uuid[])`,
            [approverIds]
          );
          hierarchyApprovers = r.rows;
        } else {
          const r = await pool.query(
            `SELECT id, email, first_name AS "firstName" FROM employees
              WHERE role IN ('admin','hr_admin') AND COALESCE(status,'active')='active' AND deleted_at IS NULL`
          );
          hierarchyApprovers = r.rows;
        }

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

        const notifTitle = leaveType === 'permission' ? 'Permission Approval Required' : 'Leave Approval Required';
        const notifMsg = leaveType === 'permission'
          ? `${empName} requested permission on ${startLabel} (${permStartTime}–${permEndTime}).`
          : `${empName} requested ${leaveType} leave from ${startLabel} (${totalDays} day${totalDays !== 1 ? 's' : ''}).`;
        await Promise.all(allRecipients.map(a => createNotification(
          a.id, 'approval', notifTitle, notifMsg,
          `/leave-tracker/team?openId=${leaveId}`
        ).catch(err => logger.warn({ err: err.message }, '[leaves] notify approver failed'))));

        const baseUrl = process.env.APP_URL || 'https://nxtpeople.altiusnxt.tech';
        const leaveTypeDisplay = leaveType === 'permission' ? 'Permission' :
                                 leaveType === 'comp_off' ? 'Compensatory Off' :
                                 leaveType.charAt(0).toUpperCase() + leaveType.slice(1) + ' Leave';
        const approvalLink = `${baseUrl}/leave-tracker/team?openId=${leaveId}`;

        await Promise.all(allRecipients.filter(a => a.email).map(a =>
          sendLeaveApprovalEmail({
            to: a.email,
            employeeName: empName,
            leaveType: leaveTypeDisplay,
            startDate,
            endDate,
            totalDays,
            reason,
            approvalLink,
            hours: isPermission ? permHours : null,
            startTime: isPermission ? permStartTime : null,
            endTime: isPermission ? permEndTime : null,
          }).catch(err => logger.warn({ err: err.message }, '[leaves] approver email failed'))
        ));
      } catch (e) { logger.error({ err: e.message }, '[leaves] notify/feed soft-fail'); }

      res.status(201).json({ success: true, data: ins.rows[0], message: 'Leave applied successfully' });
    } catch (txErr) {
      await client.query('ROLLBACK').catch(() => {});
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  }
});

// PUT approve / reject leave (hierarchy-based multi-level approval).
// Approvers act on the leave's derived approval levels. Approving covers all
// lower pending levels on-behalf; HR/Super-Admin can override any level; the
// top level cannot act first; the leave is fully approved only when every level
// is approved, and any rejection rejects the whole request. Per-level
// bookkeeping lives in approval_levels (utils/leaveApproval.js); the
// balance booking / refund here is unchanged from the previous workflow.
router.put('/:id/action', authorize('admin', 'director', 'hr_admin', 'manager', 'team_incharge'), async (req, res) => {
  const { action, rejectionReason, approveAll } = req.body;
  if (!['approved', 'rejected'].includes(action)) {
    return res.status(400).json({ success: false, message: 'Invalid action. Use: approved or rejected' });
  }
  // "Approve All" finalises every remaining level in one click (approving the
  // other levels on their behalf). Allowed for HR / Super Admin and Team Leads
  // (managers); applyApproveAll enforces the role, and canUserAct below ensures
  // a manager can only do this on a request they're actually an approver on.
  const wantApproveAll = action === 'approved' && approveAll === true;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the leave row so concurrent approvals on the same request serialize.
    const leaveRes = await client.query(`SELECT * FROM leaves WHERE id=$1 FOR UPDATE`, [req.params.id]);
    const leave = leaveRes.rows[0];
    if (!leave) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Leave not found' }); }

    const leaveLabel = leave.leave_type.charAt(0).toUpperCase() + leave.leave_type.slice(1);
    const startLabel = new Date(leave.start_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

    // Cannot act on your own request.
    if (String(leave.employee_id) === String(req.user._id)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, message: 'You cannot act on your own leave request.' });
    }
    // Already resolved.
    if (leave.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: `This leave has already been ${leave.status}.` });
    }
    // Must be a pending approver (any level) or full-access.
    if (!(await canUserAct(client, 'leave', leave.id, req.user))) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, message: 'You are not an approver for this leave request.' });
    }

    // APPROVE
    if (action === 'approved') {
      const result = wantApproveAll
        ? await applyApproveAll(client, 'leave', leave.id, req.user)
        : await applyApproval(client, 'leave', leave.id, req.user);
      if (!result.ok) {
        await client.query('ROLLBACK');
        return res.status(403).json({ success: false, message: result.message });
      }

      if (result.allApproved) {
        // Final approval — update leave_balances.booked.
        // Do NOT also decrement employees.col here: leave_balances.available was
        // already decremented at apply time, so touching employees.col would be
        // a double-deduction. Only fall back to employees.col when no leave_balances
        // row exists (legacy setup with no leave_balances rows for this year).
        if (leave.leave_type !== 'unpaid') {
          const year = new Date(leave.start_date).getFullYear();
          const dbCode = leave.leave_type === 'comp_off' ? 'compoff' : leave.leave_type;
          const ltRes = await client.query(`SELECT id FROM leave_types WHERE code=$1`, [dbCode]);
          if (ltRes.rows[0]) {
            const lbRes = await client.query(
              `UPDATE leave_balances SET booked=booked+$1 WHERE employee_id=$2 AND leave_type_id=$3 AND year=$4 RETURNING id`,
              [leave.total_days, leave.employee_id, ltRes.rows[0].id, year]
            );
            if (lbRes.rows.length === 0) {
              // No leave_balances row — nothing was decremented at apply, so decrement legacy column now
              const col = LEAVE_BALANCE_COLUMN[leave.leave_type];
              if (col && VALID_BALANCE_COLUMNS.has(col)) {
                await client.query(`UPDATE employees SET ${col}=GREATEST(0,${col}-$1) WHERE id=$2`, [leave.total_days, leave.employee_id]);
              }
            }
          } else {
            // No leave_types entry — fall back to legacy employees column
            const col = LEAVE_BALANCE_COLUMN[leave.leave_type];
            if (col && VALID_BALANCE_COLUMNS.has(col)) {
              await client.query(`UPDATE employees SET ${col}=GREATEST(0,${col}-$1) WHERE id=$2`, [leave.total_days, leave.employee_id]);
            }
          }
          // For comp_off leaves: deduct from the comp_offs ledger (FIFO) so the balance card stays accurate
          if (leave.leave_type === 'comp_off') {
            let remaining = parseFloat(leave.total_days);
            if (remaining > 0) {
              const credits = await client.query(
                `SELECT id, days_earned, days_used FROM comp_offs
                  WHERE employee_id = $1 AND status = 'approved'
                    AND (expires_at IS NULL OR expires_at >= CURRENT_DATE)
                    AND days_earned > days_used
                  ORDER BY worked_date ASC FOR UPDATE`,
                [leave.employee_id]
              );
              for (const credit of credits.rows) {
                if (remaining <= 0) break;
                const avail = parseFloat(credit.days_earned) - parseFloat(credit.days_used);
                const deduct = Math.min(remaining, avail);
                await client.query(
                  `UPDATE comp_offs SET days_used = days_used + $1 WHERE id = $2`,
                  [deduct, credit.id]
                );
                remaining -= deduct;
              }
            }
          }
        }
        await client.query(
          // The optional approver comment reuses the rejection_reason column;
          // COALESCE keeps any earlier note when no new comment is provided.
          `UPDATE leaves SET status='approved', approved_by=$1, approved_at=NOW(), rejection_reason=COALESCE($2, rejection_reason), updated_at=NOW() WHERE id=$3`,
          [req.user._id, rejectionReason || null, leave.id]
        );
      } else {
        // Partial approval - request stays pending for the remaining level(s).
        await client.query(
          `UPDATE leaves SET rejection_reason=COALESCE($1, rejection_reason), updated_at=NOW() WHERE id=$2`,
          [rejectionReason || null, leave.id]
        );
      }

      await client.query('COMMIT');

      if (result.allApproved) {
        await createNotification(leave.employee_id, 'leave', 'Leave Approved ✓',
          `Your ${leaveLabel} leave from ${startLabel} (${leave.total_days} day${leave.total_days !== 1 ? 's' : ''}) has been fully approved.`,
          '/leave-tracker/summary'
        );
        try { await pool.query(`INSERT INTO feeds (employee_id,type,title,body,icon) VALUES ($1,'leave_approved','Leave Approved ✓',$2,'✅')`, [leave.employee_id, `Your ${leaveLabel} leave from ${startLabel} has been approved.`]); }
        catch (err) { logger.warn({ err: err.message }, '[leaves] feed insert (approved) failed'); }
      }
      try {
        const empRes = await pool.query(
          `SELECT email, COALESCE(first_name || ' ' || last_name, email) AS name FROM employees WHERE id=$1`,
          [leave.employee_id]
        );
        if (empRes.rows[0]?.email) {
          await sendLeaveStatusEmail({
            to: empRes.rows[0].email,
            employeeName: empRes.rows[0].name,
            leaveType: leaveLabel,
            startDate: startLabel,
            totalDays: leave.total_days,
            hours: leave.hours || null,
            status: result.allApproved ? 'approved' : 'partial',
            approverName: result.allApproved ? null : (`${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || null),
          });
        }
      } catch (e) { logger.warn({ err: e.message }, '[leaves] employee status email failed'); }
      await logAudit(req, { action: 'APPROVE', resource: 'Leave', resourceId: leave.id, changes: { allApproved: result.allApproved } });
      return res.json({
        success: true,
        status: result.status,
        message: result.allApproved ? 'Leave fully approved.' : 'Your approval has been recorded. Awaiting the remaining level(s).',
      });
    }

    // REJECT (any single rejection rejects the whole request).
    const result = await applyRejection(client, 'leave', leave.id, req.user);
    if (!result.ok) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, message: result.message });
    }

    // Refund balance (UNCHANGED from prior workflow).
    if (leave.leave_type !== 'unpaid') {
      const year = new Date(leave.start_date).getFullYear();
      const dbCode = leave.leave_type === 'comp_off' ? 'compoff' : leave.leave_type;
      const ltRes = await client.query(`SELECT id FROM leave_types WHERE code=$1`, [dbCode]);
      if (ltRes.rows[0]) {
        await client.query(
          `UPDATE leave_balances SET available=available+$1 WHERE employee_id=$2 AND leave_type_id=$3 AND year=$4`,
          [leave.total_days, leave.employee_id, ltRes.rows[0].id, year]
        );
      }
    }
    await client.query(
      `UPDATE leaves SET status='rejected', approved_by=$1, approved_at=NOW(), rejection_reason=$2, updated_at=NOW() WHERE id=$3`,
      [req.user._id, rejectionReason || null, leave.id]
    );

    await client.query('COMMIT');

    await createNotification(leave.employee_id, 'leave', 'Leave Rejected',
      `Your ${leaveLabel} leave from ${startLabel} was rejected.${rejectionReason ? ` Reason: ${rejectionReason}` : ''}`,
      '/leave-tracker/summary'
    );
    try { await pool.query(`INSERT INTO feeds (employee_id,type,title,body,icon) VALUES ($1,'leave_rejected','Leave Rejected',$2,'❌')`, [leave.employee_id, `Your ${leaveLabel} leave from ${startLabel} was rejected.`]); }
    catch (err) { logger.warn({ err: err.message }, '[leaves] feed insert (rejected) failed'); }
    try {
      const empRes = await pool.query(
        `SELECT email, COALESCE(first_name || ' ' || last_name, email) AS name FROM employees WHERE id=$1`,
        [leave.employee_id]
      );
      if (empRes.rows[0]?.email) {
        await sendLeaveStatusEmail({
          to: empRes.rows[0].email,
          employeeName: empRes.rows[0].name,
          leaveType: leaveLabel,
          startDate: startLabel,
          totalDays: leave.total_days,
          hours: leave.hours || null,
          status: 'rejected',
          reason: rejectionReason,
        });
      }
    } catch (e) { logger.warn({ err: e.message }, '[leaves] employee rejection email failed'); }
    await logAudit(req, { action: 'REJECT', resource: 'Leave', resourceId: leave.id, changes: { status: 'rejected', rejectionReason } });
    return res.json({ success: true, status: 'rejected', message: 'Leave rejected.' });

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  } finally {
    client.release();
  }
});

// ── Admin cancel leave ──────────────────────────────────────────────────────
// Super Admin / HR cancel a PENDING request: the row is KEPT with status
// 'cancelled' (so it appears under the Cancelled filter) rather than deleted.
// Balance is refunded exactly like a rejection. Approved leaves are left to the
// owner-delete path's existing rule (not cancellable here).
router.put('/:id/cancel', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const leaveRes = await client.query(`SELECT * FROM leaves WHERE id=$1 FOR UPDATE`, [req.params.id]);
    const leave = leaveRes.rows[0];
    if (!leave) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Leave not found' }); }
    if (leave.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: `Only pending leaves can be cancelled (this one is ${leave.status}).` });
    }

    // Refund balance (mirrors the rejection refund — pending never debited 'booked').
    if (leave.leave_type !== 'unpaid' && leave.total_days > 0) {
      const year = new Date(leave.start_date).getFullYear();
      const dbCode = leave.leave_type === 'comp_off' ? 'compoff' : leave.leave_type;
      const ltRes = await client.query(`SELECT id FROM leave_types WHERE code=$1`, [dbCode]);
      if (ltRes.rows[0]) {
        await client.query(
          `UPDATE leave_balances SET available=available+$1 WHERE employee_id=$2 AND leave_type_id=$3 AND year=$4`,
          [leave.total_days, leave.employee_id, ltRes.rows[0].id, year]
        );
      }
    }
    await client.query(`UPDATE leaves SET status='cancelled', updated_at=NOW() WHERE id=$1`, [leave.id]);
    await client.query('COMMIT');

    const leaveLabel = leave.leave_type.charAt(0).toUpperCase() + leave.leave_type.slice(1);
    const startLabel = new Date(leave.start_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    await createNotification(leave.employee_id, 'leave', 'Leave Cancelled',
      `Your ${leaveLabel} leave from ${startLabel} was cancelled by HR.`, '/leave-tracker/summary'
    ).catch(() => {});
    await logAudit(req, { action: 'CANCEL', resource: 'Leave', resourceId: leave.id, changes: { prior_status: 'pending', status: 'cancelled' } });
    return res.json({ success: true, status: 'cancelled', message: 'Leave cancelled.' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  } finally {
    client.release();
  }
});

// ── DELETE cancel leave ────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  // Single try/finally so client.release() runs on every exit path, including
  // the early-return cases where we previously had to remember to release()
  // before the return statement. finally is the canonical pattern here.
  const client = await pool.connect();
  try {
    // BEGIN before SELECT so FOR UPDATE locks the row, preventing a concurrent
    // approval from changing status between our check and the DELETE.
    await client.query('BEGIN');
    const leaveRes = await client.query(
      'SELECT status, leave_type, start_date, end_date, total_days FROM leaves WHERE id=$1 AND employee_id=$2 FOR UPDATE',
      [req.params.id, req.user._id]
    );
    if (leaveRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Leave not found' });
    }
    const leave = leaveRes.rows[0];
    if (leave.status === 'approved') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Cannot cancel approved leave' });
    }

    // Only refund balance if the leave was still pending — rejected and cancelled
    // leaves already had their balance refunded at rejection/cancellation time.
    // Refunding again here would inflate the balance.
    if (leave.status === 'pending' && leave.leave_type !== 'unpaid' && leave.total_days > 0) {
      const year = new Date(leave.start_date).getFullYear();
      const dbCode = leave.leave_type === 'comp_off' ? 'compoff' : leave.leave_type;
      const ltRes = await client.query(`SELECT id FROM leave_types WHERE code=$1`, [dbCode]);
      if (ltRes.rows[0]) {
        await client.query(
          `UPDATE leave_balances
              SET available = available + $1
            WHERE employee_id=$2 AND leave_type_id=$3 AND year=$4`,
          [leave.total_days, req.user._id, ltRes.rows[0].id, year]
        );
      }
    }
    await client.query("UPDATE leaves SET status='cancelled' WHERE id=$1", [req.params.id]);
    await client.query('COMMIT');

    // Audit trail for cancellations — was missing entirely before.
    await logAudit(req, {
      action: 'CANCEL',
      resource: 'Leave',
      resourceId: req.params.id,
      changes: {
        prior_status: leave.status,
        leave_type:   leave.leave_type,
        start_date:   leave.start_date,
        end_date:     leave.end_date,
        refunded_days: leave.leave_type !== 'unpaid' ? leave.total_days : 0,
      },
    });
    res.json({ success: true, message: 'Leave cancelled' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  } finally {
    client.release();
  }
});

// ── GET leave types ────────────────────────────────────────────────────────────
router.get('/types', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id as "_id", name, code, icon, color, annual_entitlement as "annualEntitlement",
       carry_forward as "carryForward", requires_reason as "requiresReason"
       FROM leave_types WHERE is_active = true AND code NOT IN ('sick', 'earned') ORDER BY display_order ASC, name ASC`
    );
    // If no leave_types table or empty, return defaults
    if (r.rows.length === 0) {
      return res.json({ success: true, data: [
        { _id: 'casual',  name: 'Casual Leave',         code: 'casual',    icon: '☀️', color: '#f59e0b', annualEntitlement: 12 },
        { _id: 'unpaid',  name: 'Leave Without Pay',     code: 'unpaid',    icon: '📋', color: '#6b7280', annualEntitlement: 0  },
        { _id: 'compoff', name: 'Compensatory Off',      code: 'comp_off',  icon: '⭐', color: '#22c55e', annualEntitlement: 0  },
        { _id: 'perm',    name: 'Permission',             code: 'permission',icon: '🔑', color: '#8b5cf6', annualEntitlement: 0  },
      ]});
    }
    res.json({ success: true, data: r.rows });
  } catch (err) {
    // Table might not exist — return defaults
    res.json({ success: true, data: [
      { _id: 'casual',  name: 'Casual Leave',         code: 'casual',    icon: '☀️', color: '#f59e0b', annualEntitlement: 12 },
      { _id: 'unpaid',  name: 'Leave Without Pay',     code: 'unpaid',    icon: '📋', color: '#6b7280', annualEntitlement: 0  },
      { _id: 'compoff', name: 'Compensatory Off',      code: 'comp_off',  icon: '⭐', color: '#22c55e', annualEntitlement: 0  },
      { _id: 'perm',    name: 'Permission',             code: 'permission',icon: '🔑', color: '#8b5cf6', annualEntitlement: 0  },
    ]});
  }
});

// ── GET leave balance summary (4 cards) ────────────────────────────────────────
router.get('/balance', async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    // Default to the caller's own balance. Full-access (Super Admin / HR) may
    // look up another employee's balance via ?employeeId — read-only, no change
    // to anyone else's self-balance behaviour.
    const targetId = (isFullAccess(req.user.role) && req.query.employeeId)
      ? req.query.employeeId
      : req.user._id;

    // Get from employees (legacy columns)
    const empRes = await pool.query(
      'SELECT casual_leave, sick_leave, earned_leave, unpaid_leave FROM employees WHERE id=$1',
      [targetId]
    );
    const emp = empRes.rows[0] || {};

    // Count booked leaves this year per type
    const bookedRes = await pool.query(
      `SELECT leave_type, COALESCE(SUM(total_days),0) as used
       FROM leaves
       WHERE employee_id=$1 AND status='approved'
         AND EXTRACT(YEAR FROM start_date) = $2
       GROUP BY leave_type`,
      [targetId, year]
    );
    const booked = {};
    bookedRes.rows.forEach(r => { booked[r.leave_type] = parseFloat(r.used); });

    // Permission is hourly: 4h per CURRENT calendar month, no carry-forward.
    // Used = pending + approved permission hours dated in the current month.
    const permRes = await pool.query(
      `SELECT COALESCE(SUM(hours), 0) AS used FROM leaves
        WHERE employee_id = $1 AND leave_type = 'permission'
          AND status = 'approved'
          AND date_trunc('month', start_date) = date_trunc('month', CURRENT_DATE)`,
      [targetId]
    );
    // Round to 2 dp so 4 - 1.03 shows 2.97, not 2.9699999999999998 (JS float).
    const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
    const permUsed = round2(parseFloat(permRes.rows[0].used) || 0);
    const permAvailable = round2(Math.max(0, 4 - permUsed));

    // Comp-Off is an earned-credit system in its own table: available =
    // approved credits still within their 3-month validity, minus any used.
    const coRes = await pool.query(
      `SELECT COALESCE(SUM(days_earned - days_used), 0) AS avail
         FROM comp_offs
        WHERE employee_id = $1 AND status = 'approved'
          AND (expires_at IS NULL OR expires_at >= CURRENT_DATE)`,
      [targetId]
    );
    const compOffAvailable = Math.max(0, round2(parseFloat(coRes.rows[0].avail) || 0));

    // Try leave_balances table first
    let balanceRows = [];
    try {
      const lbRes = await pool.query(
        `SELECT lb.year, lb.total, lb.available, lb.used,
         lt.name, lt.code, lt.icon, lt.color
         FROM leave_balances lb
         JOIN leave_types lt ON lb.leave_type_id = lt.id
         WHERE lb.employee_id=$1 AND lb.year=$2`,
        [targetId, year]
      );
      balanceRows = lbRes.rows;
    } catch (_) {}

    // Build response: priority order = Casual, Comp-Off, LWP, Permission
    const cards = [
      {
        code: 'casual', name: 'Casual Leave', icon: '☀️', color: '#f59e0b',
        available: balanceRows.find(r => r.code === 'casual')?.available ?? (emp.casual_leave || 0),
        booked: booked['casual'] || 0,
      },
      {
        code: 'comp_off', name: 'Compensatory Off', icon: '⭐', color: '#22c55e',
        available: compOffAvailable,
        booked: booked['comp_off'] || 0,
      },
      {
        code: 'unpaid', name: 'Leave Without Pay', icon: '📋', color: '#6b7280',
        available: null, // LWP has no cap
        booked: booked['unpaid'] || 0,
      },
      {
        code: 'permission', name: 'Permission', icon: '🔑', color: '#8b5cf6',
        // Hours, not days: this month's remaining out of a 4h monthly allowance.
        unit: 'hours', monthlyLimit: 4,
        available: permAvailable,
        booked: permUsed,
      },
    ];

    res.json({ success: true, data: cards, year });
  } catch (err) {
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  }
});

// ── GET permission usage (HR/Admin monthly tracker) ───────────────────────────
// Per-employee permission hours for a given month: approved + pending + remaining
// out of the 4h monthly allowance. Full-access only (Super Admin / HR).
router.get('/permission-usage', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  try {
    const now = new Date();
    const month = Math.min(12, Math.max(1, parseInt(req.query.month, 10) || (now.getMonth() + 1)));
    const year  = parseInt(req.query.year, 10) || now.getFullYear();
    const MONTHLY_LIMIT = 4;

    const r = await pool.query(
      `SELECT e.id as "_id", e.employee_id as "employeeId",
              e.first_name as "firstName", e.last_name as "lastName",
              e.department, e.designation,
              COALESCE(SUM(l.hours) FILTER (WHERE l.status = 'approved'), 0) AS "approvedHours",
              COALESCE(SUM(l.hours) FILTER (WHERE l.status = 'pending'), 0)  AS "pendingHours",
              COUNT(l.id) FILTER (WHERE l.status IN ('approved','pending'))  AS "requests"
         FROM employees e
         LEFT JOIN leaves l
           ON l.employee_id = e.id AND l.leave_type = 'permission'
          AND EXTRACT(MONTH FROM l.start_date) = $1
          AND EXTRACT(YEAR  FROM l.start_date) = $2
        WHERE e.status = 'active' AND e.deleted_at IS NULL
        GROUP BY e.id
       HAVING COUNT(l.id) FILTER (WHERE l.status IN ('approved','pending')) > 0
        ORDER BY "approvedHours" DESC, e.first_name ASC`,
      [month, year]
    );

    const data = r.rows.map(row => {
      const approved = parseFloat(row.approvedHours) || 0;
      const pending  = parseFloat(row.pendingHours) || 0;
      return {
        ...row,
        approvedHours: approved,
        pendingHours: pending,
        remainingHours: Math.max(0, MONTHLY_LIMIT - approved - pending),
        requests: parseInt(row.requests, 10) || 0,
      };
    });
    res.json({ success: true, data, month, year, monthlyLimit: MONTHLY_LIMIT });
  } catch (err) {
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  }
});

// ── GET pending approvals for approving authority ─────────────────────────────
// GET /api/leaves/team-pending — pending leaves for manager's 2-level hierarchy
// Full-access users (admin/director/hr_admin) see all pending leaves.
// Managers and team_incharge see leaves for their direct reports AND those employees' subordinates.
router.get('/team-pending', async (req, res) => {
  try {
    const { isFullAccess } = require('../utils/roles');
    const full = isFullAccess(req.user.role);
    let whereClause, params;

    if (full) {
      whereClause = `l.status = 'pending'`;
      params = [];
    } else {
      whereClause = `l.status = 'pending'
        AND (
          e.reporting_manager_id = $1
          OR e.reporting_manager_id IN (SELECT id FROM employees WHERE reporting_manager_id = $1 AND deleted_at IS NULL)
        )`;
      params = [req.user._id];
    }

    const r = await pool.query(
      `SELECT l.id as "_id", l.leave_type as "leaveType", l.start_date as "startDate",
       l.end_date as "endDate", l.total_days as "totalDays", l.reason, l.status,
       l.created_at as "createdAt",
       json_build_object(
         '_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name,
         'department', e.department, 'designation', e.designation
       ) as employee
       FROM leaves l
       JOIN employees e ON l.employee_id = e.id
       WHERE ${whereClause}
       ORDER BY l.created_at DESC`,
      params
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  }
});

router.get('/pending-approvals', async (req, res) => {
  try {
    // Hierarchy-based queue: full-access (HR/Super Admin) see every pending
    // request; everyone else sees pending leaves where they are an assigned
    // approver of a still-pending level. canAct mirrors that (the per-level
    // "top not first" gate is enforced at action time).
    const full = isFullAccess(req.user.role);
    const r = await pool.query(
      `SELECT l.id as "_id", l.leave_type as "leaveType", l.start_date as "startDate",
       l.end_date as "endDate", l.total_days as "totalDays", l.reason, l.status,
       l.rejection_reason as "rejectionReason", l.created_at as "createdAt",
       l.start_time as "startTime", l.end_time as "endTime", l.hours,
       json_build_object(
         '_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name,
         'employeeId', e.employee_id, 'department', e.department, 'designation', e.designation,
         'photoUrl', e.photo_url
       ) as employee,
       ${APPROVAL_LEVELS_JSON} as "approvalLevels",
       ($2::boolean OR EXISTS (
          SELECT 1 FROM approval_levels x
           WHERE x.request_type = 'leave' AND x.request_id = l.id AND x.approver_id = $1 AND x.status = 'pending'
       )) as "canAct"
       FROM leaves l
       JOIN employees e ON l.employee_id = e.id
       WHERE l.status = 'pending'
         AND ($2::boolean OR EXISTS (
              SELECT 1 FROM approval_levels x
               WHERE x.request_type = 'leave' AND x.request_id = l.id AND x.approver_id = $1 AND x.status = 'pending'
         ))
       ORDER BY l.created_at DESC`,
      [req.user._id, full]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  }
});

module.exports = router;
