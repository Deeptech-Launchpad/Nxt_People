const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { isFullAccess } = require('../utils/roles');
const { approvalLevelsJson } = require('../utils/leaveApproval');
const { serverError } = require('../utils/serverError');
const { DEFAULT_TZ } = require('../utils/timezone');
router.use(protect);

/* ── What the approval queue shows ─────────────────────────────────────────
 *  Pending queues are NOT filtered by month.
 *
 *  They were, briefly, with a Backlog tab beside them holding what fell
 *  behind. The years of unactioned requests the Zoho import brought over have
 *  since been settled, so there is nothing to hide any more — and filtering
 *  with no backlog tab to catch the remainder would make anything that slips
 *  past its month vanish silently, which is worse than the clutter it was
 *  meant to remove. A queue you cannot see is a queue nobody clears.
 *
 *  Soft-deleted employees are still excluded everywhere. Employment status is
 *  filtered only on Approved / Rejected, which are reports rather than work.
 * ───────────────────────────────────────────────────────────────────────── */
// Hierarchy approval chain as JSON for the timeline, per request type/table.
const LEAVE_LEVELS_JSON = approvalLevelsJson('leave', 'l');
const REG_LEVELS_JSON   = approvalLevelsJson('regularization', 'r');
const COMPOFF_LEVELS_JSON = approvalLevelsJson('comp_off', 'c');
const WFH_LEVELS_JSON   = approvalLevelsJson('wfh', 'w');
const OD_LEVELS_JSON    = approvalLevelsJson('on_duty', 'o');

