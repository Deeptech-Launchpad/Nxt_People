/* ── How a finished day is classified ──────────────────────────────────────
 *  One engine, three presets. Strict and Lenient reproduce Zoho exactly;
 *  Custom exposes the same knobs so a policy change does not need a code
 *  change. All three run this one function — three implementations would
 *  drift apart, and then "why am I absent?" would have three answers.
 *
 *    Strict    Zoho's rule. At or above the expected full day is a full
 *              present day; between the half-day and full-day figures the day
 *              is split into half present AND HALF ABSENT; below the half-day
 *              figure it is fully absent.
 *
 *    Lenient   Zoho's other rule. Any valid punch marks the whole day present
 *              however few hours were worked.
 *
 *    Custom    The same shape with the decisions turned into settings. This
 *              org's rule — a short day is ABSENT outright, with no half-day
 *              step and no tolerance — is this preset.
 *
 *  ── What is owed, not a flat figure ───────────────────────────────────────
 *  A short day is judged against what the person actually owed that day, not
 *  against a blanket eight hours. Approved half-day leave and approved
 *  permission both reduce it, because the company already agreed to that time
 *  away. Without this, taking two hours of permission and working six would
 *  mark somebody absent, and permission would become a punishment nobody uses.
 *
 *  ── Deficit and overtime ──────────────────────────────────────────────────
 *  The difference from what was owed is reported beside the status. It never
 *  changes the status. When the org does not measure it the figure is null,
 *  not zero — "not measured" and "worked exactly their hours" are different
 *  facts and must not be collapsed into the same number.
 *
 *  Nothing here reads the database or the clock.
 * ────────────────────────────────────────────────────────────────────────── */

const round2 = (n) => Math.round(n * 100) / 100;

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const MODES = ['strict', 'lenient', 'custom'];

/**
 * The knobs actually in force, once the preset is applied.
 *
 * `strictMode` is the older boolean and still decides the preset when no
 * explicit mode is stored, so an existing saved policy keeps behaving as it
 * did rather than silently becoming Custom.
 */
function resolvePolicy(cfg = {}) {
  const mode = MODES.includes(cfg.mode)
    ? cfg.mode
    : (cfg.strictMode === false ? 'lenient' : 'strict');

  if (mode === 'lenient') {
    return {
      mode,
      punchIsEnough: true,
      shortDayBecomes: 'present',
      toleranceMinutes: 0,
      leaveReducesExpected: true,
      permissionReducesExpected: true,
      halfDayLeaveOtherHalf: 'leave',
      exemptOnDuty: false,
    };
  }
  if (mode === 'strict') {
    return {
      mode,
      punchIsEnough: false,
      shortDayBecomes: 'half_day',
      toleranceMinutes: 0,
      leaveReducesExpected: true,
      permissionReducesExpected: true,
      halfDayLeaveOtherHalf: 'leave',
      exemptOnDuty: false,
    };
  }
  return {
    mode: 'custom',
    punchIsEnough: false,
    // The one row where this org differs from Zoho: a short day is absent
    // outright rather than dropping to a half day.
    shortDayBecomes: cfg.shortDayBecomes === 'half_day' ? 'half_day' : 'absent',
    toleranceMinutes: Math.max(0, num(cfg.toleranceMinutes, 0)),
    leaveReducesExpected: cfg.leaveReducesExpected !== false,
    permissionReducesExpected: cfg.permissionReducesExpected !== false,
    halfDayLeaveOtherHalf: cfg.halfDayLeaveOtherHalf === 'absent' ? 'absent' : 'leave',
    exemptOnDuty: cfg.exemptOnDuty === true,
  };
}

/**
 * Expected hours for one employee on one day, before anything is deducted.
 *
 * 'shift' mode takes the length of their own shift. The half-day figure has no
 * shift equivalent in either system, so it stays the org's — halving the shift
 * would invent a number nobody set.
 */
function expectedFor(cfg = {}, shiftHours = null) {
  // shiftHours == null means no shift, which is not a shift of zero length:
  // Number(null) is 0 and passes isFinite, and an expected day of 0 hours
  // would make every day a full present day.
  const hasShift = shiftHours !== null && shiftHours !== undefined
    && Number.isFinite(Number(shiftHours)) && Number(shiftHours) > 0;
  const useShift = cfg.expectedMode === 'shift' && hasShift;

  // Shift mode takes both figures from the shift, exactly as the reference
  // states them: "Full day: Duration of the shift", "Half day: Half of the
  // shift duration". Keeping the org's half-day figure here would pair a
  // 4-hour half day with an 8.5-hour full day, so somebody on a long shift
  // would clear the half-day bar far too easily.
  const full = useShift ? Number(shiftHours) : num(cfg.expectedFullDay, 8);
  const half = useShift ? Number(shiftHours) / 2 : num(cfg.expectedHalfDay, 4);

  // A half day longer than a full day would classify everything as absent.
  return { full, half: Math.min(half, full) };
}

