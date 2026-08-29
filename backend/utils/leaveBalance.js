/**
 * utils/leaveBalance.js
 *
 * What a leave type's balance is, where it lives, and how to put it back.
 *
 * Three stores hold leave balances, and they were being consulted
 * inconsistently:
 *
 *   leave_balances       the designed store — available/booked, per type, per
 *                        year. Empty on every database this has run against,
 *                        so in practice nothing reads out of it yet.
 *   employees.<x>_leave  legacy columns. Because leave_balances is empty these
 *                        are where every real debit actually lands.
 *   comp_offs            a FIFO credit ledger, and the only truth for comp-off.
 *
 * Two problems came out of that split.
 *
 * The balance card read all three; the apply-time check read only the first
 * two. An employee holding two days of comp-off was shown "2 available" and
 * then refused with "Available: 0 day(s)". availableFor() is now the single
 * answer both of them use.
 *
 * Worse, approval debited one store while every refund path wrote to another.
 * That was invisible only because an approved leave could not be cancelled at
 * all. Now that it can, debitOnApproval() records which store it used on
 * leaves.balance_source, and refundApproved() puts the days back into that
 * same store. They are deliberately adjacent in this file: a debit and its
 * refund drifting apart is the defect this exists to prevent.
 */
const logger = require('../logger');

// Legacy columns that can actually be written back. Kept exclusive — a missing
// key short-circuits rather than interpolating an unknown column name.
const LEGACY_COLUMN = Object.freeze({
  casual: 'casual_leave',
  unpaid: 'unpaid_leave',
});
const VALID_LEGACY = new Set(Object.values(LEGACY_COLUMN));

// leave_types.code spells compensatory off without the underscore.
const typeCode = (leaveType) => (leaveType === 'comp_off' ? 'compoff' : leaveType);

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * How many days of `leaveType` this employee can still take, and which store
 * that number came from.
 *
 * `available: null` means the type has no ceiling — Leave Without Pay is not
 * "zero remaining", it simply does not have a balance. Collapsing the two would
 * turn "does not apply" into "you have none left".
 */
async function availableFor(db, employeeId, leaveType, year) {
  if (leaveType === 'unpaid') return { available: null, store: 'none' };

  // Permission is hours against a monthly cap, not days against a balance;
  // its ceiling is enforced where permission requests are validated.
  if (leaveType === 'permission') return { available: null, store: 'none' };

  if (leaveType === 'comp_off') {
    const r = await db.query(
      `SELECT COALESCE(SUM(days_earned - days_used), 0) AS avail
         FROM comp_offs
        WHERE employee_id = $1 AND status = 'approved'
          AND (expires_at IS NULL OR expires_at >= CURRENT_DATE)`,
      [employeeId]
    );
    return { available: Math.max(0, round2(parseFloat(r.rows[0].avail) || 0)), store: 'comp_offs' };
  }

  const lt = await db.query(`SELECT id FROM leave_types WHERE code = $1`, [typeCode(leaveType)]);
  if (lt.rows[0]) {
    const lb = await db.query(
      `SELECT available FROM leave_balances
        WHERE employee_id = $1 AND leave_type_id = $2 AND year = $3`,
      [employeeId, lt.rows[0].id, year]
    );
    if (lb.rows.length > 0) {
      return { available: round2(parseFloat(lb.rows[0].available) || 0), store: 'leave_balances' };
    }
  }

  /* No stored row, so the balance is worked out from the policy and the leave
   * actually taken.
   *
   * It used to read employees.casual_leave. That column was written as a fixed
   * entitlement, but debitOnApproval subtracted from it on every approval while
   * the balance card went on subtracting the year's bookings from it as though
   * it had not moved — so an approved day came off twice on the card and once
   * here, and the two screens quoted different numbers at the same person.
   * Nothing reset it in January either, so leave taken in earlier years was
   * still being charged against this year.
   *
   * Deriving it from the leaves table removes the second copy rather than
   * trying to keep two in step. The rows are the ledger: cancel a leave and the
   * balance returns on its own, with nothing to refund. */
  if (leaveType === 'casual') {
    const { available } = await computedFor(db, employeeId, leaveType, year);
    return { available, store: 'computed' };
  }

  // A type with no balance anywhere. Not zero — unknown.
  return { available: null, store: 'none' };
}

/**
 * Granted by the policy for this year, less what has been taken and what is
 * waiting. Pending counts: a request in flight is spoken for, and letting two
 * of them each pass the check separately is how somebody ends up approved past
 * their entitlement.
 */
async function computedFor(db, employeeId, leaveType, year) {
  const { getLeavePolicies, getJoiningRule, grantedToDate } = require('./leavePolicy');

  const e = await db.query(
    `SELECT joining_date::text AS joining FROM employees WHERE id = $1`, [employeeId]);
  const [policies, joiningRule] = await Promise.all([getLeavePolicies(), getJoiningRule()]);

  const granted = grantedToDate(policies.get(leaveType), {
    year, joiningDate: e.rows[0]?.joining, joiningRule,
  });
  // null is "no entitlement configured" — pass it through rather than calling
  // it zero, which would read as an exhausted allowance.
  if (granted === null) return { available: null, granted: null, taken: 0 };

  const t = await db.query(
    `SELECT COALESCE(SUM(total_days), 0)::float AS taken
       FROM leaves
      WHERE employee_id = $1 AND leave_type = $2
        AND status IN ('approved','pending')
        AND EXTRACT(YEAR FROM start_date) = $3`,
    [employeeId, leaveType, year]);
  const taken = round2(parseFloat(t.rows[0].taken) || 0);

  return { available: Math.max(0, round2(granted - taken)), granted: round2(granted), taken };
}

