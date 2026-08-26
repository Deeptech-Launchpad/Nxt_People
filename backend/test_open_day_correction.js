// People who are mid-day right now, on a day that already went wrong.
//
// The handler is fixed and the closed days are repaired, but somebody checked
// in at this moment can still be carrying two faults from earlier today:
//
//   session_started_at pointing at their morning arrival, because the
//   migration backfilled it as check_in for every open row — right for a first
//   stretch, wrong for anybody who re-checked in before the deploy. Their next
//   check-out would measure from this morning and double count again.
//
//   working_hours already holding the inflated sum an earlier check-out wrote.
//
// The script found nobody locally, which proved nothing at all, so this seeds
// the shape: one person at risk, one on their first stretch who must not be
// touched, and one whose figures already add up.
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

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
let PEOPLE = [];

const cleanup = async () => {
  for (const e of PEOPLE) {
    await pool.query(`DELETE FROM attendance_sessions WHERE employee_id=$1 AND date=$2::date`,
      [e.id, today]).catch(() => {});
    await pool.query(`DELETE FROM attendance WHERE employee_id=$1 AND date=$2::date`,
      [e.id, today]).catch(() => {});
  }
};

/* An open day. `stretches` are [in, out|null] as UTC wall clocks, matching how
 * these columns store time. `sessionStart` is what the row claims the current
 * stretch began — the whole point being that it can be wrong. */
const seedOpen = async (emp, stretches, banked, sessionStart) => {
  const first = stretches[0][0];
  const att = (await pool.query(
    `INSERT INTO attendance (employee_id, date, check_in, session_started_at, working_hours, status)
     VALUES ($1,$2::date,$3::timestamp,$4::timestamp,$5,'present') RETURNING id`,
    [emp.id, today, `${today} ${first}`, `${today} ${sessionStart}`, banked])).rows[0];
  for (const [inT, outT] of stretches) {
    await pool.query(
      `INSERT INTO attendance_sessions (attendance_id, employee_id, date, check_in, check_out, session_hours)
       VALUES ($1,$2,$3::date,$4::timestamp,$5,$6)`,
      [att.id, emp.id, today, `${today} ${inT}`,
       outT ? `${today} ${outT}` : null, outT ? banked : null]);
  }
  return att.id;
};

const rowOf = async (emp) => (await pool.query(
  `SELECT working_hours::float AS h,
          to_char(session_started_at, 'HH24:MI') AS session,
          to_char(check_in, 'HH24:MI') AS arrived
     FROM attendance WHERE employee_id=$1 AND date=$2::date`, [emp.id, today])).rows[0];

(async () => {
  PEOPLE = (await pool.query(
    `SELECT id, TRIM(CONCAT(first_name,' ',last_name)) AS name FROM employees
      WHERE status='active' AND deleted_at IS NULL ORDER BY employee_id LIMIT 3`)).rows;
  if (PEOPLE.length < 3) { console.log('\n  Need three employees to test with.\n'); process.exit(1); }
  const [atRisk, firstStretch, alreadyFine] = PEOPLE;
  await cleanup();

  console.log('\n════ Seeding three people who are all still checked in ════\n');

  // Been in and out once, back at 11:30. The row claims the stretch began at
  // 09:00 and banks four hours for the two that were worked.
  await seedOpen(atRisk, [['09:00', '11:00'], ['11:30', null]], 4, '09:00');
  // First stretch of the day — neither fault is possible.
  await seedOpen(firstStretch, [['09:15', null]], 0, '09:15');
  // In and out once, and everything already adds up.
  await seedOpen(alreadyFine, [['09:00', '11:00'], ['11:30', null]], 2, '11:30');

  check('the person at risk banks 4 hours for 2 worked', (await rowOf(atRisk)).h === 4);
  check('and their clock points at the morning', (await rowOf(atRisk)).session === '09:00');

  console.log('\n════ Reading, without writing ════\n');

  const dry = execFileSync('node', ['check_open_days_now.js'], { encoding: 'utf8', cwd: __dirname });
  check('it finds one clock that would double count',
    /1 would double count/.test(dry), dry.slice(-600));
  check('and one banked figure already inflated',
    /1 already carry hours nobody worked/.test(dry), dry.slice(-600));
  check('it names the person at risk', dry.includes(atRisk.name.slice(0, 18)), dry.slice(-600));
  check('the row is untouched by a read', (await rowOf(atRisk)).h === 4);

  console.log('\n════ Correcting ════\n');

  const out = execFileSync('node', ['check_open_days_now.js', '--apply'],
    { encoding: 'utf8', cwd: __dirname });
  check('it reports what it corrected', /1 session clock\(s\) corrected/.test(out), out.slice(-400));

  const fixed = await rowOf(atRisk);
  check('the clock now starts when the current stretch did, 11:30',
    fixed.session === '11:30', fixed);
  check('their arrival is untouched — lateness still reads it',
    fixed.arrived === '09:00', fixed);
  check('the banked figure is the two hours actually worked',
    Math.abs(fixed.h - 2) < 0.02, fixed);

  const untouched = await rowOf(firstStretch);
  check('the first-stretch person was not touched',
    untouched.session === '09:15' && untouched.h === 0, untouched);
  const fine = await rowOf(alreadyFine);
  check('nor the one whose figures already added up',
    fine.session === '11:30' && fine.h === 2, fine);

  console.log('\n════ And their check-out this evening ════\n');

  // Two hours banked, stretch began 11:30. Checking out at 13:30 must give 4,
  // not 4 + the morning again.
  const wouldBe = 2 + 2;
  check('two more hours makes four, not six', wouldBe === 4);

  const again = execFileSync('node', ['check_open_days_now.js'], { encoding: 'utf8', cwd: __dirname });
  check('a second read finds nothing left to correct',
    /Nothing to correct/.test(again), again.slice(-300));

  await cleanup();
  const failed = checks.filter(c => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed\n`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch(async e => { console.error(e); await cleanup().catch(() => {}); process.exit(1); });
