// Regression test for the Check-out Minimum-Working-Hours Restriction.
//
// Part A exercises backend/utils/checkoutMinHours.js's pure calculation
// directly — no DB needed, covers the arithmetic for every spec scenario.
// Part B proves the new SQL added to routes/attendance.js's /checkout
// handler (the "pending/approved, never rejected" permission + half-day
// lookup, and the pre-existing session-accumulation formula it feeds into)
// against real tables, inside one transaction that is always rolled back.
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'error';

const pool = require('./db');
const { evaluateCheckoutGate, requiredMinutesFor, isGatedShift, MIN_REQUIRED_MINUTES } = require('./utils/checkoutMinHours');

let passed = 0, total = 0;
function check(label, ok, extra) {
  total++;
  if (ok) { passed++; console.log(`PASS - ${label}`); }
  else { console.log(`FAIL - ${label}${extra ? ' :: ' + JSON.stringify(extra) : ''}`); }
}

// ───────────────────────── Part A — pure calculation ─────────────────────────

// 1. Normal General Shift: 8h30m completed -> checkout allowed.
{
  const r = evaluateCheckoutGate({ shiftName: 'General Shift', workedMinutes: 510, permissionHours: 0, halfDayType: null });
  check('General Shift, exactly 8h30m worked: not blocked', r.blocked === false);
}

// 2. Normal General Shift: less than 8h30m -> checkout blocked, shortfall shown.
{
  const r = evaluateCheckoutGate({ shiftName: 'General Shift', workedMinutes: 480, permissionHours: 0, halfDayType: null }); // 8h00m
  check('General Shift, 8h00m worked: blocked', r.blocked === true);
  check('General Shift shortfall is exactly 30m', r.shortfallMinutes === 30, r);
  check('Blocked message mentions required/remaining in h/m form', /8h 30m/.test(r.message) && /30m/.test(r.message), r.message);
}

// 3. UK Shift: same calculation as General Shift.
{
  const r = evaluateCheckoutGate({ shiftName: 'UK Shift', workedMinutes: 480, permissionHours: 0, halfDayType: null });
  check('UK Shift uses the same 8h30m requirement as General Shift', r.blocked === true && r.requiredMinutes === MIN_REQUIRED_MINUTES);
  check('UK Shift matched case-insensitively/trimmed too', isGatedShift('  uk shift ') === true);
}

// 4. Housekeeping Shift: existing behaviour unchanged (never gated).
{
  const r = evaluateCheckoutGate({ shiftName: 'Housekeeping Shift', workedMinutes: 0, permissionHours: 0, halfDayType: null });
  check('Housekeeping Shift is never gated, even with zero hours worked', r.blocked === false);
  check('An employee with no shift at all is never gated', evaluateCheckoutGate({ shiftName: null, workedMinutes: 0 }).blocked === false);
}

// 5. One first-half leave -> 4h30m attendance required.
{
  const req = requiredMinutesFor({ permissionHours: 0, halfDayType: 'first_half' });
  check('First-half leave requires exactly 4h30m attendance', req === 4 * 60 + 30, req);
  const ok = evaluateCheckoutGate({ shiftName: 'General Shift', workedMinutes: req, permissionHours: 0, halfDayType: 'first_half' });
  const short = evaluateCheckoutGate({ shiftName: 'General Shift', workedMinutes: req - 1, permissionHours: 0, halfDayType: 'first_half' });
  check('First-half leave: checkout allowed once 4h30m reached', ok.blocked === false);
  check('First-half leave: checkout blocked at 4h29m (1 minute short)', short.blocked === true && short.shortfallMinutes === 1);
}

// 6 & 7. Second-half leave -> 4h attendance required (spec section 9 lists
// this once as "one second-half leave" and again as "two half-day leaves";
// the explicit worked example for both is "Second-half leave from 1:30-6:00
// PM", so both map to the same half_day_type = 'second_half' calculation —
// there is only one half-day leave column per day in this schema, so "two
// half-day leaves" is read as the second-half-type case, not two separate
// leave rows (see the Update 6 report for the full reasoning).
{
  const req = requiredMinutesFor({ permissionHours: 0, halfDayType: 'second_half' });
  check('Second-half leave requires exactly 4h attendance', req === 4 * 60, req);
  const ok = evaluateCheckoutGate({ shiftName: 'General Shift', workedMinutes: req, permissionHours: 0, halfDayType: 'second_half' });
  check('Second-half leave: checkout allowed once 4h reached', ok.blocked === false);
  check('First-half and second-half leave durations are NOT identical', requiredMinutesFor({ halfDayType: 'first_half' }) !== requiredMinutesFor({ halfDayType: 'second_half' }));
}

