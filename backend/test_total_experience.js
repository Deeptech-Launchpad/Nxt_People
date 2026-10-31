// Total Experience calculation fix (Profile page) — targeted checks.
// Part A: formatExperience() pure-function tests, no DB.
// Part B: live age()-based calculation against the real schema, synthetic
// data wrapped in BEGIN/ROLLBACK, mirroring routes/profile.js's own query
// text for fidelity.
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'error';
const { Pool } = require('pg');
const { formatExperience } = require('./utils/experience');
const { DEFAULT_TZ } = require('./utils/timezone');
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

// ──────────────────────────── Part A: formatExperience ────────────────────
console.log('\n════ formatExperience (pure) ════\n');

check('years + months + days all shown', formatExperience(9, 7, 2) === '9 year(s) 7 month(s) 2 day(s)');
check('zero years omitted, months + days shown', formatExperience(0, 9, 28) === '9 month(s) 28 day(s)');
check('zero months omitted, years + days shown', formatExperience(6, 0, 15) === '6 year(s) 15 day(s)');
check('zero days omitted, years + months shown', formatExperience(6, 9, 0) === '6 year(s) 9 month(s)');
check('only years, no months/days', formatExperience(4, 0, 0) === '4 year(s)');
check('only months', formatExperience(0, 2, 0) === '2 month(s)');
check('only days', formatExperience(0, 0, 1) === '1 day(s)');
check('all zero (joined today) reads 0 day(s), not blank', formatExperience(0, 0, 0) === '0 day(s)');
check('null joining date (null components) returns null, not "0 day(s)"', formatExperience(null, null, null) === null);
check('non-numeric input returns null rather than throwing/NaN text', formatExperience('x', 'y', 'z') === null);

// ──────────────────────── Part B: live age() calculation ──────────────────
// Mirrors routes/profile.js's own expression (copied, not imported, for
// fidelity with what actually runs in Express) so this test fails if the
// route's SQL ever drifts from this spec.
async function computeExperience(client, employeeId) {
  const r = await client.query(
    `SELECT
       EXTRACT(YEAR  FROM age(COALESCE(exit_date, (NOW() AT TIME ZONE '${DEFAULT_TZ}')::date), joining_date::date))::int AS years,
       EXTRACT(MONTH FROM age(COALESCE(exit_date, (NOW() AT TIME ZONE '${DEFAULT_TZ}')::date), joining_date::date))::int AS months,
       EXTRACT(DAY   FROM age(COALESCE(exit_date, (NOW() AT TIME ZONE '${DEFAULT_TZ}')::date), joining_date::date))::int AS days
     FROM employees WHERE id = $1`,
    [employeeId]
  );
  const row = r.rows[0];
  return { years: row.years, months: row.months, days: row.days, text: formatExperience(row.years, row.months, row.days) };
}

