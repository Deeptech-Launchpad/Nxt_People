/**
 * utils/hoursPolicy.js
 *
 * The two worked-hour rules from Attendance > Configuration > Policy.
 *
 * Kept out of routes/reports.js so they can be exercised directly with crafted
 * inputs. That matters more than usual here: the seeded attendance in this
 * database is a uniform 8.5 hours, which is already a whole multiple of 15 and
 * 30 minutes, so every rounding assertion made against it passes without
 * rounding anything.
 */

/**
 * Round-off, applied on the way OUT of the database and never on the way in.
 * The stored punch keeps the real time — rounding at write time would destroy
 * the only record of when somebody actually arrived, with no way back.
 */
function roundHours(hours, policy) {
  if (!policy?.roundOff) return hours;
  const step = Number(policy.roundOffMinutes) || 15;
  const mode = policy.roundOffMode || 'nearest';
  const fn = mode === 'up' ? Math.ceil : mode === 'down' ? Math.floor : Math.round;
  return (fn((hours * 60) / step) * step) / 60;
}

/**
 * Minutes of a worked span falling inside the late-night window.
 *
 * The window normally wraps midnight (22:00-06:00), so membership is tested as
 * "at or after the start, OR before the end" in that case rather than as a
 * single range.
 */
function lateNightMinutes(checkIn, checkOut, night) {
  if (!night?.enabled || !checkIn || !checkOut) return 0;
  const ci = new Date(checkIn);
  const co = new Date(checkOut);
  if (Number.isNaN(ci.getTime()) || Number.isNaN(co.getTime()) || !(co > ci)) return 0;

  const [fh, fm] = String(night.from || '22:00').split(':').map(Number);
  const [th, tm] = String(night.to || '06:00').split(':').map(Number);
  if ([fh, th].some(Number.isNaN)) return 0;
  const from = fh * 60 + (fm || 0);
  const to = th * 60 + (tm || 0);
  if (from === to) return 0;

  // A minute at a time. Spans are hours, not days, and this cannot get the
  // wrap-around case subtly wrong the way interval arithmetic does.
  let overlap = 0;
  for (let t = ci.getTime(); t < co.getTime(); t += 60000) {
    const d = new Date(t);
    const m = d.getHours() * 60 + d.getMinutes();
    const inside = from < to ? (m >= from && m < to) : (m >= from || m < to);
    if (inside) overlap += 1;
  }
  return overlap;
}

module.exports = { roundHours, lateNightMinutes };