router.get('/pending', authorize('admin', 'director', 'hr_admin', 'manager', 'team_incharge'), async (req, res) => {
  try {
    const userId = req.user._id;
    // Full-access (Super Admin / HR) sees the entire org's pending queue;
    // everyone else sees pending leaves where they are an assigned approver of a
    // still-pending hierarchy level. canAct mirrors that (the per-level
    // "top not first" gate is enforced at action time).
    const full = isFullAccess(req.user.role);

    /* Every one of these joins employees and none of them excluded a
     * soft-deleted one, so `e.deleted_at IS NULL` now appears on all of them.
     *
     * Employment status is filtered only on the Approved / Rejected query.
     * A PENDING request from somebody who has left is still work to clear,
     * and hiding it would leave it pending for ever; a finished one is a
     * report, and last year's leave for people who have gone does not
     * belong on this month's. */
    // Order here must match the order of the queries below, exactly.
    const [leavesRes, regRes, wfhRes, onDutyRes, compOffRes, approvedLeavesRes] = await Promise.all([
      pool.query(`
        SELECT l.id as "_id", l.leave_type as "leaveType", l.start_date as "startDate", l.end_date as "endDate",
               l.total_days as "totalDays", l.hours, l.start_time as "startTime", l.end_time as "endTime",
               l.reason, l.status, l.is_half_day as "isHalfDay", l.created_at as "createdAt",
               json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name,
                 'department', e.department, 'employeeId', e.employee_id) as employee,
               ${LEAVE_LEVELS_JSON} as "approvalLevels",
               ($2::boolean OR EXISTS (
                  SELECT 1 FROM approval_levels x
                   WHERE x.request_type = 'leave' AND x.request_id = l.id AND x.approver_id = $1 AND x.status = 'pending'
               )) as "canAct"
        FROM leaves l
        JOIN employees e ON l.employee_id = e.id
        WHERE l.status = 'pending'
          AND e.deleted_at IS NULL
          AND ($2::boolean OR EXISTS (
               SELECT 1 FROM approval_levels x
                WHERE x.request_type = 'leave' AND x.request_id = l.id AND x.approver_id = $1 AND x.status = 'pending'
          ))
        ORDER BY l.created_at DESC
      `, [userId, full]),

      // Regularizations now flow through the same hierarchy engine as leaves.
      pool.query(`
        SELECT r.id as "_id", r.date, r.check_in as "checkIn", r.check_out as "checkOut",
               r.reason, r.status, r.created_at as "createdAt",
               json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name,
                 'department', e.department, 'employeeId', e.employee_id) as employee,
               ${REG_LEVELS_JSON} as "approvalLevels",
               ($2::boolean OR EXISTS (
                  SELECT 1 FROM approval_levels x
                   WHERE x.request_type = 'regularization' AND x.request_id = r.id AND x.approver_id = $1 AND x.status = 'pending'
               )) as "canAct"
        FROM attendance_regularizations r JOIN employees e ON r.employee_id = e.id
        WHERE r.status = 'pending'
          AND e.deleted_at IS NULL
          AND ($2::boolean OR EXISTS (
               SELECT 1 FROM approval_levels x
                WHERE x.request_type = 'regularization' AND x.request_id = r.id AND x.approver_id = $1 AND x.status = 'pending'
          ))
        ORDER BY r.date DESC
      `, [userId, full]),

      pool.query(`
        SELECT w.id as "_id", w.date, w.reason, w.status, w.rejection_reason as "rejectionReason", w.created_at as "createdAt",
               json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name,
                 'department', e.department, 'employeeId', e.employee_id) as employee,
               ${WFH_LEVELS_JSON} as "approvalLevels",
               ($2::boolean OR EXISTS (
                  SELECT 1 FROM approval_levels x
                   WHERE x.request_type = 'wfh' AND x.request_id = w.id AND x.approver_id = $1 AND x.status = 'pending'
               )) as "canAct"
        FROM wfh_requests w JOIN employees e ON w.employee_id = e.id
        WHERE w.status = 'pending'
          AND e.deleted_at IS NULL
          AND ($2::boolean OR EXISTS (
               SELECT 1 FROM approval_levels x
                WHERE x.request_type = 'wfh' AND x.request_id = w.id AND x.approver_id = $1 AND x.status = 'pending'
          ))
        ORDER BY w.date DESC
      `, [userId, full]),

      pool.query(`
        SELECT o.id as "_id", o.start_date::text as "startDate", o.end_date::text as "endDate",
               o.unit, o.start_time as "startTime", o.end_time as "endTime", o.hours,
               o.request_type as "requestType", o.reason, o.status,
               o.rejection_reason as "rejectionReason", o.created_at as "createdAt",
               json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name,
                 'department', e.department, 'employeeId', e.employee_id) as employee,
               ${OD_LEVELS_JSON} as "approvalLevels",
               ($2::boolean OR EXISTS (
                  SELECT 1 FROM approval_levels x
                   WHERE x.request_type = 'on_duty' AND x.request_id = o.id AND x.approver_id = $1 AND x.status = 'pending'
               )) as "canAct"
        FROM on_duty_requests o JOIN employees e ON o.employee_id = e.id
        WHERE o.status = 'pending'
          AND e.deleted_at IS NULL
          AND ($2::boolean OR EXISTS (
               SELECT 1 FROM approval_levels x
                WHERE x.request_type = 'on_duty' AND x.request_id = o.id AND x.approver_id = $1 AND x.status = 'pending'
          ))
        ORDER BY o.start_date DESC
      `, [userId, full]),

      // Comp-Offs now flow through the same hierarchy engine as leaves.
      pool.query(`
        SELECT c.id as "_id", c.worked_date as "workedDate", c.comp_off_date as "compOffDate",
               c.reason, c.days_earned as "daysEarned", c.expires_at as "expiresAt",
               c.status, c.created_at as "createdAt",
               json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name,
                 'department', e.department, 'employeeId', e.employee_id) as employee,
               ${COMPOFF_LEVELS_JSON} as "approvalLevels",
               ($2::boolean OR EXISTS (
                  SELECT 1 FROM approval_levels x
                   WHERE x.request_type = 'comp_off' AND x.request_id = c.id AND x.approver_id = $1 AND x.status = 'pending'
               )) as "canAct"
        FROM comp_offs c JOIN employees e ON c.employee_id = e.id
        WHERE c.status = 'pending'
          AND e.deleted_at IS NULL
          AND ($2::boolean OR EXISTS (
               SELECT 1 FROM approval_levels x
                WHERE x.request_type = 'comp_off' AND x.request_id = c.id AND x.approver_id = $1 AND x.status = 'pending'
          ))
        ORDER BY c.worked_date DESC
      `, [userId, full]),

      pool.query(`
        SELECT l.id as "_id", l.leave_type as "leaveType", l.start_date as "startDate", l.end_date as "endDate",
               l.total_days as "totalDays", l.hours, l.start_time as "startTime", l.end_time as "endTime",
               l.reason, l.status, l.is_half_day as "isHalfDay", l.created_at as "createdAt",
               l.rejection_reason as "rejectionReason",
               json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name,
                 'department', e.department, 'employeeId', e.employee_id) as employee,
               l.approved_by as "approvedById",
               ${LEAVE_LEVELS_JSON} as "approvalLevels"
        FROM leaves l
        JOIN employees e ON l.employee_id = e.id
        WHERE ${full ? 'TRUE' : `EXISTS (SELECT 1 FROM approval_levels x WHERE x.request_type = 'leave' AND x.request_id = l.id AND x.approver_id = $1)`}
          AND l.status IN ('approved', 'rejected')
          /* This month only. It had no date bound at all, so the Approved and
           * Rejected tabs were showing 2024 alongside today and the 500-row cap
           * was being spent on history nobody was looking for.
           *
           * Overlap rather than start date, so a leave running from the 30th
           * into next month still belongs to this month too. */
          AND l.start_date <= (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::date
          AND l.end_date   >= date_trunc('month', CURRENT_DATE)::date
          /* People, not records. Deleted rows were never excluded here at all.
           *
           * Somebody whose last working day falls inside this month is still
           * this month's business — they were an employee for part of it and
           * their leave belongs on the report. It is only once their last day
           * is behind the month that they drop off. */
          AND e.deleted_at IS NULL
          AND (
            e.status = 'active'
            OR e.exit_date >= date_trunc('month', CURRENT_DATE)::date
          )
        ORDER BY l.start_date DESC LIMIT 500
      `, full ? [] : [userId]),
    ]);

    const leaves = leavesRes.rows;
    const regularizations = regRes.rows;
    const wfhRequests = wfhRes.rows;
    const compOffs = compOffRes.rows;
    const onDuty = onDutyRes.rows;
    const approvedLeaves = approvedLeavesRes.rows;
    const total = leaves.length + regularizations.length + wfhRequests.length + compOffs.length + onDuty.length;

    res.json({
      success: true,
      data: { leaves, regularizations, wfhRequests, compOffs, onDuty, approvedLeaves, total }
    });
  } catch (err) { serverError(res, err); }
});

