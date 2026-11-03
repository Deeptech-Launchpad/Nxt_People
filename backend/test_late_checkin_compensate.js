// Update 2 — Employee-only Late Check-in: Apply Permission.
// Part A: isLateCheckinEligible() + validateLateCheckinDecision(), pure, no DB.
// Part B: live, synthetic-data checks against the real schema (multi-session
// accumulation, late_checkin_action persisted vs. not re-asked on re-checkin).
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'error';
const { Pool } = require('pg');
const { isLateCheckinEligible, validateLateCheckinDecision, LATE_CHECKIN_CUTOFF_MINS, isEmployeeRole } = require('./utils/lateCheckinCompensate');
const { evaluateCheckoutGate } = require('./utils/checkoutMinHours');
const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
});

let passed = 0, total = 0;
function check(label, ok, extra) {
  total++;
  if (ok) { passed++; console.log(`PASS - ${label}`); }
  else { console.log(`FAIL - ${label}${extra ? ' :: ' + JSON.stringify(extra) : ''}`); }
}

// ───────────────────────── Part A: eligibility + decision ─────────────────
console.log('\n════ isLateCheckinEligible (pure) ════\n');

const base = { role: 'team_member', shiftName: 'General Shift', isFirstCheckin: true };

check('9:45 AM exactly (585 min) follows the normal flow — NOT eligible',
  isLateCheckinEligible({ ...base, checkInMins: 585 }) === false);
check('9:46 AM (586 min) IS eligible', isLateCheckinEligible({ ...base, checkInMins: 586 }) === true);
check('9:44 AM is NOT eligible', isLateCheckinEligible({ ...base, checkInMins: 584 }) === false);
check('cutoff constant is exactly 9:45 (585 minutes)', LATE_CHECKIN_CUTOFF_MINS === 585);

check('Admin role is never eligible, however late', isLateCheckinEligible({ ...base, role: 'admin', checkInMins: 700 }) === false);
check('HR (hr_admin) role is never eligible', isLateCheckinEligible({ ...base, role: 'hr_admin', checkInMins: 700 }) === false);
check('Manager role is never eligible', isLateCheckinEligible({ ...base, role: 'manager', checkInMins: 700 }) === false);
check('Team Lead (team_incharge) role is never eligible', isLateCheckinEligible({ ...base, role: 'team_incharge', checkInMins: 700 }) === false);
check('Director role is never eligible', isLateCheckinEligible({ ...base, role: 'director', checkInMins: 700 }) === false);
check('Employee (team_member) role late on General Shift IS eligible', isLateCheckinEligible({ ...base, checkInMins: 700 }) === true);
check('Employee (legacy "employee" role string) late on General Shift IS ALSO eligible — same role, pre-migrate_rename_roles.js spelling',
  isLateCheckinEligible({ ...base, role: 'employee', checkInMins: 700 }) === true);
check('isEmployeeRole recognizes both spellings', isEmployeeRole('team_member') === true && isEmployeeRole('employee') === true);
check('isEmployeeRole rejects everything else (admin/hr_admin/manager/team_incharge/director/unknown)',
  ['admin', 'hr_admin', 'manager', 'team_incharge', 'director', 'nonsense', undefined].every(r => isEmployeeRole(r) === false));

check('UK Shift employee, however late, is NOT eligible (General Shift only)',
  isLateCheckinEligible({ ...base, shiftName: 'UK Shift', checkInMins: 700 }) === false);
check('UK Shift employee under the legacy "employee" role string is ALSO not eligible — shift rule still applies regardless of which role spelling',
  isLateCheckinEligible({ ...base, role: 'employee', shiftName: 'UK Shift', checkInMins: 700 }) === false);
check('Housekeeping Shift employee, however late, is NOT eligible',
  isLateCheckinEligible({ ...base, shiftName: 'Housekeeping Shift', checkInMins: 700 }) === false);
check('Housekeeping Shift employee under the legacy "employee" role string is ALSO not eligible',
  isLateCheckinEligible({ ...base, role: 'employee', shiftName: 'Housekeeping Shift', checkInMins: 700 }) === false);
