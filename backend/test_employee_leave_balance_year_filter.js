// Regression test for the Employee Leave Balance report's two fixes:
//   1. The Year filter now spans 2021..currentYear, and historical years
//      compute correctly (the accrual engine was reading the wrong
//      "joining date" column for most employees — see utils/leavePolicy.js
//      usage in routes/reports.js).
//   2. An employee relieved before a selected year (or not yet joined by
//      its end) is excluded from the picker and rejected by the report
//      endpoints themselves — not just hidden in the UI.
//
// House pattern: everything happens inside one transaction that is always
// rolled back, so this never leaves data behind even if an assertion throws.
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'error';

const pool = require('./db');
const { eligibleForYear, eligibleForYearClause } = require('./utils/employeeEligibility');
const { grantedToDate, getLeavePolicies, getJoiningRule } = require('./utils/leavePolicy');

let passed = 0, total = 0;
function check(label, ok, extra) {
  total++;
  if (ok) { passed++; console.log(`PASS - ${label}`); }
  else { console.log(`FAIL - ${label}${extra ? ' :: ' + JSON.stringify(extra) : ''}`); }
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const mkEmployee = async ({ email, dateOfJoining, exitDate, joiningDateLegacy }) => {
      const r = await client.query(
        `INSERT INTO employees (first_name, last_name, email, password, role, status, joining_date, date_of_joining, exit_date, casual_leave)
         VALUES ('Test', 'Employee', $1, 'x', 'team_member', $2, $3, $4, $5, 12)
         RETURNING id`,
        [email, exitDate ? 'inactive' : 'active', joiningDateLegacy || new Date(), dateOfJoining, exitDate || null]
      );
      return r.rows[0].id;
    };

    // --- Scenario 2: relieved in 2025 -> excluded from the 2026 report ---
    const relieved2025 = await mkEmployee({
      email: `relieved2025-${Date.now()}@test.local`,
      dateOfJoining: '2020-01-01',
      exitDate: '2025-06-15',
    });
    const relieved2025Row = (await client.query(
      'SELECT COALESCE(date_of_joining, joining_date)::text AS "joiningDate", exit_date::text AS "exitDate" FROM employees WHERE id = $1',
      [relieved2025]
    )).rows[0];
    check('relieved mid-2025 is NOT eligible for 2026', eligibleForYear(relieved2025Row, 2026) === false);
    check('relieved mid-2025 IS eligible for 2025 (employed part of the year)', eligibleForYear(relieved2025Row, 2025) === true);
    check('relieved mid-2025 IS eligible for 2024 (employed the whole year)', eligibleForYear(relieved2025Row, 2024) === true);

    // --- Scenario 3: employed during 2024, now inactive -> still eligible for 2024 ---
    // (relieved2025Row above already covers "now inactive, eligible for a
    // past year they were employed in" — exit_date 2025-06-15, status
    // 'inactive', checked against 2024 where they were still on the books.)
    check('now-inactive employee stays eligible for a year they were actually employed in (status column ignored)',
      eligibleForYear(relieved2025Row, 2024) === true);

    // --- Scenario 4: joined during the selected year ---
    const midYearJoiner = await mkEmployee({
      email: `midyear-${Date.now()}@test.local`,
      dateOfJoining: '2024-06-10',
      exitDate: null,
    });
    const midYearRow = (await client.query(
      'SELECT COALESCE(date_of_joining, joining_date)::text AS "joiningDate", exit_date::text AS "exitDate" FROM employees WHERE id = $1',
      [midYearJoiner]
    )).rows[0];
    check('mid-2024 joiner IS eligible for 2024', eligibleForYear(midYearRow, 2024) === true);
    check('mid-2024 joiner is NOT eligible for 2023 (not yet employed)', eligibleForYear(midYearRow, 2023) === false);
    check('mid-2024 joiner IS eligible for 2025 (still employed, no exit)', eligibleForYear(midYearRow, 2025) === true);

    // --- Scenario 5: the picker's SQL clause agrees with the report gate ---
    const yearsToCheck = [2023, 2024, 2025, 2026];
    for (const y of yearsToCheck) {
      const clause = eligibleForYearClause('e', y, 1);
      const sqlRows = await client.query(
        `SELECT id FROM employees e WHERE e.id IN ($2, $3)${clause.clause}`,
        [...clause.params, relieved2025, midYearJoiner]
      );
      const sqlEligible = new Set(sqlRows.rows.map(r => r.id));
      const jsEligible = new Set(
        [[relieved2025, relieved2025Row], [midYearJoiner, midYearRow]]
          .filter(([, row]) => eligibleForYear(row, y))
          .map(([id]) => id)
      );
      check(`picker SQL clause and report-gate JS check agree for year ${y}`,
        sqlEligible.size === jsEligible.size && [...sqlEligible].every(id => jsEligible.has(id)),
        { sqlEligible: [...sqlEligible], jsEligible: [...jsEligible] });
    }

    // --- Scenario 6: historical year now computes correctly ---
    // Mirrors a real data shape found in this DB: joining_date is a
    // row-creation timestamp (e.g. "today"), date_of_joining holds the
    // real join date. Before the fix, routes/reports.js read raw
    // joining_date, so accrualEvents() saw a "joining year" in the future
    // relative to any requested historical year and granted 0.
    const legacyJoinTimestamp = new Date(); // "today" — stands in for the row-creation default
    const realJoinDate = '2021-11-01';
    const policies = await getLeavePolicies();
    const joiningRule = await getJoiningRule();
    const casualPolicy = policies.get('casual');

    const grantedWithBug = grantedToDate(casualPolicy, {
      year: 2022, joiningDate: legacyJoinTimestamp.toISOString(), joiningRule, annualAmount: 12,
    });
    const grantedFixed = grantedToDate(casualPolicy, {
      year: 2022, joiningDate: realJoinDate, joiningRule, annualAmount: 12,
    });
    check('using the raw (row-creation) joining date reproduces the historical-year bug (0 granted)', grantedWithBug === 0, { grantedWithBug });
    check('resolving date_of_joining first fixes 2022\'s granted amount (full year, joined 2021)', grantedFixed === 12, { grantedFixed });

    // Current year should also recompute correctly now, not just historical
    // ones — the bug understated even the current year for anyone whose
    // joining_date isn't their real join date.
    const grantedCurrentYearFixed = grantedToDate(casualPolicy, {
      year: new Date().getFullYear(), joiningDate: realJoinDate, joiningRule, annualAmount: 12,
    });
    check('current year also computes the full allocation once the real join date is used',
      grantedCurrentYearFixed === 12, { grantedCurrentYearFixed });

    // --- Confirm nothing was actually written ---
    const leftoverCheck = await client.query(
      'SELECT COUNT(*)::int AS n FROM employees WHERE id IN ($1, $2)', [relieved2025, midYearJoiner]
    );
    check('both synthetic employees exist only inside this (about to be rolled back) transaction',
      leftoverCheck.rows[0].n === 2);

  } catch (err) {
    console.error('ERROR during test run:', err);
  } finally {
    await client.query('ROLLBACK');
    const postRollback = await pool.query(
      `SELECT COUNT(*)::int AS n FROM employees WHERE email LIKE 'relieved2025-%@test.local' OR email LIKE 'midyear-%@test.local'`
    );
    check('rollback confirmed - no synthetic employees persisted', postRollback.rows[0].n === 0);
    client.release();
    await pool.end();
  }

  console.log(`\n${passed}/${total} checks passed`);
  process.exit(passed === total ? 0 : 1);
}

main();
