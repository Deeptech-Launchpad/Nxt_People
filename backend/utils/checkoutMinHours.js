// Check-out minimum-working-hours gate (General Shift / UK Shift only).
//
// Pure calculation, no DB access — routes/attendance.js's /checkout handler
// supplies the facts this needs (today's effective shift name, permission
// hours applied today, half-day leave type applied today, and the worked
// minutes it has already computed for this checkout) and acts on the
// verdict. Kept separate so the arithmetic can be unit-tested directly.

// Only these two shifts are gated; every other shift (including
// Housekeeping, whose staff never call this route at all — see
// migrate_manual_attendance.js) is completely unaffected.
const GATED_SHIFT_NAMES = new Set(['general shift', 'uk shift']);

// The late-check-in / Apply Permission workflow (separate feature, see
// routes/attendance.js's /checkin) applies to General Shift only — UK
// Shift and Housekeeping are explicitly excluded from it even though UK
// Shift shares the same checkout-gate requirement above.
const GENERAL_SHIFT_NAME = 'general shift';

// Both gated shifts require the same 8h30m, per spec.
const MIN_REQUIRED_MINUTES = 8 * 60 + 30;

// Fixed figures given by the business, not a 50/50 split of the shift span:
// first-half leave is 4h, second-half leave is 4h30m.
const HALF_DAY_LEAVE_MINUTES = { first_half: 4 * 60, second_half: 4 * 60 + 30 };

function normalizeShiftName(shiftName) {
  return String(shiftName || '').trim().toLowerCase();
}

function isGatedShift(shiftName) {
  return GATED_SHIFT_NAMES.has(normalizeShiftName(shiftName));
}

// Reliable shift identity check: compares the employee's actual assigned
// shift name (joined from the shifts table, never a guess) against the
// literal "General Shift" — no employee-name matching, no text heuristics.
function isGeneralShift(shiftName) {
  return normalizeShiftName(shiftName) === GENERAL_SHIFT_NAME;
}

// Who may enable/disable checkout_min_hours_exempt for an employee.
// Deliberately narrower than PUT /employees/:id's own authorize(...) guard
// (admin, director, hr_admin), which still covers every other field on that
// route unchanged — director, team_incharge (Team Lead) and team_member
// (Employee) can all still edit everything else about an employee, just not
// this one setting. A closed allowlist of exactly two roles, not a denylist,
// so adding a future role to the system can't silently grant it this by
// default.
const CHECKOUT_EXEMPTION_ROLES = new Set(['admin', 'hr_admin']);

function canModifyCheckoutExemption(role) {
  return CHECKOUT_EXEMPTION_ROLES.has(role);
}

function fmtHm(totalMinutes) {
  const m = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${mm}m`;
}

// permissionHours: sum of permission-leave hours applied for today, counting
// any non-rejected status (pending or approved) — the business rule does
// not wait for approval/rejection to calculate the requirement.
// halfDayType: 'first_half' | 'second_half' | null/undefined, same
// non-rejected-status rule.
function requiredMinutesFor({ permissionHours, halfDayType } = {}) {
  const permissionMinutes = Math.round((Number(permissionHours) || 0) * 60);
  const halfDayMinutes = HALF_DAY_LEAVE_MINUTES[halfDayType] || 0;
  return Math.max(0, MIN_REQUIRED_MINUTES - permissionMinutes - halfDayMinutes);
}

// workedMinutes: today's accumulated working_hours as of this checkout,
// expressed in minutes (same value the route is about to persist).
// exempt: this employee's permanent, admin-set exemption from the minimum
//   checkout-hours restriction — bypasses everything below unconditionally.
// Returns { blocked: false } for a non-gated shift or once the requirement
// is met; otherwise { blocked: true, requiredMinutes, workedMinutes,
// shortfallMinutes, message }.
function evaluateCheckoutGate({ shiftName, workedMinutes, permissionHours, halfDayType, exempt } = {}) {
  if (exempt) return { blocked: false, exempt: true };
  if (!isGatedShift(shiftName)) return { blocked: false };

  const requiredMinutes = requiredMinutesFor({ permissionHours, halfDayType });
  const workedRounded = Math.round(Number(workedMinutes) || 0);
  const shortfallMinutes = requiredMinutes - workedRounded;

  if (shortfallMinutes <= 0) return { blocked: false, requiredMinutes };

  return {
    blocked: true,
    requiredMinutes,
    workedMinutes: workedRounded,
    shortfallMinutes,
    message: `You still need ${fmtHm(shortfallMinutes)} more to reach the required `
      + `${fmtHm(requiredMinutes)} for today (completed ${fmtHm(workedRounded)}).`,
  };
}

module.exports = {
  isGatedShift,
  isGeneralShift,
  canModifyCheckoutExemption,
  requiredMinutesFor,
  evaluateCheckoutGate,
  MIN_REQUIRED_MINUTES,
  HALF_DAY_LEAVE_MINUTES,
};