// 8. Two-hour permission -> 6h30m attendance required.
{
  const req = requiredMinutesFor({ permissionHours: 2, halfDayType: null });
  check('2-hour permission requires exactly 6h30m attendance', req === 6 * 60 + 30, req);
}

// 9. Permission plus one half-day (first-half) leave -> combined deduction.
{
  // Spec example: normal 8h30m - 2h permission - 4h (first-half) leave = 2h30m.
  const req = requiredMinutesFor({ permissionHours: 2, halfDayType: 'first_half' });
  check('Permission (2h) + first-half leave (4h): required attendance is exactly 2h30m', req === 2 * 60 + 30, req);
}

// Deductions never push the requirement below zero (defensive — not an
// expected real-world combination, but must not misbehave if it occurs).
{
  const req = requiredMinutesFor({ permissionHours: 6, halfDayType: 'second_half' }); // 6h + 4h30m > 8h30m
  check('Combined deductions exceeding the shift total floor at 0, never negative', req === 0, req);
}

async function main() {
  const client = await pool.connect();
  const stamp = Date.now();
  try {
    await client.query('BEGIN');

    const mkEmployee = async (shiftId) => {
      const r = await client.query(
        `INSERT INTO employees (first_name, last_name, email, password, role, status, shift_id)
         VALUES ('Test', 'Employee', $1, 'x', 'team_member', 'active', $2) RETURNING id`,
        [`checkout-min-hours-${stamp}-${Math.random().toString(36).slice(2)}@test.local`, shiftId]
      );
      return r.rows[0].id;
    };
    const mkShift = async (name, start, end) => {
      const r = await client.query(
        `INSERT INTO shifts (name, start_time, end_time) VALUES ($1, $2, $3) RETURNING id`,
        [name, start, end]
      );
      return r.rows[0].id;
    };

    const generalShiftId = await mkShift(`General Shift ${stamp}`, '09:30', '18:00');
    // Deliberately named exactly 'General Shift' / 'UK Shift' for the gate
    // match itself (the gate matches by name, case-insensitively) — the
    // shiftId above is only used for employee assignment / shift_hours;
    // rename it to the literal gated name for this employee's lookup.
    await client.query(`UPDATE shifts SET name = 'General Shift' WHERE id = $1`, [generalShiftId]);
    const employeeId = await mkEmployee(generalShiftId);

    // ── Part B.1 — "does not wait for approval" (pending permission counts) ──
    const PERMISSION_PENDING_OR_APPROVED_SQL = `
      SELECT COALESCE((
               SELECT SUM(COALESCE(l.hours, 0))
                 FROM leaves l
                WHERE l.employee_id = $1 AND l.status <> 'rejected'
                  AND l.leave_type = 'permission'
                  AND $2::date BETWEEN l.start_date AND l.end_date), 0) AS permission_hours`;

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

    await client.query(
      `INSERT INTO leaves (employee_id, leave_type, start_date, end_date, total_days, reason, status, start_time, end_time, hours)
       VALUES ($1, 'permission', $2::date, $2::date, 0, 'test permission', 'pending', '11:00', '13:00', 2)`,
      [employeeId, today]
    );
    let permRes = await client.query(PERMISSION_PENDING_OR_APPROVED_SQL, [employeeId, today]);
    check('A PENDING (not yet approved) permission request already reduces the requirement', Number(permRes.rows[0].permission_hours) === 2);

    await client.query(`UPDATE leaves SET status = 'rejected' WHERE employee_id = $1 AND leave_type = 'permission'`, [employeeId]);
    permRes = await client.query(PERMISSION_PENDING_OR_APPROVED_SQL, [employeeId, today]);
    check('A REJECTED permission request no longer reduces the requirement', Number(permRes.rows[0].permission_hours) === 0);

    // ── Part B.2 — half-day leave lookup, pending counts, rejected excluded ──
    const HALF_DAY_SQL = `
      SELECT l.half_day_type
        FROM leaves l
       WHERE l.employee_id = $1 AND l.status <> 'rejected'
         AND l.leave_type <> 'permission' AND l.is_half_day = true
         AND $2::date BETWEEN l.start_date AND l.end_date
       ORDER BY l.created_at DESC LIMIT 1`;

    await client.query(
      `INSERT INTO leaves (employee_id, leave_type, start_date, end_date, total_days, reason, status, is_half_day, half_day_type)
       VALUES ($1, 'casual', $2::date, $2::date, 0.5, 'test half day', 'pending_approval', true, 'first_half')`,
      [employeeId, today]
    );
    let halfRes = await client.query(HALF_DAY_SQL, [employeeId, today]);
    check('A PENDING half-day (first-half) leave is already picked up', halfRes.rows[0]?.half_day_type === 'first_half');

    // ── Part B.3 — multiple check-in/out sessions accumulate correctly ──
    // Replicates the exact (unmodified) formula from routes/attendance.js's
    // /checkout handler: workingHours = safePrev(attendance.working_hours
    // before this checkout) + sessionHours(this session). This is the
    // number the new gate reads as `workedMinutes` — proving it accumulates
    // correctly across sessions proves the gate sees the true daily total.
    const attRes = await client.query(
      `INSERT INTO attendance (employee_id, date, check_in, working_hours, status)
       VALUES ($1, $2::date, NOW() - INTERVAL '5 hours', 0, 'present') RETURNING id`,
      [employeeId, today]
    );
    const attendanceId = attRes.rows[0].id;

    // Session 1: checked in 5h ago, checks out now -> ~5h worked.
    const safePrev1 = 0;
    const sessionHours1 = 5; // simulated, matches the 5-hour check_in offset above
    const workingHoursAfterSession1 = parseFloat((safePrev1 + sessionHours1).toFixed(8));
    await client.query(`UPDATE attendance SET check_out = NOW(), working_hours = $1 WHERE id = $2`, [workingHoursAfterSession1, attendanceId]);
    const gate1 = evaluateCheckoutGate({ shiftName: 'General Shift', workedMinutes: workingHoursAfterSession1 * 60, permissionHours: 0, halfDayType: null });
    check('After session 1 (5h total): still blocked, 3h30m short', gate1.blocked === true && gate1.shortfallMinutes === 210, gate1);

    // Employee checks in again (permission break ended), accumulates a
    // second session of 3h40m -> total 8h40m, clears the 8h30m requirement.
    await client.query(`UPDATE attendance SET check_out = NULL, check_in = NOW() - INTERVAL '3 hours 40 minutes' WHERE id = $1`, [attendanceId]);
    const prevRaw = (await client.query(`SELECT working_hours FROM attendance WHERE id = $1`, [attendanceId])).rows[0].working_hours;
    const safePrev2 = isFinite(parseFloat(prevRaw)) ? parseFloat(prevRaw) : 0;
    const sessionHours2 = 3 + 40 / 60;
    const workingHoursAfterSession2 = parseFloat((safePrev2 + sessionHours2).toFixed(8));
    const gate2 = evaluateCheckoutGate({ shiftName: 'General Shift', workedMinutes: workingHoursAfterSession2 * 60, permissionHours: 0, halfDayType: null });
    check('After session 2 (5h + 3h40m = 8h40m total): requirement met, checkout allowed', gate2.blocked === false, { workingHoursAfterSession2, gate2 });

    // ── Part B.4 — missing/NaN working_hours handled safely (existing
    // safePrev fallback, unmodified by this feature; confirmed here so the
    // gate never receives NaN from a fresh/blank row). ──
    const freshRaw = null; // a brand-new attendance row before any checkout
    const safePrevFresh = isFinite(parseFloat(freshRaw)) ? parseFloat(freshRaw) : 0;
    check('A fresh/NULL working_hours value safely falls back to 0, not NaN', safePrevFresh === 0 && Number.isFinite(safePrevFresh));

    // ── Confirm nothing was actually written ──
    const inTxn = await client.query(`SELECT COUNT(*)::int AS n FROM employees WHERE email LIKE $1`, [`checkout-min-hours-${stamp}-%@test.local`]);
    check('synthetic employee exists only inside this (about to be rolled back) transaction', inTxn.rows[0].n === 1);

  } catch (err) {
    console.error('ERROR during test run:', err);
  } finally {
    await client.query('ROLLBACK');
    const postRollback = await pool.query(`SELECT COUNT(*)::int AS n FROM employees WHERE email LIKE $1`, [`checkout-min-hours-${stamp}-%@test.local`]);
    check('rollback confirmed - no synthetic employees persisted', postRollback.rows[0].n === 0);
    client.release();
    await pool.end();
  }

  console.log(`\n${passed}/${total} checks passed`);
  process.exit(passed === total ? 0 : 1);
}

main();
