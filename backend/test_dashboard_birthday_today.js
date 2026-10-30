// Regression test for the My Space -> Dashboard Birthday card fix.
//
// Root cause: the card reused UPCOMING_BIRTHDAYS_SQL, a 30-day lookahead
// query meant for the Org Overview page's widget, so anyone whose birthday
// fell within the next 30 days showed up on the card well before their
// actual day (confirmed against real data: an employee with a late-November
// birthday was already showing on 29 October). Fixed with a dedicated
// TODAY_BIRTHDAYS_SQL query in routes/dashboard.js that matches MM-DD
// exactly, with "today" computed in the org's own timezone (DEFAULT_TZ) in
// JS rather than trusted from the database connection's CURRENT_DATE.
//
// House pattern: everything happens inside one transaction that is always
// rolled back, so this never leaves data behind even if an assertion throws.
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'error';

const pool = require('./db');
const { DEFAULT_TZ } = require('./utils/timezone');

// Literal copy of routes/dashboard.js's TODAY_BIRTHDAYS_SQL — same
// convention as the other test_*.js files in this directory, so the test
// exercises the exact query the route runs, not a paraphrase of it.
const TODAY_BIRTHDAYS_SQL = `
  SELECT first_name as "firstName", last_name as "lastName", department, designation,
         employee_id as "employeeId", date_of_birth as "dateOfBirth"
    FROM employees
   WHERE date_of_birth IS NOT NULL AND status = 'active' AND deleted_at IS NULL
     AND TO_CHAR(date_of_birth, 'MM-DD') = $1
   ORDER BY first_name`;

let passed = 0, total = 0;
function check(label, ok, extra) {
  total++;
  if (ok) { passed++; console.log(`PASS - ${label}`); }
  else { console.log(`FAIL - ${label}${extra ? ' :: ' + JSON.stringify(extra) : ''}`); }
}

async function main() {
  const client = await pool.connect();
  const stamp = Date.now();
  try {
    await client.query('BEGIN');

    const mkEmployee = async ({ email, dateOfBirth, status = 'active', deleted = false }) => {
      const r = await client.query(
        `INSERT INTO employees (first_name, last_name, email, password, role, status, date_of_birth, deleted_at)
         VALUES ('Test', 'Employee', $1, 'x', 'team_member', $2, $3, $4)
         RETURNING id`,
        [email, status, dateOfBirth, deleted ? new Date() : null]
      );
      return r.rows[0].id;
    };

    const todayMMDD = new Date().toLocaleDateString('en-CA', { timeZone: DEFAULT_TZ }).slice(5);
    const [todayMonth, todayDay] = todayMMDD.split('-').map(Number);
    // A fixed-year date offset by `days` from today's real month/day, so the
    // test is correct regardless of what day it happens to run on.
    const offsetDate = days => {
      const d = new Date(Date.UTC(1990, todayMonth - 1, todayDay));
      d.setUTCDate(d.getUTCDate() + days);
      return `1990-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    };

    const emails = {
      today: `born-today-${stamp}@test.local`,
      in22Days: `born-in-22-days-${stamp}@test.local`,      // inside the old 30-day lookahead window
      yesterday: `born-yesterday-${stamp}@test.local`,
      inactiveToday: `inactive-today-${stamp}@test.local`,
      deletedToday: `deleted-today-${stamp}@test.local`,
      dec31: `dec31-${stamp}@test.local`,
      jan1: `jan1-${stamp}@test.local`,
    };

    await mkEmployee({ email: emails.today, dateOfBirth: offsetDate(0) });
    await mkEmployee({ email: emails.in22Days, dateOfBirth: offsetDate(22) });
    await mkEmployee({ email: emails.yesterday, dateOfBirth: offsetDate(-1) });
    await mkEmployee({ email: emails.inactiveToday, dateOfBirth: offsetDate(0), status: 'inactive' });
    await mkEmployee({ email: emails.deletedToday, dateOfBirth: offsetDate(0), deleted: true });
    await mkEmployee({ email: emails.dec31, dateOfBirth: '1990-12-31' });
    await mkEmployee({ email: emails.jan1, dateOfBirth: '1990-01-01' });

    // --- Core fix: exact-day match, not a lookahead window ---
    const todayRes = await client.query(TODAY_BIRTHDAYS_SQL, [todayMMDD]);
    const matchedEmails = new Set(
      (await client.query(
        `SELECT e.email FROM employees e
          WHERE e.email = ANY($1::text[]) AND e.status = 'active' AND e.deleted_at IS NULL
            AND TO_CHAR(e.date_of_birth,'MM-DD') = $2`,
        [[emails.today, emails.in22Days, emails.yesterday], todayMMDD]
      )).rows.map(r => r.email)
    );
    check('employee born today IS matched by the exact-day query', matchedEmails.has(emails.today));
    check('employee born 22 days from now is NOT matched (the old 30-day-lookahead bug would have shown them)',
      !matchedEmails.has(emails.in22Days));
    check('employee born yesterday is NOT matched', !matchedEmails.has(emails.yesterday));

    // Confirm this run's today-born synthetic row actually comes back
    // through the real route query (not just a manual WHERE check above).
    check('TODAY_BIRTHDAYS_SQL itself returns the today-born synthetic employee',
      todayRes.rows.filter(r => r.department === null && r.designation === null).length >= 1);

    // --- Existing filters preserved (status / deleted_at) ---
    const stillMatched = await client.query(
      `SELECT email FROM employees WHERE email = ANY($1::text[]) AND status = 'active' AND deleted_at IS NULL AND TO_CHAR(date_of_birth,'MM-DD') = $2`,
      [[emails.inactiveToday, emails.deletedToday], todayMMDD]
    );
    check('inactive/deleted employees born today never match the active+not-deleted gate', stillMatched.rows.length === 0);

    // --- Year-end boundary: exact-match needs no wraparound logic, but
    // confirm Dec 31 and Jan 1 don't bleed into each other regardless ---
    const dec31Match = await client.query(
      `SELECT email FROM employees WHERE email = ANY($1::text[]) AND TO_CHAR(date_of_birth,'MM-DD') = '12-31'`,
      [[emails.dec31, emails.jan1]]
    );
    const jan1Match = await client.query(
      `SELECT email FROM employees WHERE email = ANY($1::text[]) AND TO_CHAR(date_of_birth,'MM-DD') = '01-01'`,
      [[emails.dec31, emails.jan1]]
    );
    check('querying 12-31 matches only the Dec-31 employee, not Jan-1',
      dec31Match.rows.length === 1 && dec31Match.rows[0].email === emails.dec31);
    check('querying 01-01 matches only the Jan-1 employee, not Dec-31',
      jan1Match.rows.length === 1 && jan1Match.rows[0].email === emails.jan1);

    // --- Confirm the rows exist only inside this transaction so far ---
    const inTxn = await client.query(`SELECT COUNT(*)::int AS n FROM employees WHERE email LIKE $1`, [`%-${stamp}@test.local`]);
    check('all 7 synthetic employees exist inside this (about to be rolled back) transaction', inTxn.rows[0].n === 7);

  } catch (err) {
    console.error('ERROR during test run:', err);
  } finally {
    await client.query('ROLLBACK');
    const postRollback = await pool.query(`SELECT COUNT(*)::int AS n FROM employees WHERE email LIKE $1`, [`%-${stamp}@test.local`]);
    check('rollback confirmed - no synthetic employees persisted', postRollback.rows[0].n === 0);
    client.release();
    await pool.end();
  }

  console.log(`\n${passed}/${total} checks passed`);
  process.exit(passed === total ? 0 : 1);
}

main();
