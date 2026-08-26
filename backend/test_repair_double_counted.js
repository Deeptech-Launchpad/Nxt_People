// Repairing days that were charged twice for the same stretch.
//
// The local database has no multi-stretch days, so the repair reported
// "nothing to repair" and proved nothing whatsoever. This seeds the exact
// corrupted shape the old handler produced and checks the repair finds it,
// corrects it, and leaves everything else alone.
//
// The shape, from the two reports:
//   10:00 in, 11:00 out           1h banked, correct
//   11:01 in, 12:00 out           1 + (12:00 − 10:00) = 3h stored for 2h worked
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'silent';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({ sendMail: async () => ({ ok: true }), verify: async () => true });

const pool = require('./db');
const { execFileSync } = require('child_process');

const checks = [];
const check = (l, ok, x) => { checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '\n          ' + JSON.stringify(x).slice(0, 300)}`); };

const BAD = '2096-02-05';    // two stretches, hours double counted
const GOOD = '2096-02-06';   // two stretches, already correct
const SINGLE = '2096-02-07'; // one stretch — cannot have this fault
let EMP = null;

const cleanup = async () => {
  if (!EMP) return;
  await pool.query(
    `DELETE FROM attendance_sessions WHERE employee_id=$1 AND date BETWEEN '2096-02-01' AND '2096-02-28'`,
    [EMP.id]).catch(() => {});
  await pool.query(
    `DELETE FROM attendance WHERE employee_id=$1 AND date BETWEEN '2096-02-01' AND '2096-02-28'`,
    [EMP.id]).catch(() => {});
};

// A day with its stretches, and whatever working_hours the old handler left.
const seed = async (date, stretches, storedHours, status) => {
  const first = stretches[0][0], last = stretches[stretches.length - 1][1];
  const att = (await pool.query(
    `INSERT INTO attendance (employee_id, date, check_in, check_out, working_hours, status)
     VALUES ($1,$2::date,$3::timestamp,$4::timestamp,$5,$6) RETURNING id`,
    [EMP.id, date, `${date} ${first}`, `${date} ${last}`, storedHours, status])).rows[0];
  for (const [inT, outT] of stretches) {
    await pool.query(
      `INSERT INTO attendance_sessions (attendance_id, employee_id, date, check_in, check_out, session_hours)
       VALUES ($1,$2,$3::date,$4::timestamp,$5::timestamp,$6)`,
      // session_hours carried the same bad sum, which is why it cannot be
      // trusted and the spans are recomputed instead.
      [att.id, EMP.id, date, `${date} ${inT}`, `${date} ${outT}`, storedHours]);
  }
  return att.id;
};

const row = async (date) => (await pool.query(
  `SELECT working_hours::float AS h, status FROM attendance WHERE employee_id=$1 AND date=$2::date`,
  [EMP.id, date])).rows[0];

(async () => {
  EMP = (await pool.query(
    `SELECT id FROM employees WHERE status='active' AND deleted_at IS NULL LIMIT 1`)).rows[0];
  if (!EMP) { console.log('\n  No employee to test with.\n'); process.exit(1); }
  await cleanup();

  console.log('\n════ Seeding the corrupted shape ════\n');

  await seed(BAD, [['10:00', '11:00'], ['11:01', '12:00']], 3, 'present');
  await seed(GOOD, [['09:00', '12:00'], ['13:00', '17:00']], 7, 'present');
  await seed(SINGLE, [['09:00', '17:30']], 8.5, 'present');

  check('the bad day claims 3 hours', (await row(BAD)).h === 3);
  check('the good day claims 7, which is what it worked', (await row(GOOD)).h === 7);
  check('the single-stretch day claims 8.5', (await row(SINGLE)).h === 8.5);

  console.log('\n════ The dry run finds it and writes nothing ════\n');

  const dry = execFileSync('node', ['repair_double_counted_hours.js'],
    { encoding: 'utf8', cwd: __dirname });
  check('it reports one day to repair', /1 of them store more hours/.test(dry), dry.slice(-500));
  check('and names the bad day', dry.includes(BAD), dry.slice(-500));
  check('but not the day that already adds up', !dry.includes(GOOD), dry.slice(-500));
  check('the bad day is still 3 hours — a dry run writes nothing',
    (await row(BAD)).h === 3, await row(BAD));

  console.log('\n════ Applying ════\n');

  const out = execFileSync('node', ['repair_double_counted_hours.js', '--apply'],
    { encoding: 'utf8', cwd: __dirname });
  check('the repair ran', /1 day\(s\) repaired/.test(out), out.slice(-300));

  const fixed = await row(BAD);
  // 10:00–11:00 is sixty minutes and 11:01–12:00 is fifty-nine, so the honest
  // total is 1.98 — not "about two". Asserting 2 with a loose tolerance would
  // have accepted a repair that quietly rounded the day.
  check('the day is 1.98 hours, the two stretches exactly',
    Math.abs(fixed.h - 1.98) < 0.005, fixed);
  check('and it is no longer called a full day',
    fixed.status !== 'present', fixed);

  const good = await row(GOOD);
  check('the correct day was NOT touched', good.h === 7 && good.status === 'present', good);
  const single = await row(SINGLE);
  check('nor the single-stretch day', single.h === 8.5, single);

  const sessions = (await pool.query(
    `SELECT session_hours::float AS h FROM attendance_sessions
      WHERE employee_id=$1 AND date=$2::date ORDER BY check_in`, [EMP.id, BAD])).rows;
  check('each stretch now records its own length, not the day\'s bad sum',
    sessions.length === 2 && Math.abs(sessions[0].h - 1) < 0.02 && Math.abs(sessions[1].h - 0.98) < 0.02,
    sessions);

  console.log('\n════ Running it again changes nothing ════\n');

  const again = execFileSync('node', ['repair_double_counted_hours.js'],
    { encoding: 'utf8', cwd: __dirname });
  check('there is nothing left to repair', /Nothing to repair/.test(again), again.slice(-300));

  await cleanup();
  const failed = checks.filter(c => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed\n`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch(async e => { console.error(e); await cleanup().catch(() => {}); process.exit(1); });
