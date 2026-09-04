#!/usr/bin/env node
/* Who else has a leave_balances row that has drifted from their real leaves?
 *
 * READ ONLY. Nothing here writes.
 *
 * Shivanie's casual balance was wrong for a specific, mechanical reason:
 * PUT /leave-types/balances/:employeeId (the Customize Balance screen) writes
 * `available` from whatever an admin types and hard-codes `booked` to 0 on
 * first insert, never touching it again on update. The moment that row
 * exists, availableFor() (routes/leaves.js, the Leave Summary card, and the
 * apply-time check) reads it INSTEAD OF computing from the policy engine and
 * the leaves table — so any leave the person had already taken becomes
 * invisible to their own balance from that point on.
 *
 * The fingerprint is mechanical and checkable for everyone at once: a
 * leave_balances row for 'casual' whose `booked` figure is LOWER than the
 * approved casual days that actually exist for that employee in that year.
 * That gap cannot happen through the normal apply/approve flow — booked only
 * ever increases by exactly what got approved — so wherever it appears, the
 * row was written by something other than the normal path.
 *
 *   node inspect_leave_balance_audit.js            every leave_balances row
 *   node inspect_leave_balance_audit.js 2025        just one year
 */
const pool = require('./db');
const { computedFor } = require('./utils/leaveBalance');

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const onlyYear = process.argv[2] ? parseInt(process.argv[2], 10) : null;

(async () => {
  const rows = await pool.query(
    `SELECT lb.id, lb.employee_id, lb.year, lb.available, lb.booked,
            e.employee_id AS code, e.first_name || ' ' || COALESCE(e.last_name,'') AS name,
            e.casual_leave AS "legacyCasual"
       FROM leave_balances lb
       JOIN leave_types lt ON lb.leave_type_id = lt.id
       JOIN employees e ON e.id = lb.employee_id
      WHERE lt.code = 'casual' ${onlyYear ? 'AND lb.year = $1' : ''}
      ORDER BY e.employee_id`,
    onlyYear ? [onlyYear] : []);

  console.log(`\n=== Casual leave_balances rows: ${rows.rows.length} ===\n`);

  const flagged = [];
  for (const r of rows.rows) {
    const actual = await pool.query(
      `SELECT COALESCE(SUM(total_days), 0) AS days FROM leaves
        WHERE employee_id = $1 AND leave_type = 'casual' AND status = 'approved'
          AND EXTRACT(YEAR FROM start_date) = $2`,
      [r.employee_id, r.year]);
    const actualApproved = round2(parseFloat(actual.rows[0].days) || 0);
    const booked = round2(parseFloat(r.booked) || 0);
    const gap = round2(actualApproved - booked);

    if (gap > 0.01) {
      const computed = await computedFor(pool, r.employee_id, 'casual', r.year);
      flagged.push({ ...r, actualApproved, booked, gap, computed });
    }
  }

  if (!flagged.length) {
    console.log('No mismatches found. Every leave_balances row for casual leave has\n'
      + 'a `booked` figure that accounts for the approved leave on file.');
    await pool.end();
    return;
  }

  console.log(`${flagged.length} employee(s) whose stored balance undercounts leave they have actually taken:\n`);
  for (const f of flagged) {
    console.log(`${f.code}  ${f.name.trim()}  (${f.year})`);
    console.log(`  leave_balances says     available=${f.available}  booked=${f.booked}`);
    console.log(`  actually approved       ${f.actualApproved}d of casual leave this year`);
    console.log(`  gap (invisible leave)   ${f.gap}d`);
    if (f.computed.granted !== null) {
      console.log(`  what computedFor() says granted=${f.computed.granted} taken=${f.computed.taken} available=${f.computed.available}`
        + `   <- what they'd see with no override`);
    }
    console.log('');
  }

  console.log(`${flagged.length} of ${rows.rows.length} rows affected.`);
  console.log('Each one is a leave_balances row where booked has not kept pace with real');
  console.log('approvals — the fingerprint left by PUT /leave-types/balances/:employeeId');
  console.log('(Customize Balance), which resets booked to 0 and never updates it again.');

  await pool.end();
})().catch(async (e) => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