/* ── Approvals done in a month ─────────────────────────────────────────────
 *  Counted by approved_at, which every one of these action handlers sets only
 *  on FINAL approval — a request with one level of three signed is still
 *  pending and is not counted.
 *
 *  Scoped the way the Approved Leaves list above is: full access sees the org,
 *  everyone else sees requests they were an approver on at any level. The
 *  pending queries' "still-pending level" test cannot apply to finished work.
 *
 *  Month boundaries are midnight in the org's timezone, built as timestamptz so
 *  the comparison is right whether a given approved_at column is TIMESTAMP or
 *  TIMESTAMPTZ (the migrations created both).
 * ───────────────────────────────────────────────────────────────────────── */
router.get('/summary', authorize('admin', 'director', 'hr_admin', 'manager', 'team_incharge'), async (req, res) => {
  try {
    const s = await pool.query(`SELECT timezone FROM settings LIMIT 1`).catch(() => ({ rows: [] }));
    const tz = s.rows[0]?.timezone || DEFAULT_TZ;

    const [curYear, curMonth] = new Date().toLocaleDateString('en-CA', { timeZone: tz }).split('-').map(Number);
    const month = req.query.month === undefined ? curMonth : Number(req.query.month);
    const year = req.query.year === undefined ? curYear : Number(req.query.year);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return res.status(400).json({ success: false, message: 'month must be 1-12' });
    }
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return res.status(400).json({ success: false, message: 'Invalid year' });
    }

    const full = isFullAccess(req.user.role);
    const scope = (type, alias) => full
      ? 'TRUE'
      : `EXISTS (SELECT 1 FROM approval_levels x WHERE x.request_type = '${type}' AND x.request_id = ${alias}.id AND x.approver_id = $4)`;
    const people = `e.deleted_at IS NULL AND (e.status = 'active' OR e.exit_date >= make_date($1::int, $2::int, 1))`;
    const inMonth = (alias) => `${alias}.status = 'approved'
          AND ${alias}.approved_at >= (make_date($1::int, $2::int, 1)::timestamp AT TIME ZONE $3::text)
          AND ${alias}.approved_at <  ((make_date($1::int, $2::int, 1) + INTERVAL '1 month')::timestamp AT TIME ZONE $3::text)`;
    const leaveCount = (leaveType) => `(SELECT COUNT(*)::int FROM leaves l JOIN employees e ON l.employee_id = e.id
        WHERE l.leave_type = '${leaveType}' AND ${inMonth('l')} AND ${people} AND ${scope('leave', 'l')})`;
    const tableCount = (table, alias, type) => `(SELECT COUNT(*)::int FROM ${table} ${alias} JOIN employees e ON ${alias}.employee_id = e.id
        WHERE ${inMonth(alias)} AND ${people} AND ${scope(type, alias)})`;

    const r = await pool.query(`
      SELECT ${leaveCount('casual')} AS casual,
             ${leaveCount('permission')} AS permissions,
             ${leaveCount('unpaid')} AS lop,
             ${tableCount('attendance_regularizations', 'r', 'regularization')} AS regularizations,
             ${tableCount('wfh_requests', 'w', 'wfh')} AS wfh,
             ${tableCount('comp_offs', 'c', 'comp_off')} AS "compOff",
             ${tableCount('on_duty_requests', 'o', 'on_duty')} AS "onDuty"
    `, full ? [year, month, tz] : [year, month, tz, req.user._id]);

    res.json({ success: true, data: { month, year, ...r.rows[0] } });
  } catch (err) { serverError(res, err); }
});

module.exports = router;
