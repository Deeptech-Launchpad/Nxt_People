const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { createNotification } = require('./notifications');
const { logAudit } = require('../utils/audit');
const { countWorkingDays } = require('../utils/workingDays');
const logger = require('../logger');

router.use(protect);

const VALID_LEAVE_TYPES = ['casual', 'sick', 'earned', 'unpaid'];
// Whitelist mapping leave_type code → physical column name. Defense in
// depth: even though `leave.leave_type` reaches the balance-decrement
// UPDATE from a DB row (not directly from request body), interpolating a
// column name into SQL is dangerous if any future code path stores
// attacker-influenced text in the column. Keep this map exhaustive — any
// missing key short-circuits the UPDATE rather than building bad SQL.
const LEAVE_BALANCE_COLUMN = Object.freeze({
  casual: 'casual_leave',
  sick:   'sick_leave',
  earned: 'earned_leave',
  unpaid: 'unpaid_leave',
});
const VALID_BALANCE_COLUMNS = new Set(Object.values(LEAVE_BALANCE_COLUMN));

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
         json_build_object('firstName', a.first_name, 'lastName', a.last_name) as "approvedBy"
         FROM leaves l
         LEFT JOIN employees a ON l.approved_by = a.id
         ${query}
         ORDER BY l.created_at DESC
         LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, limit, offset]
      ),
    ]);
    res.json({ success: true, data: result.rows, total: countRes.rows[0]?.n || 0, page, limit });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET all leaves (admin/manager) ────────────────────────────────────────────
