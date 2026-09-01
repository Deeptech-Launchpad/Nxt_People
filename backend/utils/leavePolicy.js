/**
 * utils/leavePolicy.js
 *
 * Where the balance reports get their accrual rules.
 *
 * `leave_types.accrual_mode` / `accrual_amount` were added by
 * migrate_leave_policy.js and shown on the Leave Policy configuration screen,
 * but nothing read them: the reports carried their own copy of the rules
 * ("casual is granted once, permission is 4 hours a month, comp-off is
 * earned"). Editing a policy changed the screen and nothing else. These
 * helpers are the one place that policy is read, shared by the balance
 * summary, the monthly drilldown and the history ledger — a grant the ledger
 * disagreed with would make both untrustworthy.
 *
 * Modes:
 *   annual   the whole amount granted once, on the entitlement start date
 *   monthly  the amount granted every calendar month from joining
 *   earned   credited by its own events (comp-off worked days); no schedule
 *   none     no entitlement at all, which is why those rows report a blank
 *            Granted rather than a zero
 */
const pool = require('../db');

// The reports address compensatory off as `comp_off`; the seeded leave type
// spells it `compoff`. One canonical spelling either side of this boundary.
const CODE_ALIASES = { compoff: 'comp_off' };
const canonicalCode = code => CODE_ALIASES[code] || code;

// Rows the reports show that have no leave_types record — `absent` is
// attendance data rather than a leave type — fall back to no entitlement,
// which is exactly how they behaved when the rules were hardcoded.
const NO_POLICY = {
  unit: 'days', payType: 'unpaid', accrualMode: 'none', accrualAmount: 0,
  carryForward: false, maxDaysPerYear: null,
};

// Read fresh per request rather than cached: the Leave Policy screen writes
// this table, and a report still quoting the previous policy for the next
// minute would look like a bug in the report.
async function getLeavePolicies() {
  const r = await pool.query(
    `SELECT code, name, unit, pay_type, accrual_mode, accrual_amount,
            carry_forward, max_days_per_year FROM leave_types`
  );
  const map = new Map();
  for (const row of r.rows) {
    const code = canonicalCode(row.code);
    map.set(code, {
      code,
      name: row.name,
      unit: row.unit,
      payType: row.pay_type,
      accrualMode: row.accrual_mode,
      accrualAmount: parseFloat(row.accrual_amount) || 0,
      // Per type, HR-configurable — Settings -> Leave Tracker -> Leave Policy.
      // Casual is seeded off: unused days do not survive into next year.
      carryForward: !!row.carry_forward,
      // The ceiling on what carries — irrelevant when carryForward is off.
      maxDaysPerYear: row.max_days_per_year === null ? null : parseFloat(row.max_days_per_year),
    });
  }
  return { get: code => map.get(code) || { code, name: code, ...NO_POLICY } };
}

/* The joining month rule, from Settings -> Leave Tracker -> Leave Accrual.
 *
 * Falls back to the rule being OFF, never on. A missing column — an install
 * that has not run migrate_leave_joining_rule.js — must grant people their
 * whole joining month rather than silently withhold it: too much leave is a
 * conversation, too little is a support ticket from somebody who cannot book
 * the day they were promised.
 */
const NO_JOINING_RULE = Object.freeze({
  skipWhenShortMonth: false, minDaysRemaining: 0, appliesToJoinersFrom: null,
  grandfatherFullYear: [],
});

async function getJoiningRule() {
  try {
    const r = await pool.query(`SELECT leave_accrual_config AS c FROM settings LIMIT 1`);
    const jm = r.rows[0]?.c?.joiningMonth;
    if (!jm) return NO_JOINING_RULE;
    return {
      skipWhenShortMonth: !!jm.skipWhenShortMonth,
      minDaysRemaining: Number(jm.minDaysRemaining) || 0,
      appliesToJoinersFrom: jm.appliesToJoinersFrom || null,
      grandfatherFullYear: Array.isArray(r.rows[0].c.grandfatherFullYear)
        ? r.rows[0].c.grandfatherFullYear : [],
    };
  } catch (_) {
    return NO_JOINING_RULE;
  }
}

// The date a year's entitlement starts for this employee: their joining date
// if they joined mid-year, otherwise January 1st. An annual allocation is
// granted whole on that date — it's a flat allocation in this system, and the
// reference grants it in full to a mid-year joiner too.
function entitlementStart(year, joiningDate) {
  const iso = joiningDate ? String(joiningDate).slice(0, 10) : null;
  return iso && Number(iso.slice(0, 4)) === year ? iso : `${year}-01-01`;
}

/**
 * Every grant this policy makes to this employee in this year, up to
 * `upToMonth`, which defaults to the whole year.
 *
 * It used to default to the month we are in, on the reasoning that an accrual
 * which hasn't happened yet isn't spendable. The reference does not work that
 * way: Zoho grants the year's twelve monthly accruals up front, so a permission
 * balance reads 48 hours in August rather than 32, and an employee comparing
 * the two systems sees the same number in both. Callers that genuinely need a
 * cut-off — leave encashment, which values a balance as at a period end — pass
 * `upToMonth` explicitly and are unaffected.
 *
 * `annualAmount` overrides the policy's amount for annual grants. Casual is
 * the one type with a per-employee allocation (`employees.casual_leave`), so
 * that column stays its source; every other type takes accrual_amount.
 *
 * Returns [{ month, amount, date }]. Months before joining produce nothing at
 * all rather than a zero row.
 */
