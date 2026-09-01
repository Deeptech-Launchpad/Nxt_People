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
const { sandwichedDays } = require('../utils/sandwichLeave');
const { getLeavePolicies, getJoiningRule, grantedToDate } = require('../utils/leavePolicy');
const logger = require('../logger');
const { fire } = require('../utils/workflowEngine');
const { canCancel, loadConfig } = require('../utils/leaveCancellation');
const { availableFor, computedFor, debitOnApproval, refundApproved, typeCode: dbTypeCode } = require('../utils/leaveBalance');
const { partialAllowed } = require('../utils/leaveExtension');
const { notifyChainOfCancellation } = require('../utils/cancellationNotice');
const { approvalEmail, outcomeEmail } = require('../utils/approvalMessages');
const { serverError } = require('../utils/serverError');

router.use(protect);

const VALID_LEAVE_TYPES = ['casual', 'unpaid', 'permission', 'comp_off'];

// A date column comes back as a Date object. toISOString() would render it
// in UTC, which in IST is the previous day — the shift this project has been
// bitten by four times. Local parts only.
const ymdLocal = (d) => {
  const x = d instanceof Date ? d : new Date(`${String(d).slice(0, 10)}T00:00:00`);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

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
    serverError(res, err);
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
    serverError(res, err);
  }
});

// ── POST apply leave ───────────────────────────────────────────────────────────
/* Whose leave is this, and may the caller file it?
 *
 * Zoho reaches one form through two doors: My Data files for you and has no
 * employee field, Operations puts a selector on top and files for anybody.
 * Filing for somebody else spends THEIR balance and can cost them pay, so it is
 * an administrative act and gated like one — a team lead approving a report is
 * not the same authority as booking leave in their name. */
const LEAVE_UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