/**
 * Take the days off the balance when a leave becomes fully approved, and
 * report which store absorbed it so the refund can find its way back.
 */
async function debitOnApproval(db, { employeeId, leaveType, days, year }) {
  const amount = parseFloat(days) || 0;
  if (leaveType === 'unpaid' || amount <= 0) return 'none';

  if (leaveType === 'comp_off') {
    // Oldest credit first, so a credit close to expiring is spent before one
    // that still has time on it.
    let remaining = amount;
    const credits = await db.query(
      `SELECT id, days_earned, days_used FROM comp_offs
        WHERE employee_id = $1 AND status = 'approved'
          AND (expires_at IS NULL OR expires_at >= CURRENT_DATE)
          AND days_earned > days_used
        ORDER BY worked_date ASC FOR UPDATE`,
      [employeeId]
    );
    for (const credit of credits.rows) {
      if (remaining <= 0) break;
      const spare = parseFloat(credit.days_earned) - parseFloat(credit.days_used);
      const take = Math.min(remaining, spare);
      await db.query(`UPDATE comp_offs SET days_used = days_used + $1 WHERE id = $2`, [take, credit.id]);
      remaining -= take;
    }
    if (remaining > 0) {
      logger.warn({ employeeId, leaveType, days: amount, short: remaining },
        '[leaveBalance] comp-off approved for more days than the ledger held');
    }
    return 'comp_offs';
  }

  const lt = await db.query(`SELECT id FROM leave_types WHERE code = $1`, [typeCode(leaveType)]);
  if (lt.rows[0]) {
    const lb = await db.query(
      `UPDATE leave_balances SET booked = booked + $1
        WHERE employee_id = $2 AND leave_type_id = $3 AND year = $4 RETURNING id`,
      [amount, employeeId, lt.rows[0].id, year]
    );
    if (lb.rows.length > 0) return 'leave_balances';
  }

  /* Nothing is debited for a computed type. Its balance is derived from the
   * leaves table, so the approved row IS the debit — writing a second copy to
   * employees.casual_leave is what made the card and this disagree, and it was
   * never reset in January either. Refunds have nothing to put back: cancel the
   * leave and the balance returns because the row is gone. */
  if (leaveType === 'casual') return 'computed';

  return 'none';
}

/**
 * Undo debitOnApproval. `store` is what that call returned, carried on
 * leaves.balance_source; when it is missing — a leave approved before the
 * column existed — the store is resolved live, which lands in the same place
 * unless balances were provisioned in between.
 */
async function refundApproved(db, { employeeId, leaveType, days, year, store }) {
  const amount = parseFloat(days) || 0;
  if (leaveType === 'unpaid' || amount <= 0) return 'none';

  let target = store;
  if (!target || target === 'none') {
    target = (await availableFor(db, employeeId, leaveType, year)).store;
  }

  if (target === 'comp_offs') {
    // Newest consumption back first, mirroring the oldest-first spend.
    let remaining = amount;
    const spent = await db.query(
      `SELECT id, days_used FROM comp_offs
        WHERE employee_id = $1 AND status = 'approved' AND days_used > 0
        ORDER BY worked_date DESC FOR UPDATE`,
      [employeeId]
    );
    for (const credit of spent.rows) {
      if (remaining <= 0) break;
      const give = Math.min(remaining, parseFloat(credit.days_used));
      await db.query(`UPDATE comp_offs SET days_used = days_used - $1 WHERE id = $2`, [give, credit.id]);
      remaining -= give;
    }
    if (remaining > 0) {
      logger.warn({ employeeId, days: amount, unreturned: remaining },
        '[leaveBalance] comp-off refund found fewer used days than it was returning');
    }
    return 'comp_offs';
  }

  if (target === 'leave_balances') {
    const lt = await db.query(`SELECT id FROM leave_types WHERE code = $1`, [typeCode(leaveType)]);
    if (lt.rows[0]) {
      // Approval only moved days into `booked`; the day left `available` back
      // when the leave was applied for, so both sides are reversed here.
      await db.query(
        `UPDATE leave_balances
            SET booked = GREATEST(0, booked - $1), available = available + $1
          WHERE employee_id = $2 AND leave_type_id = $3 AND year = $4`,
        [amount, employeeId, lt.rows[0].id, year]
      );
      return 'leave_balances';
    }
  }

  if (target === 'legacy') {
    const col = LEGACY_COLUMN[leaveType];
    if (col && VALID_LEGACY.has(col)) {
      await db.query(`UPDATE employees SET ${col} = ${col} + $1 WHERE id = $2`, [amount, employeeId]);
      return 'legacy';
    }
  }

  /* A computed balance has nothing to give back — the days return the moment
   * the leave row stops counting. Said explicitly so this does not fall
   * through to the warning below, which would fire on every cancellation and
   * train everyone to ignore it. */
  if (target === 'computed') return 'computed';

  logger.warn({ employeeId, leaveType, days: amount, store: target },
    '[leaveBalance] approved leave refunded but no store could take the days back');
  return 'none';
}

module.exports = {
  availableFor, computedFor, debitOnApproval, refundApproved,
  LEGACY_COLUMN, VALID_LEGACY, typeCode, round2,
};
