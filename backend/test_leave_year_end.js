/* What happens to a leave balance at year end.
 *
 * Casual leave was never meant to carry forward — leave_types.carry_forward
 * has said false for it since the column was seeded — but nothing enforced
 * it. Vellayan's 22-day casual balance came from Zoho summing four years of
 * unused leave into one figure at import time. This is what stops the same
 * thing from happening again on this system's own clock, and what makes
 * "carries forward" an actual, working, per-type setting rather than a
 * column nobody reads.
 *
 * Two layers:
 *   carryForwardAmount()   pure. what survives the year end, given a policy
 *                           and a balance. No database, no clock.
 *   runYearEndRollover()   touches the database. Given real leave_balances
 *                           rows for the outgoing year, it must carry what
 *                           carryForwardAmount says to carry, lapse the rest
 *                           with an audit trail, and do neither twice if run
 *                           a second time for the same year.
 */
require('dotenv').config();
process.env.LOG_LEVEL = 'silent';
process.env.EMAIL_DISABLED = 'true';

const { carryForwardAmount } = require('./utils/leavePolicy');

const checks = [];
const check = (l, ok, x) => { checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '   got ' + JSON.stringify(x)}`); };

console.log('\n════ carryForwardAmount — pure ════\n');

check("carryForward off means nothing survives, however much was left",
  carryForwardAmount({ carryForward: false, maxDaysPerYear: 100 }, 22) === 0,
  carryForwardAmount({ carryForward: false, maxDaysPerYear: 100 }, 22));

check("that is casual's actual seeded configuration — and Vellayan's real case",
  carryForwardAmount({ carryForward: false, maxDaysPerYear: 12 }, 22) === 0);

check("carryForward on with no cap carries the whole balance",
  carryForwardAmount({ carryForward: true, maxDaysPerYear: null }, 22) === 22,
  carryForwardAmount({ carryForward: true, maxDaysPerYear: null }, 22));

check("carryForward on with a cap carries at most the cap",
  carryForwardAmount({ carryForward: true, maxDaysPerYear: 15 }, 22) === 15,
  carryForwardAmount({ carryForward: true, maxDaysPerYear: 15 }, 22));

check("and does not top a smaller balance up to the cap",
  carryForwardAmount({ carryForward: true, maxDaysPerYear: 15 }, 4) === 4,
  carryForwardAmount({ carryForward: true, maxDaysPerYear: 15 }, 4));

check("a cap of exactly zero means nothing carries",
  carryForwardAmount({ carryForward: true, maxDaysPerYear: 0 }, 22) === 0,
  carryForwardAmount({ carryForward: true, maxDaysPerYear: 0 }, 22));

check("a negative available (an over-drawn balance) carries nothing, not a negative",
  carryForwardAmount({ carryForward: true, maxDaysPerYear: 15 }, -3) === 0,
  carryForwardAmount({ carryForward: true, maxDaysPerYear: 15 }, -3));

check("zero available carries zero, off or on",
  carryForwardAmount({ carryForward: true, maxDaysPerYear: 15 }, 0) === 0
  && carryForwardAmount({ carryForward: false, maxDaysPerYear: 15 }, 0) === 0);

console.log('\n════ runYearEndRollover — against real rows, then reverted ════\n');

(async () => {
  const pool = require('./db');
  const { runYearEndRollover } = require('./utils/leaveYearEnd');
  const nodemailer = require('nodemailer');
  nodemailer.createTransport = () => ({
    sendMail: async () => { throw new Error('this test does not send mail'); },
    verify: async () => { throw new Error('this test does not send mail'); },
  });

  const YEAR = 2099; // far outside any real data, so nothing here can collide
  const cleanup = [];

  try {
    const casualLt = (await pool.query(`SELECT id FROM leave_types WHERE code = 'casual'`)).rows[0];
    const emp = (await pool.query(
      `SELECT id, employee_id FROM employees WHERE deleted_at IS NULL LIMIT 2`)).rows;
    if (!casualLt || emp.length < 2) {
      console.log('  skipped — no employees/leave types to test against in this database\n');
      return finish(0);
    }

    // casual: carry_forward = false in every real deployment. Confirmed
    // rather than assumed, so this test fails loudly if that default ever
    // changes underneath it instead of silently testing the wrong thing.
    const casualCfg = (await pool.query(
      `SELECT carry_forward AS cf FROM leave_types WHERE id = $1`, [casualLt.id])).rows[0];
    check("casual is carry_forward = false in this database, as seeded",
      casualCfg.cf === false, casualCfg);

    // carry_forward is a property of the TYPE, not the person, so two people
    // on the same type cannot be made to behave differently. Person A sits on
    // real, untouched casual (carry_forward = false, never modified here) and
    // must lapse. Person B sits on a different type, temporarily switched to
    // carry forward with a cap, to prove the mechanism moves a balance when
    // it is told to — in the same rollover call, so this also proves the
    // decision is genuinely per-type rather than global.
    const permLt = (await pool.query(`SELECT id FROM leave_types WHERE code = 'permission'`)).rows[0];
    if (!permLt) { console.log('  skipped — no permission leave type in this database\n'); return finish(0); }

    const insA = await pool.query(
      `INSERT INTO leave_balances (employee_id, leave_type_id, year, available, booked)
       VALUES ($1,$2,$3,22,0) RETURNING id`, [emp[0].id, casualLt.id, YEAR]);
    cleanup.push(insA.rows[0].id);

    const original = (await pool.query(`SELECT carry_forward, max_days_per_year FROM leave_types WHERE id=$1`, [permLt.id])).rows[0];
    await pool.query(`UPDATE leave_types SET carry_forward = TRUE, max_days_per_year = 15 WHERE id = $1`, [permLt.id]);
    const insB = await pool.query(
      `INSERT INTO leave_balances (employee_id, leave_type_id, year, available, booked)
       VALUES ($1,$2,$3,22,0) RETURNING id`, [emp[1].id, permLt.id, YEAR]);
    cleanup.push(insB.rows[0].id);

    // Dry run first — must report correctly and write nothing.
    const dry = await runYearEndRollover(pool, { fromYear: YEAR, toYear: YEAR + 1, apply: false });
    check("dry run finds both rows and reports what would happen, without applying",
      dry.applied === false && dry.carried.length === 1 && dry.lapsed.length === 1, dry);

    const beforeRow = await pool.query(
      `SELECT 1 FROM leave_balances WHERE leave_type_id=$1 AND year=$2`, [permLt.id, YEAR + 1]);
    check("and genuinely wrote nothing", beforeRow.rows.length === 0);

    // Now for real.
    const applied = await runYearEndRollover(pool, { fromYear: YEAR, toYear: YEAR + 1, apply: true });
    cleanup.push(...(await pool.query(
      `SELECT id FROM leave_balances WHERE leave_type_id=$1 AND year=$2`, [permLt.id, YEAR + 1])).rows.map(r => r.id));

    check("person B's carry_forward=true balance carried, capped at 15",
      applied.carried.some(c => c.employeeId === emp[1].id && c.carried === 15), applied.carried);
    check("person A's carry_forward=false CASUAL balance lapsed instead — same rollover call, different type, different outcome",
      applied.lapsed.some(l => l.employeeId === emp[0].id && l.lapsed === 22 && l.typeCode === 'casual'), applied.lapsed);

    const nextYearRow = (await pool.query(
      `SELECT available FROM leave_balances WHERE employee_id=$1 AND leave_type_id=$2 AND year=$3`,
      [emp[1].id, permLt.id, YEAR + 1])).rows[0];
    check(`the new year's row for person B actually holds 15, not 22`,
      parseFloat(nextYearRow?.available) === 15, nextYearRow);

    const lapsedLog = (await pool.query(
      `SELECT days_added FROM leave_accrual_log
        WHERE employee_id=$1 AND leave_type='casual' AND reason LIKE 'Lapsed at the end of%'`,
      [emp[0].id])).rows[0];
    check("the lapse is logged, negative, auditable",
      lapsedLog && parseFloat(lapsedLog.days_added) === -22, lapsedLog);

    // Re-run: must not double-write or double-log.
    const second = await runYearEndRollover(pool, { fromYear: YEAR, toYear: YEAR + 1, apply: true });
    const stillOneRow = (await pool.query(
      `SELECT available FROM leave_balances WHERE employee_id=$1 AND leave_type_id=$2 AND year=$3`,
      [emp[1].id, permLt.id, YEAR + 1])).rows;
    check("running it twice does not create a second row for the same year",
      stillOneRow.length === 1 && parseFloat(stillOneRow[0].available) === 15, stillOneRow);
    const logCount = (await pool.query(
      `SELECT count(*)::int AS n FROM leave_accrual_log
        WHERE employee_id=$1 AND leave_type='casual' AND reason LIKE 'Lapsed at the end of%'`,
      [emp[0].id])).rows[0].n;
    check("or a second lapse log entry", logCount === 1, logCount);
    void second;

    await pool.query(`UPDATE leave_types SET carry_forward=$1, max_days_per_year=$2 WHERE id=$3`,
      [original.carry_forward, original.max_days_per_year, permLt.id]);
    await pool.query(
      `DELETE FROM leave_accrual_log
        WHERE employee_id = ANY($1::uuid[])
          AND (reason LIKE 'Lapsed at the end of%' OR reason LIKE 'Carried forward into%')`,
      [[emp[0].id, emp[1].id]]);
    for (const id of cleanup) await pool.query(`DELETE FROM leave_balances WHERE id = $1`, [id]);

    finish(0);
  } catch (e) {
    console.error('\n  setup/db failed —', e.message, '\n');
    for (const id of cleanup) { try { await pool.query(`DELETE FROM leave_balances WHERE id = $1`, [id]); } catch {} }
    finish(1);
  }

  async function finish(extraExit) {
    await pool.end();
    const failed = checks.filter(c => !c).length;
    console.log(`\n${checks.length - failed}/${checks.length} passed\n`);
    process.exit(failed || extraExit ? 1 : 0);
  }
})();
