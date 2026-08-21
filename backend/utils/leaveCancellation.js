/**
 * utils/leaveCancellation.js
 *
 * Who may cancel a leave request, and when.
 *
 * Leave Tracker → Configuration → Leave Request holds a permissions matrix:
 * three rows describing *when* the leave falls, three columns describing *who*
 * is asking. This turns a leave row plus the person asking into a yes or no.
 *
 * Before this existed the rule was hard-coded and much blunter — an employee
 * could cancel any leave of their own that was not yet approved, however far in
 * the past it was — and the settings screen wrote a blob nothing ever read.
 */
const pool = require('../db');
const { isFullAccess } = require('./roles');
const { cycleFor } = require('./payPeriodCycle');

const ROWS = ['past_within_pay_period', 'current_and_upcoming', 'past_within_calendar_year'];
const ACTORS = ['self', 'manager', 'approver'];

// A pg DATE comes back as a Date at LOCAL midnight. toISOString() would shift
// it to the previous day anywhere east of Greenwich, so the parts are read
// locally instead. This has bitten this project three times.
const ymd = d => (d instanceof Date
  ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  : String(d).slice(0, 10));

const todayYmd = () => ymd(new Date());

/**
 * Which row of the matrix a leave falls under.
 *
 * A leave that has not finished yet is current-or-upcoming, whatever its start
 * date — a range still running is not a past leave.
 *
 * A past leave inside the live pay-period cycle matches the pay-period row.
 * That row is checked first because it is the narrower of the two: every leave
 * in the current cycle is also inside the current calendar year, and the more
 * specific row is the one the reference screen puts first.
 *
 * A past leave in a previous year matches no row at all, and so is cancellable
 * by nobody. Returns null for that.
 */
function classify(leave, payPeriod, now = new Date(), cfg = null) {
  const today = ymd(now);
  const end = ymd(leave.end_date || leave.endDate);
  const start = ymd(leave.start_date || leave.startDate);

  if (end >= today) return 'current_and_upcoming';

  // "Custom pay period" replaces the live cycle with a plain window of days
  // back from today. The row is the same row — what changes is how far it
  // reaches. Without this the setting saved and the cycle was used anyway.
  if (cfg && cfg.pastScope === 'custom') {
    const days = Number(cfg.customDays) > 0 ? Number(cfg.customDays) : 30;
    const from = new Date(now);
    from.setDate(from.getDate() - days);
    if (start >= ymd(from)) return 'past_within_pay_period';
  } else if (payPeriod) {
    const cycle = cycleFor(payPeriod, now);
    if (start >= cycle.startDate && end <= cycle.endDate) return 'past_within_pay_period';
  }

  if (start.slice(0, 4) === today.slice(0, 4)) return 'past_within_calendar_year';
  return null;
}

/**
 * The actor roles this user holds over this leave. Someone can hold more than
 * one — a reporting manager who is also the named approver — so this returns a
 * set rather than picking one, and permission is granted if ANY role held has
 * it. Holding an extra role must never take an ability away.
 */
async function actorsFor(user, leave) {
  const actors = new Set();
  const owner = String(leave.employee_id || leave.employeeId);
  if (String(user._id) === owner) actors.add('self');

  const e = await pool.query(
    `SELECT reporting_manager_id, approving_authority_id FROM employees WHERE id = $1`,
    [owner]
  );
  const row = e.rows[0] || {};
  if (row.reporting_manager_id && String(row.reporting_manager_id) === String(user._id)) actors.add('manager');
  if (row.approving_authority_id && String(row.approving_authority_id) === String(user._id)) actors.add('approver');

  // Whoever the approval chain actually named, which is the definition the
  // approvals screen uses, rather than a guess from the org chart.
  const lv = await pool.query(
    `SELECT 1 FROM approval_levels
      WHERE request_type = 'leave' AND request_id = $1 AND approver_id = $2 LIMIT 1`,
    [leave.id, user._id]
  );
  if (lv.rows.length) actors.add('approver');

  if (isFullAccess(user.role)) actors.add('approver');
  return actors;
}

// The live cycle rule, or null when no pay period is configured. With none,
// the pay-period row can never match and a past leave falls through to the
// calendar-year row — which is what the screen's own hint promises.
async function currentPayPeriod() {
  const r = await pool.query(
    `SELECT start_day AS "startDay", end_day AS "endDay"
       FROM pay_periods WHERE is_active = TRUE ORDER BY created_at ASC LIMIT 1`
  );
  return r.rows[0] || null;
}