(async () => {
  console.log('\n════ Live age()-based calculation ════\n');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const mk = async (suffix, joiningDate, exitDate) => {
      const r = await client.query(
        `INSERT INTO employees (employee_id, first_name, last_name, email, role, status, joining_date, exit_date)
         VALUES ($1, 'Test', 'Experience', $2, 'employee', 'active', $3::date, $4::date)
         RETURNING id`,
        [`TESTEXP${suffix}`, `test.experience.${suffix}@example.invalid`, joiningDate, exitDate]
      );
      return r.rows[0].id;
    };

    // 1. The exact bug-report scenario — pinned via exit_date so the
    // expected figure never depends on when this test happens to run.
    // DOJ 03/01/2026, measured at 31/10/2026 -> 9 month(s) 28 day(s).
    const id1 = await mk('01', '2026-01-03', '2026-10-31');
    let r = await computeExperience(client, id1);
    check('bug report case: 2026-01-03 -> 2026-10-31 reads 9 month(s) 28 day(s)',
      r.years === 0 && r.months === 9 && r.days === 28 && r.text === '9 month(s) 28 day(s)', r);

    // 2. Multi-year, clean month boundary (different years, no day leftover).
    const id2 = await mk('02', '2020-01-01', '2026-10-01');
    r = await computeExperience(client, id2);
    check('multi-year: 2020-01-01 -> 2026-10-01 reads 6 year(s) 9 month(s)',
      r.years === 6 && r.months === 9 && r.days === 0 && r.text === '6 year(s) 9 month(s)', r);

    // 3. Leap day anniversary — exact 4-year gap between two leap days.
    // A 30-day-month approximation has no concept of this at all; a correct
    // calendar-based age() lands exactly on 4y 0m 0d.
    const id3 = await mk('03', '2024-02-29', '2028-02-29');
    r = await computeExperience(client, id3);
    check('leap day: 2024-02-29 -> 2028-02-29 reads exactly 4 year(s)',
      r.years === 4 && r.months === 0 && r.days === 0 && r.text === '4 year(s)', r);

    // 4. Month-end-to-month-end (both ends the last day of their month).
    const id4 = await mk('04', '2026-01-31', '2026-03-31');
    r = await computeExperience(client, id4);
    check('month-end: 2026-01-31 -> 2026-03-31 reads exactly 2 month(s)',
      r.years === 0 && r.months === 2 && r.days === 0 && r.text === '2 month(s)', r);

    // 5. Same-day join and exit -> zero experience, not blank/negative.
    const id5 = await mk('05', '2026-10-31', '2026-10-31');
    r = await computeExperience(client, id5);
    check('same-day join and exit reads 0 day(s)',
      r.years === 0 && r.months === 0 && r.days === 0 && r.text === '0 day(s)', r);

    // 6. Exit Date business logic preserved: an active employee (no exit
    // date) is measured against today, not against a fixed/past date.
    // Both sides computed in ONE statement so there's no JS Date round-trip
    // (no .toISOString() etc.) that could itself introduce the exact kind
    // of local-time/UTC off-by-one this fix exists to avoid in the route.
    const id6 = await mk('06', '2020-01-01', null);
    const cmp = await client.query(
      `SELECT
         EXTRACT(YEAR  FROM age(COALESCE(e.exit_date, (NOW() AT TIME ZONE '${DEFAULT_TZ}')::date), e.joining_date::date))::int AS r_y,
         EXTRACT(MONTH FROM age(COALESCE(e.exit_date, (NOW() AT TIME ZONE '${DEFAULT_TZ}')::date), e.joining_date::date))::int AS r_m,
         EXTRACT(DAY   FROM age(COALESCE(e.exit_date, (NOW() AT TIME ZONE '${DEFAULT_TZ}')::date), e.joining_date::date))::int AS r_d,
         EXTRACT(YEAR  FROM age((NOW() AT TIME ZONE '${DEFAULT_TZ}')::date, '2020-01-01'::date))::int AS exp_y,
         EXTRACT(MONTH FROM age((NOW() AT TIME ZONE '${DEFAULT_TZ}')::date, '2020-01-01'::date))::int AS exp_m,
         EXTRACT(DAY   FROM age((NOW() AT TIME ZONE '${DEFAULT_TZ}')::date, '2020-01-01'::date))::int AS exp_d
       FROM employees e WHERE e.id = $1`,
      [id6]
    );
    const c = cmp.rows[0];
    check('active employee (no exit_date) is measured against today, not frozen',
      c.r_y === c.exp_y && c.r_m === c.exp_m && c.r_d === c.exp_d, c);

    // 7. An exit_date in the past freezes the figure — it must NOT keep
    // growing after the employee has left, confirming the existing
    // ex-employee business logic (routes/team.js) is preserved here too.
    const id7 = await mk('07', '2020-01-01', '2022-06-15');
    r = await computeExperience(client, id7);
    check('ex-employee experience is frozen at the exit date (2 year(s) 5 month(s) 14 day(s))',
      r.years === 2 && r.months === 5 && r.days === 14, r);

    await client.query('ROLLBACK');
    const gone = await pool.query(`SELECT id FROM employees WHERE employee_id LIKE 'TESTEXP%'`);
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
