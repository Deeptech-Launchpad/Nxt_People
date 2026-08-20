// Is the engine actually the thing deciding a day now?
//
// The rule passing its own unit tests proves nothing about whether check-out
// calls it. This drives the real check-out endpoint and the real regularization
// approval, and checks what landed in the database.
//
// The case that matters most is the last one: a punched day and a regularized
// day of identical length must be called the same thing. They were computed by
// two separate copies of the thresholds before, which is exactly how a calendar
// and a report come to disagree.
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({ sendMail: async () => ({ ok: true }), verify: async () => true });

const app = require('./app');
const pool = require('./db');
const jwt = require('jsonwebtoken');
const http = require('http');

const checks = [];
const check = (l, ok, x) => { checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '\n          ' + JSON.stringify(x).slice(0, 300)}`); };

let PORT = 0;
const call = (method, p, token, body) => new Promise(resolve => {
  const data = body === undefined ? null : JSON.stringify(body);
  const req = http.request({ host: '127.0.0.1', port: PORT, path: '/api' + p, method,
    headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) } },
    res => { let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{ let j=null; try{j=JSON.parse(d);}catch{} resolve({s:res.statusCode,j}); }); });
  req.on('error', e => resolve({ s: 0, j: null, err: e.message }));
  if (data) req.write(data); req.end();
});

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const made = [];
let ORIGINAL = null, ORIG_COLS = null;

// Drive check-out for a day of exactly `hours` by seeding the open row itself:
// the endpoint measures from the stored check_in to now, so the arrival is the
// only lever on the length of the day.
async function checkOutAfter(empId, token, hours) {
  const d = today();
  await pool.query(`DELETE FROM attendance WHERE employee_id=$1 AND date=$2`, [empId, d]);
  await pool.query(`DELETE FROM attendance_sessions WHERE employee_id=$1 AND date=$2`, [empId, d]);
  const id = (await pool.query(
    `INSERT INTO attendance (employee_id, date, check_in, status, working_hours, late_minutes)
     VALUES ($1, $2::date, NOW() - ($3 || ' hours')::interval, 'present', 0, 0) RETURNING id`,
    [empId, d, String(hours)])).rows[0].id;
  const r = await call('POST', '/attendance/checkout', token, {});
  const row = (await pool.query(`SELECT status, working_hours FROM attendance WHERE id=$1`, [id])).rows[0];
  await pool.query(`DELETE FROM attendance WHERE id=$1`, [id]);
  return { http: r.s, ...row };
}

(async () => {
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  PORT = server.address().port;

  const emp = (await pool.query(
    `SELECT id, employee_id AS code FROM employees
      WHERE role='team_member' AND status='active' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`)).rows[0];
  const T = jwt.sign({ id: emp.id }, process.env.JWT_SECRET, { expiresIn: '1h' });

  ORIGINAL = (await pool.query(`SELECT attendance_policy_config AS c FROM settings LIMIT 1`)).rows[0].c;
  ORIG_COLS = (await pool.query(
    `SELECT expected_hours_mode AS m, expected_hours_per_day AS f, expected_half_day_hours AS h FROM settings LIMIT 1`)).rows[0];

  const setPolicy = async (extra) => {
    await pool.query(
      `UPDATE settings SET attendance_policy_config = $1::jsonb,
              expected_hours_mode='manual', expected_hours_per_day=8, expected_half_day_hours=4`,
      [JSON.stringify({ ...(ORIGINAL || {}), calculateHoursFrom: 'every',
        allowOvertimeAndDeviation: true, ruleEffectiveFrom: null, ...extra })]);
  };

  console.log(`\n  subject ${emp.code}\n`);
  console.log("════ HR's rule: under 8h is absent ════\n");

  await setPolicy({ mode: 'custom', strictMode: true, shortDayBecomes: 'absent', toleranceMinutes: 0 });

  const eight = await checkOutAfter(emp.id, T, 8.2);
  check('8.2h worked is present', eight.status === 'present', eight);

  const short = await checkOutAfter(emp.id, T, 7.9);
  check('7.9h is ABSENT, not a half day — the engine is deciding this',
    short.status === 'absent', short);

  const veryShort = await checkOutAfter(emp.id, T, 2);
  check('2h is absent too', veryShort.status === 'absent', veryShort);

  console.log('\n════ Switching to Strict changes the answer, with no code change ════\n');

  await setPolicy({ mode: 'strict', strictMode: true });
  const strictShort = await checkOutAfter(emp.id, T, 7.9);
  check('the same 7.9h day is now a HALF DAY', strictShort.status === 'half-day', strictShort);
  check('and 2h is still absent',
    (await checkOutAfter(emp.id, T, 2)).status === 'absent');

  console.log('\n════ Lenient marks present however short ════\n');

  await setPolicy({ mode: 'lenient', strictMode: false });
  const lenient = await checkOutAfter(emp.id, T, 1.5);
  check('1.5h is present under Lenient', lenient.status === 'present', lenient);

  console.log('\n════ Permission reduces what is owed, through the real endpoint ════\n');

  await setPolicy({ mode: 'custom', strictMode: true, shortDayBecomes: 'absent',
    toleranceMinutes: 0, permissionReducesExpected: true });

  const perm = (await pool.query(
    `INSERT INTO leaves (employee_id, leave_type, start_date, end_date, total_days, hours, reason, status)
     VALUES ($1,'permission',$2::date,$2::date,0,2,'wired probe','approved') RETURNING id`,
    [emp.id, today()])).rows[0].id;
  made.push(() => pool.query(`DELETE FROM leaves WHERE id=$1`, [perm]));

  const withPerm = await checkOutAfter(emp.id, T, 6.1);
  check('6.1h with 2h approved permission is PRESENT', withPerm.status === 'present', withPerm);

  const stillShort = await checkOutAfter(emp.id, T, 5);
  check('but 5h against the same 2h permission is still absent',
    stillShort.status === 'absent', stillShort);

  await pool.query(`DELETE FROM leaves WHERE id=$1`, [perm]);
  const noPerm = await checkOutAfter(emp.id, T, 6.1);
  check('and without the permission that same 6.1h day is absent',
    noPerm.status === 'absent', noPerm);

  console.log('\n════ The effective date holds the rule back ════\n');

  // Dated tomorrow, so today must still be judged by the old thresholds.
  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  await setPolicy({ mode: 'custom', strictMode: true, shortDayBecomes: 'absent',
    toleranceMinutes: 0, ruleEffectiveFrom: tomorrow });
  const held = await checkOutAfter(emp.id, T, 7.9);
  check('with the rule starting tomorrow, today is not judged by it',
    held.status !== 'absent', held);

  console.log('\n════ A punched day and a regularized day agree ════\n');

  await setPolicy({ mode: 'custom', strictMode: true, shortDayBecomes: 'absent', toleranceMinutes: 0 });

  // 09:00–16:00 is seven hours: short of eight, so absent under this policy.
  const regDate = '2019-08-14';
  await pool.query(`DELETE FROM attendance WHERE employee_id=$1 AND date=$2`, [emp.id, regDate]);
  await pool.query(`DELETE FROM attendance_regularizations WHERE employee_id=$1 AND date=$2`, [emp.id, regDate]);

  const reg = (await pool.query(
    `INSERT INTO attendance_regularizations (employee_id, date, check_in, check_out, reason, status)
     VALUES ($1,$2,'09:00:00','16:00:00','wired probe','pending') RETURNING id`,
    [emp.id, regDate])).rows[0].id;
  made.push(() => pool.query(`DELETE FROM attendance_regularizations WHERE id=$1`, [reg]));
  made.push(() => pool.query(`DELETE FROM attendance WHERE employee_id=$1 AND date=$2`, [emp.id, regDate]));

  const approver = (await pool.query(
    `SELECT id FROM employees WHERE role='admin' AND status='active' AND deleted_at IS NULL LIMIT 1`)).rows[0];
  const AT = jwt.sign({ id: approver.id }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const act = await call('PUT', `/regularizations/${reg}/action`, AT, { action: 'approved' });
  check('the regularization is approved', act.s === 200, { s: act.s, m: act.j?.message });

  const regRow = (await pool.query(
    `SELECT status, working_hours FROM attendance WHERE employee_id=$1 AND date=$2`,
    [emp.id, regDate])).rows[0];
  check('a regularized 7h day is absent, exactly as a punched 7h day would be',
    regRow?.status === 'absent', regRow);

  console.log('\n════ Restoring ════\n');

  for (const fn of made) await fn().catch(() => {});
  await pool.query(`DELETE FROM attendance WHERE employee_id=$1 AND date=$2`, [emp.id, today()]);
  await pool.query(
    `UPDATE settings SET attendance_policy_config = $1::jsonb,
            expected_hours_mode=$2, expected_hours_per_day=$3, expected_half_day_hours=$4`,
    [JSON.stringify(ORIGINAL), ORIG_COLS.m, ORIG_COLS.f, ORIG_COLS.h]);
  const back = (await pool.query(`SELECT attendance_policy_config AS c FROM settings LIMIT 1`)).rows[0].c;
  check('the policy is put back', JSON.stringify(back) === JSON.stringify(ORIGINAL));

  server.close();
  const failed = checks.filter(c => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed\n`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch(async e => {
  console.error(e);
  for (const fn of made) await fn().catch(() => {});
  if (ORIGINAL) await pool.query(
    `UPDATE settings SET attendance_policy_config = $1::jsonb,
            expected_hours_mode=$2, expected_hours_per_day=$3, expected_half_day_hours=$4`,
    [JSON.stringify(ORIGINAL), ORIG_COLS?.m, ORIG_COLS?.f, ORIG_COLS?.h]).catch(() => {});
  process.exit(1);
});