function accrualEvents(policy, { year, upToMonth = 12, joiningDate, annualAmount = null, joiningRule = null }) {
  const [jy, jm, jd] = joiningDate ? String(joiningDate).slice(0, 10).split('-').map(Number) : [];
  if (jy > year) return [];

  if (policy.accrualMode === 'annual') {
    // Not bounded by upToMonth: an annual allocation is the year's, granted
    // whole and available from the start of the entitlement — including for
    // someone whose joining date is still ahead of today, whose balance has
    // always read as their full allocation.
    const amount = annualAmount === null || annualAmount === undefined
      ? policy.accrualAmount : annualAmount;
    const date = entitlementStart(year, joiningDate);
    return [{ month: Number(date.slice(5, 7)), amount, date }];
  }

  if (policy.accrualMode === 'monthly') {
    let startMonth = jy === year ? jm : 1;

    /* The joining month only counts if enough of it was left. Expressed as
     * days remaining rather than a day of the month: "after the 24th" is seven
     * days in August but four in February, so a fixed day would change the
     * rule's width through the year. Seven days remaining means the final week
     * does not accrue.
     *
     *   joined 24 Aug -> 31 - 24 + 1 = 8 remain -> August accrues
     *   joined 25 Aug -> 31 - 25 + 1 = 7 remain -> it does not
     *
     * Only applies to people who joined on or after the rule's start date.
     * Everyone already on the books keeps what they have been told they have,
     * so switching this on moves nobody's existing balance. */
    const joinedThisYear = jy === year;
    const subject = joinedThisYear && joiningRule?.appliesToJoinersFrom
      && String(joiningDate).slice(0, 10) >= joiningRule.appliesToJoinersFrom;

    if (subject && joiningRule.skipWhenShortMonth) {
      const daysInJoinMonth = new Date(Date.UTC(year, jm, 0)).getUTCDate();
      const remaining = daysInJoinMonth - jd + 1;
      if (remaining <= (joiningRule.minDaysRemaining ?? 0)) startMonth = jm + 1;
    }

    /* Types listed in grandfatherFullYear were granted whole before this rule
     * existed, so somebody already on the books keeps the whole year rather
     * than losing days they have been told they have and may already have
     * booked. Casual is listed because it was an annual twelve until now;
     * permission is not, because it has always accrued by the month and
     * nobody's figure should move.
     *
     * Only bites in the joining year — from the next year on, everybody is a
     * full-year employee and the two paths agree anyway. */
    if (joinedThisYear && !subject
        && (joiningRule?.grandfatherFullYear || []).includes(policy.code)) {
      startMonth = 1;
    }

    const out = [];
    for (let m = startMonth; m <= upToMonth; m++) {
      // The first entry is dated the joining day and the rest the 1st, so the
      // ledger's accrual rows land where the entitlement actually arrived.
      const day = jy === year && m === jm ? jd : 1;
      // Every month grants the whole amount, the joining month included.
      //
      // This used to charge a joining month by the days actually worked, the
      // way Zoho did: somebody starting on 3 January got 4 × 29/31 = 3.74
      // hours for it. That is where a permission balance reading 29.74 came
      // from where 30 was expected — the 0.26 was January's missing part. The
      // decision was to stop pro-rating: a month is a month, whichever day of
      // it somebody starts on, which is a rule HR can explain without a
      // calculator. It does mean joining-year figures no longer match the
      // migrated Zoho history to the second decimal place.
      out.push({
        month: m,
        amount: policy.accrualAmount,
        date: `${year}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      });
    }
    return out;
  }

  // earned: credited by its own events, counted where those events live.
  // none: no entitlement.
  return [];
}

const round2 = n => Math.round(n * 100) / 100;

// Total granted for the year so far. Null means "this type has no entitlement"
// — the reports print a blank Granted for those rather than a zero, which
// would read as an exhausted allowance. `earnedAmount` is what an `earned`
// policy has actually accrued from its own events.
function grantedToDate(policy, opts) {
  if (policy.accrualMode === 'none') return null;
  if (policy.accrualMode === 'earned') return round2(opts.earnedAmount || 0);
  return round2(accrualEvents(policy, opts).reduce((sum, a) => sum + a.amount, 0));
}

/**
 * How much of an unused balance survives into the next year, per
 * leave_types.carry_forward — the whole point of the flag, unenforced until
 * now. Off means everything left over lapses: `available` is what an
 * imported or hand-set balance still holds, and none of it moves forward.
 * On carries it capped at max_days_per_year, so "carry forward" cannot
 * silently become "carry forward without limit" the moment somebody switches
 * it on.
 *
 * Pure. What happens to the difference — logging a lapse, writing a row for
 * the new year — is the caller's decision, not this function's.
 */
function carryForwardAmount(policy, available) {
  if (!policy.carryForward) return 0;
  const amt = Math.max(0, round2(parseFloat(available) || 0));
  const cap = policy.maxDaysPerYear;
  // null/undefined is the only "no cap" — 0 is a real cap (nothing carries),
  // not the absence of one. `cap > 0` here would have let a 0-day cap through
  // uncapped, the opposite of what setting it to 0 is for.
  return (cap === null || cap === undefined) ? amt : Math.min(amt, round2(cap));
}

module.exports = {
  getLeavePolicies, getJoiningRule, accrualEvents, grantedToDate, carryForwardAmount, entitlementStart, round2,
};
