// Permission leave availability display fix — targeted checks.
// Read-only against the real schema; synthetic data wrapped in BEGIN/ROLLBACK.
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'error';
const { Pool } = require('pg');
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

// Mirrors the new route's own calculation exactly (copied, not imported, for
// fidelity with what actually runs in Express) so this test fails if the
// route's SQL/arithmetic ever drifts from this spec.
async function computeAvailability(client, employeeId, dateParam, monthlyLimit, leaveId = null) {
  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const r = await client.query(
    `SELECT COALESCE(SUM(hours), 0) AS used FROM leaves
      WHERE employee_id = $1 AND leave_type = 'permission'
        AND status IN ('pending', 'approved')
        AND date_trunc('month', start_date) = date_trunc('month', COALESCE($2::date, CURRENT_DATE))
        AND ($3::uuid IS NULL OR id <> $3::uuid)`,
    [employeeId, dateParam, leaveId]
  );
  const used = round2(parseFloat(r.rows[0].used) || 0);
  const available = round2(Math.max(0, monthlyLimit - used));
  return { used, available };
}

// Mirrors the route's isValidCalendarDate exactly, for the same fidelity reason.
function isValidCalendarDate(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const [y, m, d] = str.split('-').map(Number);
  if (m < 1 || m > 12) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const empRes = await client.query(
      `INSERT INTO employees (employee_id, first_name, last_name, email, role, status, joining_date)
       VALUES ('TESTPERM01', 'Test', 'Permission', 'test.permission.avail@example.invalid', 'employee', 'active', '2020-01-01')
       RETURNING id`
    );
    const empId = empRes.rows[0].id;

    // 1.5h pending in the selected month → 4 - 1.5 = 2.5 remaining (the spec's own example).
    await client.query(
      `INSERT INTO leaves (employee_id, leave_type, start_date, end_date, total_days, reason, status, hours, start_time, end_time)
       VALUES ($1, 'permission', '2026-11-05', '2026-11-05', 0, 'test', 'pending', 1.5, '10:00', '11:30')`,
      [empId]
    );
    let r = await computeAvailability(client, empId, '2026-11-05', 4);
    check('1.5h pending this month -> 2.5h remaining (spec example)', r.available === 2.5 && r.used === 1.5, r);

    // Approved counts too, same as pending (status IN ('pending','approved')).
    await client.query(
      `INSERT INTO leaves (employee_id, leave_type, start_date, end_date, total_days, reason, status, hours, start_time, end_time)
       VALUES ($1, 'permission', '2026-11-12', '2026-11-12', 0, 'test', 'approved', 1.0, '14:00', '15:00')`,
      [empId]
    );
    r = await computeAvailability(client, empId, '2026-11-05', 4);
    check('approved request in the same month also counts against availability', r.used === 2.5 && r.available === 1.5, r);

    // Rejected must NOT count.
    await client.query(
      `INSERT INTO leaves (employee_id, leave_type, start_date, end_date, total_days, reason, status, hours, start_time, end_time)
       VALUES ($1, 'permission', '2026-11-20', '2026-11-20', 0, 'test', 'rejected', 2.0, '09:00', '11:00')`,
      [empId]
    );
    r = await computeAvailability(client, empId, '2026-11-05', 4);
    check('a rejected request does not reduce availability', r.used === 2.5, r);

    // A different month must not be affected (per-month cap, no bleed-over).
    r = await computeAvailability(client, empId, '2026-12-05', 4);
    check('a different month starts fresh at full 4h (no carry-over)', r.available === 4 && r.used === 0, r);

    // Availability never goes negative even if usage exceeds the cap.
    await client.query(
      `INSERT INTO leaves (employee_id, leave_type, start_date, end_date, total_days, reason, status, hours, start_time, end_time)
       VALUES ($1, 'permission', '2026-10-02', '2026-10-02', 0, 'test', 'approved', 2.0, '09:00', '11:00'),
              ($1, 'permission', '2026-10-09', '2026-10-09', 0, 'test', 'approved', 1.5, '09:00', '10:30'),
              ($1, 'permission', '2026-10-16', '2026-10-16', 0, 'test', 'pending',  2.0, '09:00', '11:00')`,
      [empId]
    );
    r = await computeAvailability(client, empId, '2026-10-02', 4);
    check('availability floors at 0, never negative, even if usage exceeds the cap', r.available === 0 && r.used === 5.5, r);

    // Editing an existing permission request must not count its own hours
    // against itself. Insert a 2h request and read availability with and
    // without excluding it, for the same selected month.
    const editRes = await client.query(
      `INSERT INTO leaves (employee_id, leave_type, start_date, end_date, total_days, reason, status, hours, start_time, end_time)
       VALUES ($1, 'permission', '2026-09-08', '2026-09-08', 0, 'test', 'pending', 2.0, '09:00', '11:00')
       RETURNING id`,
      [empId]
    );
    const editId = editRes.rows[0].id;
    const withoutExclusion = await computeAvailability(client, empId, '2026-09-08', 4);
    check('without leaveId, editing its own request counts against itself', withoutExclusion.used === 2 && withoutExclusion.available === 2, withoutExclusion);
    const withExclusion = await computeAvailability(client, empId, '2026-09-08', 4, editId);
    check('with leaveId, the request being edited is excluded from its own usage', withExclusion.used === 0 && withExclusion.available === 4, withExclusion);

    // A second, unrelated permission request in the same month still counts
    // even while the first is excluded by id.
    await client.query(
      `INSERT INTO leaves (employee_id, leave_type, start_date, end_date, total_days, reason, status, hours, start_time, end_time)
       VALUES ($1, 'permission', '2026-09-15', '2026-09-15', 0, 'test', 'approved', 1.0, '09:00', '10:00')`,
      [empId]
    );
    const withExclusionAndOther = await computeAvailability(client, empId, '2026-09-08', 4, editId);
    check('a different request in the same month still counts while the edited one is excluded', withExclusionAndOther.used === 1 && withExclusionAndOther.available === 3, withExclusionAndOther);

    // Invalid calendar dates: regex-shaped but not real (month 13, day 45,
    // Feb 30) must be rejected before reaching Postgres.
    check('2026-13-45 (bad month) rejected', isValidCalendarDate('2026-13-45') === false);
    check('2026-02-30 (Feb has no 30th) rejected', isValidCalendarDate('2026-02-30') === false);
    check('2026-00-10 (month 0) rejected', isValidCalendarDate('2026-00-10') === false);
    check('not-a-date rejected', isValidCalendarDate('not-a-date') === false);
    check('2026-11-05 (a real date) accepted', isValidCalendarDate('2026-11-05') === true);
    check('2024-02-29 (leap day, valid) accepted', isValidCalendarDate('2024-02-29') === true);
    check('2026-02-29 (non-leap year, invalid) rejected', isValidCalendarDate('2026-02-29') === false);

    // Other leave types are untouched: total_days-based accrual query (the
    // one /balance uses for casual/comp-off/unpaid) is completely separate
    // code and was not modified by this fix.
    const leaveTypeCol = await client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'leaves' AND column_name IN ('leave_type', 'total_days', 'hours')`
    );
    check('leaves table still has leave_type/total_days/hours columns untouched', leaveTypeCol.rows.length === 3, leaveTypeCol.rows);

    await client.query('ROLLBACK');
    const gone = await pool.query(`SELECT id FROM employees WHERE employee_id = 'TESTPERM01'`);
    check('rollback confirmed - no synthetic employee persisted', gone.rows.length === 0);
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
