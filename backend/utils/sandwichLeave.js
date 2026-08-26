/* ── Sandwich leave ────────────────────────────────────────────────────────
 *  A weekend or holiday that falls between leave days can be counted as leave
 *  itself. Somebody off on Thursday and again on Monday has, on this reading,
 *  taken four days rather than two.
 *
 *  Every decision inside it is a setting, because none of them are ours to
 *  make and all of them change what a person's balance says:
 *
 *    enabled            off by default. Off means this file changes nothing.
 *    minDays            bridge only once the leave runs to this many days.
 *                       0 bridges a single long weekend as readily as a
 *                       fortnight, which is rarely what an org means.
 *    requireBothSides   true  — a bridged day needs leave before AND after it
 *                       false — leave on one side is enough, so a Friday off
 *                               pulls in the weekend that follows
 *    appliesTo          'all' or 'unpaid'. Applying this to earned leave takes
 *                       days off a balance somebody accrued; applying it only
 *                       to unpaid leave costs pay instead. Different decisions.
 *
 *  Two things this deliberately does NOT do.
 *
 *  It never invents a weekend. Non-working days come from work_calendars and
 *  weekend_rules, so the org's real pattern — Sunday always, and the second day
 *  moving between Friday and Saturday by week of month — is honoured. A
 *  hardcoded Saturday/Sunday test would bridge the wrong days about half the
 *  time here.
 *
 *  It never counts the same day twice. The exact dates bridged are stored on
 *  the leave row, so a second request that closes the same gap from the other
 *  side cannot charge for them again.
 * ────────────────────────────────────────────────────────────────────────── */

const { loadWeekendResolver, holidayClosesOffice, holidayTypeFor } = require('./workingDays');

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const midnight = (v) => {
  const d = v instanceof Date ? new Date(v) : new Date(`${String(v).slice(0, 10)}T00:00:00`);
  d.setHours(0, 0, 0, 0);
  return d;
};

const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

// How far either side of the request to look for adjoining leave. A gap wider
// than a week is not a sandwich by any reading, and this bounds the walk.
const REACH = 8;

/**
 * @returns {{enabled, minDays, requireBothSides, appliesTo, autoReverse}}
 */
function resolve(cfg = {}) {
  const s = cfg.sandwichLeave || cfg || {};
  return {
    enabled: s.enabled === true,
    minDays: Number.isFinite(Number(s.minDays)) ? Math.max(0, Number(s.minDays)) : 0,
    requireBothSides: s.requireBothSides !== false,
    appliesTo: s.appliesTo === 'unpaid' ? 'unpaid' : 'all',
    autoReverse: s.autoReverse === true,
  };
}

/**
 * The non-working days a leave request would pull in.
 *
 * @param {object} db          pool or client
 * @param {string} employeeId
 * @param {string|Date} start
 * @param {string|Date} end
 * @param {string} leaveType
 * @param {object} cfg         the leave_additional_config section
 * @param {string} excludeLeaveId  ignore this leave when looking for neighbours
 *
 * @returns {Promise<{days:number, dates:string[], reason:string}>}
 */