async function resolveLeaveSubject(user, employeeId) {
  if (!employeeId || String(employeeId) === String(user._id)) {
    return { id: user._id, onBehalf: false };
  }
  if (!isFullAccess(user.role)) {
    return { error: 403, message: 'Only HR and administrators can apply leave for another employee.' };
  }
  if (!LEAVE_UUID.test(String(employeeId))) {
    return { error: 400, message: 'That is not a valid employee.' };
  }
  const r = await pool.query(
    `SELECT id, TRIM(CONCAT(first_name, ' ', last_name)) AS name
       FROM employees WHERE id = $1 AND deleted_at IS NULL`, [employeeId]);
  if (!r.rows.length) return { error: 404, message: 'That employee no longer exists.' };
  return { id: r.rows[0].id, name: r.rows[0].name, onBehalf: true };
}

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

    /* Applying for somebody else, the way Zoho's Operations -> Leave Tracker ->
     * Leave Requests does it. My Data has no employee field; Operations puts one
     * on top and HR can file for a person who is already away and could not.
     *
     * Every rule below — balance, overlap, sandwich, the approval chain — is
     * about the person the leave belongs to, never the person typing. */
    const subject = await resolveLeaveSubject(req.user, req.body.employeeId);
    if (subject.error) return res.status(subject.error).json({ success: false, message: subject.message });
    const subjectId = subject.id;

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
    // How far ahead leave may be booked — Leave Tracker > Configuration >
    // Leave Request. Stored since that screen was built, but until now nothing
    // read it, so the limit was advertised and never applied.
    {
      const cfg = await loadConfig();
      const years = Number(cfg.futureRequestYears) || 1;
      const limit = new Date(today);
      limit.setFullYear(limit.getFullYear() + years);
      if (start > limit) {
        return res.status(400).json({
          success: false,
          message: `Leave can only be requested up to ${years} year${years > 1 ? 's' : ''} in advance.`,
        });
      }
    }

    // ── Permission = hourly leave, capped per calendar month, NO carry-forward ──
    // Captured as a single date + start/end time. Day-based balance machinery
    // below is skipped for permission; the cap is enforced per calendar month.
    //
    // The cap is the Leave Policy accrual for the type (Configuration → Leave
    // Policy), not a literal — the same figure the balance reports grant, so
    // what an employee may apply for and what their balance says they have
    // cannot disagree.
    const isPermission = leaveType === 'permission';
    const endDateVal = isPermission ? startDate : endDate;   // permission is single-day
    let permStartTime = null, permEndTime = null, permHours = 0, permMonthlyCap = 0;
    if (isPermission) {
      const policy = (await getLeavePolicies()).get('permission');
      // A scheduled policy sets the allowance; 'earned' and 'none' have no
      // allowance to spend, so there is nothing to apply against.
      permMonthlyCap = ['monthly', 'annual'].includes(policy.accrualMode) ? policy.accrualAmount : 0;
      if (permMonthlyCap <= 0) {
        return res.status(400).json({ success: false, message: 'Permission has no allowance configured. Ask HR to set one under Leave Policy.' });
      }
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
      if (permHours > permMonthlyCap) {
        return res.status(400).json({ success: false, message: `A single permission cannot exceed ${permMonthlyCap} hours.` });
      }
      // Pending + approved permission hours already used in the SAME calendar
      // month as the requested date. No carry-forward → each month starts full.
      const usedRes = await pool.query(
        `SELECT COALESCE(SUM(hours), 0) AS used FROM leaves
          WHERE employee_id = $1 AND leave_type = 'permission'
            AND status IN ('pending', 'approved')
            AND date_trunc('month', start_date) = date_trunc('month', $2::date)`,
        [subjectId, startDate]
      );
      const usedHrs = parseFloat(usedRes.rows[0].used) || 0;
      if (usedHrs + permHours > permMonthlyCap) {
        const left = Math.max(0, permMonthlyCap - usedHrs);
        return res.status(400).json({ success: false, message: `Monthly permission limit is ${permMonthlyCap} hours. You have ${left.toFixed(2)}h remaining this month.` });
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
        [subjectId, startDate, permStartTime, permEndTime]
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
        [subjectId, startDate, endDate]
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

    // Sandwich leave: weekends and holidays sitting between leave days can be
    // charged as leave themselves. Off by default, and every decision inside it
    // is a setting — see utils/sandwichLeave.js. A half day cannot bridge
    // anything, so it is left out.
    let sandwich = { days: 0, dates: [] };
    if (!isPermission && !isHalfDay) {
      try {
        const addCfg = (await pool.query(
          `SELECT leave_additional_config AS c FROM settings LIMIT 1`)).rows[0]?.c || {};
        sandwich = await sandwichedDays(pool, {
          employeeId: subjectId, start, end, leaveType, cfg: addCfg,
        });
      } catch (err) {
        // A policy that cannot be read must not block somebody applying for
        // leave. Charging nothing is the safe direction to fail in.
        logger.warn({ err: err.message }, '[leaves] sandwich calculation skipped');
      }
    }

    const totalDays = isPermission ? 0 : (isHalfDay ? 0.5 : workingDays + sandwich.days);
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
      await client.query('SELECT 1 FROM employees WHERE id = $1 FOR UPDATE', [subjectId]);

      // Re-verify inside the lock — catches any race that slipped through the pre-checks.
      if (isPermission) {
        const recheck = await client.query(
          `SELECT COALESCE(SUM(hours), 0) AS used FROM leaves
            WHERE employee_id = $1 AND leave_type = 'permission'
              AND status IN ('pending', 'approved')
              AND date_trunc('month', start_date) = date_trunc('month', $2::date)`,
          [subjectId, startDate]
        );
        const usedHrs = parseFloat(recheck.rows[0].used) || 0;
        if (usedHrs + permHours > permMonthlyCap) {
          await client.query('ROLLBACK');
          const left = Math.max(0, permMonthlyCap - usedHrs);
          return res.status(400).json({ success: false, message: `Monthly permission limit is ${permMonthlyCap} hours. You have ${left.toFixed(2)}h remaining this month.` });
        }
      } else {
        const recheck = await client.query(
          `SELECT id FROM leaves
            WHERE employee_id = $1
              AND status IN ('pending', 'pending_approval', 'approved')
              AND start_date <= $3::date AND end_date >= $2::date
            LIMIT 1`,
          [subjectId, startDate, endDate]
        );
        if (recheck.rows.length > 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ success: false, message: 'You already have a leave request covering one or more of these dates.' });
        }
      }

      if (!isPermission && leaveType !== 'unpaid') {
        const year = start.getFullYear();
        // One balance answer, shared with the balance card. This block used to
        // read leave_balances and then fall back to a hand-written lookup that
        // knew only casual and permission — so an employee holding two days of
        // comp-off was shown "2 available" on the card and refused here with
        // "Available: 0 day(s)".
        const { available, store } = await availableFor(client, subjectId, leaveType, year);

        // null is "this type has no ceiling", not "nothing left". Treating the
        // two the same would refuse leave that has no balance to run out of.
        if (available !== null && available < totalDays) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: `Insufficient ${leaveType} leave balance. Available: ${available} day(s)`
          });
        }

        // leave_balances reserves the days at application time; the legacy
        // columns and the comp-off ledger are debited at approval instead.
        // Only the store that reserves here is touched here, so nothing is
        // taken twice.
        if (store === 'leave_balances') {
          const lt = await client.query(`SELECT id FROM leave_types WHERE code=$1`, [dbTypeCode(leaveType)]);
          await client.query(
            `UPDATE leave_balances SET available = available - $1
              WHERE employee_id=$2 AND leave_type_id=$3 AND year=$4`,
            [totalDays, subjectId, lt.rows[0].id, year]
          );
        }
      }

      ins = await client.query(
        `INSERT INTO leaves (employee_id, leave_type, start_date, end_date, total_days, reason, is_half_day, half_day_type, start_time, end_time, hours, sandwich_days, sandwich_dates)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::date[])
         RETURNING id as "_id", leave_type as "leaveType", start_date as "startDate",
         end_date as "endDate", total_days as "totalDays", reason, status,
         is_half_day as "isHalfDay", half_day_type as "halfDayType", created_at as "createdAt",
         start_time as "startTime", end_time as "endTime", hours,
         sandwich_days as "sandwichDays", sandwich_dates as "sandwichDates"`,
        [subjectId, leaveType, startDate, endDateVal, totalDays, reason, isHalfDay || false, halfDayType || null,
         permStartTime, permEndTime, isPermission ? permHours : null,
         sandwich.days, sandwich.dates.length ? sandwich.dates : null]
      );

      const leaveId = ins.rows[0]._id;

      // ── Build the hierarchy-based approval chain (Employee Tree) ──
      let approverLevels = [];
      try {
        approverLevels = await createLevels(client, 'leave', leaveId, subjectId);
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

        await createFeedEntry(subjectId, 'leave', 'Leave Applied', msg, '📅');

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
        /* Approvals, not the Leave Tracker. This pointed at
         * /more-services/operations/leave-tracker?openId=..., which reads a
         * `tab` parameter but has never read `openId` — so the id was dropped
         * and the approver landed on User-specific Operations, an empty search
         * box, with nothing to tell them which request they had come for.
         *
         * No tab is given because the Approvals screen works out which one the
         * id belongs to and opens the request itself. Regularization and
         * on-duty have always linked here; leave was the odd one out. */
        await Promise.all(allRecipients.map(a => createNotification(
          a.id, 'approval', notifTitle, notifMsg,
          `/approvals?openId=${leaveId}`
        ).catch(err => logger.warn({ err: err.message }, '[leaves] notify approver failed'))));

        const baseUrl = process.env.APP_URL || 'https://nxtpeople.altiusnxt.tech';
        const leaveTypeDisplay = leaveType === 'permission' ? 'Permission' :
                                 leaveType === 'comp_off' ? 'Compensatory Off' :
                                 leaveType.charAt(0).toUpperCase() + leaveType.slice(1) + ' Leave';
        // Same destination as the in-app notification above, so the mail and
        // the bell do not land the approver in two different places.
        const approvalLink = `${baseUrl}/approvals?openId=${leaveId}`;

        // Settings > Approvals > Messages decides who is written to, with what
        // subject, and whether a template replaces the built-in wording. Until
        // this was wired that card was stored and ignored.
        const mail = await approvalEmail({
          requestType: 'leave',
          record: { leaveType, totalDays, startDate, endDate },
          approverEmails: allRecipients.map(a => a.email).filter(Boolean),
          employeeId: subjectId,
          vars: {
            EmployeeName: empName, LeaveType: leaveTypeDisplay,
            FromDate: startDate, ToDate: endDateVal, Days: totalDays,
            Reason: reason || '', Link: approvalLink,
            // The seeded templates say ${requestType}; without it the phrase
            // "your ${requestType} is waiting" reached inboxes verbatim.
            RequestType: leaveTypeDisplay,
          },
        });

        if (mail.html) {
          // A chosen template replaces the whole email, so the built-in layout
          // is not rendered underneath it.
          //
          // One message per approver rather than one to all of them: the
          // templates open "Hi ${approverName}," and a single render shared
          // across the list can only leave that blank. It also stops every
          // approver seeing who else is on the request.
          const byEmail = new Map(allRecipients
            .filter(a => a.email)
            .map(a => [a.email.toLowerCase(), a.firstName || null]));
          await Promise.all(mail.to.map(async address => {
            const html = await mail.htmlFor(byEmail.get(String(address).toLowerCase()) || null);
            return sendMail({
              to: address, cc: mail.cc, bcc: mail.bcc, replyTo: mail.replyTo,
              subject: mail.subject || 'A request is waiting for your approval',
              html: html || mail.html,
            }).catch(err => logger.warn({ err: err.message }, '[leaves] approver email failed'));
          }));
        } else {
          await Promise.all(mail.to.map(address =>
            sendLeaveApprovalEmail({
              to: address,
              employeeName: empName,
              leaveType: leaveTypeDisplay,
              startDate,
              endDate,
              totalDays,
              reason,
              approvalLink,
              customSubject: mail.subject || undefined,
              cc: mail.cc, bcc: mail.bcc, replyTo: mail.replyTo,
              hours: isPermission ? permHours : null,
              startTime: isPermission ? permStartTime : null,
              endTime: isPermission ? permEndTime : null,
            }).catch(err => logger.warn({ err: err.message }, '[leaves] approver email failed'))
          ));
        }
      } catch (e) { logger.error({ err: e.message }, '[leaves] notify/feed soft-fail'); }

      // Fire-and-forget by design: the leave is already committed, and a
      // workflow must never be able to fail or delay the request that raised it.
      fire('leave', 'created', { recordId: ins.rows[0].id, actorId: subjectId });
      res.status(201).json({ success: true, data: ins.rows[0], message: 'Leave applied successfully' });
    } catch (txErr) {
      await client.query('ROLLBACK').catch(() => {});
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err) {
    serverError(res, err);
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
  // Which store the days came out of, recorded on the leave so a later
  // cancellation puts them back into that same store.
  let balanceSource = null;

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
        // Final approval — take the days off whichever store actually holds
        // this employee's balance, and remember which one that was. The three
        // branches that used to live here (leave_balances, the legacy column,
        // the comp-off ledger) now sit next to their matching refund in
        // utils/leaveBalance.js, because a debit and its refund landing in
        // different stores is exactly what went wrong before.
        if (leave.leave_type !== 'unpaid') {
          const year = new Date(leave.start_date).getFullYear();
          balanceSource = await debitOnApproval(client, {
            employeeId: leave.employee_id,
            leaveType: leave.leave_type,
            days: leave.total_days,
            year,
          });
        }
        await client.query(
          // The optional approver comment reuses the rejection_reason column;
          // COALESCE keeps any earlier note when no new comment is provided.
          `UPDATE leaves SET status='approved', approved_by=$1, approved_at=NOW(), rejection_reason=COALESCE($2, rejection_reason), balance_source=$4, updated_at=NOW() WHERE id=$3`,
          [req.user._id, rejectionReason || null, leave.id, balanceSource]
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
        // "Also tell the requester when it is Approved" on the Approvals
        // screen. Switching it off used to change nothing.
        const notice = await outcomeEmail({
          requestType: 'leave', record: leave, event: 'approved',
          vars: {
            EmployeeName: empRes.rows[0]?.name || '', LeaveType: leaveLabel,
            FromDate: startLabel, Days: leave.total_days,
            RequestType: leaveLabel,
            ApproverName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || null,
          },
        });
        if (empRes.rows[0]?.email && notice.send) {
          if (notice.html) {
            await sendMail({
              to: [empRes.rows[0].email], cc: notice.cc, bcc: notice.bcc, replyTo: notice.replyTo,
              subject: notice.subject || 'Your request has been approved',
              html: notice.html,
            });
          } else {
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
        }
      } catch (e) { logger.warn({ err: e.message }, '[leaves] employee status email failed'); }
      await logAudit(req, { action: 'APPROVE', resource: 'Leave', resourceId: leave.id, changes: { allApproved: result.allApproved } });
      // Only once every level has approved. Firing per level would send the
      // "your leave is approved" mail while it is still awaiting someone.
      if (result.allApproved) fire('leave', 'approved', { recordId: leave.id, actorId: req.user._id });
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
      const notice = await outcomeEmail({
        requestType: 'leave', record: leave, event: 'rejected',
        vars: {
          EmployeeName: empRes.rows[0]?.name || '', LeaveType: leaveLabel,
          FromDate: startLabel, Days: leave.total_days, Reason: rejectionReason || '',
          RequestType: leaveLabel,
          ApproverName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || null,
        },
      });
      if (empRes.rows[0]?.email && notice.send) {
        if (notice.html) {
          await sendMail({
            to: [empRes.rows[0].email], cc: notice.cc, bcc: notice.bcc, replyTo: notice.replyTo,
            subject: notice.subject || 'Your request has been rejected',
            html: notice.html,
          });
        } else {
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
      }
    } catch (e) { logger.warn({ err: e.message }, '[leaves] employee rejection email failed'); }
    await logAudit(req, { action: 'REJECT', resource: 'Leave', resourceId: leave.id, changes: { status: 'rejected', rejectionReason } });
    fire('leave', 'rejected', { recordId: leave.id, actorId: req.user._id });
    return res.json({ success: true, status: 'rejected', message: 'Leave rejected.' });

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    serverError(res, err);
  } finally {
    client.release();
  }
});

