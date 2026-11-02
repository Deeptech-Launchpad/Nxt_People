// Employee-only late check-in: Permission vs. Compensate Working Hours.
//
// Pure calculation, no DB access — routes/attendance.js's /checkin handler
// supplies the facts this needs (the caller's role, their resolved shift
// name, the check-in clock-time in minutes, and whether this is the day's
// first check-in) and acts on the verdict. Kept separate from
// checkoutMinHours.js: that file is the checkout-time gate (General + UK
// Shift, every role); this is the check-in-time decision (General Shift
// only, Employee role only) — two different rules that happen to share a
// shift name, not one rule reused.

const { isGeneralShift } = require('./checkoutMinHours');

// Canonical "Employee" role string — see utils/roles.js's single source of
// truth (ROLES.TEAM_MEMBER). Not re-derived from that module to avoid a
// circular-ish coupling for one literal; kept identical to it deliberately.
//
// 'employee' is also accepted: migrate_rename_roles.js renamed the role
// string from 'employee' to 'team_member' org-wide, but that migration
// never touched every existing row — some employees in this database still
// carry the pre-rename 'employee' value. Both strings mean the exact same
// role; this does not broaden who the late-check-in workflow applies to; it
// only stops two still-active, still-General-Shift employees from being
// silently skipped by it because of a data migration gap. No employee
// record or role value is changed here — this only widens what this one
// feature's own eligibility check reads as "Employee".
const EMPLOYEE_ROLE = 'team_member';
const EMPLOYEE_ROLES = new Set([EMPLOYEE_ROLE, 'employee']);

function isEmployeeRole(role) {
  return EMPLOYEE_ROLES.has(role);
}

// 9:45 AM. Fixed, independent of shift grace/lateness settings — the spec's
// own cutoff, not the existing late-detection logic further down the route.
const LATE_CHECKIN_CUTOFF_MINS = 9 * 60 + 45;

const VALID_ACTIONS = new Set(['permission', 'compensate']);

// role: req.user.role. shiftName: the employee's resolved shift name today
//   (rostered-first, same resolution as id/start_time — never guessed).
// checkInMins: minutes since midnight, in the org's timezone, of this
//   check-in attempt.
// isFirstCheckin: true only when there is no existing attendance row for
//   today at all — a re-check-in later in the day must never re-trigger
//   this, it already has an answer.
// hasValidFirstHalfLeaveToday: a pending-or-approved (never rejected or
//   cancelled) First-Half Leave request covering today — see
//   hasValidFirstHalfLeave() below for how the route resolves this. A
//   First-Half Leave fully explains a late arrival, so it bypasses the
//   whole late-check-in decision — no popup, no reason, no record —
//   regardless of what time the check-in actually lands at. Second-Half
//   Leave gets no such exception: it does not affect the morning check-in
//   at all, only (unchanged) the checkout-time requirement.
function isLateCheckinEligible({ role, shiftName, checkInMins, isFirstCheckin, hasValidFirstHalfLeaveToday } = {}) {
  if (hasValidFirstHalfLeaveToday) return false;
  return !!isFirstCheckin
    && isEmployeeRole(role)
    && isGeneralShift(shiftName)
    && Number(checkInMins) > LATE_CHECKIN_CUTOFF_MINS;
}

// Validates the decision an eligible check-in must supply. Returns
// { ok: true, action, reason, leaveId } or { ok: false, code, message } —
// the route turns a non-ok result directly into its 400 response, so this
// function is the single place the "did they even choose?" and "is the
// Permission link actually present?" rules live, instead of being
// duplicated inline. Ownership/type verification of leaveId still has to
// happen in the route (this file stays DB-free) — this only confirms one
// was supplied at all.
//
// The reason for Compensate Working Hours is OPTIONAL: an employee may
// proceed with it blank. When one is given it is trimmed and saved/shown
// normally; when it isn't, `reason` comes back null, same as it already did
// for the Permission path. Nothing about the 8h30m requirement, the
// checkout gate, or any other validation is affected by this — only
// whether a reason is mandatory to proceed.
//
// leaveId is REQUIRED for 'permission': check-in must only complete after a
// real Permission application has actually been submitted (its leaves.id is
// the proof), never from the bare choice alone. The frontend now only ever
// calls /checkin with action:'permission' from ApplyLeaveModal's onDone —
// i.e. after a successful POST /leaves — so this also closes off a direct
// API call that tries to claim "permission" without ever applying for one.
function validateLateCheckinDecision({ action, reason, leaveId } = {}) {
  if (!VALID_ACTIONS.has(action)) {
    return {
      ok: false, code: 'LATE_CHECKIN_DECISION_REQUIRED',
      message: 'Check-in after 9:45 AM requires choosing Apply Permission or Compensate Working Hours.',
    };
  }
  if (action === 'permission' && !String(leaveId || '').trim()) {
    return {
      ok: false, code: 'LATE_CHECKIN_PERMISSION_NOT_LINKED',
      message: 'Check-in can only complete after the Permission application has been submitted.',
    };
  }
  const trimmedReason = String(reason || '').trim();
  return {
    ok: true, action,
    reason: action === 'compensate' && trimmedReason ? trimmedReason : null,
    leaveId: action === 'permission' ? String(leaveId).trim() : null,
  };
}

module.exports = {
  EMPLOYEE_ROLE,
  EMPLOYEE_ROLES,
  isEmployeeRole,
  LATE_CHECKIN_CUTOFF_MINS,
  isLateCheckinEligible,
  validateLateCheckinDecision,
};
