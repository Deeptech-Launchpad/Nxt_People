/* ── Monthly approval reminder — one digest per eligible approver ──────────
 *  Runs on the 27th of every month. Covers Casual Leave, LOP, Permission
 *  (all three are `leaves` rows, distinguished by leave_type) and Attendance
 *  Regularization, at whatever approval stage each is currently waiting on
 *  — not just the final one.
 *
 *  Eligible roles = utils/roles.js's APPROVERS (admin, director, hr_admin,
 *  manager, team_incharge) — the same six-role model and the same approver
 *  set every other approval route in this app already guards on. team_member
 *  is never eligible.
 *
 *  "Pending, at any stage" is read exactly the way routes/approvals.js's own
 *  GET /pending already reads it, not a second interpretation of the
 *  hierarchy:
 *    - Full-access (admin/director/hr_admin): every `status = 'pending'` row
 *      in leaves / attendance_regularizations, org-wide — matching their
 *      existing "sees everything" visibility (isFullAccess()).
 *    - Manager / Team Incharge: only rows with a matching approval_levels
 *      row where `status = 'pending' AND approver_id = them` — the level
 *      currently actionable, whichever number it is. A manager never sees a
 *      request that is not (yet) actually waiting on them specifically,
 *      same as the Approvals page itself.
 *
 *  Idempotency: one row per (recipient, month) in monthly_approval_reminders,
 *  claimed via INSERT ... ON CONFLICT DO NOTHING before sending — see that
 *  table's migration. A second cron fire (another instance, a retry, an
 *  overlapping sweep) loses the race on the claim and sends nothing, so the
 *  job is safe to run more than once for the same month.
 * ───────────────────────────────────────────────────────────────────────── */

const pool = require('../db');
const logger = require('../logger');
const { APPROVERS, isFullAccess } = require('./roles');
const { sendMonthlyApprovalReminderEmail } = require('./mailer');

const TYPE_LABELS = {
  casual: 'Casual Leave',
  unpaid: 'LOP Leave',
  permission: 'Permission',
  regularization: 'Attendance Regularization',
};

// 'YYYY-MM-DD' in a given IANA timezone, without ever touching a JS Date's
// own (always-local-or-UTC) getters — the same trap documented elsewhere in
// this codebase for date-only columns.
function partsInTz(date, tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const get = (type) => parts.find(p => p.type === type).value;
  return { year: get('year'), month: get('month'), day: get('day') };
}

/**
 * @param now        defaults to real "now"; pass a fixed Date for testing.
 * @param tz         IANA timezone the "27th" and the month label are read in.
 * @param force      bypass the day-of-month gate — for a safe manual test run.
 */
async function sweepMonthlyApprovalReminder({ now = new Date(), tz = 'Asia/Kolkata', force = false } = {}) {
  const summary = { eligibleApprovers: 0, considered: 0, sent: 0, skipped: 0, failed: 0 };

  const { year, month, day } = partsInTz(now, tz);
  if (!force && Number(day) !== 27) return summary;

  const period = `${year}-${month}`;
  const monthLabel = new Date(Date.UTC(Number(year), Number(month) - 1, 1))
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const approvalsLink = `${(process.env.FRONTEND_URL || 'https://nxtpeople.altiusnxt.tech').replace(/\/$/, '')}/approvals`;

  const approvers = await pool.query(
    `SELECT id, email, first_name, last_name, role
       FROM employees
      WHERE deleted_at IS NULL AND status = 'active'
        AND role = ANY($1::text[])
        AND email IS NOT NULL AND email <> ''`,
    [APPROVERS]
  );
  summary.eligibleApprovers = approvers.rows.length;

  for (const approver of approvers.rows) {
    const full = isFullAccess(approver.role);

    // Same shape of query routes/approvals.js's GET /pending already runs
    // for the leave and regularization sources — see the header comment.
    const leaveRows = await pool.query(
      `SELECT l.leave_type AS type, l.start_date AS date,
              TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS "employeeName"
         FROM leaves l
         JOIN employees e ON e.id = l.employee_id
        WHERE l.status = 'pending' AND e.deleted_at IS NULL
          AND ($2::boolean OR EXISTS (
                SELECT 1 FROM approval_levels x
                 WHERE x.request_type = 'leave' AND x.request_id = l.id
                   AND x.approver_id = $1 AND x.status = 'pending'
              ))
        ORDER BY l.created_at DESC`,
      [approver.id, full]
    );

    const regRows = await pool.query(
      `SELECT r.date,
              TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS "employeeName"
         FROM attendance_regularizations r
         JOIN employees e ON e.id = r.employee_id
        WHERE r.status = 'pending' AND e.deleted_at IS NULL
          AND ($2::boolean OR EXISTS (
                SELECT 1 FROM approval_levels x
                 WHERE x.request_type = 'regularization' AND x.request_id = r.id
                   AND x.approver_id = $1 AND x.status = 'pending'
              ))
        ORDER BY r.date DESC`,
      [approver.id, full]
    );

    const totalPending = leaveRows.rows.length + regRows.rows.length;
    summary.considered++;
    if (totalPending === 0) { summary.skipped++; continue; } // nothing to chase — no reminder sent

    const breakdownCounts = { casual: 0, unpaid: 0, permission: 0, regularization: regRows.rows.length };
    for (const r of leaveRows.rows) breakdownCounts[r.type] = (breakdownCounts[r.type] || 0) + 1;
    const breakdown = Object.entries(breakdownCounts)
      .filter(([, count]) => count > 0)
      .map(([type, count]) => ({ label: TYPE_LABELS[type] || type, count }));

    const items = [
      ...leaveRows.rows.map(r => ({ employeeName: r.employeeName, requestType: TYPE_LABELS[r.type] || r.type, date: r.date })),
      ...regRows.rows.map(r => ({ employeeName: r.employeeName, requestType: TYPE_LABELS.regularization, date: r.date })),
    ];

    try {
      // Claim first, send second — a crash between the two just means the
      // next sweep (even next month's) tries again, never a double-send of
      // the one that already went out.
      const claim = await pool.query(
        `INSERT INTO monthly_approval_reminders (recipient_id, period, pending_count, status)
         VALUES ($1, $2, $3, 'success')
         ON CONFLICT (recipient_id, period) DO NOTHING
         RETURNING id`,
        [approver.id, period, totalPending]
      );
      if (!claim.rows.length) { summary.skipped++; continue; } // already sent this period

      await sendMonthlyApprovalReminderEmail({
        to: approver.email,
        recipientName: `${approver.first_name} ${approver.last_name}`.trim(),
        monthLabel,
        totalPending,
        breakdown,
        items,
        approvalsLink,
      });
      summary.sent++;
    } catch (err) {
      summary.failed++;
      // The claim stands, same reasoning as approval_followups: a broken
      // mail server should not get retried every minute, but the row keeps
      // why nothing arrived.
      await pool.query(
        `UPDATE monthly_approval_reminders SET status = 'failed', message = $1
          WHERE recipient_id = $2 AND period = $3`,
        [err.message, approver.id, period]
      ).catch(() => {});
      logger.error({ err: err.message, approverId: approver.id }, 'Monthly approval reminder failed to send');
    }
  }

  return summary;
}

module.exports = { sweepMonthlyApprovalReminder };