async function sandwichedDays(db, { employeeId, start, end, leaveType, cfg, excludeLeaveId = null }) {
  const rule = resolve(cfg);
  if (!rule.enabled) return { days: 0, dates: [], reason: 'policy off' };
  if (leaveType === 'permission') return { days: 0, dates: [], reason: 'permission is hours, not days' };
  if (rule.appliesTo === 'unpaid' && leaveType !== 'unpaid') {
    return { days: 0, dates: [], reason: 'policy applies to unpaid leave only' };
  }

  const from = midnight(start);
  const to = midnight(end);
  if (to < from) return { days: 0, dates: [], reason: 'empty range' };

  // Neighbouring approved leave, so a gap can be closed from either side even
  // when the two halves were applied for separately.
  const windowStart = ymd(addDays(from, -REACH));
  const windowEnd = ymd(addDays(to, REACH));
  const neighbours = await db.query(
    `SELECT start_date::text AS s, end_date::text AS e, sandwich_dates
       FROM leaves
      WHERE employee_id = $1
        AND status IN ('approved', 'pending')
        AND leave_type <> 'permission'
        AND start_date <= $3::date AND end_date >= $2::date
        ${excludeLeaveId ? 'AND id <> $4' : ''}`,
    excludeLeaveId ? [employeeId, windowStart, windowEnd, excludeLeaveId]
                   : [employeeId, windowStart, windowEnd]);

  // Weekends from the org's own rules, holidays read once for the window. A
  // hardcoded Saturday/Sunday test would be wrong here about half the time,
  // because the second weekend day moves by week of month.
  //
  // Loaded before the sets below are built, because whether a date counts as a
  // leave day or as a candidate for bridging depends on it.
  const [resolver, holRes, whoRes] = await Promise.all([
    loadWeekendResolver(),
    db.query(
      `SELECT h.date::text AS ymd, h.type,
              COALESCE(ARRAY_AGG(s.ref_id::text) FILTER (WHERE s.kind = 'location'), '{}') AS location_ids,
              COALESCE(ARRAY_AGG(s.ref_id::text) FILTER (WHERE s.kind = 'shift'), '{}') AS shift_ids
         FROM holidays h
         LEFT JOIN holiday_scopes s ON s.holiday_id = h.id
        WHERE h.date BETWEEN $1::date AND $2::date
        GROUP BY h.id, h.date, h.type`,
      [ymd(addDays(from, -REACH)), ymd(addDays(to, REACH))]),
    // Which holidays reach this person depends on where they work and on what
    // shift, so the bridging question cannot be answered without them.
    db.query(`SELECT work_location_id AS "workLocationId", shift_id AS "shiftId"
                FROM employees WHERE id = $1`, [employeeId]),
  ]);
  const employee = whoRes.rows[0] || {};
  const holMap = new Map();
  for (const h of holRes.rows) {
    if (!holMap.has(h.ymd)) holMap.set(h.ymd, []);
    holMap.get(h.ymd).push({ type: h.type, locationIds: h.location_ids || [], shiftIds: h.shift_ids || [] });
  }

  const isOff = (d) => {
    const type = holidayTypeFor(holMap, ymd(d), employee);
    // An explicit working-day override beats the weekend rules; a closing
    // holiday beats everything.
    if (holidayClosesOffice(type)) return true;
    if (type === 'working_day') return false;
    return resolver.isWeekend(d);
  };

  // Days spent as leave — the WORKING days of each range only. A weekend
  // falling inside a Friday-to-Monday request is not a day of leave; it is
  // exactly the day this policy is deciding whether to charge for, so counting
  // it here would rule it out before it was ever considered.
  const onLeave = new Set();
  const addRange = (a, b) => {
    for (let d = midnight(a); d <= midnight(b); d = addDays(d, 1)) {
      if (!isOff(d)) onLeave.add(ymd(d));
    }
  };
  addRange(from, to);
  for (const n of neighbours.rows) addRange(n.s, n.e);

  // Days some other leave has already been charged for bridging. Without this,
  // applying for Thursday and then for Monday charges the weekend twice.
  const alreadyBridged = new Set();
  for (const n of neighbours.rows) {
    for (const d of (n.sandwich_dates || [])) {
      alreadyBridged.add(d instanceof Date ? ymd(d) : String(d).slice(0, 10));
    }
  }

  // The actual leave days in this block, which is what a threshold counts.
  const leaveDayCount = onLeave.size;
  if (rule.minDays > 0 && leaveDayCount < rule.minDays) {
    return { days: 0, dates: [], reason: `under the ${rule.minDays}-day threshold` };
  }

  const dates = [];
  for (let d = addDays(from, -REACH); d <= addDays(to, REACH); d = addDays(d, 1)) {
    const key = ymd(d);
    if (onLeave.has(key)) continue;          // it is leave, not a bridge
    if (alreadyBridged.has(key)) continue;   // another leave already paid for it
    if (!isOff(d)) continue;                 // a working day is an absence, not a bridge

    // Walk out to the nearest leave day on each side, crossing only other
    // non-working days. A working day in between breaks the sandwich.
    const touches = (step) => {
      for (let i = 1; i <= REACH; i++) {
        const probe = addDays(d, step * i);
        const k = ymd(probe);
        if (onLeave.has(k)) return true;
        if (!isOff(probe)) return false;
      }
      return false;
    };
    const before = touches(-1);
    const after = touches(1);

    const bridged = rule.requireBothSides ? (before && after) : (before || after);
    if (bridged) dates.push(key);
  }

  dates.sort();
  return {
    days: dates.length,
    dates,
    reason: dates.length ? 'bridged' : 'nothing between the leave days',
  };
}

module.exports = { sandwichedDays, resolve };
