// Update 1 — Employee-wise checkout minimum-hours exemption.
// Part A: evaluateCheckoutGate()'s `exempt` param, pure, no DB.
// Part B: persistence through employees.checkout_min_hours_exempt — set via
// a direct UPDATE (what the admin-only PUT /employees/:id route writes),
// then re-read in a FRESH query (simulating "after refresh / re-login" —
// nothing here is cached, it comes straight back from the row).
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'error';
const { Pool } = require('pg');
const { evaluateCheckoutGate, isGatedShift, canModifyCheckoutExemption, requiredMinutesFor } = require('./utils/checkoutMinHours');
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

console.log('\n════ evaluateCheckoutGate: exempt (pure) ════\n');

check('exempt General Shift employee with 0 minutes worked is never blocked',
  evaluateCheckoutGate({ shiftName: 'General Shift', workedMinutes: 0, exempt: true }).blocked === false);
check('exempt result reports exempt: true for the caller to label it, if wanted',
  evaluateCheckoutGate({ shiftName: 'General Shift', workedMinutes: 0, exempt: true }).exempt === true);
check('non-exempt General Shift employee with 0 minutes worked is still blocked (regression)',
  evaluateCheckoutGate({ shiftName: 'General Shift', workedMinutes: 0, exempt: false }).blocked === true);
check('exempt employee on Housekeeping (already ungated) also unaffected, no crash',
  evaluateCheckoutGate({ shiftName: 'Housekeeping Shift', workedMinutes: 0, exempt: true }).blocked === false);
check('non-exempt Housekeeping employee remains ungated (regression, unrelated to this feature)',
  evaluateCheckoutGate({ shiftName: 'Housekeeping Shift', workedMinutes: 0, exempt: false }).blocked === false);

// UK Shift explicitly, not just General Shift — the exemption is shift-
// agnostic (it bypasses the gate before the gate even looks at the shift
// name), but the spec calls this out by name so it gets its own pair.
check('exempt UK Shift employee with 0 minutes worked is never blocked',
  evaluateCheckoutGate({ shiftName: 'UK Shift', workedMinutes: 0, exempt: true }).blocked === false);
check('non-exempt UK Shift employee remains restricted (regression)',
  evaluateCheckoutGate({ shiftName: 'UK Shift', workedMinutes: 0, exempt: false }).blocked === true);

// Permission and half-day deductions keep working exactly as before for a
// NON-exempt employee — this feature must not touch that arithmetic at all.
check('non-exempt: permission deduction still reduces the requirement (regression)',
  evaluateCheckoutGate({ shiftName: 'General Shift', workedMinutes: 390, permissionHours: 2, exempt: false }).blocked === false); // 8h30m - 2h = 6h30m = 390min
check('non-exempt: half-day deduction still reduces the requirement (regression)',
  evaluateCheckoutGate({ shiftName: 'General Shift', workedMinutes: 240, halfDayType: 'second_half', exempt: false }).blocked === false); // second_half requires exactly 4h = 240min
check('isGatedShift unaffected by this change (regression)', isGatedShift('UK Shift') === true && isGatedShift('Housekeeping Shift') === false);

console.log('\n════ evaluateCheckoutGate: fullDayLeaveSubmitted (pure) ════\n');
// A submitted (pending or approved) full-day leave request covering today
// lets checkout through even with 0 minutes worked and no permission/half-day
// deduction -- "submitted", not "approved": the business rule is explicitly
// "do not wait for approval" (see routes/attendance.js's /checkout).
check('General Shift, 0 minutes worked, full-day leave submitted (pending): checkout is allowed',
  evaluateCheckoutGate({ shiftName: 'General Shift', workedMinutes: 0, fullDayLeaveSubmitted: true }).blocked === false);
check('fullDayLeaveExemption: true is reported for the caller to label it, if wanted',
  evaluateCheckoutGate({ shiftName: 'General Shift', workedMinutes: 0, fullDayLeaveSubmitted: true }).fullDayLeaveExemption === true);
check('UK Shift, 0 minutes worked, full-day leave submitted: checkout is allowed (shift-agnostic, same as the permanent exemption)',
  evaluateCheckoutGate({ shiftName: 'UK Shift', workedMinutes: 0, fullDayLeaveSubmitted: true }).blocked === false);
check('without fullDayLeaveSubmitted, the same General Shift / 0 minutes is still blocked (regression -- the exact scenario from the spec)',
  evaluateCheckoutGate({ shiftName: 'General Shift', workedMinutes: 0, fullDayLeaveSubmitted: false }).blocked === true);