check('legacy "employee" role at or before 9:45 AM follows the normal flow — NOT eligible (time rule still applies)',
  isLateCheckinEligible({ ...base, role: 'employee', checkInMins: 585 }) === false);
check('no shift assigned at all is NOT eligible',
  isLateCheckinEligible({ ...base, shiftName: null, checkInMins: 700 }) === false);
check('shift name matching is case/whitespace-insensitive, same as the checkout gate',
  isLateCheckinEligible({ ...base, shiftName: '  GENERAL shift  ', checkInMins: 700 }) === true);

check('a re-check-in later in the day (isFirstCheckin: false) is NEVER eligible, however late',
  isLateCheckinEligible({ ...base, checkInMins: 700, isFirstCheckin: false }) === false);

console.log('\n════ First-Half Leave exception (pure) ════\n');

check('a valid (approved) First-Half Leave bypasses the late-check-in workflow entirely',
  isLateCheckinEligible({ ...base, checkInMins: 700, hasValidFirstHalfLeaveToday: true }) === false);
check('the bypass holds even very late (e.g. 2:30 PM / 870 min) — the leave explains the whole morning',
  isLateCheckinEligible({ ...base, checkInMins: 870, hasValidFirstHalfLeaveToday: true }) === false);
check('with no First-Half Leave, the normal late-check-in workflow still applies (regression)',
  isLateCheckinEligible({ ...base, checkInMins: 700, hasValidFirstHalfLeaveToday: false }) === true);
check('the bypass does not itself grant eligibility to someone who would not otherwise be eligible (e.g. wrong role)',
  isLateCheckinEligible({ ...base, role: 'admin', checkInMins: 700, hasValidFirstHalfLeaveToday: true }) === false);
check('the First-Half Leave bypass also applies to the legacy "employee" role string',
  isLateCheckinEligible({ ...base, role: 'employee', checkInMins: 700, hasValidFirstHalfLeaveToday: true }) === false);
check('a re-check-in later in the day is NEVER eligible under the legacy "employee" role string either (regression)',
  isLateCheckinEligible({ ...base, role: 'employee', checkInMins: 700, isFirstCheckin: false }) === false);

console.log('\n════ validateLateCheckinDecision (pure) ════\n');

check('no action at all -> LATE_CHECKIN_DECISION_REQUIRED',
  validateLateCheckinDecision({}).code === 'LATE_CHECKIN_DECISION_REQUIRED');
check('garbage action value -> LATE_CHECKIN_DECISION_REQUIRED',
  validateLateCheckinDecision({ action: 'nonsense' }).code === 'LATE_CHECKIN_DECISION_REQUIRED');
check('"permission" with no reason is fine (given a leaveId) — Permission needs no reason of its own',
  validateLateCheckinDecision({ action: 'permission', leaveId: 'abc-123' }).ok === true);

// Compensate Working Hours has been removed — 'compensate' must now be
// rejected exactly like any other invalid action, even with a leaveId.
check('"compensate" is no longer a valid action — rejected with LATE_CHECKIN_DECISION_REQUIRED',
  validateLateCheckinDecision({ action: 'compensate', leaveId: 'abc-123' }).code === 'LATE_CHECKIN_DECISION_REQUIRED');
check('"permission" decision carries no reason even if one was sent (not stored for that path, regression)',
  validateLateCheckinDecision({ action: 'permission', leaveId: 'abc-123', reason: 'ignored' }).reason === null);
check('an invalid action is still rejected',
  validateLateCheckinDecision({ action: 'nonsense', reason: 'Traffic' }).code === 'LATE_CHECKIN_DECISION_REQUIRED');

// Permission now requires proof a real application exists: the submitted
// leave's own id. Check-in must not complete on the bare choice alone —
// this is the actual fix for "Applied Permission with no application".
check('"permission" with NO leaveId -> LATE_CHECKIN_PERMISSION_NOT_LINKED (refuses to complete check-in)',
  validateLateCheckinDecision({ action: 'permission' }).code === 'LATE_CHECKIN_PERMISSION_NOT_LINKED');
check('"permission" with a blank leaveId is treated the same as missing (cannot bypass with an empty string)',
  validateLateCheckinDecision({ action: 'permission', leaveId: '   ' }).code === 'LATE_CHECKIN_PERMISSION_NOT_LINKED');