/**
 * Classify one finished day.
 *
 * @param {number}  workedHours      hours actually worked
 * @param {boolean} hasPunch         did they check in or out at all
 * @param {number}  leavePortion     approved leave covering the day: 0, 0.5 or 1
 * @param {number}  permissionHours  approved permission hours on the day
 * @param {boolean} onDuty           the day is approved on-duty
 * @param {number}  lateMinutes      minutes past shift start, for the 'late' label
 * @param {number}  graceMinutes     lateness allowed before the label applies
 * @param {object}  cfg              attendance policy config
 * @param {number}  shiftHours       length of this employee's shift
 *
 * @returns {{status, present, absent, leave, owed, expected, deficit, overtime}}
 *   present, absent and leave are day portions summing to 1.
 */
function classifyDay({
  workedHours = 0,
  hasPunch = false,
  leavePortion = 0,
  permissionHours = 0,
  onDuty = false,
  lateMinutes = 0,
  graceMinutes = 0,
  cfg = {},
  shiftHours = null,
} = {}) {
  const p = resolvePolicy(cfg);
  const { full } = expectedFor(cfg, shiftHours);
  const worked = Math.max(0, num(workedHours, 0));
  const leave = Math.min(1, Math.max(0, num(leavePortion, 0)));
  const permission = Math.max(0, num(permissionHours, 0));

  // A day fully covered by approved leave is not a working day at all. It is
  // not judged, not counted short, and not marked absent.
  if (leave >= 1) {
    return {
      status: 'leave', present: 0, absent: 0, leave: 1,
      owed: 0, expected: full, deficit: null, overtime: null,
    };
  }

  // What they owed once the company's own approvals are taken off.
  const workingPortion = 1 - leave;
  let owed = full * workingPortion;
  if (!p.leaveReducesExpected) owed = full;
  if (p.permissionReducesExpected) owed = Math.max(0, owed - permission);
  owed = round2(owed);

  const tolerance = p.toleranceMinutes / 60;
  const met = worked + tolerance >= owed;

  let present, absent;
  if (onDuty && p.exemptOnDuty) {
    // Approved on-duty at a client site, where there may be nothing to punch.
    present = workingPortion; absent = 0;
  } else if (!hasPunch && !onDuty) {
    present = 0; absent = workingPortion;
  } else if (p.punchIsEnough) {
    present = workingPortion; absent = 0;
  } else if (met) {
    present = workingPortion; absent = 0;
  } else if (p.shortDayBecomes === 'half_day' && worked >= expectedFor(cfg, shiftHours).half) {
    // Zoho's middle step: half of the working portion is present, half absent.
    present = round2(workingPortion / 2); absent = round2(workingPortion / 2);
  } else {
    present = 0; absent = workingPortion;
  }

  // Where the leave half of a half-day-leave day is counted. Recording it as
  // absent takes the day off their balance AND marks them away, so 'leave' is
  // the default and 'absent' is a deliberate choice.
  let leaveOut = leave;
  if (leave > 0 && p.halfDayLeaveOtherHalf === 'absent') {
    absent = round2(absent + leave);
    leaveOut = 0;
  }

  // "Allow overtime and deviation" off means the org does not measure this.
  // Reporting 0 would claim they worked their hours exactly.
  const measured = cfg.allowOvertimeAndDeviation === true;
  const deficit = measured ? round2(Math.max(0, owed - worked)) : null;
  const overtime = measured ? round2(Math.max(0, worked - owed)) : null;

  let status;
  if (present > 0 && absent === 0 && leaveOut === 0) {
    status = lateMinutes > graceMinutes ? 'late' : 'present';
  } else if (present > 0 && leaveOut > 0) {
    status = 'half-day-leave';
  } else if (present > 0) {
    status = 'half-day';
  } else if (leaveOut > 0) {
    status = 'half-day-leave';
  } else {
    status = 'absent';
  }

  return {
    status,
    present: round2(present),
    absent: round2(absent),
    leave: round2(leaveOut),
    owed,
    expected: full,
    deficit,
    overtime,
  };
}

module.exports = { classifyDay, expectedFor, resolvePolicy, MODES };
