/* ── Loss of pay that does not fit inside one pay period ───────────────────
 *  "The maximum number of LOP allowed per pay period" caps what a period can
 *  charge. Today anything past that cap is simply dropped, which leaves a hole:
 *  five unpaid days in one month costs less than five spread across two,
 *  because the excess in the busy month evaporates.
 *
 *  Carrying it over closes that. The excess moves to the next period and is
 *  charged there instead of being forgiven.
 *
 *  Every decision is a setting, because each one changes what somebody is paid:
 *
 *    unpaidLeave     'lop' keeps today's behaviour — the excess is waived.
 *                    'carry_over' moves it to the next period.
 *    maxPerPeriod    blank means no cap, which is NOT a cap of zero.
 *    carryExpiry     'one_period' — a carried day that still cannot be charged
 *                    next period is dropped. 'never' — it keeps moving until
 *                    there is room for it.
 *
 *  Days are charged oldest first, so a debt cannot sit at the back of the queue
 *  indefinitely while newer days are charged ahead of it.
 *
 *  Nothing here is stored. The figures are derived by replaying the periods, so
 *  changing the cap or switching the policy off cannot leave a stale balance
 *  behind that nobody can explain. The cost is a bounded walk backwards, and
 *  MAX_LOOKBACK bounds it.
 * ────────────────────────────────────────────────────────────────────────── */

const { cycleFor } = require('./payPeriodCycle');

// A year of history. Beyond that a carried unpaid day is somebody's HR problem,
// not an arithmetic one, and the walk has to stop somewhere.
const MAX_LOOKBACK = 12;

const round2 = n => Math.round(n * 100) / 100;

function resolve(cfg = {}) {
  const l = cfg.lossOfPay || cfg || {};
  const raw = l.maxPerPeriod;
  return {
    carryOver: l.unpaidLeave === 'carry_over',
    // Blank means no cap. Zero is a real cap that charges nothing, so the test
    // is on null rather than on falsiness.
    maxPerPeriod: (raw === null || raw === undefined || raw === '') ? null : Number(raw),
    expiry: l.carryExpiry === 'never' ? 'never' : 'one_period',
    visibleToEmployee: l.carryVisibleToEmployee === true,
  };
}

/** The org's pay period, or a calendar month if none is configured. */
async function activePayPeriod(db) {
  try {
    const r = await db.query(
      `SELECT start_day AS "startDay", end_day AS "endDay"
         FROM pay_periods WHERE is_active = TRUE ORDER BY created_at ASC LIMIT 1`);
    if (r.rows[0]) return r.rows[0];
  } catch { /* table may not exist yet */ }
  return { startDay: 1, endDay: 32 };  // LAST_DAY sentinel — calendar month
}

const shiftMonths = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d;
};

/**
 * Loss of pay for one pay period, with anything carried in from before it.
 *
 * @param {object}   db
 * @param {string}   employeeId
 * @param {string}   on           any date inside the period of interest (YYYY-MM-DD)
 * @param {object}   cfg          the leave reports config section
 * @param {function} rawFor       async (startIso, endIso) => number — the raw LOP
 *                                for a range. Injected so this file does not
 *                                have to reach into the payroll routes.
 * @param {object}   period       optional pay period; read from the org if absent
 *
 * @returns {Promise<{period, raw, carriedIn, charged, carriedOut, waived, expired}>}
 */
async function lopForPeriod(db, { employeeId, on, cfg, rawFor, period = null }) {
  const rule = resolve(cfg);
  const pp = period || await activePayPeriod(db);
  const target = cycleFor(pp, new Date(`${String(on).slice(0, 10)}T00:00:00Z`));

  // Without carry-over there is nothing to replay: this period stands alone.
  if (!rule.carryOver) {
    const raw = round2(await rawFor(target.startDate, target.endDate));
    const charged = rule.maxPerPeriod === null ? raw : Math.min(raw, rule.maxPerPeriod);
    return {
      period: target, raw, carriedIn: 0,
      charged: round2(charged),
      carriedOut: 0,
      waived: round2(Math.max(0, raw - charged)),
      expired: 0,
    };
  }

  // Oldest period first, so a debt is charged before newer days are.
  const periods = [];
  for (let i = MAX_LOOKBACK; i >= 0; i--) {
    periods.push(cycleFor(pp, shiftMonths(target.startDate, -i)));
  }

  let queue = [];          // [{ days, age }] — age counted in periods carried
  let carriedIn = 0, charged = 0, carriedOut = 0, waived = 0, expired = 0, raw = 0;

  for (let i = 0; i < periods.length; i++) {
    const p = periods[i];
    const isTarget = i === periods.length - 1;

    const periodRaw = round2(await rawFor(p.startDate, p.endDate));
    const openingBalance = round2(queue.reduce((s, q) => s + q.days, 0));

    queue.push({ days: periodRaw, age: 0 });

    const capacity = rule.maxPerPeriod === null ? Infinity : rule.maxPerPeriod;
    let took = 0;
    for (const item of queue) {
      if (took >= capacity) break;
      const take = Math.min(item.days, capacity - took);
      item.days = round2(item.days - take);
      took = round2(took + take);
    }
    queue = queue.filter(q => q.days > 0.0001);

    let periodExpired = 0;
    for (const q of queue) q.age++;
    if (rule.expiry === 'one_period') {
      periodExpired = round2(queue.filter(q => q.age > 1).reduce((s, q) => s + q.days, 0));
      queue = queue.filter(q => q.age <= 1);
    }

    if (isTarget) {
      raw = periodRaw;
      carriedIn = openingBalance;
      charged = took;
      carriedOut = round2(queue.reduce((s, q) => s + q.days, 0));
      expired = periodExpired;
      waived = 0;   // with carry-over on, nothing is forgiven — it moves or it expires
    }
  }

  return { period: target, raw, carriedIn, charged, carriedOut, waived, expired };
}

module.exports = { lopForPeriod, activePayPeriod, resolve, MAX_LOOKBACK };
