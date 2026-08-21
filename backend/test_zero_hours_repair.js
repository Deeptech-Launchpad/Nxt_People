// Recovering the hours on a day recorded as zero.
//
// The dangerous move here is using the punch span. It includes lunch, so a
// person who arrived at 09:30 and left at 18:30 would be credited nine hours
// for a day they worked eight — and it would look like a repair. The test that
// matters most is the last one: a day with no sessions and no regularization
// must be LEFT ALONE, however obvious the span looks.
require('dotenv').config();
const pool = require('./db');
const { execFileSync } = require('child_process');

const checks = [];
const check = (l, ok, x) => { checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '\n          ' + JSON.stringify(x).slice(0, 300)}`); };

const made = [];
const D = n => `2019-10-${String(n).padStart(2, '0')}`;

const hoursOf = async (id) => (await pool.query(
  `SELECT working_hours, status FROM attendance WHERE id=$1`, [id])).rows[0];

// A day with punches, a real span, and zero hours.
const seedDay = async (empId, day, ci, co) => {
  await pool.query(`DELETE FROM attendance WHERE employee_id=$1 AND date=$2`, [empId, day]);
  const id = (await pool.query(
    `INSERT INTO attendance (employee_id, date, check_in, check_out, working_hours, status, late_minutes)
     VALUES ($1, $2::date,
       (($2::date + $3::time) AT TIME ZONE 'Asia/Kolkata' AT TIME ZONE 'UTC'),
       (($2::date + $4::time) AT TIME ZONE 'Asia/Kolkata' AT TIME ZONE 'UTC'),
       0, 'absent', 0) RETURNING id`, [empId, day, ci, co])).rows[0].id;
  made.push(() => pool.query(`DELETE FROM attendance WHERE id=$1`, [id]));
  return id;
};

(async () => {
  const emps = (await pool.query(
    `SELECT id FROM employees WHERE status='active' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 3`)).rows;
  if (emps.length < 3) { console.log('  needs three employees locally'); process.exit(1); }

  // 1. Sessions exist — the sum of what was recorded.
  const withSessions = await seedDay(emps[0].id, D(1), '09:30', '18:30');
  for (const [ci, co, h] of [['09:30', '13:00', 3.5], ['14:00', '18:30', 4.5]]) {
    const sid = (await pool.query(
      `INSERT INTO attendance_sessions (attendance_id, employee_id, date, check_in, check_out, session_hours)
       VALUES ($1, $2, $3::date,
         (($3::date + $4::time) AT TIME ZONE 'Asia/Kolkata' AT TIME ZONE 'UTC'),
         (($3::date + $5::time) AT TIME ZONE 'Asia/Kolkata' AT TIME ZONE 'UTC'), $6)
       RETURNING id`, [withSessions, emps[0].id, D(1), ci, co, h])).rows[0].id;
    made.push(() => pool.query(`DELETE FROM attendance_sessions WHERE id=$1`, [sid]));
  }

  // 2. No sessions, but an approved regularization stating the hours.
  const withReg = await seedDay(emps[1].id, D(2), '09:30', '18:30');
  const reg = (await pool.query(
    `INSERT INTO attendance_regularizations (employee_id, date, check_in, check_out, reason, status, approved_at)
     VALUES ($1, $2::date, '09:45:00', '18:15:00', 'probe', 'approved', NOW()) RETURNING id`,
    [emps[1].id, D(2)])).rows[0].id;
  made.push(() => pool.query(`DELETE FROM attendance_regularizations WHERE id=$1`, [reg]));

  // 3. Neither. The span is nine hours and says nothing about lunch.
  const bare = await seedDay(emps[2].id, D(3), '09:30', '18:30');

  console.log('\n  seeded: one day with sessions, one with a regularization, one with neither\n');

  console.log('════ The dry run ════\n');

  const dry = execFileSync('node', ['repair_zero_hours.js'], { cwd: __dirname, encoding: 'utf8' });

  check('the day with sessions is offered at the sum of them, not the span',
    /0h -> 8\.00h\s+from 2 session\(s\)/.test(dry),
    dry.split('\n').filter(l => l.includes(D(1))));
  check('the day with a regularization is offered at the hours claimed',
    /0h -> 8\.50h\s+from regularized 09:45-18:15/.test(dry),
    dry.split('\n').filter(l => l.includes(D(2))));
  check('the day with neither is NOT offered at the span',
    !new RegExp(`${D(3)}[^\\n]*0h ->`).test(dry),
    dry.split('\n').filter(l => l.includes(D(3))));
  check('and is reported as unprovable instead',
    /unprovable/.test(dry) && dry.includes(D(3)),
    dry.split('\n').filter(l => l.includes('unprovable')));
  check('nothing was written', Number((await hoursOf(withSessions)).working_hours) === 0);

  console.log('\n════ Applying ════\n');

  execFileSync('node', ['repair_zero_hours.js', '--apply'], { cwd: __dirname, encoding: 'utf8' });

  const s1 = await hoursOf(withSessions);
  check('the session day is stored at 8h, not the 9h span',
    Math.abs(Number(s1.working_hours) - 8) < 0.001, s1);
  check('and its status is no longer absent', s1.status !== 'absent', s1);

  const s2 = await hoursOf(withReg);
  check('the regularized day is stored at the 8.5h claimed',
    Math.abs(Number(s2.working_hours) - 8.5) < 0.001, s2);

  const s3 = await hoursOf(bare);
  check('the unprovable day is untouched — no lunch was paid for',
    Number(s3.working_hours) === 0 && s3.status === 'absent', s3);

  console.log('\n════ A second run has nothing left but the unprovable one ════\n');

  const again = execFileSync('node', ['repair_zero_hours.js'], { cwd: __dirname, encoding: 'utf8' });
  check('the repaired days no longer appear',
    !again.includes(D(1)) && !again.includes(D(2)),
    again.split('\n').filter(l => l.includes('2019-10')));
  check('and the unprovable one still does', again.includes(D(3)));

  console.log('\n════ Restoring ════\n');

  for (const fn of made.reverse()) await fn().catch(() => {});
  check('the probe rows are gone',
    (await pool.query(
      `SELECT COUNT(*)::int n FROM attendance WHERE date BETWEEN $1 AND $2`, [D(1), D(3)])).rows[0].n === 0);

  const failed = checks.filter(c => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed\n`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch(async e => {
  console.error(e);
  for (const fn of made.reverse()) await fn().catch(() => {});
  process.exit(1);
});
