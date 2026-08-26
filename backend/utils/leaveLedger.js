/* ── What somebody's leave balance is, and how it got there ─────────────────
 *  Two screens need the same answer and must not compute it twice.
 *
 *    Customize Balance   the grid — everyone's balance for every leave type
 *    Customize Policy    one person's policies, and the history behind each
 *
 *  Until now the grid showed each leave type's ANNUAL MAXIMUM whenever nobody
 *  had stored a figure, so 150 people all read "12" and the column was
 *  decoration. A balance is not a constant: it is what the policy has granted
 *  by today, minus what has been taken, and for a monthly accrual it changes
 *  every month and depends on the joining date.
 *
 *  So one function answers it, and the ledger is the same arithmetic with its
 *  working shown — every accrual and every leave in date order with a running
 *  balance, which is what Zoho's View History displays:
 *
 *      01/01/2026   Accrual        +12          12
 *      13/01/2026   Leave Taken          1      11
 *      02/03/2026   Leave Taken          1      10
 *
 *  A stored figure in leave_balances always wins. That row exists precisely
 *  because somebody overrode the calculation, and recomputing over the top of
 *  a correction would undo it silently.
 *
 *  Pure arithmetic: no queries, no clock. The caller brings the data.
 * ────────────────────────────────────────────────────────────────────────── */
const { accrualEvents, round2 } = require('./leavePolicy');

/** Days a leave record consumes, in that leave type's own unit. */
function amountOf(leave) {
  // Permission is granted and spent in hours; everything else in days. Mixing
  // them produces a balance that is neither.
  if (leave.hours != null && parseFloat(leave.hours) > 0) return parseFloat(leave.hours);
  return parseFloat(leave.totalDays) || 0;
}

/**
 * One employee, one leave type.
 *
 * @param {object} policy    from getLeavePolicies().get(code)
 * @param {object} employee  { joiningDate }
 * @param {array}  leaves    approved leaves of this type, this year
 * @param {object} opts      { year, upToMonth, stored, earnedAmount }
 *
 * `stored` is the leave_balances row if one exists — an override, not a cache.
 */
function ledgerFor(policy, employee, leaves, { year, upToMonth = 12, stored = null, earnedAmount = 0 } = {}) {
  const accruals = policy.accrualMode === 'earned'
    // An earned type is credited by its own events (a comp-off approval), not
    // by the calendar, so the accrual side is a single figure the caller knows.
    ? (earnedAmount > 0 ? [{ date: `${year}-01-01`, amount: earnedAmount }] : [])
    : accrualEvents(policy, { year, upToMonth, joiningDate: employee.joiningDate });

  const events = [
    ...accruals.map(a => ({ date: a.date, type: 'accrual', added: a.amount, used: null })),
    ...leaves.map(l => ({
      date: String(l.startDate).slice(0, 10),
      type: 'leave',
      added: null,
      used: amountOf(l),
      note: l.reason || null,
    })),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.type === 'accrual' ? -1 : 1));

  let running = 0;
  for (const e of events) {
    running = round2(running + (e.added || 0) - (e.used || 0));
    e.balance = running;
  }

  const granted = round2(accruals.reduce((s, a) => s + a.amount, 0));
  const used = round2(leaves.reduce((s, l) => s + amountOf(l), 0));

  return {
    code: policy.code,
    name: policy.name,
    unit: policy.unit || 'days',
    payType: policy.payType,
    accrualMode: policy.accrualMode,
    granted,
    used,
    // The computed figure and the one actually in force are different facts.
    // A screen that prints only the second cannot show that somebody was
    // corrected, and a screen that prints only the first is lying about what
    // the person may take.
    computed: round2(granted - used),
    stored: stored == null ? null : round2(parseFloat(stored)),
    balance: stored == null ? round2(granted - used) : round2(parseFloat(stored)),
    overridden: stored != null,
    events,
  };
}

module.exports = { ledgerFor, amountOf };
