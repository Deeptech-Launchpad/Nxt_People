/* repair_inverted_days.js, including the path that writes.
 *
 * The first --apply on live failed with "current transaction is aborted".
 * The audit insert named audit_logs(user_id, ...) where the table is
 * audit_log(actor_id, ...); Postgres poisons a transaction on any failed
 * statement, and the .catch(() => {}) wrapped around that insert swallowed
 * the real error so the failure surfaced as something else entirely. Nothing
 * was written, but only by luck of the rollback.
 *
 * The dry run had been exercised repeatedly and proved nothing about the
 * write, because a dry run never reaches it. So this seeds the exact shape,
 * runs the real script end to end, and checks the row AND the audit entry.
 */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'silent';

const pool = require('./db');
const { execFileSync } = require('child_process');

const checks = [];
const check = (l, ok, x) => { checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '\n          ' + JSON.stringify(x).slice(0, 300)}`); };

const TAG = 'RI' + Date.now().toString().slice(-6);
const DATE = '2094-03-17';          // far future: cannot collide with real data
let EMP = null;

const cleanup = async () => {
  if (!EMP) return;
  await pool.query(`DELETE FROM audit_log WHERE resource='Attendance repair'
     AND resource_id IN (SELECT id::text FROM attendance WHERE employee_id=$1)`, [EMP]).catch(() => {});
  await pool.query(`DELETE FROM audit_log WHERE changes->>'employee' = $1`, [TAG + '-EMP']).catch(() => {});
  await pool.query(`DELETE FROM attendance_regularizations WHERE employee_id=$1`, [EMP]).catch(() => {});
  await pool.query(`DELETE FROM attendance WHERE employee_id=$1`, [EMP]).catch(() => {});
  await pool.query(`DELETE FROM employees WHERE id=$1`, [EMP]).catch(() => {});
};

const run = (args = []) => {
  try {
    return execFileSync('node', ['repair_inverted_days.js', ...args],
      { cwd: __dirname, encoding: 'utf8', timeout: 90000 });
  } catch (err) {
    return (err.stdout || '') + (err.stderr || '');
  }
};

(async () => {
  console.log('\nRepairing a day whose check-out landed before its check-in\n');

  EMP = (await pool.query(
    `INSERT INTO employees (employee_id, first_name, last_name, email, role, status, is_user, login_enabled)
     VALUES ($1,'Inverted','Repair',$2,'team_member','active',TRUE,TRUE) RETURNING id`,
    [TAG + '-EMP', `${TAG.toLowerCase()}@example.invalid`])).rows[0].id;

  /* The live shape exactly: a day stamped present with no hours, and the
   * approved request that was meant to have set it. */
  await pool.query(
    `INSERT INTO attendance (employee_id, date, check_in, check_out, working_hours, status)
     VALUES ($1, $2::date,
             ($2 || ' 07:34:00')::timestamp AT TIME ZONE 'Asia/Kolkata' AT TIME ZONE 'UTC',
             ($2 || ' 06:00:00')::timestamp AT TIME ZONE 'Asia/Kolkata' AT TIME ZONE 'UTC',
             0, 'present')`,
    [EMP, DATE]);
  await pool.query(
    `INSERT INTO attendance_regularizations (employee_id, date, check_in, check_out, reason, status)
     VALUES ($1, $2::date, '09:30', '06:00', 'System Error', 'approved')`,
    [EMP, DATE]);

  /* 1 — the dry run proposes it and writes nothing. */
  {
    const out = run();
    check('the dry run proposes the day', /REPAIR .*2094-03-17/.test(out), out.split('\n').filter(l => /2094/.test(l))[0]);
    check('  ...reading the times from the approved request',
      /09:30->18:00 = 08:30/.test(out), out.split('\n').filter(l => /becomes/.test(l))[0]);

    const row = (await pool.query(
      `SELECT working_hours AS hours FROM attendance WHERE employee_id=$1`, [EMP])).rows[0];
    check('  ...and changes nothing', Number(row.hours) === 0, row);
  }

  /* 2 — THE PATH THAT WAS NEVER EXERCISED. */
  {
    const out = run(['--apply']);
    check('the apply reports success rather than an aborted transaction',
      /1 day\(s\) repaired/.test(out) && !/transaction is aborted/.test(out),
      out.split('\n').filter(l => l.trim()).slice(-3).join(' | '));

    const row = (await pool.query(
      `SELECT working_hours AS hours,
              to_char(check_in  AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS "in",
              to_char(check_out AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS "out"
         FROM attendance WHERE employee_id=$1`, [EMP])).rows[0];
    check('  ...the day now runs 09:30 to 18:00', row['in'] === '09:30' && row.out === '18:00', row);
    check('  ...and banks 8.5 hours', Math.abs(Number(row.hours) - 8.5) < 0.01, row.hours);
  }

  /* 3 — and it is traceable. A repair nobody can audit is not one to make. */
  {
    const a = await pool.query(
      `SELECT changes FROM audit_log
        WHERE resource='Attendance repair' AND changes->>'employee' = $1`, [TAG + '-EMP']);
    check('the repair is recorded in the audit trail', a.rows.length === 1, a.rows.length);
    check('  ...saying what it changed',
      /09:30->18:00/.test(a.rows[0]?.changes?.summary || ''), a.rows[0]?.changes?.summary);
  }

  /* 4 — running it again finds nothing: the day is no longer inverted. */
  {
    const out = run();
    check('a second run has nothing left to do', /Nothing found/.test(out), out.trim().split('\n').slice(-1)[0]);
  }

  await cleanup();
  const passed = checks.filter(Boolean).length;
  console.log(`\n  ${passed}/${checks.length} passed\n`);
  await pool.end();
  process.exit(passed === checks.length ? 0 : 1);
})().catch(async e => {
  console.error(e);
  await cleanup();
  await pool.end().catch(() => {});
  process.exit(1);
});