function normalise(config) {
  const c = (config || {}).cancellation || {};
  const permissions = {};
  for (const row of ROWS) {
    const src = (c.permissions || {})[row] || {};
    permissions[row] = ACTORS.reduce((o, a) => ({ ...o, [a]: !!src[a] }), {});
  }
  return { ...c, permissions };
}

/**
 * @returns {{allowed: boolean, reason?: string, row?: string}}
 */
async function canCancel({ user, leave, config }) {
  const cfg = normalise(config);
  const period = await currentPayPeriod();
  const row = classify(leave, period, new Date(), cfg);
  if (!row) {
    return { allowed: false, reason: 'This leave is from a previous calendar year and can no longer be cancelled.' };
  }

  // Scoping to specific leave policies. Anything outside the chosen set cannot
  // be cancelled at all, whatever the permission matrix says — the narrower
  // rule wins, or "specific" would mean nothing.
  const type = String(leave.leave_type || leave.leaveType || '');
  if (cfg.requestScope === 'specific'
      && Array.isArray(cfg.policies) && cfg.policies.length
      && !cfg.policies.includes(type)) {
    return {
      allowed: false, row,
      reason: `${type || 'This'} leave cannot be cancelled once approved. This is set under Leave Tracker → Configuration → Leave Request.`,
    };
  }

  const actors = await actorsFor(user, leave);
  if (!actors.size) {
    return { allowed: false, row, reason: 'You are not the employee, their reporting manager, or an approver for this request.' };
  }

  const allowed = [...actors].some(a => cfg.permissions[row][a]);
  if (allowed) {
    // Payroll may already have paid for this leave. Cancelling it then leaves
    // the record disagreeing with a payslip somebody has already been given,
    // which is the one outcome nobody can see happening.
    const paid = await payslipExistsFor(leave);
    if (paid) {
      const action = cfg.payrollRun || 'block';
      if (action === 'block') {
        return {
          allowed: false, row, payrollRun: true,
          reason: `Payroll has already run for ${paid.month}/${paid.year}. This leave cannot be cancelled — ask HR to adjust it instead.`,
        };
      }
      if (action === 'flag') {
        return {
          allowed: true, row, payrollRun: true, flagged: true,
          warning: `Payroll has already run for ${paid.month}/${paid.year}. Cancelling this will not match the payslip already issued.`,
        };
      }
    }
    return { allowed: true, row };
  }

  const LABEL = {
    past_within_pay_period: 'past leave in the current pay period',
    current_and_upcoming: 'leave from today onwards',
    past_within_calendar_year: 'past leave in the current calendar year',
  };
  return {
    allowed: false,
    row,
    reason: `Cancelling ${LABEL[row]} is not permitted for you. This is set under Leave Tracker → Configuration → Leave Request.`,
  };
}

/**
 * Has a payslip already been issued covering this leave?
 *
 * The payslip table is keyed by month and year, so a leave spanning a boundary
 * is checked against every month it touches — the earliest match is the one
 * reported, because that is the payslip somebody already has in hand.
 */
async function payslipExistsFor(leave) {
  const start = new Date(`${ymd(leave.start_date || leave.startDate)}T00:00:00`);
  const end = new Date(`${ymd(leave.end_date || leave.endDate)}T00:00:00`);
  const months = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cur <= end && months.length < 24) {
    months.push({ month: cur.getMonth() + 1, year: cur.getFullYear() });
    cur.setMonth(cur.getMonth() + 1);
  }
  if (!months.length) return null;

  try {
    // payroll_payslips is what Payroll Run actually writes. The older
    // `payslips` table was archived, and asking it would mean this check never
    // fired at all.
    const r = await pool.query(
      `SELECT pay_month AS month, pay_year AS year FROM payroll_payslips
        WHERE employee_id = $1
          AND (pay_month, pay_year) IN (${months.map((_, i) => `($${i * 2 + 2}, $${i * 2 + 3})`).join(', ')})
        ORDER BY pay_year, pay_month LIMIT 1`,
      [leave.employee_id || leave.employeeId, ...months.flatMap(m => [m.month, m.year])]);
    return r.rows[0] || null;
  } catch {
    // No payslip table yet, or it cannot be read. Reporting "already paid"
    // here would block every cancellation, so the safe direction is to say no.
    return null;
  }
}

async function loadConfig() {
  const r = await pool.query(`SELECT leave_request_config AS config FROM settings LIMIT 1`);
  return r.rows[0]?.config || {};
}

module.exports = { canCancel, classify, actorsFor, loadConfig, normalise, payslipExistsFor, ROWS, ACTORS, ymd, todayYmd };