// ── Cancel someone else's leave ─────────────────────────────────────────────
// Cancels a PENDING request: the row is KEPT with status 'cancelled' (so it
// appears under the Cancelled filter) rather than deleted. Balance is refunded
// exactly like a rejection. Approved leaves are left to the owner-delete path's
// existing rule (not cancellable here).
//
// There is no authorize() guard because the permissions matrix on Leave
// Tracker > Configuration > Leave Request IS the guard, and it distinguishes
// reporting managers from approvers — a distinction no role guard can make,
// since both are relationships to the employee rather than roles. canCancel()
// resolves those relationships and refuses anybody holding neither, so an
// unrelated employee gets a 403 exactly as before.
router.put('/:id/cancel', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const leaveRes = await client.query(`SELECT * FROM leaves WHERE id=$1 FOR UPDATE`, [req.params.id]);
    const leave = leaveRes.rows[0];
    if (!leave) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Leave not found' }); }
    // An approved leave is the case this whole screen exists for. The
    // cancellation rules are "leave from today onwards", "past leave in the
    // current pay period" and "past leave in the current calendar year" — and
    // the last two describe leave that was necessarily approved and taken. A
    // status gate here used to refuse every one of them before canCancel() was
    // consulted, which left the entire configuration unable to do anything.
    // Already-resolved leaves stay refused: there is nothing left to cancel.
    if (leave.status !== 'pending' && leave.status !== 'approved') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: `This leave is already ${leave.status}.` });
    }

    const config = await loadConfig();
    const verdict = await canCancel({ user: req.user, leave, config });
    if (!verdict.allowed) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, message: verdict.reason });
    }
    const reason = String(req.body?.reason || '').trim();
    if (config.cancellationReasonMandatory && !reason) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'A reason for cancelling is required.' });
    }

    // What gets refunded depends on what was actually debited, and the two
    // differ by status.
    //
    // A pending leave only ever reserved against leave_balances.available —
    // the legacy columns and the comp-off ledger are not touched until
    // approval — so reversing that reservation is the whole job.
    //
    // An approved leave has additionally been debited from whichever store
    // holds the balance, recorded at the time in balance_source. Returning the
    // days to a store that was never debited, which is what a single shared
    // refund path would do, is how a cancellation quietly destroys a day.
    if (leave.leave_type !== 'unpaid' && leave.total_days > 0) {
      const year = new Date(leave.start_date).getFullYear();
      if (leave.status === 'approved') {
        await refundApproved(client, {
          employeeId: leave.employee_id, leaveType: leave.leave_type,
          days: leave.total_days, year, store: leave.balance_source,
        });
      } else {
        const ltRes = await client.query(`SELECT id FROM leave_types WHERE code=$1`, [dbTypeCode(leave.leave_type)]);
        if (ltRes.rows[0]) {
          await client.query(
            `UPDATE leave_balances SET available=available+$1 WHERE employee_id=$2 AND leave_type_id=$3 AND year=$4`,
            [leave.total_days, leave.employee_id, ltRes.rows[0].id, year]
          );
        }
      }
    }
    await client.query(
      `UPDATE leaves
          SET status='cancelled', cancellation_reason=$2, cancelled_by=$3, cancelled_at=NOW(), updated_at=NOW()
        WHERE id=$1`,
      [leave.id, reason || null, req.user._id]
    );
    await client.query('COMMIT');

    const leaveLabel = leave.leave_type.charAt(0).toUpperCase() + leave.leave_type.slice(1);
    const startLabel = new Date(leave.start_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    // Naming the person rather than "HR": a reporting manager or an approver
    // can cancel too now, and being told the wrong party did it is worse than
    // being told nothing.
    const byRes = await pool.query(
      `SELECT TRIM(CONCAT(first_name, ' ', last_name)) AS name FROM employees WHERE id = $1`, [req.user._id]
    ).catch(() => ({ rows: [] }));
    const by = byRes.rows[0]?.name || 'an approver';
    await createNotification(leave.employee_id, 'leave', 'Leave Cancelled',
      `Your ${leaveLabel} leave from ${startLabel} was cancelled by ${by}.${reason ? ` Reason: ${reason}` : ''}`,
      '/leave-tracker/summary'
    ).catch(() => {});
    await logAudit(req, { action: 'CANCEL', resource: 'Leave', resourceId: leave.id, changes: { prior_status: leave.status, status: 'cancelled', matrix_row: verdict.row, balance_source: leave.balance_source || null, reason: reason || null } });
    // The people who approved it are told it is gone. Fire-and-forget: the
    // cancellation is already committed, so a mail failure must not undo it.
    notifyChainOfCancellation({ leave, actor: req.user, kind: 'full' });
    return res.json({ success: true, status: 'cancelled', message: 'Leave cancelled.' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    serverError(res, err);
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
      'SELECT id, employee_id, status, leave_type, start_date, end_date, total_days, balance_source FROM leaves WHERE id=$1 AND employee_id=$2 FOR UPDATE',
      [req.params.id, req.user._id]
    );
    if (leaveRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Leave not found' });
    }
    const leave = leaveRes.rows[0];
    // Whether an approved leave may be withdrawn is canCancel()'s decision, not
    // a flat refusal here. The cancellation rules cover past leave in the pay
    // period and past leave in the calendar year, both of which are approved by
    // definition; refusing on status first meant neither rule could ever apply.
    if (leave.status !== 'pending' && leave.status !== 'approved') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: `This leave is already ${leave.status}.` });
    }

    // When the leave falls decides whether the employee may cancel it at all.
    // Until this was wired an employee could withdraw a leave from any month of
    // the year as long as it had not been approved.
    const config = await loadConfig();
    const verdict = await canCancel({ user: req.user, leave, config });
    if (!verdict.allowed) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, message: verdict.reason });
    }
    const cancelReason = String(req.body?.reason || '').trim();
    if (config.cancellationReasonMandatory && !cancelReason) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'A reason for cancelling is required.' });
    }

    // Rejected and cancelled leaves were already refunded when they were
    // rejected or cancelled, and are refused above, so only these two states
    // reach here. They are refunded differently: a pending leave has only ever
    // reserved against leave_balances.available, while an approved one was
    // debited from whichever store balance_source names.
    if (leave.leave_type !== 'unpaid' && leave.total_days > 0) {
      const year = new Date(leave.start_date).getFullYear();
      if (leave.status === 'approved') {
        await refundApproved(client, {
          employeeId: leave.employee_id, leaveType: leave.leave_type,
          days: leave.total_days, year, store: leave.balance_source,
        });
      } else {
        const ltRes = await client.query(`SELECT id FROM leave_types WHERE code=$1`, [dbTypeCode(leave.leave_type)]);
        if (ltRes.rows[0]) {
          await client.query(
            `UPDATE leave_balances
                SET available = available + $1
              WHERE employee_id=$2 AND leave_type_id=$3 AND year=$4`,
            [leave.total_days, req.user._id, ltRes.rows[0].id, year]
          );
        }
      }
    }
    await client.query(
      `UPDATE leaves SET status='cancelled', cancellation_reason=$2, cancelled_by=$3, cancelled_at=NOW()
        WHERE id=$1`,
      [req.params.id, cancelReason || null, req.user._id]
    );
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
        matrix_row: verdict.row,
        reason: cancelReason || null,
      },
    });
    notifyChainOfCancellation({ leave, actor: req.user, kind: 'full' });
    res.json({ success: true, message: 'Leave cancelled' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    serverError(res, err);
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
      'SELECT casual_leave, sick_leave, earned_leave, unpaid_leave, joining_date::text AS "joiningDate" FROM employees WHERE id=$1',
      [targetId]
    );
    const emp = empRes.rows[0] || {};

    // Count booked leaves this year per type.
    //
    // Pending counts as booked. A request in flight is already reserved —
    // applying debits leave_balances.available immediately and cancelling
    // refunds it — so counting only approved days showed somebody 12 available
    // and 4 booked while the system had in fact set 5 aside. The reference
    // counts it the same way: Zoho reads 5 booked where 4 are approved and one
    // is still waiting.
    const bookedRes = await pool.query(
      `SELECT leave_type,
              COALESCE(SUM(total_days), 0) AS used,
              COALESCE(SUM(hours), 0)      AS hours
       FROM leaves
       WHERE employee_id=$1 AND status IN ('approved','pending')
         AND EXTRACT(YEAR FROM start_date) = $2
       GROUP BY leave_type`,
      [targetId, year]
    );
    const booked = {}, bookedHours = {};
    bookedRes.rows.forEach(r => {
      booked[r.leave_type] = parseFloat(r.used);
      bookedHours[r.leave_type] = parseFloat(r.hours);
    });

    // Permission is hourly and capped per CURRENT calendar month with no
    // carry-forward, at whatever Leave Policy sets as its accrual.
    // Used = approved permission hours dated in the current month.
    const permPolicy = (await getLeavePolicies()).get('permission');
    const permMonthly = ['monthly', 'annual'].includes(permPolicy.accrualMode) ? permPolicy.accrualAmount : 0;
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
    const permAvailable = round2(Math.max(0, permMonthly - permUsed));

    /* This month is what you may still take; the year is how much permission
     * you have had. The card showed only the month, so "Available 4h" told
     * somebody nothing about whether they had used two hours this year or
     * forty — which is the figure that matters when anybody asks about it. */
    /* The whole year, not the year so far. This passed the current month as a
     * cut-off, so in August the card showed 32 hours granted where the leave
     * ledger — which has always granted all twelve — showed 48. Same employee,
     * same year, two different figures on two screens. The cut-off was removed
     * from the accrual engine for exactly this reason; this caller was missed. */
    const permGrantedYear = round2(grantedToDate(permPolicy, {
      year, joiningDate: emp?.joiningDate, joiningRule: await getJoiningRule(),
    }) || 0);
    const permBookedYear = round2(bookedHours['permission'] || 0);
    const permAvailableYear = round2(permGrantedYear - permBookedYear);

    // Comp-Off is an earned-credit system in its own table: available =
    // approved credits still within their validity window, minus any used.
    const coRes = await pool.query(
      `SELECT COALESCE(SUM(days_earned - days_used), 0) AS avail
         FROM comp_offs
        WHERE employee_id = $1 AND status = 'approved'
          AND (expires_at IS NULL OR expires_at >= CURRENT_DATE)`,
      [targetId]
    );
    const compOffAvailable = Math.max(0, round2(parseFloat(coRes.rows[0].avail) || 0));

    /* Casual, from the one function that also decides whether an application
     * is allowed. `granted` rides along so the card can say where the number
     * came from — an accrual that has only reached August is not the same as a
     * year's allowance already spent, and the figure alone cannot tell them
     * apart. */
    /* Try leave_balances table first.
     *
     * This selected lb.total and lb.used, columns the table has never had —
     * it only has available and booked (migrate_zoho_features.js). The query
     * has been throwing on every single call and silently swallowed by the
     * catch below, so balanceRows has always been empty and nothing has ever
     * actually been read out of it. */
    let balanceRows = [];
    try {
      const lbRes = await pool.query(
        `SELECT lb.year, lb.available, lb.booked,
         lt.name, lt.code, lt.icon, lt.color
         FROM leave_balances lb
         JOIN leave_types lt ON lb.leave_type_id = lt.id
         WHERE lb.employee_id=$1 AND lb.year=$2`,
        [targetId, year]
      );
      balanceRows = lbRes.rows;
    } catch (_) {}

    const casualStore = await availableFor(pool, targetId, 'casual', year);
    /* `available` is always availableFor's number — the same one the apply-time
     * check uses, so the card can never promise more than a request would
     * actually be allowed.
     *
     * `granted` is the "22 of -" gap: an imported balance has no accrual to
     * compute, so there was never a number to put after "of". The table has
     * no stored total either — but available + booked reconstructs it exactly,
     * because every write to this store preserves that sum: applying moves a
     * day out of available, approving moves it into booked, rejecting or
     * cancelling an approved leave puts it back the other way. Whatever the
     * split between the two, they always add back up to the year's grant. */
    const casualBalance = casualStore.store === 'computed'
      ? await computedFor(pool, targetId, 'casual', year)
      : {
          available: casualStore.available,
          granted: (() => {
            const row = balanceRows.find(r => r.code === 'casual');
            return row ? round2((parseFloat(row.available) || 0) + (parseFloat(row.booked) || 0)) : null;
          })(),
        };

    // Build response: priority order = Casual, Comp-Off, LWP, Permission
    const cards = [
      {
        code: 'casual', name: 'Casual Leave', icon: '☀️', color: '#f59e0b',
        /* The same answer the application check uses, from the same function.
         *
         * This used to do its own arithmetic — employees.casual_leave minus the
         * year's bookings — on the belief that the column was a fixed
         * entitlement. It is not: approval had already subtracted from it, so
         * approved days came off twice here and once there, and an employee was
         * shown a smaller number than the system would actually let them book.
         * Two numbers for one question is worse than either being wrong. */
        available: casualBalance.available,
        booked: booked['casual'] || 0,
        granted: casualBalance.granted,
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
        // Hours, not days: this month's remaining out of the configured
        // monthly allowance.
        unit: 'hours', monthlyLimit: permMonthly,
        available: permAvailable,
        booked: permUsed,
        // The year, beside the month.
        grantedYear: permGrantedYear,
        bookedYear: permBookedYear,
        availableYear: permAvailableYear,
      },
    ];

    /* The two figures in the header above the cards.
     *
     * They were being assembled in the browser by summing the leave list, and
     * total_days arrives from pg as a STRING because it is numeric — so
     * `0 + '0' + '2' + '1' + '1'` produced "00211 day(s)" on a screen an
     * employee reads. Summing belongs here, next to the SQL, where the types
     * are known.
     *
     * Days and hours are reported separately rather than added: two hours of
     * permission is not a fraction of a leave day, and the reference says
     * "5 day(s) and 2 hour(s)" for exactly that reason.
     */
    const totals = await pool.query(
      `SELECT COALESCE(SUM(total_days), 0)::float AS days,
              COALESCE(SUM(hours), 0)::float      AS hours
         FROM leaves
        WHERE employee_id = $1 AND status IN ('approved','pending')
          AND EXTRACT(YEAR FROM start_date) = $2`,
      [targetId, year]
    );

    // Absence is a stored attendance status here, which is the same definition
    // the Leave Balance screen counts. It is NOT the reference's figure — Zoho
    // counts absence recorded in its leave tracker, and reports 0 for somebody
    // its own attendance shows absent — so the two will differ, deliberately.
    const absent = await pool.query(
      `SELECT COUNT(*)::int AS n FROM attendance
        WHERE employee_id = $1 AND status = 'absent'
          AND EXTRACT(YEAR FROM date) = $2`,
      [targetId, year]
    );

    res.json({
      success: true, data: cards, year,
      summary: {
        bookedDays: round2(totals.rows[0].days),
        bookedHours: round2(totals.rows[0].hours),
        absentDays: absent.rows[0].n,
      },
    });
  } catch (err) {
    serverError(res, err);
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
    serverError(res, err);
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
    serverError(res, err);
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
    serverError(res, err);
  }
});