check('an employee on an UNGATED shift (Housekeeping) with no full-day leave at all is still unaffected (regression)',
  evaluateCheckoutGate({ shiftName: 'Housekeeping Shift', workedMinutes: 0, fullDayLeaveSubmitted: false }).blocked === false);
check('fullDayLeaveSubmitted does not alter requiredMinutesFor -- the arithmetic for a NON-exempt, non-full-day-leave checkout is untouched (regression)',
  requiredMinutesFor({ permissionHours: 2 }) === 390); // 8h30m - 2h = 6h30m = 390min, same as before this change

console.log('\n════ canModifyCheckoutExemption: who may change the setting (pure) ════\n');

check('admin (Super Admin) CAN modify the exemption', canModifyCheckoutExemption('admin') === true);
check('hr_admin (HR) CAN modify the exemption', canModifyCheckoutExemption('hr_admin') === true);
check('director CANNOT modify the exemption', canModifyCheckoutExemption('director') === false);
check('team_incharge (Team Lead) CANNOT modify the exemption', canModifyCheckoutExemption('team_incharge') === false);
check('team_member (Employee) CANNOT modify the exemption', canModifyCheckoutExemption('team_member') === false);
check('manager CANNOT modify the exemption', canModifyCheckoutExemption('manager') === false);
check('an unknown/garbage role CANNOT modify the exemption (closed allowlist, not a denylist)',
  canModifyCheckoutExemption('some_future_role') === false);
check('undefined/missing role CANNOT modify the exemption', canModifyCheckoutExemption(undefined) === false);

