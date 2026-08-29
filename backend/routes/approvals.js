const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { isFullAccess } = require('../utils/roles');
const { approvalLevelsJson } = require('../utils/leaveApproval');
const { serverError } = require('../utils/serverError');
router.use(protect);

/* ── This month, and everything still waiting from before it ───────────────
 *  The pending queue listed every unactioned request ever made, so leave from
 *  2022 and 2024 — most of it inherited from the Zoho migration and never
 *  cleared — sat above this week's. Filtering it out would have hidden work
 *  nobody could then action, so instead it is separated: the ordinary tabs
 *  show this month, and a Backlog tab shows what is still waiting from before.
 *
 *  A request is backlog once its whole date range finished before this month
 *  began. A request for NEXT month is not backlog — it is upcoming work and
 *  belongs in the ordinary queue, or it could never be approved.
 * ───────────────────────────────────────────────────────────────────────── */
const MONTH_START = `date_trunc('month', CURRENT_DATE)::date`;

const isBacklog = (endCol) => `(${endCol} < ${MONTH_START})`;

/* Soft-deleted employees never appear anywhere.
 *
 * Current-month work is for people still here, or leaving this month — they
 * were an employee for part of it. Backlog deliberately includes people who
 * have left: clearing their stuck requests is the entire reason that tab
 * exists, and excluding them would strand those rows as pending for ever. */
const visiblePeople = (endCol) =>
  `e.deleted_at IS NULL AND (${isBacklog(endCol)} OR e.status = 'active' OR e.exit_date >= ${MONTH_START})`;

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
    // "top not first" gate is enforced at action time). Other request types
    // keep their existing direct-reports scoping.
    const full = isFullAccess(req.user.role);
    // Direct-reports predicate for the simple (single-step) request types.
    const reportFilter = full ? '' : ' AND (e.reporting_manager_id = $1 OR e.approving_authority_id = $1)';
    const simpleParams = full ? [] : [userId];

    /* Every one of these joins employees and none of them excluded a
     * soft-deleted one, so `e.deleted_at IS NULL` now appears on all seven.
     *
     * Employment status is filtered only on the Approved / Rejected query.
     * A PENDING request from somebody who has left is still work to clear,
     * and hiding it would leave it pending for ever; a finished one is a
     * report, and last year's leave for people who have gone does not
     * belong on this month's. */
    // Order here must match the order of the queries below, exactly.
    const [leavesRes, timesheetsRes, regRes, wfhRes, onDutyRes, compOffRes, approvedLeavesRes] = await Promise.all([
      pool.query(`
        SELECT l.id as "_id", l.leave_type as "leaveType", l.start_date as "startDate", l.end_date as "endDate",
               l.total_days as "totalDays", l.hours, l.start_time as "startTime", l.end_time as "endTime",
               l.reason, l.status, l.is_half_day as "isHalfDay", l.created_at as "createdAt",
               json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name,
                 'department', e.department, 'employeeId', e.employee_id) as employee,
               ${LEAVE_LEVELS_JSON} as "approvalLevels",
               ${isBacklog('l.end_date')} as "isBacklog",
               ($2::boolean OR EXISTS (
                  SELECT 1 FROM approval_levels x
                   WHERE x.request_type = 'leave' AND x.request_id = l.id AND x.approver_id = $1 AND x.status = 'pending'
               )) as "canAct"
        FROM leaves l
        JOIN employees e ON l.employee_id = e.id
        WHERE l.status = 'pending'
          AND ${visiblePeople('l.end_date')}
          AND ($2::boolean OR EXISTS (
               SELECT 1 FROM approval_levels x
                WHERE x.request_type = 'leave' AND x.request_id = l.id AND x.approver_id = $1 AND x.status = 'pending'
          ))
        ORDER BY l.created_at DESC
      `, [userId, full]),

      pool.query(`
        SELECT t.id as "_id", t.week_start_date as "weekStartDate", t.week_end_date as "weekEndDate",
               t.total_hours as "totalHours", t.status, t.notes, t.created_at as "createdAt",
               json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name,
                 'department', e.department, 'employeeId', e.employee_id) as employee,
               ${isBacklog('t.week_end_date')} as "isBacklog"
        FROM timesheets t JOIN employees e ON t.employee_id = e.id
        WHERE t.status = 'submitted' AND ${visiblePeople('t.week_end_date')}${reportFilter} ORDER BY t.created_at DESC
      `, simpleParams),

      // Regularizations now flow through the same hierarchy engine as leaves.
      pool.query(`
        SELECT r.id as "_id", r.date, r.check_in as "checkIn", r.check_out as "checkOut",
               r.reason, r.status, r.created_at as "createdAt",
               json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name,
                 'department', e.department, 'employeeId', e.employee_id) as employee,
               ${REG_LEVELS_JSON} as "approvalLevels",
               ${isBacklog('r.date')} as "isBacklog",
               ($2::boolean OR EXISTS (
                  SELECT 1 FROM approval_levels x
                   WHERE x.request_type = 'regularization' AND x.request_id = r.id AND x.approver_id = $1 AND x.status = 'pending'
               )) as "canAct"
        FROM attendance_regularizations r JOIN employees e ON r.employee_id = e.id
        WHERE r.status = 'pending'
          AND ${visiblePeople('r.date')}
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
               ${isBacklog('w.date')} as "isBacklog",
               ($2::boolean OR EXISTS (
                  SELECT 1 FROM approval_levels x
                   WHERE x.request_type = 'wfh' AND x.request_id = w.id AND x.approver_id = $1 AND x.status = 'pending'
               )) as "canAct"
        FROM wfh_requests w JOIN employees e ON w.employee_id = e.id
        WHERE w.status = 'pending'
          AND ${visiblePeople('w.date')}
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
               ${isBacklog('o.end_date')} as "isBacklog",
               ($2::boolean OR EXISTS (
                  SELECT 1 FROM approval_levels x
                   WHERE x.request_type = 'on_duty' AND x.request_id = o.id AND x.approver_id = $1 AND x.status = 'pending'
               )) as "canAct"
        FROM on_duty_requests o JOIN employees e ON o.employee_id = e.id
        WHERE o.status = 'pending'
          AND ${visiblePeople('o.end_date')}
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
               ${isBacklog('GREATEST(c.worked_date, COALESCE(c.comp_off_date, c.worked_date))')} as "isBacklog",
               ($2::boolean OR EXISTS (
                  SELECT 1 FROM approval_levels x
                   WHERE x.request_type = 'comp_off' AND x.request_id = c.id AND x.approver_id = $1 AND x.status = 'pending'
               )) as "canAct"
        FROM comp_offs c JOIN employees e ON c.employee_id = e.id
        WHERE c.status = 'pending'
          AND ${visiblePeople("GREATEST(c.worked_date, COALESCE(c.comp_off_date, c.worked_date))")}
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
    const timesheets = timesheetsRes.rows;
    const regularizations = regRes.rows;
    const wfhRequests = wfhRes.rows;
    const compOffs = compOffRes.rows;
    const onDuty = onDutyRes.rows;
    const approvedLeaves = approvedLeavesRes.rows;
    const total = leaves.length + timesheets.length + regularizations.length + wfhRequests.length + compOffs.length + onDuty.length;

    res.json({
      success: true,
      data: { leaves, timesheets, regularizations, wfhRequests, compOffs, onDuty, approvedLeaves, total }
    });
  } catch (err) { serverError(res, err); }
});

module.exports = router;