// Leave extension was built here and removed deliberately.
//
// It let an approved leave grow by moving its end date, which sounds tidy
// — one absence, one record — and is not. The approval chain has several
// levels; a manager extending is level one, so levels two and three would
// never see the added day. Applying it immediately therefore skipped part of
// the hierarchy, and sending it back through the chain made it a new leave
// request with extra machinery bolted on. Either way worse than the thing
// that already works.
//
// Raising a second request is the answer. The settings card says so.
// leaves.extension_reason / extended_by / extended_at stay on the table:
// dropping columns is riskier than leaving three unused ones.

// ── PUT cancel part of a leave ─────────────────────────────────────────────
//
// Leave Tracker > Configuration > Leave Request > "Allow partial leave
// cancellation". The note under it was honest about the cost: cancelling part
// of a range has to split the request in two. That is what this does.
//
// Three shapes, and the third is the one that makes this awkward:
//   - the cancelled part starts the range  -> the request moves its start later
//   - the cancelled part ends the range    -> the request pulls its end earlier
//   - the cancelled part is in the middle  -> the request keeps the head, and a
//                                             second request is created for the
//                                             tail, carrying split_from
//
// Who may do it is decided by canCancel, not by a matrix of its own: the screen
// offers partial cancellation as a modifier on cancelling rather than as a
// separate permission, so whoever may cancel the whole may cancel a part.
router.put('/:id/cancel-partial', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const leave = (await client.query(
      `SELECT * FROM leaves WHERE id = $1 FOR UPDATE`, [req.params.id])).rows[0];
    if (!leave) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Leave not found' }); }

    if (leave.status !== 'pending' && leave.status !== 'approved') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: `This leave is already ${leave.status}.` });
    }

    const config = await loadConfig();
    if (!partialAllowed(config)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Partial leave cancellation is switched off. This is set under Leave Tracker → Configuration → Leave Request.',
      });
    }

    const from = String(req.body?.startDate || '').slice(0, 10);
    const to = String(req.body?.endDate || '').slice(0, 10);
    const bounds = /^\d{4}-\d{2}-\d{2}$/;
    if (!bounds.test(from) || !bounds.test(to) || to < from) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'A valid start and end date are required for the part being cancelled' });
    }

    const leaveStart = ymdLocal(leave.start_date);
    const leaveEnd = ymdLocal(leave.end_date);
    if (from < leaveStart || to > leaveEnd) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `That range is outside the leave, which runs ${leaveStart} to ${leaveEnd}.`,
      });
    }
    if (from === leaveStart && to === leaveEnd) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'That is the whole leave — cancel it outright rather than partially.',
      });
    }

    const verdict = await canCancel({ user: req.user, leave, config });
    if (!verdict.allowed) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, message: verdict.reason });
    }
    const reason = String(req.body?.reason || '').trim();
    if (config.cancellationReasonMandatory && !reason) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'A reason for cancelling is required.' });
    }

    const removedDays = await countWorkingDays(from, to);
    if (removedDays <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Those dates are all non-working days, so cancelling them frees nothing.',
      });
    }

    const year = new Date(leave.start_date).getFullYear();
    // Only an approved leave has been debited. A pending one reserved against
    // leave_balances at apply time, exactly as the whole-leave path assumes.
    if (leave.leave_type !== 'unpaid') {
      if (leave.status === 'approved') {
        await refundApproved(client, {
          employeeId: leave.employee_id, leaveType: leave.leave_type,
          days: removedDays, year, store: leave.balance_source,
        });
      } else {
        const lt = await client.query(`SELECT id FROM leave_types WHERE code = $1`, [dbTypeCode(leave.leave_type)]);
        if (lt.rows[0]) {
          await client.query(
            `UPDATE leave_balances SET available = available + $1
              WHERE employee_id = $2 AND leave_type_id = $3 AND year = $4`,
            [removedDays, leave.employee_id, lt.rows[0].id, year]);
        }
      }
    }

    const dayBefore = (d) => { const x = new Date(`${d}T00:00:00`); x.setDate(x.getDate() - 1); return ymdLocal(x); };
    const dayAfter = (d) => { const x = new Date(`${d}T00:00:00`); x.setDate(x.getDate() + 1); return ymdLocal(x); };

    let outcome;
    if (from === leaveStart) {
      // Head removed: the request now starts the day after the cancelled part.
      const newStart = dayAfter(to);
      const days = await countWorkingDays(newStart, leaveEnd);
      await client.query(
        `UPDATE leaves SET start_date = $2::date, total_days = $3,
                cancelled_days = COALESCE(cancelled_days, 0) + $4, updated_at = NOW()
          WHERE id = $1`, [leave.id, newStart, days, removedDays]);
      outcome = { shape: 'start_trimmed', remaining: [{ from: newStart, to: leaveEnd, days }] };
    } else if (to === leaveEnd) {
      // Tail removed: the request now ends the day before it.
      const newEnd = dayBefore(from);
      const days = await countWorkingDays(leaveStart, newEnd);
      await client.query(
        `UPDATE leaves SET end_date = $2::date, total_days = $3,
                cancelled_days = COALESCE(cancelled_days, 0) + $4, updated_at = NOW()
          WHERE id = $1`, [leave.id, newEnd, days, removedDays]);
      outcome = { shape: 'end_trimmed', remaining: [{ from: leaveStart, to: newEnd, days }] };
    } else {
      // Middle removed: the original keeps the head, and the tail becomes its
      // own request so the two halves can be approved, cancelled or reported on
      // independently. It carries split_from so the pair stays traceable.
      const headEnd = dayBefore(from);
      const tailStart = dayAfter(to);
      const headDays = await countWorkingDays(leaveStart, headEnd);
      const tailDays = await countWorkingDays(tailStart, leaveEnd);

      await client.query(
        `UPDATE leaves SET end_date = $2::date, total_days = $3,
                cancelled_days = COALESCE(cancelled_days, 0) + $4, updated_at = NOW()
          WHERE id = $1`, [leave.id, headEnd, headDays, removedDays]);

      const tail = (await client.query(
        `INSERT INTO leaves
           (employee_id, leave_type, start_date, end_date, total_days, reason, status,
            approved_by, approved_at, balance_source, split_from)
         VALUES ($1,$2,$3::date,$4::date,$5,$6,$7,$8,$9,$10,$11)
         RETURNING id`,
        [leave.employee_id, leave.leave_type, tailStart, leaveEnd, tailDays,
         leave.reason, leave.status, leave.approved_by, leave.approved_at,
         leave.balance_source, leave.id])).rows[0];

      // The tail inherits the original's standing, so an approved leave split
      // in two does not quietly send half of itself back for approval.
      if (leave.status === 'pending') {
        await createLevels(client, 'leave', tail.id, leave.employee_id, {});
      }
      outcome = {
        shape: 'split',
        remaining: [
          { from: leaveStart, to: headEnd, days: headDays, id: leave.id },
          { from: tailStart, to: leaveEnd, days: tailDays, id: tail.id },
        ],
      };
    }

    await client.query('COMMIT');

    await logAudit(req, {
      action: 'CANCEL_PARTIAL', resource: 'Leave', resourceId: leave.id,
      changes: {
        cancelled_from: from, cancelled_to: to, cancelled_days: removedDays,
        prior_status: leave.status, shape: outcome.shape,
        matrix_row: verdict.row, balance_source: leave.balance_source || null,
        reason: reason || null,
      },
    });
    notifyChainOfCancellation({
      leave, actor: req.user, kind: 'partial',
      detail: { from, to, days: removedDays, shape: outcome.shape, remaining: outcome.remaining },
    });
    await createNotification(leave.employee_id, 'leave', 'Leave Partly Cancelled',
      `${removedDays} day(s) of your ${leave.leave_type} leave (${from} to ${to}) were cancelled.`,
      '/leave-tracker/summary').catch(() => {});

    return res.json({
      success: true,
      data: { cancelledDays: removedDays, ...outcome },
      message: `${removedDays} day(s) cancelled.`,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return serverError(res, err, 'partial leave cancellation');
  } finally { client.release(); }
});

module.exports = router;