(async () => {
  console.log('\n════ Persistence across "sessions" (DB round-trip) ════\n');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const empRes = await client.query(
      `INSERT INTO employees (employee_id, first_name, last_name, email, role, status, joining_date, checkout_min_hours_exempt)
       VALUES ('TESTEXEMPT01', 'Test', 'Exempt', 'test.exempt.checkout@example.invalid', 'team_member', 'active', '2024-01-01', false)
       RETURNING id`
    );
    const empId = empRes.rows[0].id;

    // Admin turns the exemption ON (exactly what PUT /employees/:id writes).
    await client.query(`UPDATE employees SET checkout_min_hours_exempt = true WHERE id = $1`, [empId]);

    // Fresh, independent read — simulates a new request after refresh/re-login.
    let r = await client.query(`SELECT checkout_min_hours_exempt AS exempt FROM employees WHERE id = $1`, [empId]);
    check('exemption persists as TRUE on a fresh read after being enabled', r.rows[0].exempt === true);

    // Admin turns it back OFF.
    await client.query(`UPDATE employees SET checkout_min_hours_exempt = false WHERE id = $1`, [empId]);
    r = await client.query(`SELECT checkout_min_hours_exempt AS exempt FROM employees WHERE id = $1`, [empId]);
    check('exemption persists as FALSE after being disabled again', r.rows[0].exempt === false);

    // Default for a brand-new employee (no explicit value given) is FALSE —
    // nobody is exempt until an admin says so by name.
    const def = await client.query(
      `INSERT INTO employees (employee_id, first_name, last_name, email, role, status, joining_date)
       VALUES ('TESTEXEMPT02', 'Test', 'Default', 'test.exempt.default@example.invalid', 'team_member', 'active', '2024-01-01')
       RETURNING checkout_min_hours_exempt AS exempt`
    );
    check('a new employee defaults to NOT exempt', def.rows[0].exempt === false);

    // ── Update 2: full_day_leave_submitted_today -- the EXACT SQL condition
    // routes/attendance.js's /checkout now runs, against synthetic rows in
    // this same rolled-back transaction (nothing persists).
    console.log('\n════ full_day_leave_submitted_today SQL fact (DB round-trip, rolled back) ════\n');
    const fdEmp = await client.query(
      `INSERT INTO employees (employee_id, first_name, last_name, email, role, status, joining_date)
       VALUES ('TESTFULLDAY01', 'Test', 'FullDayLeave', 'test.fullday.checkout@example.invalid', 'team_member', 'active', '2024-01-01')
       RETURNING id`
    );
    const fdEmpId = fdEmp.rows[0].id;
    const checkFullDayFact = async (date) => {
      const r = await client.query(
        `SELECT EXISTS (
            SELECT 1 FROM leaves l
             WHERE l.employee_id = $1 AND l.status <> 'rejected'
               AND l.leave_type <> 'permission'
               AND (l.is_half_day IS NOT TRUE)
               AND $2::date BETWEEN l.start_date AND l.end_date
         ) AS fact`,
        [fdEmpId, date]
      );
      return r.rows[0].fact;
    };
    const insertLeave = (date, { leaveType = 'casual', status = 'pending', isHalfDay = false, halfDayType = null } = {}) =>
      client.query(
        `INSERT INTO leaves (employee_id, leave_type, start_date, end_date, status, is_half_day, half_day_type, total_days, reason)
         VALUES ($1, $2, $3::date, $3::date, $4, $5, $6, 1, 'Test fixture for full_day_leave_submitted_today')`,
        [fdEmpId, leaveType, date, status, isHalfDay, halfDayType]
      );

    check('no leave at all for this date: fact is false', (await checkFullDayFact('2026-01-10')) === false);

    await insertLeave('2026-01-11', { status: 'pending' });
    check('a PENDING full-day casual leave covering this date: fact is true (checkout must not wait for approval)',
      (await checkFullDayFact('2026-01-11')) === true);

    await insertLeave('2026-01-12', { status: 'approved' });
    check('an APPROVED full-day leave covering this date: fact is true',
      (await checkFullDayFact('2026-01-12')) === true);

    await insertLeave('2026-01-13', { status: 'rejected' });
    check('a REJECTED full-day leave covering this date: fact is false (must fall back to the normal 8h30m restriction)',
      (await checkFullDayFact('2026-01-13')) === false);

    await insertLeave('2026-01-14', { leaveType: 'permission', status: 'pending' });
    check('a pending PERMISSION request (not a full-day leave) covering this date: fact is false',
      (await checkFullDayFact('2026-01-14')) === false);

    await insertLeave('2026-01-15', { status: 'pending', isHalfDay: true, halfDayType: 'first_half' });
    check('a pending HALF-DAY leave covering this date: fact is false (half-day keeps its own, separate deduction, not the full-day exemption)',
      (await checkFullDayFact('2026-01-15')) === false);

    await client.query('ROLLBACK');
    const gone = await pool.query(`SELECT id FROM employees WHERE employee_id LIKE 'TESTEXEMPT%' OR employee_id LIKE 'TESTFULLDAY%'`);
    check('rollback confirmed - no synthetic employees persisted', gone.rows.length === 0);

    // ── Access control ──────────────────────────────────────────────────
    // Two layers, checked two different ways:
    //  1. Route-level: PUT /employees/:id itself is still only reachable by
    //     admin/director/hr_admin (unchanged) — confirmed by static source
    //     check below, since this environment's sandbox blocks minting a
    //     test JWT (reasonably — that's treated as credential materialization,
    //     and this test respects that rather than routing around it).
    //  2. Field-level (the actual fix this round): director CAN still reach
    //     the handler but must be rejected from touching this ONE field —
    //     confirmed BEHAVIOURALLY above via canModifyCheckoutExemption(),
    //     the exact function the route calls (not re-implemented here), plus
    //     a static check that the route really does call it for this field.
    const fs = require('fs');
    const employeesSrc = fs.readFileSync(require.resolve('./routes/employees.js'), 'utf8');
    const putMatch = employeesSrc.match(/router\.put\('\/:id',\s*authorize\(([^)]*)\)[\s\S]*?(?=\nrouter\.|module\.exports)/);
    check('PUT /employees/:id is still guarded by authorize(...) (regression — the route-level guard itself was not touched)',
      !!putMatch, { found: !!putMatch });
    if (putMatch) {
      const allowedRoles = putMatch[1];
      check("authorize(...) on that route still lists admin/director/hr_admin — director can still reach the handler for every OTHER field (regression)",
        /'admin'/.test(allowedRoles) && /'director'/.test(allowedRoles) && /'hr_admin'/.test(allowedRoles)
        && !/'team_member'/.test(allowedRoles) && !/'team_incharge'/.test(allowedRoles),
        { allowedRoles });
      check('checkoutMinHoursExempt is written inside that same guarded handler block',
        putMatch[0].includes('checkoutMinHoursExempt'));
      check('the handler actually calls canModifyCheckoutExemption(req.user.role) before writing this field',
        /canModifyCheckoutExemption\(req\.user\.role\)/.test(putMatch[0]));
      // The field-specific check must come BEFORE updates.push(`checkout_min_hours_exempt...)
      // — otherwise it would validate too late to actually stop the write.
      const guardIdx = putMatch[0].indexOf('canModifyCheckoutExemption(req.user.role)');
      const writeIdx = putMatch[0].indexOf('checkout_min_hours_exempt = $');
      check('the field-specific guard runs BEFORE the column is written, not after',
        guardIdx > -1 && writeIdx > -1 && guardIdx < writeIdx, { guardIdx, writeIdx });
    }
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
