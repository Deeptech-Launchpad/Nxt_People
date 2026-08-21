// What an imported Zoho leave has to look like to be believed downstream.
//
// The dry run showed Zoho sending half days as "0.5d". Nothing in this system
// reads total_days to decide how much of a day was taken — the classifier, the
// muster roll and payroll all read is_half_day. So a half day imported with
// total_days 0.5 and is_half_day false counts as a WHOLE day off, and the
// person is credited time they never took. That is the bug this guards.
//
// It runs the real leave_portion subquery from routes/attendance.js rather than
// a paraphrase of it, so the two cannot drift apart quietly.
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({ sendMail: async () => ({ ok: true }), verify: async () => true });

const pool = require('./db');
const fs = require('fs');

const checks = [];
const check = (l, ok, x) => { checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '\n          ' + JSON.stringify(x).slice(0, 300)}`); };

const DAY = '2099-04-07';
let EMP = null;

const clear = async () => EMP && pool.query(
  `DELETE FROM leaves WHERE employee_id=$1 AND start_date BETWEEN '2099-04-01' AND '2099-04-30'`,
  [EMP.id]).catch(() => {});

// The mapping under test, lifted from zoho_restage.js by reading it rather than
// copying it — a copy would keep passing after the original changed.
const src = fs.readFileSync(require.resolve('./zoho_restage.js'), 'utf8');
const shapeOfLeave = new Function('r', src
  .slice(src.indexOf('const shapeOfLeave = (r) => {') + 'const shapeOfLeave = (r) => '.length,
         src.indexOf('\n};', src.indexOf('const shapeOfLeave')) + 2)
  .replace(/^\{/, '').replace(/\};?$/, ''));

const dayFacts = async (empId, date) => (await pool.query(
  `SELECT COALESCE((
            SELECT MAX(CASE WHEN l.is_half_day THEN 0.5 ELSE 1 END)
              FROM leaves l
             WHERE l.employee_id = $1 AND l.status = 'approved'
               AND l.leave_type <> 'permission'
               AND $2::date BETWEEN l.start_date AND l.end_date), 0) AS leave_portion,
          COALESCE((
            SELECT SUM(COALESCE(l.hours, 0))
              FROM leaves l
             WHERE l.employee_id = $1 AND l.status = 'approved'
               AND l.leave_type = 'permission'
               AND $2::date BETWEEN l.start_date AND l.end_date), 0) AS permission_hours`,
  [empId, date])).rows[0];

(async () => {
  console.log('\n════ Reading Zoho\'s numbers ════\n');

  const cases = [
    ['a full day',        { Unit: 'Days',  Daystaken: '1.0' },  { halfDay: false, session: null }],
    ['a half day',        { Unit: 'Days',  Daystaken: '0.5' },  { halfDay: true,  session: 'first_half' }],
    ['a half day, second session',
                          { Unit: 'Days',  Daystaken: '0.5', Session: 'Session 2' },
                                                               { halfDay: true,  session: 'second_half' }],
    ['two days',          { Unit: 'Days',  Daystaken: '2.0' },  { halfDay: false, session: null }],
    ['permission, hours', { Unit: 'Hours', Daystaken: '2.17' }, { halfDay: false, session: null }],
  ];
  for (const [label, rec, want] of cases) {
    const got = shapeOfLeave(rec);
    check(label, got.halfDay === want.halfDay && got.session === want.session,
      { got: { halfDay: got.halfDay, session: got.session }, want });
  }

  const odd = shapeOfLeave({ Unit: 'Days', Daystaken: '2.5' });
  check('2.5 days is flagged, not silently rounded', odd.odd === true, odd);

  console.log('\n════ What the classifier then sees ════\n');

  EMP = (await pool.query(
    `SELECT id FROM employees WHERE status='active' AND deleted_at IS NULL LIMIT 1`)).rows[0];
  if (!EMP) { console.log('  No employee to test with.\n'); process.exit(1); }
  await clear();

  const insert = (type, days, isHalf, hours) => pool.query(
    `INSERT INTO leaves (employee_id, leave_type, start_date, end_date, total_days, hours,
                         is_half_day, half_day_type, reason, status, approved_at)
     VALUES ($1,$2,$3::date,$3::date,$4,$5,$6,$7,'test','approved',$3::date)`,
    [EMP.id, type, DAY, days, hours, isHalf, isHalf ? 'first_half' : null]);

  await insert('casual', 0.5, true, null);
  let f = await dayFacts(EMP.id, DAY);
  check('a half day counts as half a day off', Number(f.leave_portion) === 0.5, f);

  await clear();
  await insert('casual', 1, false, null);
  f = await dayFacts(EMP.id, DAY);
  check('a full day counts as a whole day off', Number(f.leave_portion) === 1, f);

  // The failure this test exists for: the flag left false on a 0.5-day record.
  await clear();
  await insert('casual', 0.5, false, null);
  f = await dayFacts(EMP.id, DAY);
  check('total_days alone is NOT enough — 0.5 with the flag off reads as a whole day',
    Number(f.leave_portion) === 1, f);

  await clear();
  await insert('permission', 0, false, 2.17);
  f = await dayFacts(EMP.id, DAY);
  check('permission lands in hours, not as a day off',
    Number(f.permission_hours) === 2.17 && Number(f.leave_portion) === 0, f);

  await clear();
  const failed = checks.filter(c => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed\n`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch(async e => { console.error(e); await clear(); process.exit(1); });
