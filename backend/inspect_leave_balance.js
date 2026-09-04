#!/usr/bin/env node
/* Why does this person's casual leave balance disagree between screens?
 *
 * READ ONLY. Nothing here writes.
 *
 * Casual leave balance is computed FOUR different ways in this codebase,
 * and they are not the same number for anyone who has ever had leave
 * approved without a leave_balances row:
 *
 *   1. employees.casual_leave    a legacy column, frozen at whatever it
 *                                 was seeded to. Nothing has written to it
 *                                 since debitOnApproval was changed to stop
 *                                 double-counting (utils/leaveBalance.js).
 *   2. leave_balances table      the designed store. Present only for
 *                                 employees provisioned into it — most were
 *                                 not, after the Zoho migration.
 *   3. computed (policy engine)  grantedToDate(policy) minus approved+
 *                                 pending leaves this year. What
 *                                 availableFor() actually returns, and so
 *                                 what the Leave Summary CARD and the
 *                                 apply-time check both use.
 *   4. reports.js booked-balance the report's own arithmetic: (1) minus
 *                                 bookings inside the query's date window
 *                                 only, not the whole year.
 *
 * This prints all four for one person, so a disputed number can be traced
 * to the one screen that produced it instead of guessed at.
 *
 *   node inspect_leave_balance.js Shivanie
 *   node inspect_leave_balance.js ANXT2600xxx
 */
const pool = require('./db');
const { availableFor, computedFor } = require('./utils/leaveBalance');

const who = process.argv[2];
if (!who) { console.error('Usage: node inspect_leave_balance.js <name or employee code>'); process.exit(1); }

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

(async () => {
  const year = new Date().getFullYear();

  const people = await pool.query(
    `SELECT id, employee_id AS code, first_name || ' ' || COALESCE(last_name,'') AS name,
            casual_leave AS "legacyCasual", joining_date::text AS "joiningDate"
       FROM employees
      WHERE employee_id ILIKE $1 OR (first_name || ' ' || COALESCE(last_name,'')) ILIKE $1
      ORDER BY employee_id`,
    [`%${who}%`]);

  if (!people.rows.length) { console.log(`No employee matches "${who}"`); await pool.end(); return; }
  if (people.rows.length > 1) {
    console.log(`${people.rows.length} matches — showing all:\n`);
  }

  for (const p of people.rows) {
    console.log(`\n=== ${p.code}  ${p.name.trim()} ===`);
    console.log(`joined ${p.joiningDate}\n`);

    // 1. The legacy column, verbatim.
    console.log(`1. employees.casual_leave (legacy, frozen)   ${p.legacyCasual}`);

    // 2. leave_balances, if a row exists for this year.
    const lb = await pool.query(
      `SELECT lb.available, lb.booked
         FROM leave_balances lb JOIN leave_types lt ON lb.leave_type_id = lt.id
        WHERE lb.employee_id = $1 AND lt.code = 'casual' AND lb.year = $2`,
      [p.id, year]);
    if (lb.rows.length) {
      const r = lb.rows[0];
      console.log(`2. leave_balances row (${year})              available=${r.available} booked=${r.booked}`);
    } else {
      console.log(`2. leave_balances row (${year})              none — this person is on the computed path`);
    }

    // 3. What availableFor() / the Leave Summary card actually returns.
    const store = await availableFor(pool, p.id, 'casual', year);
    console.log(`3. availableFor() — what the CARD shows      available=${store.available}  (store: ${store.store})`);
    if (store.store === 'computed') {
      const c = await computedFor(pool, p.id, 'casual', year);
      console.log(`   computedFor() detail                       granted=${c.granted} taken=${c.taken} available=${c.available}`);
    }

    // Every casual leave row this year, so "taken" is not just a number.
    const rows = await pool.query(
      `SELECT start_date::text AS start, end_date::text AS end, total_days AS days, status
         FROM leaves
        WHERE employee_id = $1 AND leave_type = 'casual' AND EXTRACT(YEAR FROM start_date) = $2
        ORDER BY start_date`,
      [p.id, year]);
    console.log(`\n   Casual leave rows in ${year} (${rows.rows.length}):`);
    for (const r of rows.rows) {
      console.log(`     ${r.start}${r.start !== r.end ? ' to ' + r.end : ''}   ${r.days}d   ${r.status}`);
    }

    // 4. The booked-balance report's own arithmetic, for the range it would
    // use with no query params — this month to today, same as the screen's
    // default when nobody has picked a range.
    const rangeStart = new Date(new Date().setDate(1)).toLocaleDateString('en-CA');
    const rangeEnd = new Date().toLocaleDateString('en-CA');
    const windowBooked = await pool.query(
      `SELECT COALESCE(SUM(total_days), 0) AS days FROM leaves
        WHERE employee_id = $1 AND status = 'approved' AND leave_type = 'casual'
          AND start_date <= $3::date AND end_date >= $2::date`,
      [p.id, rangeStart, rangeEnd]);
    const casualAllocated = p.legacyCasual === null ? null : parseFloat(p.legacyCasual);
    const casualBooked = round2(parseFloat(windowBooked.rows[0].days) || 0);
    const reportBalance = casualAllocated === null ? null : Math.max(0, round2(casualAllocated - casualBooked));
    console.log(`\n4. booked-balance report, default range ${rangeStart}..${rangeEnd}`);
    console.log(`   casualAllocated (= legacy column)          ${casualAllocated}`);
    console.log(`   casualBooked (approved, IN this window)    ${casualBooked}`);
    console.log(`   => Balance shown on that report             ${reportBalance}`);

    console.log(`\n   Full-year approved casual so far: ${round2(rows.rows.filter(r => r.status === 'approved').reduce((s, r) => s + parseFloat(r.days), 0))}d`);
  }

  await pool.end();
})().catch(async (e) => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
