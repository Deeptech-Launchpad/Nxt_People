// The arrival repair reported "nothing matches" against a clean local database.
// True, and useless — indistinguishable from detection that does not work.
//
// The whole safety of this script rests on one judgement: created_at is an
// arrival when a check-in wrote it, and is NOT one when the absent scheduler
// did. So both shapes are seeded here, and the test fails if it cannot tell
// them apart — inventing an earlier arrival for somebody is the failure that
// matters.
require('dotenv').config();
const pool = require('./db');
const { execFileSync } = require('child_process');

const checks = [];
const check = (l, ok, x) => { checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '\n          ' + JSON.stringify(x).slice(0, 300)}`); };

const DAY = '2019-12-12';
const made = [];

const readRow = async (id) => (await pool.query(
  `SELECT to_char(check_in AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata','HH24:MI:SS') AS ci,
          late_minutes, status, working_hours
     FROM attendance WHERE id=$1`, [id])).rows[0];

// A row whose punch is later than the row itself — the symptom.
const seed = async (empId, madeAt, checkIn) => {
  const id = (await pool.query(
    `INSERT INTO attendance (employee_id, date, check_in, check_out, working_hours, status, late_minutes, created_at)
     VALUES ($1, $2::date,
       (($2::date + $3::time) AT TIME ZONE 'Asia/Kolkata' AT TIME ZONE 'UTC'),
       (($2::date + '18:00'::time) AT TIME ZONE 'Asia/Kolkata' AT TIME ZONE 'UTC'),
       8.5, 'present', 300,
       (($2::date + $4::time) AT TIME ZONE 'Asia/Kolkata' AT TIME ZONE 'UTC'))
     RETURNING id`, [empId, DAY, checkIn, madeAt])).rows[0].id;
  made.push(() => pool.query(`DELETE FROM attendance WHERE id=$1`, [id]));
  return id;
};

(async () => {
  const emps = (await pool.query(
    `SELECT id FROM employees WHERE status='active' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 4`)).rows;
  if (emps.length < 4) { console.log('  needs four employees locally'); process.exit(1); }

  await pool.query(`DELETE FROM attendance WHERE date=$1`, [DAY]);

  // One row written by a check-in: nobody else was created in that minute.
  const lone = await seed(emps[0].id, '09:41:07', '14:30:00');

  // Three rows written together, as the absent scheduler writes them. Their
  // created_at is the cron's time and must NOT be read as an arrival.
  const bulk = [];
  for (let i = 1; i < 4; i++) bulk.push(await seed(emps[i].id, '11:00:00', '15:15:00'));

  console.log(`\n  seeded one lone row at 09:41 and three sharing 11:00\n`);

  console.log('════ The dry run tells them apart ════\n');

  const dry = execFileSync('node', ['repair_arrival_from_created.js'], { cwd: __dirname, encoding: 'utf8' });

  check('exactly one row is judged safe to repair',
    /1 row\(s\) where created_at is an arrival/.test(dry),
    dry.split('\n').find(l => l.includes('created_at is an arrival')));
  check('and the three written together are left alone',
    /3 row\(s\) left alone/.test(dry),
    dry.split('\n').find(l => l.includes('left alone')));
  check('the lone row is the one offered', /14:30:00 -> 09:41:07/.test(dry),
    dry.split('\n').find(l => l.includes('->')));
  check('nothing was written by the dry run',
    (await readRow(lone)).ci === '14:30:00', await readRow(lone));

  console.log('\n════ Applying ════\n');

  execFileSync('node', ['repair_arrival_from_created.js', '--apply'], { cwd: __dirname, encoding: 'utf8' });

  const fixed = await readRow(lone);
  check('the lone row now carries its real arrival', fixed.ci === '09:41:07', fixed);
  check('and its late minutes were recomputed, not left at 300',
    Number(fixed.late_minutes) === 11, fixed.late_minutes);
  check('hours were not touched', Number(fixed.working_hours) === 8.5, fixed.working_hours);

  for (const id of bulk) {
    const row = await readRow(id);
    check('a bulk-written row is untouched — no arrival was invented',
      row.ci === '15:15:00' && Number(row.late_minutes) === 300, row);
  }

  console.log('\n════ A second run has nothing left ════\n');

  const again = execFileSync('node', ['repair_arrival_from_created.js'], { cwd: __dirname, encoding: 'utf8' });
  check('the repaired row no longer appears',
    !/09:41:07/.test(again.split('left alone')[0]),
    again.split('\n').filter(l => l.includes('->')));

  console.log('\n════ Restoring ════\n');

  for (const fn of made) await fn().catch(() => {});
  check('the probe rows are gone',
    (await pool.query(`SELECT COUNT(*)::int n FROM attendance WHERE date=$1`, [DAY])).rows[0].n === 0);

  const failed = checks.filter(c => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed\n`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch(async e => {
  console.error(e);
  for (const fn of made) await fn().catch(() => {});
  process.exit(1);
});
