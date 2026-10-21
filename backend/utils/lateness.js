/* When somebody was actually due in, and how late they were against that.
 *
 * Lateness used to be measured from the shift's start time and nothing else,
 * which marked people late for time the company had already approved them to
 * be away. An employee with permission from 9:30 to 10:45 who walked in at
 * 10:48 was recorded as "Late by 1h 18m" — the full gap from 9:30 — when he
 * was three minutes late against the time he was actually expected.
 *
 * A permission only moves the deadline when it covers the start of the shift.
 * One taken at two in the afternoon says nothing about when the morning began,
 * and must not excuse a late arrival that happened hours earlier.
 *
 * Consecutive permissions chain: 9:30-10:00 followed by 10:00-10:45 moves the
 * deadline to 10:45, same as the single record would have.
 *
 * This only changes what the day is CALLED. The permission's own hours, the
 * balance it is drawn from, and the expected-hours maths in attendanceRule's
 * classifyDay are all untouched — that already nets approved permission off
 * what a person owed.
 */

/** "09:30", "09:30:00" or a Date -> minutes past midnight. */
function toMinutes(t) {
  if (t === null || t === undefined || t === '') return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t));
  if (!m) return null;
  const h = Number(m[1]), mins = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mins)) return null;
  return h * 60 + mins;
}

/**
 * The minute by which somebody was due in, given the shift start and any
 * approved permissions on that day.
 *
 * @param {number} shiftStartMins  minutes past midnight
 * @param {Array<{startTime, endTime}>} permissions approved permission rows
 * @returns {number} the deadline, in minutes past midnight
 */
function dueInMinutes(shiftStartMins, permissions) {
  if (!Number.isFinite(shiftStartMins)) return shiftStartMins;
  const windows = (permissions || [])
    .map(p => ({ s: toMinutes(p.startTime ?? p.start_time), e: toMinutes(p.endTime ?? p.end_time) }))
    .filter(w => w.s !== null && w.e !== null && w.e > w.s)
    .sort((a, b) => a.s - b.s);

  let due = shiftStartMins;
  for (const w of windows) {
    // Covers the moment they were due, so the deadline moves to its end.
    // `<=` on the start so a permission beginning exactly at shift start
    // counts, which is the common case for a late-arrival permission.
    if (w.s <= due && w.e > due) due = w.e;
  }
  return due;
}

/**
 * Minutes late, with approved permission taken off the front of the day.
 * Never negative — arriving early is not negative lateness.
 */
function lateMinutesFor({ checkInMins, shiftStartMins, permissions }) {
  if (!Number.isFinite(checkInMins) || !Number.isFinite(shiftStartMins)) return 0;
  return Math.max(0, checkInMins - dueInMinutes(shiftStartMins, permissions));
}

module.exports = { toMinutes, dueInMinutes, lateMinutesFor };
