/* ── How a finished day is classified ──────────────────────────────────────
 *  Zoho's rule, which this reproduces exactly:
 *
 *    Strict   the hours decide.  At or above the expected full day it is a
 *             full present day.  Between the half-day and full-day figures the
 *             day is split — HALF PRESENT AND HALF ABSENT, not merely labelled
 *             "half day" — and below the half-day figure it is fully absent.
 *
 *    Lenient  the punch decides.  Any valid check-in or check-out marks the
 *             person present for the whole day however few hours they worked.
 *             No punch at all is absent.
 *
 *  In both modes the difference from the expected full day is reported beside
 *  the status as a deficit or as overtime. It never changes the status — in
 *  Zoho that figure is information, not a penalty.
 *
 *  The split is the part that matters and the part we did not have. A single
 *  'half-day' label cannot say how much of the day was unworked, so nothing
 *  downstream — payable days, loss of pay — can act on it. `absent` is that
 *  missing half.
 *
 *  Both thresholds come from the ONE pair Zoho has: expected full day and
 *  expected half day, set manually or taken from the employee's shift. We used
 *  to classify against a second, different pair (7.5h/4h) while reporting
 *  payable time against the expected pair (8h/4h), so a 7.6-hour day was a full
 *  present day that was still short of what the payable report expected.
 *
 *  Nothing here reads the database or the clock: give it hours and a config and
 *  it returns the same answer every time, which is what makes it testable
 *  against Zoho's own worked examples.
 * ────────────────────────────────────────────────────────────────────────── */

const round2 = (n) => Math.round(n * 100) / 100;

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Expected hours for one employee on one day.
 *
 * 'shift' mode takes the length of their own shift; 'manual' uses the org
 * figures. The half-day figure has no shift equivalent in either system, so it
 * stays the org's — halving the shift would invent a number nobody set.
 */
function expectedFor(cfg = {}, shiftHours = null) {
  // shiftHours == null means this employee has no shift, which is not the same
  // as a shift of zero length — Number(null) is 0 and passes isFinite, and an
  // expected day of 0 hours would make every day a full present day.
  const hasShift = shiftHours !== null && shiftHours !== undefined
    && Number.isFinite(Number(shiftHours)) && Number(shiftHours) > 0;
  const full = cfg.expectedMode === 'shift' && hasShift
    ? Number(shiftHours)
    : num(cfg.expectedFullDay, 8);
  const half = num(cfg.expectedHalfDay, 4);
  // A half day longer than a full day would classify everything as absent.
  return { full, half: Math.min(half, full) };
}

/**
 * Classify one finished day.
 *
 * @param {number}  workedHours   hours actually worked (already rounded/capped
 *                                by whatever the policy says about that)
 * @param {boolean} hasPunch      did they check in or out at all
 * @param {number}  lateMinutes   minutes past shift start, for the 'late' label
 * @param {number}  graceMinutes  lateness allowed before the label applies
 * @param {object}  cfg           attendance policy config
 * @param {number}  shiftHours    length of this employee's shift, for 'shift' mode
 *
 * @returns {{status, present, absent, deficit, overtime, expected}}
 *   present/absent are day portions: 1, 0.5 or 0, and they always sum to 1.
 *   deficit/overtime are hours, or null when the policy does not track them —
 *   null meaning "not measured", which is not the same as zero.
 */
function classifyDay({
  workedHours = 0,
  hasPunch = false,
  lateMinutes = 0,
  graceMinutes = 0,
  cfg = {},
  shiftHours = null,
} = {}) {
  const { full, half } = expectedFor(cfg, shiftHours);
  const worked = Math.max(0, num(workedHours, 0));

  // Strict is the default: an unsaved policy must not silently mark everyone
  // present for the day regardless of hours.
  const strict = cfg.strictMode !== false;

  let present, absent;
  if (!hasPunch) {
    present = 0; absent = 1;
  } else if (!strict) {
    // Lenient — the punch alone is enough, whatever the hours say.
    present = 1; absent = 0;
  } else if (worked >= full) {
    present = 1; absent = 0;
  } else if (worked >= half) {
    present = 0.5; absent = 0.5;
  } else {
    present = 0; absent = 1;
  }

  // "Allow overtime and deviation" off means the org does not measure this at
  // all. Reporting 0 would claim they worked their hours exactly.
  const measured = cfg.allowOvertimeAndDeviation === true;
  const deficit = measured ? round2(Math.max(0, full - worked)) : null;
  const overtime = measured ? round2(Math.max(0, worked - full)) : null;

  let status;
  if (present === 1) status = lateMinutes > graceMinutes ? 'late' : 'present';
  else if (present === 0.5) status = 'half-day';
  else status = 'absent';

  return { status, present, absent, deficit, overtime, expected: full };
}

module.exports = { classifyDay, expectedFor };
