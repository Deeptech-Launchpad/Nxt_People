/**
 * utils/leaveExtension.js
 *
 * Who may extend a leave that has already been submitted, and who may cancel
 * only part of one.
 *
 * Both settings live on Leave Tracker > Configuration > Leave Request and both
 * were stored and ignored. Extension carries the same three-row, three-actor
 * matrix as cancellation — "leave from today onwards", "past leave in the
 * current pay period", "past leave in the current calendar year", each against
 * self / manager / approver — so the classification and the actor resolution
 * are reused from leaveCancellation.js rather than rewritten. Two copies of a
 * rule this fiddly would drift, and the screens promise they behave alike.
 *
 * What extension adds on top is the policy list: the card asks which leave
 * policies may be extended at all, and a type left unticked cannot be, whoever
 * is asking.
 */
const { classify, actorsFor, ROWS, ACTORS, ymd, todayYmd } = require('./leaveCancellation');
const pool = require('../db');

const LABEL = {
  past_within_pay_period: 'past leave in the current pay period',
  current_and_upcoming: 'leave from today onwards',
  past_within_calendar_year: 'past leave in the current calendar year',
};

function normaliseExtension(config) {
  const e = (config || {}).extension || {};
  const permissions = {};
  for (const row of ROWS) {
    const src = (e.permissions || {})[row] || {};
    permissions[row] = ACTORS.reduce((o, a) => ({ ...o, [a]: !!src[a] }), {});
  }
  return {
    ...e,
    permissions,
    policies: Array.isArray(e.policies) ? e.policies.map(String) : [],
    reasonMandatory: !!e.reasonMandatory,
  };
}

async function currentPayPeriod() {
  const r = await pool.query(
    `SELECT cycle, start_day AS "startDay", end_day AS "endDay"
       FROM pay_periods WHERE is_active = TRUE ORDER BY created_at LIMIT 1`
  ).catch(() => ({ rows: [] }));
  return r.rows[0] || null;
}

/**
 * @returns {{allowed: boolean, reason?: string, row?: string}}
 */
async function canExtend({ user, leave, config }) {
  const cfg = normaliseExtension(config);

  // The policy list is the first gate, and an empty list means no policy has
  // been chosen — not that every policy qualifies. Reading it the other way
  // would switch the feature on for everything the moment it was wired.
  const type = String(leave.leave_type || leave.leaveType || '');
  if (!cfg.policies.length) {
    return {
      allowed: false,
      reason: 'No leave policy has been enabled for extension. This is set under Leave Tracker → Configuration → Leave Request.',
    };
  }
  if (!cfg.policies.includes(type)) {
    return { allowed: false, reason: `${type} leave cannot be extended under the current configuration.` };
  }

  const period = await currentPayPeriod();
  const row = classify(leave, period);
  if (!row) {
    return { allowed: false, reason: 'This leave is from a previous calendar year and can no longer be extended.' };
  }

  const actors = await actorsFor(user, leave);
  if (!actors.size) {
    return { allowed: false, row, reason: 'You are not the employee, their reporting manager, or an approver for this request.' };
  }

  const allowed = [...actors].some(a => cfg.permissions[row][a]);
  if (allowed) return { allowed: true, row };

  return {
    allowed: false,
    row,
    reason: `Extending ${LABEL[row]} is not permitted for you. This is set under Leave Tracker → Configuration → Leave Request.`,
  };
}

/**
 * Partial cancellation reuses the cancellation matrix rather than adding one of
 * its own — the screen offers it as a modifier on cancelling ("allow partial
 * leave cancellation"), not as a separate permission. So whoever may cancel the
 * whole thing may cancel part of it, and only when the switch is on.
 */
function partialAllowed(config) {
  return !!((config || {}).cancellation || {}).allowPartial;
}

module.exports = { canExtend, normaliseExtension, partialAllowed, LABEL, ymd, todayYmd };
