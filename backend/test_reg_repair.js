// The repair script reported "nothing to repair" against a database that had no
// approved regularizations at all — green while exercising none of it. This
// builds one row with the exact shape of the bug and proves the script finds it,
// fixes it, and leaves the next run with nothing to do.
require('dotenv').config();
const pool = require('./db');
const { execFileSync } = require('child_process');

const checks = [];
const check = (l, ok, x) => { checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '\n          ' + JSON.stringify(x)}`); };

const DATE = '2019-03-15', IN = '09:53:00', OUT = '18:30:00';
const made = [];

const read = async (id) => (await pool.query(
  `SELECT to_char(check_in  AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS ist_in,
          to_char(check_out AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS ist_out,
          working_hours, late_minutes, status FROM attendance WHERE id=$1`, [id])).rows[0];

(async () => {
  const emp = (await pool.query(
    `SELECT id, employee_id AS code FROM employees
      WHERE status='active' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`)).rows[0];

  await pool.query(`DELETE FROM attendance WHERE employee_id=$1 AND date=$2`, [emp.id, DATE]);
  await pool.query(`DELETE FROM attendance_regularizations WHERE employee_id=$1 AND date=$2`, [emp.id, DATE]);

  const reg = (await pool.query(
    `INSERT INTO attendance_regularizations (employee_id, date, check_in, check_out, reason, status)
     VALUES ($1,$2,$3,$4,'timezone repair probe','approved') RETURNING id`,
    [emp.id, DATE, IN, OUT])).rows[0].id;
  made.push(() => pool.query(`DELETE FROM attendance_regularizations WHERE id=$1`, [reg]));

  // Exactly what the old handler produced: the IST clock written in raw, so it
  // reads back 5h30m late, with the late_minutes the backfill then stamped.
  const att = (await pool.query(
    `INSERT INTO attendance (employee_id, date, check_in, check_out, status, working_hours, late_minutes)
     VALUES ($1,$2,($2::date + $3::time)::timestamp,($2::date + $4::time)::timestamp,'present',0,343)
     RETURNING id`, [emp.id, DATE, IN, OUT])).rows[0].id;
  made.push(() => pool.query(`DELETE FROM attendance WHERE id=$1`, [att]));

  const before = await read(att);
  console.log(`\n  seeded ${emp.code} ${DATE}: asked ${IN.slice(0,5)}, row reads ${before.ist_in} - ${before.ist_out}\n`);
  check('the seed really is broken — it reads 5h30m late', before.ist_in === '15:23', before.ist_in);
  check('and its hours are the zero the old handler left', Number(before.working_hours) === 0, before.working_hours);

  const dry = execFileSync('node', ['repair_regularized_times.js'], { cwd: __dirname, encoding: 'utf8' });
  check('the dry run finds it', /1 row\(s\) to move back/.test(dry), dry.split('\n').slice(1, 6));
  check('and writes nothing', (await read(att)).ist_in === '15:23');

  execFileSync('node', ['repair_regularized_times.js', '--apply'], { cwd: __dirname, encoding: 'utf8' });
  const after = await read(att);
  console.log(`\n  after repair: ${after.ist_in} - ${after.ist_out}, ${after.working_hours}h, late ${after.late_minutes}, ${after.status}\n`);

  check('the arrival is the time that was asked for', after.ist_in === '09:53', after.ist_in);
  check('the exit too', after.ist_out === '18:30', after.ist_out);
  check('the hours are rebuilt from those two times',
    Math.abs(Number(after.working_hours) - 8.6167) < 0.001, after.working_hours);
  check('the false 343 late minutes are gone', Number(after.late_minutes) === 23, after.late_minutes);
  // 09:53 against a 09:30 start with 15 minutes' grace is genuinely late. The
  // repair applies the same rule the approval handler does rather than
  // preserving whatever the broken row happened to say, so a status change here
  // is the point, not a side effect.
  check('the status is re-derived from the real arrival, not left as it was',
    after.status === 'late', after.status);

  const again = execFileSync('node', ['repair_regularized_times.js'], { cwd: __dirname, encoding: 'utf8' });
  check('a second run has nothing left to do', /Nothing carries the 5h30m fingerprint/.test(again),
    again.split('\n').slice(1, 5));

  for (const fn of made) await fn().catch(() => {});
  const failed = checks.filter(c => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch(async e => {
  console.error(e);
  for (const fn of made) await fn().catch(() => {});
  process.exit(1);
});
