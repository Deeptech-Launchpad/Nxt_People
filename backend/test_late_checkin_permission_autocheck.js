// Fix: automatic check-in after Permission submission, and no re-prompt /
// no duplicate Permission when one already exists for today.
//
// Part A: the new "existing Permission for today" SQL fact, run directly
// against synthetic rows in a rolled-back transaction (nothing persists).
// Part B: static checks that the fix is wired the way it's meant to be --
// the DB fact is read BEFORE the route falls back to requiring a fresh
// decision from the request body, and the frontend locks ApplyLeaveModal
// to the Permission type for this flow instead of leaving it open to
// (possibly wrongly) choose.
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'error';
const { Pool } = require('pg');
const fs = require('fs');
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

const EXISTING_PERMISSION_SQL = `
  SELECT id FROM leaves
   WHERE employee_id = $1 AND leave_type = 'permission'
     AND status IN ('pending', 'pending_approval', 'approved')
     AND $2::date BETWEEN start_date AND end_date
   ORDER BY created_at DESC LIMIT 1`;

(async () => {
  console.log('\n════ Existing-Permission-for-today SQL fact (DB round-trip, rolled back) ════\n');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const empA = await client.query(
      `INSERT INTO employees (employee_id, first_name, last_name, email, role, status, joining_date)
       VALUES ('TESTLATEAUTO01', 'Test', 'LateAuto', 'test.lateauto.a@example.invalid', 'team_member', 'active', '2024-01-01')
       RETURNING id`
    );
    const empB = await client.query(
      `INSERT INTO employees (employee_id, first_name, last_name, email, role, status, joining_date)
       VALUES ('TESTLATEAUTO02', 'Test', 'LateAuto2', 'test.lateauto.b@example.invalid', 'team_member', 'active', '2024-01-01')
       RETURNING id`
    );
    const empAId = empA.rows[0].id, empBId = empB.rows[0].id;
    const today = '2026-11-16';
    const otherDay = '2026-11-15';

    const insertPerm = (empId, date, status) => client.query(
      `INSERT INTO leaves (employee_id, leave_type, start_date, end_date, status, start_time, end_time, reason, total_days)
       VALUES ($1, 'permission', $2::date, $2::date, $3, '09:45:00', '10:30:00', 'test fixture', 0)`,
      [empId, date, status]
    );

    const factFor = async (empId, date) => {
      const r = await client.query(EXISTING_PERMISSION_SQL, [empId, date]);
      return r.rows[0]?.id || null;
    };

    check('no permission at all today: fact is null', (await factFor(empAId, today)) === null);

    await insertPerm(empAId, today, 'pending');
    const pendingId = (await client.query(
      `SELECT id FROM leaves WHERE employee_id=$1 AND start_date=$2::date`, [empAId, today]
    )).rows[0].id;
    check('a PENDING permission for today: fact finds it (auto-check-in must not wait for approval)',
      (await factFor(empAId, today)) === pendingId);

    await client.query(`UPDATE leaves SET status='approved' WHERE id=$1`, [pendingId]);
    check('the SAME permission, now APPROVED: fact still finds it',
      (await factFor(empAId, today)) === pendingId);

    await client.query(`UPDATE leaves SET status='rejected' WHERE id=$1`, [pendingId]);
    check('the SAME permission, now REJECTED: fact no longer finds it (must fall back to a fresh decision)',
      (await factFor(empAId, today)) === null);

    await client.query(`UPDATE leaves SET status='cancelled' WHERE id=$1`, [pendingId]);
    check('the SAME permission, now CANCELLED: fact still does not find it',
      (await factFor(empAId, today)) === null);

    await client.query(`UPDATE leaves SET status='pending' WHERE id=$1`, [pendingId]);
    check('restored to pending: fact finds it again (sanity check on the update itself)',
      (await factFor(empAId, today)) === pendingId);

    check("a permission for a DIFFERENT day does not satisfy TODAY's fact",
      (await factFor(empAId, otherDay)) === null);

    check("employee B's check for today is unaffected by employee A's permission (no cross-employee leakage)",
      (await factFor(empBId, today)) === null);

    await insertPerm(empBId, today, 'pending');
    const empBPermId = (await client.query(
      `SELECT id FROM leaves WHERE employee_id=$1 AND start_date=$2::date`, [empBId, today]
    )).rows[0].id;
    check("employee B's own pending permission is found for B, and is a DIFFERENT row than A's",
      (await factFor(empBId, today)) === empBPermId && empBPermId !== pendingId);

    // A non-permission leave type must never satisfy this fact.
    await client.query(
      `INSERT INTO leaves (employee_id, leave_type, start_date, end_date, status, reason, total_days)
       VALUES ($1, 'casual', $2::date, $2::date, 'approved', 'test fixture', 1)`,
      [empAId, otherDay]
    );
    check('an approved CASUAL leave (not permission) never satisfies the permission fact',
      (await factFor(empAId, otherDay)) === null);

    await client.query('ROLLBACK');
    const gone = await pool.query(`SELECT id FROM employees WHERE employee_id LIKE 'TESTLATEAUTO%'`);
    check('rollback confirmed - no synthetic employees persisted', gone.rows.length === 0);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('ERROR', e.message);
    total++;
  } finally {
    client.release();
  }

  console.log('\n════ Static wiring checks (source inspection) ════\n');

  const attSrc = fs.readFileSync(require.resolve('./routes/attendance.js'), 'utf8');
  const checkinHandlerMatch = attSrc.match(/router\.post\('\/checkin'[\s\S]*?(?=\nrouter\.|module\.exports)/);
  check("the /checkin handler was found in routes/attendance.js", !!checkinHandlerMatch);
  if (checkinHandlerMatch) {
    const body = checkinHandlerMatch[0];
    const existingPermIdx = body.indexOf('existingPermission');
    const validateCallIdx = body.indexOf('validateLateCheckinDecision({');
    check('the existing-Permission lookup is present in the /checkin handler', existingPermIdx > -1);
    check('that lookup runs (and existingPermission is read) BEFORE the request body is required to supply a decision',
      existingPermIdx > -1 && validateCallIdx > -1 && existingPermIdx < validateCallIdx,
      { existingPermIdx, validateCallIdx });
    check("the decision falls back to validateLateCheckinDecision(req.body...) only when no existing permission was found",
      /existingPermission\s*\n?\s*\?\s*\{[\s\S]*?ok:\s*true,\s*action:\s*'permission'/.test(body));
  }

  const modalSrc = fs.readFileSync(require.resolve('./../frontend/src/components/requests/ApplyLeaveModal.jsx'), 'utf8');
  check("ApplyLeaveModal.jsx has a mode === 'permission' branch that auto-selects the Permission type",
    /mode === 'permission'/.test(modalSrc) && /permission/i.test(modalSrc.split("mode === 'permission'")[1]?.slice(0, 300) || ''));
  check("the Leave-type dropdown is disabled for mode === 'permission' (locked, same as 'compoff')",
    /disabled=\{mode === 'compoff' \|\| mode === 'permission'/.test(modalSrc));

  const ctxSrc = fs.readFileSync(require.resolve('./../frontend/src/context/AttendanceContext.jsx'), 'utf8');
  const lateFlowMatch = ctxSrc.match(/showPermissionAfterLateCheckin &&[\s\S]*?<ApplyLeaveModal[\s\S]*?\/>/);
  check('AttendanceContext.jsx passes mode="permission" to the ApplyLeaveModal it opens for the late-check-in flow',
    !!lateFlowMatch && /mode="permission"/.test(lateFlowMatch[0]));

  console.log(`\n${passed}/${total} checks passed`);
  await pool.end();
  process.exit(passed === total ? 0 : 1);
})();
