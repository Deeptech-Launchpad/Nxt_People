// Sandwich leave.
//
// The switch has sat on the settings screen doing nothing, so the first thing
// worth proving is that turning it OFF still changes nothing — this policy
// spends people's leave balances, and "off" has to mean off.
//
// After that: the weekend it bridges must come from the org's own calendar and
// not a hardcoded Saturday/Sunday, and the same gap closed from both sides must
// only be charged once.
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({ sendMail: async () => ({ ok: true }), verify: async () => true });

const pool = require('./db');
const { sandwichedDays } = require('./utils/sandwichLeave');

const checks = [];
const check = (l, ok, x) => { checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '\n          ' + JSON.stringify(x).slice(0, 300)}`); };

const made = [];
let EMP = null;
let ORIG_RULES = null;

const ON = (extra = {}) => ({
  sandwichLeave: { enabled: true, minDays: 0, requireBothSides: true, appliesTo: 'all', ...extra },
});

const run = (opts) => sandwichedDays(pool, { employeeId: EMP, cfg: ON(), ...opts });

(async () => {
  EMP = (await pool.query(
    `SELECT id FROM employees WHERE status='active' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`)).rows[0].id;

  // A known calendar, so the assertions are about the rule and not about
  // whatever this database happens to have. Sunday plus every Saturday.
  ORIG_RULES = (await pool.query(`SELECT id, is_active FROM weekend_rules`)).rows;
  await pool.query(`UPDATE weekend_rules SET is_active = FALSE`);
  // days_of_week is JSONB holding day names, not an int array. start_date
  // defaults to CURRENT_DATE and a rule does not apply before it starts, so it
  // has to be set back or none of these 2019 dates are weekends at all.
  const rule = (await pool.query(
    `INSERT INTO weekend_rules (name, days_of_week, weeks_of_month, start_date, is_active)
     VALUES ('probe', '["sun","sat"]'::jsonb, NULL, '2000-01-01'::date, TRUE) RETURNING id`)).rows[0].id;
  made.push(() => pool.query(`DELETE FROM weekend_rules WHERE id=$1`, [rule]));
  made.push(async () => { for (const r of ORIG_RULES)
    await pool.query(`UPDATE weekend_rules SET is_active=$1 WHERE id=$2`, [r.is_active, r.id]); });

  // 2019-11-08 is a Friday; 9th Sat, 10th Sun, 11th Monday.
  const FRI = '2019-11-08', SAT = '2019-11-09', SUN = '2019-11-10', MON = '2019-11-11';
  await pool.query(`DELETE FROM leaves WHERE employee_id=$1 AND start_date BETWEEN '2019-11-01' AND '2019-11-30'`, [EMP]);
  made.push(() => pool.query(
    `DELETE FROM leaves WHERE employee_id=$1 AND start_date BETWEEN '2019-11-01' AND '2019-11-30'`, [EMP]));

  console.log('\n════ Off means off ════\n');

  let r = await sandwichedDays(pool, {
    employeeId: EMP, start: FRI, end: MON, leaveType: 'casual',
    cfg: { sandwichLeave: { enabled: false } },
  });
  check('with the policy off nothing is bridged', r.days === 0, r);
  r = await sandwichedDays(pool, { employeeId: EMP, start: FRI, end: MON, leaveType: 'casual', cfg: {} });
  check('and an unsaved policy is off too', r.days === 0, r);

  console.log('\n════ One request spanning the weekend ════\n');

  r = await run({ start: FRI, end: MON, leaveType: 'casual' });
  check('Friday to Monday bridges the two weekend days', r.days === 2, r);
  check('and names which days they were',
    r.dates.join(',') === `${SAT},${SUN}`, r.dates);

  r = await run({ start: FRI, end: FRI, leaveType: 'casual' });
  check('a single Friday with nothing after it bridges nothing', r.days === 0, r);

  console.log('\n════ The gap closed from both sides is charged once ════\n');

  const first = (await pool.query(
    `INSERT INTO leaves (employee_id, leave_type, start_date, end_date, total_days, reason, status, sandwich_days, sandwich_dates)
     VALUES ($1,'casual',$2::date,$2::date,1,'probe','approved',2,$3::date[]) RETURNING id`,
    [EMP, FRI, [SAT, SUN]])).rows[0].id;
  made.push(() => pool.query(`DELETE FROM leaves WHERE id=$1`, [first]));

  r = await run({ start: MON, end: MON, leaveType: 'casual' });
  check('a Monday request does not charge for a weekend already paid for',
    r.days === 0, r);

  await pool.query(`UPDATE leaves SET sandwich_days=0, sandwich_dates=NULL WHERE id=$1`, [first]);
  r = await run({ start: MON, end: MON, leaveType: 'casual' });
  check('but it does bridge when the neighbouring leave was not charged',
    r.days === 2, r);

  console.log('\n════ Both sides, or one ════\n');

  await pool.query(`DELETE FROM leaves WHERE id=$1`, [first]);
  r = await sandwichedDays(pool, {
    employeeId: EMP, start: FRI, end: FRI, leaveType: 'casual',
    cfg: ON({ requireBothSides: false }),
  });
  check('with one side enough, a lone Friday pulls in the weekend after it',
    r.days === 2, r);

  console.log('\n════ The threshold ════\n');

  r = await sandwichedDays(pool, {
    employeeId: EMP, start: FRI, end: MON, leaveType: 'casual', cfg: ON({ minDays: 5 }),
  });
  check('two leave days do not meet a five-day threshold', r.days === 0, r);
  r = await sandwichedDays(pool, {
    employeeId: EMP, start: FRI, end: MON, leaveType: 'casual', cfg: ON({ minDays: 2 }),
  });
  check('but they meet a two-day one', r.days === 2, r);

  console.log('\n════ Which leave types ════\n');

  r = await sandwichedDays(pool, {
    employeeId: EMP, start: FRI, end: MON, leaveType: 'casual', cfg: ON({ appliesTo: 'unpaid' }),
  });
  check('casual leave is untouched when the policy is unpaid-only', r.days === 0, r);
  r = await sandwichedDays(pool, {
    employeeId: EMP, start: FRI, end: MON, leaveType: 'unpaid', cfg: ON({ appliesTo: 'unpaid' }),
  });
  check('unpaid leave still bridges', r.days === 2, r);
  r = await run({ start: FRI, end: MON, leaveType: 'permission' });
  check('permission is hours, not days, so it never bridges', r.days === 0, r);

  console.log('\n════ It reads the real calendar, not a hardcoded weekend ════\n');

  // Make the Saturday an explicit working day. A rule keyed to Sat/Sun would
  // still bridge it; one reading the calendar must not.
  const hol = (await pool.query(
    `INSERT INTO holidays (name, date, type) VALUES ('Probe working Saturday', $1::date, 'working_day')
     RETURNING id`, [SAT])).rows[0].id;
  made.push(() => pool.query(`DELETE FROM holidays WHERE id=$1`, [hol]));

  r = await run({ start: FRI, end: MON, leaveType: 'casual' });
  check('a Saturday marked as a working day is not bridged',
    r.days === 1 && r.dates[0] === SUN, r);

  await pool.query(`UPDATE holidays SET type='holiday' WHERE id=$1`, [hol]);
  r = await run({ start: FRI, end: MON, leaveType: 'casual' });
  check('and a declared holiday between leave days is bridged', r.days === 2, r);

  console.log('\n════ A working day in the middle breaks the sandwich ════\n');

  await pool.query(`DELETE FROM holidays WHERE id=$1`, [hol]);
  // Monday to the following Monday, with real working days in between: those
  // are leave, and the weekend inside is bridged, but nothing beyond.
  r = await run({ start: MON, end: '2019-11-18', leaveType: 'casual' });
  check('a longer block bridges only the weekend inside it',
    r.dates.every(d => d === '2019-11-16' || d === '2019-11-17'), r.dates);

  console.log('\n════ Restoring ════\n');

  for (const fn of made.reverse()) await fn().catch(() => {});
  const left = (await pool.query(
    `SELECT COUNT(*)::int n FROM leaves WHERE employee_id=$1 AND start_date BETWEEN '2019-11-01' AND '2019-11-30'`,
    [EMP])).rows[0].n;
  check('the probe leave is gone', left === 0, left);
  const activeRules = (await pool.query(`SELECT COUNT(*)::int n FROM weekend_rules WHERE is_active`)).rows[0].n;
  check('the weekend rules are back',
    activeRules === ORIG_RULES.filter(r => r.is_active).length,
    { now: activeRules, before: ORIG_RULES.filter(r => r.is_active).length });

  const failed = checks.filter(c => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed\n`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch(async e => {
  console.error(e);
  for (const fn of made.reverse()) await fn().catch(() => {});
  process.exit(1);
});