// Real pagination — was returning `total: result.rows.length` (just the page
// size), and capping at 1000 when limit='all', which meant large orgs could
// never see their tail. Now: COUNT(*) over the same WHERE for true total,
// limit clamped to 200, no "all" shortcut.
router.get('/', authorize('admin', 'manager'), async (req, res) => {
  try {
    const { status, department, employeeId, startDate, endDate } = req.query;
    const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    let query = 'WHERE 1=1';
    let params = [];
    let idx = 1;

    if (status)     { query += ` AND l.status = $${idx++}`;           params.push(status); }
    if (employeeId) { query += ` AND l.employee_id = $${idx++}`;      params.push(employeeId); }
    if (department) { query += ` AND e.department = $${idx++}`;       params.push(department); }
    if (startDate)  { query += ` AND l.end_date >= $${idx++}`;        params.push(startDate); }
    if (endDate)    { query += ` AND l.start_date <= $${idx++}`;      params.push(endDate); }

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
         json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name,
           'department', e.department, 'employeeId', e.employee_id) as employee,
         json_build_object('firstName', a.first_name, 'lastName', a.last_name) as "approvedBy"
         FROM leaves l
         JOIN employees e ON l.employee_id = e.id
         LEFT JOIN employees a ON l.approved_by = a.id
         ${query}
         ORDER BY l.start_date DESC
         LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, limit, offset]
      ),
    ]);

    res.json({ success: true, data: result.rows, total: countRes.rows[0]?.n || 0, page, limit });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
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

    // Overlap check — refuse if any non-rejected leave already covers any day in [start, end].
    const overlap = await pool.query(
      `SELECT id, start_date, end_date FROM leaves
        WHERE employee_id = $1
          AND status IN ('pending', 'pending_approval', 'approved')
          AND start_date <= $3::date AND end_date >= $2::date
        LIMIT 1`,
      [req.user._id, start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)]
    );
    if (overlap.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'You already have a leave request covering one or more of these dates.'
      });
    }

    // Honour weekend_rules + holidays (no more hardcoded Sat/Sun).
    const workingDays = await countWorkingDays(start, end);
    const totalDays = isHalfDay ? 0.5 : workingDays;
    if (totalDays <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Selected range has no working days (all weekends/holidays).'
      });
    }

    // Check balance from employees table (legacy)
    const empRes = await pool.query(
      'SELECT casual_leave, sick_leave, earned_leave, unpaid_leave FROM employees WHERE id=$1',
      [req.user._id]
    );
    const employee = empRes.rows[0];
    const col = LEAVE_BALANCE_COLUMN[leaveType];
    const balance = employee[col];

    if (leaveType !== 'unpaid' && (balance === null || balance === undefined || balance < totalDays)) {
      return res.status(400).json({
        success: false,
        message: `Insufficient ${leaveType} leave balance. Available: ${balance ?? 0} day(s)`
      });
    }

    // ── Phase 3: Decrement leave_balances.available on Apply ──
    // Surface errors: if the ledger update fails, fail the request so the
    // user retries rather than getting a leave row without a balance debit.
    if (leaveType !== 'unpaid') {
      const year = start.getFullYear();
      const ltRes = await pool.query(`SELECT id FROM leave_types WHERE code=$1`, [leaveType]);
      if (ltRes.rows[0]) {
        const updRes = await pool.query(
          `UPDATE leave_balances
             SET available = available - $1
           WHERE employee_id=$2 AND leave_type_id=$3 AND year=$4
           RETURNING id`,
          [totalDays, req.user._id, ltRes.rows[0].id, year]
        );
        // updRes.rows.length === 0 just means no ledger row exists yet for
        // this year — that's fine, the legacy columns are authoritative.
        // A DB error would have thrown and bubbled to the 500 handler below.
        void updRes;
      }
    }

    const ins = await pool.query(
      `INSERT INTO leaves (employee_id, leave_type, start_date, end_date, total_days, reason, is_half_day, half_day_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id as "_id", leave_type as "leaveType", start_date as "startDate",
       end_date as "endDate", total_days as "totalDays", reason, status,
       is_half_day as "isHalfDay", half_day_type as "halfDayType", created_at as "createdAt"`,
      [req.user._id, leaveType, startDate, endDate, totalDays, reason, isHalfDay || false, halfDayType || null]
    );

    // ── Notify Manager & Feed Entry ──
    try {
      const { createFeedEntry } = require('./feeds');
      const startLabel = new Date(startDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      const msg = `${req.user.firstName} applied ${leaveType} leave from ${startLabel} for ${totalDays} day(s).`;
      
      // Post to employee's feed
      await createFeedEntry(req.user._id, 'leave', 'Leave Applied', msg, '📅');

      // Notify Manager
      const emp = await pool.query('SELECT reporting_manager_id FROM employees WHERE id=$1', [req.user._id]);
      if (emp.rows[0]?.reporting_manager_id) {
        await createNotification(
          emp.rows[0].reporting_manager_id,
          'approval',
          'New Leave Request',
          `${req.user.firstName} ${req.user.lastName} has requested leave.`,
          '/approvals'
        );
      }
    } catch (e) { logger.error({ err: e.message }, '[leaves] notify/feed soft-fail'); }

    res.status(201).json({ success: true, data: ins.rows[0], message: 'Leave applied successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── PUT forward / approve / reject leave (two-step flow) ──────────────────────
router.put('/:id/action', authorize('admin', 'manager'), async (req, res) => {
  try {
    const { action, rejectionReason } = req.body;
    if (!['forward', 'approved', 'rejected'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Invalid action. Use: forward, approved, or rejected' });
    }

    const leaveRes = await pool.query(
      `SELECT l.*, e.reporting_manager_id, e.approving_authority_id
       FROM leaves l JOIN employees e ON l.employee_id = e.id WHERE l.id=$1`,
      [req.params.id]
    );
    const leave = leaveRes.rows[0];
    if (!leave) return res.status(404).json({ success: false, message: 'Leave not found' });

    const isAdmin              = req.user.role === 'admin';
    const isReportingAuth      = String(leave.reporting_manager_id) === String(req.user._id);
    const isApprovingAuth      = String(leave.approving_authority_id) === String(req.user._id);
    const isOwner              = String(leave.employee_id)           === String(req.user._id);
    const leaveLabel           = leave.leave_type.charAt(0).toUpperCase() + leave.leave_type.slice(1);
    const startLabel           = new Date(leave.start_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

    // Hard guard against self-approval: even if HR mis-configures an employee
    // as their own reporting_manager_id / approving_authority_id, they
    // cannot forward / approve / reject their own leave. Only admins (who
    // are intentionally outside the chain) are exempt.
    if (isOwner && !isAdmin && (action === 'approved' || action === 'forward' || action === 'rejected')) {
      return res.status(403).json({ success: false, message: 'You cannot act on your own leave request.' });
    }

    // ── STEP 1: Reporting Authority FORWARDS to Approving Authority ──
    if (action === 'forward') {
      if (!isReportingAuth && !isAdmin)
        return res.status(403).json({ success: false, message: 'Only the Reporting Authority can forward this leave.' });
      if (leave.status !== 'pending')
        return res.status(400).json({ success: false, message: `Cannot forward a leave in status: ${leave.status}` });

      await pool.query(`UPDATE leaves SET status='pending_approval', updated_at=NOW() WHERE id=$1`, [req.params.id]);

      if (leave.approving_authority_id) {
        const empR = await pool.query('SELECT first_name, last_name FROM employees WHERE id=$1', [leave.employee_id]);
        const name = empR.rows[0] ? `${empR.rows[0].first_name} ${empR.rows[0].last_name}` : 'An employee';
        await createNotification(
          leave.approving_authority_id, 'approval', 'Leave Awaiting Your Approval',
          `${name}'s ${leaveLabel} leave (${startLabel}) has been forwarded to you for final approval.`,
          '/approvals'
        );
      }
      return res.json({ success: true, message: 'Leave forwarded to Approving Authority.' });
    }

    // ── STEP 2: Approving Authority APPROVES ──
    if (action === 'approved') {
      if (!isApprovingAuth && !isAdmin)
        return res.status(403).json({ success: false, message: 'Only the Approving Authority can approve this leave.' });
      if (!isAdmin && leave.status !== 'pending_approval')
        return res.status(400).json({ success: false, message: 'Leave must be forwarded by the Reporting Authority first.' });

      // ── Atomic balance + status update ───────────────────────────
      // Three mutations move together: legacy column balance, leave_balances
      // booked counter, leaves.status. If any fails mid-way the user would
      // either lose days without getting their leave, or get it without
      // their balance debited. Wrap in a single transaction so it's
      // either all-or-nothing.
      // Pool-client lifecycle: release MUST run on every exit path. The
      // previous shape had release() in both the success path and the catch
      // — if catch's ROLLBACK succeeded but release() then threw, the
      // connection would leak. finally guarantees one release per acquire.
      const client = await pool.connect();
      let up;
      try {
        await client.query('BEGIN');

        if (leave.leave_type !== 'unpaid') {
          const col = LEAVE_BALANCE_COLUMN[leave.leave_type];
          // Hard whitelist guard before interpolating into SQL.
          if (col && VALID_BALANCE_COLUMNS.has(col)) {
            await client.query(`UPDATE employees SET ${col}=GREATEST(0,${col}-$1) WHERE id=$2`, [leave.total_days, leave.employee_id]);
          }
          const year = new Date(leave.start_date).getFullYear();
          const ltRes = await client.query(`SELECT id FROM leave_types WHERE code=$1`, [leave.leave_type]);
          if (ltRes.rows[0]) {
            await client.query(
              `UPDATE leave_balances SET booked=booked+$1 WHERE employee_id=$2 AND leave_type_id=$3 AND year=$4`,
              [leave.total_days, leave.employee_id, ltRes.rows[0].id, year]
            );
          }
        }

        up = await client.query(
          `UPDATE leaves SET status='approved', approved_by=$1, approved_at=NOW(), updated_at=NOW()
           WHERE id=$2 RETURNING id as "_id", status, leave_type as "leaveType", start_date as "startDate", end_date as "endDate", total_days as "totalDays"`,
          [req.user._id, req.params.id]
        );

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }

      // Soft side-effects — kept outside the txn so a notif/feed glitch
      // doesn't roll back a successful approval. Each is independently safe.
      await createNotification(leave.employee_id, 'leave', 'Leave Approved ✓',
        `Your ${leaveLabel} leave from ${startLabel} (${leave.total_days} day${leave.total_days !== 1 ? 's' : ''}) has been approved.`,
        '/leave-tracker/summary'
      );
      try { await pool.query(`INSERT INTO feeds (employee_id,type,title,body,icon) VALUES ($1,'leave_approved','Leave Approved ✓',$2,'✅')`, [leave.employee_id, `Your ${leaveLabel} leave from ${startLabel} has been approved.`]); }
      catch (err) { logger.warn({ err: err.message }, '[leaves] feed insert (approved) failed'); }
      await logAudit(req, { action: 'APPROVE', resource: 'Leave', resourceId: req.params.id, changes: { status: 'approved' } });
      return res.json({ success: true, data: up.rows[0], message: 'Leave approved.' });
    }

    // ── REJECT: Either authority can reject at any stage ──
    if (action === 'rejected') {
      if (!isReportingAuth && !isApprovingAuth && !isAdmin)
        return res.status(403).json({ success: false, message: 'You are not authorized to reject this leave.' });

      // Same all-or-nothing rule on rejection: balance refund + status
      // update must succeed together so we don't double-credit a leave.
      const client = await pool.connect();
      let up;
      try {
        await client.query('BEGIN');

        if (leave.leave_type !== 'unpaid') {
          const year = new Date(leave.start_date).getFullYear();
          const ltRes = await client.query(`SELECT id FROM leave_types WHERE code=$1`, [leave.leave_type]);
          if (ltRes.rows[0]) {
            await client.query(
              `UPDATE leave_balances SET available=available+$1 WHERE employee_id=$2 AND leave_type_id=$3 AND year=$4`,
              [leave.total_days, leave.employee_id, ltRes.rows[0].id, year]
            );
          }
        }

        up = await client.query(
          `UPDATE leaves SET status='rejected', approved_by=$1, approved_at=NOW(), rejection_reason=$2, updated_at=NOW()
           WHERE id=$3 RETURNING id as "_id", status, leave_type as "leaveType"`,
          [req.user._id, rejectionReason || null, req.params.id]
        );

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }

      await createNotification(leave.employee_id, 'leave', 'Leave Rejected',
        `Your ${leaveLabel} leave from ${startLabel} was rejected.${rejectionReason ? ` Reason: ${rejectionReason}` : ''}`,
        '/leave-tracker/summary'
      );
      try { await pool.query(`INSERT INTO feeds (employee_id,type,title,body,icon) VALUES ($1,'leave_rejected','Leave Rejected',$2,'❌')`, [leave.employee_id, `Your ${leaveLabel} leave from ${startLabel} was rejected.`]); }
      catch (err) { logger.warn({ err: err.message }, '[leaves] feed insert (rejected) failed'); }
      await logAudit(req, { action: 'REJECT', resource: 'Leave', resourceId: req.params.id, changes: { status: 'rejected', rejectionReason } });
      return res.json({ success: true, data: up.rows[0], message: 'Leave rejected.' });
    }

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── DELETE cancel leave ────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  // Single try/finally so client.release() runs on every exit path, including
  // the early-return cases where we previously had to remember to release()
  // before the return statement. finally is the canonical pattern here.
  const client = await pool.connect();
  try {
    const leaveRes = await client.query(
      'SELECT status, leave_type, start_date, end_date, total_days FROM leaves WHERE id=$1 AND employee_id=$2',
      [req.params.id, req.user._id]
    );
    if (leaveRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Leave not found' });
    }
    const leave = leaveRes.rows[0];
    if (leave.status === 'approved') {
      return res.status(400).json({ success: false, message: 'Cannot cancel approved leave' });
    }

    // Atomic refund-and-delete: apply debited leave_balances.available, so
    // cancellation has to credit it back. If we delete the leave without
    // refunding, the user's available balance silently drifts down.
    try {
      await client.query('BEGIN');
      if (leave.leave_type !== 'unpaid' && leave.total_days > 0) {
        const year = new Date(leave.start_date).getFullYear();
        const ltRes = await client.query(`SELECT id FROM leave_types WHERE code=$1`, [leave.leave_type]);
        if (ltRes.rows[0]) {
          await client.query(
            `UPDATE leave_balances
                SET available = available + $1
              WHERE employee_id=$2 AND leave_type_id=$3 AND year=$4`,
            [leave.total_days, req.user._id, ltRes.rows[0].id, year]
          );
        }
      }
      await client.query('DELETE FROM leaves WHERE id=$1', [req.params.id]);
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK').catch(() => {});
      throw txErr;
    }

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
    res.status(500).json({ success: false, message: err.message });
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
       FROM leave_types WHERE is_active = true ORDER BY display_order ASC, name ASC`
    );
    // If no leave_types table or empty, return defaults
    if (r.rows.length === 0) {
      return res.json({ success: true, data: [
        { _id: 'casual',  name: 'Casual Leave',         code: 'casual',    icon: '☀️', color: '#f59e0b', annualEntitlement: 12 },
        { _id: 'sick',    name: 'Sick Leave',            code: 'sick',      icon: '🏥', color: '#ef4444', annualEntitlement: 12 },
        { _id: 'earned',  name: 'Earned Leave',          code: 'earned',    icon: '💼', color: '#3b82f6', annualEntitlement: 15 },
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
      { _id: 'sick',    name: 'Sick Leave',            code: 'sick',      icon: '🏥', color: '#ef4444', annualEntitlement: 12 },
      { _id: 'earned',  name: 'Earned Leave',          code: 'earned',    icon: '💼', color: '#3b82f6', annualEntitlement: 15 },
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
    // Get from employees (legacy columns)
    const empRes = await pool.query(
      'SELECT casual_leave, sick_leave, earned_leave, unpaid_leave FROM employees WHERE id=$1',
      [req.user._id]
    );
    const emp = empRes.rows[0] || {};

    // Count booked leaves this year per type
    const bookedRes = await pool.query(
      `SELECT leave_type, COALESCE(SUM(total_days),0) as used
       FROM leaves
       WHERE employee_id=$1 AND status='approved'
         AND EXTRACT(YEAR FROM start_date) = $2
       GROUP BY leave_type`,
      [req.user._id, year]
    );
    const booked = {};
    bookedRes.rows.forEach(r => { booked[r.leave_type] = parseFloat(r.used); });

    // Try leave_balances table first
    let balanceRows = [];
    try {
      const lbRes = await pool.query(
        `SELECT lb.year, lb.total, lb.available, lb.used,
         lt.name, lt.code, lt.icon, lt.color
         FROM leave_balances lb
         JOIN leave_types lt ON lb.leave_type_id = lt.id
         WHERE lb.employee_id=$1 AND lb.year=$2`,
        [req.user._id, year]
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
        available: balanceRows.find(r => r.code === 'comp_off')?.available ?? 0,
        booked: booked['comp_off'] || 0,
      },
      {
        code: 'unpaid', name: 'Leave Without Pay', icon: '📋', color: '#6b7280',
        available: null, // LWP has no cap
        booked: booked['unpaid'] || 0,
      },
      {
        code: 'permission', name: 'Permission', icon: '🔑', color: '#8b5cf6',
        available: balanceRows.find(r => r.code === 'permission')?.available ?? (emp.earned_leave || 0),
        booked: booked['permission'] || 0,
      },
    ];

    res.json({ success: true, data: cards, year });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET pending approvals for approving authority ─────────────────────────────
router.get('/pending-approvals', async (req, res) => {
  try {
    const { status = 'pending' } = req.query;
    const r = await pool.query(
      `SELECT l.id as "_id", l.leave_type as "leaveType", l.start_date as "startDate",
       l.end_date as "endDate", l.total_days as "totalDays", l.reason, l.status,
       l.rejection_reason as "rejectionReason", l.created_at as "createdAt",
       json_build_object(
         '_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name,
         'employeeId', e.employee_id, 'department', e.department, 'designation', e.designation,
         'photoUrl', e.photo_url
       ) as employee
       FROM leaves l
       JOIN employees e ON l.employee_id = e.id
       WHERE (e.reporting_manager_id = $1 AND l.status = 'pending')
          OR (e.approving_authority_id = $1 AND l.status = 'pending_approval')
       ORDER BY l.created_at DESC`,
      [req.user._id]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