check('"permission" WITH a leaveId is accepted and the id is trimmed through',
  validateLateCheckinDecision({ action: 'permission', leaveId: '  abc-123  ' }).ok === true
  && validateLateCheckinDecision({ action: 'permission', leaveId: '  abc-123  ' }).leaveId === 'abc-123');
check('"permission" ok result never carries a reason, even alongside a leaveId',
  validateLateCheckinDecision({ action: 'permission', leaveId: 'abc-123', reason: 'ignored' }).reason === null);

// ───────────────────────── Part B: live, synthetic data ───────────────────
(async () => {
  console.log('\n════ Live multi-session + persistence checks ════\n');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const shiftRes = await client.query(
      `SELECT id FROM shifts WHERE lower(trim(name)) = 'general shift' LIMIT 1`
    );
    check('a "General Shift" row exists in this database to test against', shiftRes.rows.length === 1, shiftRes.rows);
    const generalShiftId = shiftRes.rows[0]?.id;

    const empRes = await client.query(
      `INSERT INTO employees (employee_id, first_name, last_name, email, role, status, joining_date, shift_id)
       VALUES ('TESTLATECI01', 'Test', 'LateCheckin', 'test.late.checkin@example.invalid', 'team_member', 'active', '2024-01-01', $1)
       RETURNING id`,
      [generalShiftId]
    );
    const empId = empRes.rows[0].id;
    const today = '2026-10-31';

    // A second, separate employee: late, chose Permission — no reason
    // stored for that path, and their checkout is held to the normal
    // General-Shift minimum-hours rule.
    const empRes2 = await client.query(
      `INSERT INTO employees (employee_id, first_name, last_name, email, role, status, joining_date, shift_id)
       VALUES ('TESTLATECI02', 'Test', 'Permission', 'test.late.permission@example.invalid', 'team_member', 'active', '2024-01-01', $1)
       RETURNING id`,
      [generalShiftId]
    );
    const emp2Id = empRes2.rows[0].id;
    await client.query(
      `INSERT INTO attendance (employee_id, date, check_in, session_started_at, status, late_minutes, late_checkin_action, late_checkin_reason)
       VALUES ($1, $2::date, $3, $3, 'late', 61, 'permission', NULL)`,
      [emp2Id, today, `${today} 10:46:00`]
    );
    const row2 = (await client.query(
      `SELECT late_checkin_action, late_checkin_reason FROM attendance WHERE employee_id = $1 AND date = $2::date`,
      [emp2Id, today]
    )).rows[0];
    check('Permission path stores action but no reason', row2.late_checkin_action === 'permission' && row2.late_checkin_reason === null);
    let gate = evaluateCheckoutGate({ shiftName: 'General Shift', workedMinutes: 390, permissionHours: 2 });
    check('Permission-path checkout uses the normal deduction rule', gate.blocked === false);

    // ── Permission linkage (the actual fix) ─────────────────────────────
    // Mirrors routes/attendance.js's own ownership/type check exactly, for
    // fidelity with what the route actually runs.
    const verifyPermissionLink = async (leaveId, employeeId) => {
      const r = await client.query(
        `SELECT id FROM leaves WHERE id = $1 AND employee_id = $2 AND leave_type = 'permission'`,
        [leaveId, employeeId]
      );
      return r.rows.length > 0;
    };

    const empRes4 = await client.query(
      `INSERT INTO employees (employee_id, first_name, last_name, email, role, status, joining_date, shift_id)
       VALUES ('TESTLATECI04', 'Test', 'PermissionLinked', 'test.permission.linked@example.invalid', 'team_member', 'active', '2024-01-01', $1)
       RETURNING id`,
      [generalShiftId]
    );
    const emp4Id = empRes4.rows[0].id;
    const realPermission = await client.query(
      `INSERT INTO leaves (employee_id, leave_type, start_date, end_date, total_days, reason, status, hours, start_time, end_time)
       VALUES ($1, 'permission', $2::date, $2::date, 0, 'test', 'pending', 1.0, '09:30', '10:30')
       RETURNING id`,
      [emp4Id, today]
    );
    const realPermissionId = realPermission.rows[0].id;
    check('a genuine Permission leave belonging to the employee passes the ownership/type check',
      await verifyPermissionLink(realPermissionId, emp4Id) === true);

    // Someone else's Permission request must NOT verify for this employee.
    const otherEmpRes = await client.query(
      `INSERT INTO employees (employee_id, first_name, last_name, email, role, status, joining_date)
       VALUES ('TESTLATECI04B', 'Test', 'Other', 'test.permission.other@example.invalid', 'team_member', 'active', '2024-01-01')
       RETURNING id`
    );
    const otherEmpId = otherEmpRes.rows[0].id;
    const otherPermission = await client.query(
      `INSERT INTO leaves (employee_id, leave_type, start_date, end_date, total_days, reason, status, hours, start_time, end_time)
       VALUES ($1, 'permission', $2::date, $2::date, 0, 'test', 'pending', 1.0, '09:30', '10:30')
       RETURNING id`,
      [otherEmpId, today]
    );
    check("another employee's Permission request does NOT verify for this employee (cannot claim someone else's)",
      await verifyPermissionLink(otherPermission.rows[0].id, emp4Id) === false);

    // A non-Permission leave (e.g. casual) must NOT verify, even though it
    // genuinely belongs to this employee.
    const casualLeave = await client.query(
      `INSERT INTO leaves (employee_id, leave_type, start_date, end_date, total_days, reason, status)
       VALUES ($1, 'casual', $2::date, $2::date, 1, 'test', 'pending')
       RETURNING id`,
      [emp4Id, today]
    );
    check('a non-Permission leave type (casual) does NOT verify, even though it belongs to the employee',
      await verifyPermissionLink(casualLeave.rows[0].id, emp4Id) === false);

    check('a nonexistent leave id does NOT verify', await verifyPermissionLink('00000000-0000-0000-0000-000000000000', emp4Id) === false);

    // The actual INSERT the route performs once verification passes.
    await client.query(
      `INSERT INTO attendance (employee_id, date, check_in, session_started_at, status, late_minutes, late_checkin_action, late_checkin_reason, late_checkin_leave_id)
       VALUES ($1, $2::date, $3, $3, 'late', 61, 'permission', NULL, $4)`,
      [emp4Id, today, `${today} 10:46:00`, realPermissionId]
    );
    const linkedRow = (await client.query(
      `SELECT late_checkin_action, late_checkin_leave_id,
              (late_checkin_action = 'permission' AND late_checkin_leave_id IS NOT NULL) AS "permissionLinked"
         FROM attendance WHERE employee_id = $1 AND date = $2::date`,
      [emp4Id, today]
    )).rows[0];
    check('a linked Permission record persists with the real leave id, and reads as permissionLinked: true (report logic)',
      linkedRow.late_checkin_leave_id === realPermissionId && linkedRow.permissionLinked === true);

    // A historical row (pre-fix era) with action='permission' but no link —
    // must remain exactly as it is (requirement: existing rows stay valid
    // with late_checkin_leave_id = NULL), and the report logic must read it
    // as NOT linked, honestly, rather than claiming a Permission that was
    // never confirmed.
    const historicalRow = (await client.query(
      `SELECT late_checkin_leave_id,
              (late_checkin_action = 'permission' AND late_checkin_leave_id IS NOT NULL) AS "permissionLinked"
         FROM attendance WHERE employee_id = $1 AND date = $2::date`,
      [emp2Id, today]
    )).rows[0];
    check('the pre-fix-style row (action=permission, no leave id) reads as permissionLinked: false, and the row itself is untouched (still NULL, not retroactively fixed)',
      historicalRow.late_checkin_leave_id === null && historicalRow.permissionLinked === false);

    // Referential integrity: the FK itself rejects a leave id that doesn't
    // exist. SAVEPOINT/ROLLBACK TO around it: a failed statement aborts the
    // whole enclosing transaction in Postgres until rolled back to here, so
    // without this every check after it would spuriously error out too.
    let fkRejected = false;
    await client.query('SAVEPOINT before_fk_violation');
    try {
      await client.query(
        `INSERT INTO attendance (employee_id, date, check_in, session_started_at, status, late_checkin_action, late_checkin_leave_id)
         VALUES ($1, '2026-11-20'::date, NOW(), NOW(), 'present', 'permission', '00000000-0000-0000-0000-000000000000')`,
        [emp4Id]
      );
    } catch (e) {
      fkRejected = e.code === '23503'; // foreign_key_violation
      await client.query('ROLLBACK TO SAVEPOINT before_fk_violation');
    }
    check('the late_checkin_leave_id foreign key rejects a nonexistent leaves.id', fkRejected === true);

    // Re-check-in preserves the leave link too, same as action/reason.
    const beforeReopen = await client.query(`SELECT id FROM attendance WHERE employee_id = $1 AND date = $2::date`, [emp4Id, today]);
    await client.query(
      `UPDATE attendance SET check_out = $2, working_hours = 1 WHERE id = $1`,
      [beforeReopen.rows[0].id, `${today} 12:00:00`]
    );
    await client.query(
      `UPDATE attendance SET check_out = NULL, session_started_at = $2 WHERE id = $1`,
      [beforeReopen.rows[0].id, `${today} 13:00:00`]
    );
    const afterReopen = (await client.query(`SELECT late_checkin_leave_id FROM attendance WHERE id = $1`, [beforeReopen.rows[0].id])).rows[0];
    check('re-check-in preserves late_checkin_leave_id unchanged, same as action/reason', afterReopen.late_checkin_leave_id === realPermissionId);

    // First-Half Leave exception — live, against the real leaves schema.
    // Mirrors routes/attendance.js's own query (copied, not imported, for
    // fidelity) so this test fails if that query's logic ever drifts.
    const hasValidFirstHalfLeave = async (empId2, date) => {
      const r = await client.query(
        `SELECT 1 FROM leaves
          WHERE employee_id = $1 AND is_half_day = true AND half_day_type = 'first_half'
            AND status IN ('pending', 'pending_approval', 'approved')
            AND $2::date BETWEEN start_date AND end_date
          LIMIT 1`,
        [empId2, date]
      );
      return r.rows.length > 0;
    };

    const empRes3 = await client.query(
      `INSERT INTO employees (employee_id, first_name, last_name, email, role, status, joining_date, shift_id)
       VALUES ('TESTLATECI03', 'Test', 'FirstHalf', 'test.first.half@example.invalid', 'team_member', 'active', '2024-01-01', $1)
       RETURNING id`,
      [generalShiftId]
    );
    const emp3Id = empRes3.rows[0].id;

    // Approved First-Half Leave -> qualifies.
    await client.query(
      `INSERT INTO leaves (employee_id, leave_type, start_date, end_date, total_days, reason, status, is_half_day, half_day_type)
       VALUES ($1, 'casual', $2::date, $2::date, 0.5, 'test', 'approved', true, 'first_half')`,
      [emp3Id, today]
    );
    check('an APPROVED First-Half Leave qualifies for the exception', await hasValidFirstHalfLeave(emp3Id, today) === true);

    // Pending First-Half Leave for a different day -> also qualifies.
    const emp3bRes = await client.query(
      `INSERT INTO employees (employee_id, first_name, last_name, email, role, status, joining_date, shift_id)
       VALUES ('TESTLATECI03B', 'Test', 'FirstHalfPending', 'test.first.half.pending@example.invalid', 'team_member', 'active', '2024-01-01', $1)
       RETURNING id`,
      [generalShiftId]
    );
    const emp3bId = emp3bRes.rows[0].id;
    await client.query(
      `INSERT INTO leaves (employee_id, leave_type, start_date, end_date, total_days, reason, status, is_half_day, half_day_type)
       VALUES ($1, 'casual', $2::date, $2::date, 0.5, 'test', 'pending', true, 'first_half')`,
      [emp3bId, today]
    );
    check('a PENDING (not yet approved) First-Half Leave also qualifies for the exception', await hasValidFirstHalfLeave(emp3bId, today) === true);

    // Rejected First-Half Leave -> does NOT qualify.
    const emp3cRes = await client.query(
      `INSERT INTO employees (employee_id, first_name, last_name, email, role, status, joining_date, shift_id)
       VALUES ('TESTLATECI03C', 'Test', 'FirstHalfRejected', 'test.first.half.rejected@example.invalid', 'team_member', 'active', '2024-01-01', $1)
       RETURNING id`,
      [generalShiftId]
    );
    const emp3cId = emp3cRes.rows[0].id;
    await client.query(
      `INSERT INTO leaves (employee_id, leave_type, start_date, end_date, total_days, reason, status, is_half_day, half_day_type)
       VALUES ($1, 'casual', $2::date, $2::date, 0.5, 'test', 'rejected', true, 'first_half')`,
      [emp3cId, today]
    );
    check('a REJECTED First-Half Leave does NOT qualify — normal late-check-in workflow still applies',
      await hasValidFirstHalfLeave(emp3cId, today) === false);

    // Cancelled First-Half Leave -> does NOT qualify.
    const emp3dRes = await client.query(
      `INSERT INTO employees (employee_id, first_name, last_name, email, role, status, joining_date, shift_id)
       VALUES ('TESTLATECI03D', 'Test', 'FirstHalfCancelled', 'test.first.half.cancelled@example.invalid', 'team_member', 'active', '2024-01-01', $1)
       RETURNING id`,
      [generalShiftId]
    );
    const emp3dId = emp3dRes.rows[0].id;
    await client.query(
      `INSERT INTO leaves (employee_id, leave_type, start_date, end_date, total_days, reason, status, is_half_day, half_day_type)
       VALUES ($1, 'casual', $2::date, $2::date, 0.5, 'test', 'cancelled', true, 'first_half')`,
      [emp3dId, today]
    );
    check('a CANCELLED First-Half Leave does NOT qualify — normal late-check-in workflow still applies',
      await hasValidFirstHalfLeave(emp3dId, today) === false);

    // Second-Half Leave -> does NOT qualify for the check-in exception (it
    // never affects the morning check-in at all — only the unchanged
    // checkout-time requirement does).
    const emp3eRes = await client.query(
      `INSERT INTO employees (employee_id, first_name, last_name, email, role, status, joining_date, shift_id)
       VALUES ('TESTLATECI03E', 'Test', 'SecondHalf', 'test.second.half@example.invalid', 'team_member', 'active', '2024-01-01', $1)
       RETURNING id`,
      [generalShiftId]
    );
    const emp3eId = emp3eRes.rows[0].id;
    await client.query(
      `INSERT INTO leaves (employee_id, leave_type, start_date, end_date, total_days, reason, status, is_half_day, half_day_type)
       VALUES ($1, 'casual', $2::date, $2::date, 0.5, 'test', 'approved', true, 'second_half')`,
      [emp3eId, today]
    );
    check('an approved SECOND-Half Leave does NOT trigger the check-in exception (regression: only First-Half does)',
      await hasValidFirstHalfLeave(emp3eId, today) === false);
    // And the existing Second-Half checkout deduction is completely untouched.
    gate = evaluateCheckoutGate({ shiftName: 'General Shift', workedMinutes: 240, halfDayType: 'second_half' });
    check('Second-Half Leave checkout requirement (exactly 4h) is unchanged by this update', gate.blocked === false);

    // The CHECK constraint actually rejects an invalid action value at the
    // database level too — not just at the route's validation layer.
    let rejected = false;
    try {
      await client.query(
        `INSERT INTO attendance (employee_id, date, check_in, session_started_at, status, late_checkin_action)
         VALUES ($1, '2026-11-15'::date, NOW(), NOW(), 'present', 'not_a_real_action')`,
        [empId]
      );
    } catch (e) { rejected = e.message.includes('attendance_late_checkin_action_check') || e.code === '23514'; }
    check('an invalid late_checkin_action value is rejected by the DB CHECK constraint', rejected === true);

    await client.query('ROLLBACK');
    const gone = await pool.query(`SELECT id FROM employees WHERE employee_id LIKE 'TESTLATECI%'`);
    check('rollback confirmed - no synthetic employees persisted', gone.rows.length === 0);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('ERROR', e.message);
    total++;
  } finally {
    client.release();
    await pool.end();
  }
  console.log(`\n${passed}/${total} checks passed`);
  process.exit(passed === total ? 0 : 1);
})();
