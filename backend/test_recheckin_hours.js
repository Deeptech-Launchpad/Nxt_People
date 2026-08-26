// Checking out and coming back.
//
// The reported sequence: checked in at 2:02 PM, checked out around 6:21 and
// the day read about 4 hours — correct — then re-checked in and the clock
// jumped to 8:39 worked, before five hours had passed.
//
// check_in stays the day's arrival on a re-check-in, which is right: lateness
// is measured from it and "first in" means the first one. But check-out
// computed the session as `now - check_in` and ADDED it to the hours already
// banked, so the first stretch was charged twice. The live timer did the same
// arithmetic, so the screen and the stored figure agreed with each other and
// both were wrong — which is why it looked like a display glitch.
//
// This drives the real route handlers over a controlled clock rather than
// asserting the arithmetic in isolation: the bug was in which column the
// handler read, and a reimplementation of the sum would have passed.
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'silent';
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
    headers: { Authorization: 'Bearer ' + token,
      ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) } },
    res => { let d = ''; res.on('data', c => d += c);
      res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch {} resolve({ s: res.statusCode, j }); }); });
  req.on('error', () => resolve({ s: 0, j: null }));
  if (data) req.write(data); req.end();
});

let EMP = null;
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const cleanup = async () => {
  if (!EMP) return;
  await pool.query(`DELETE FROM attendance_sessions WHERE employee_id=$1 AND date=$2`,
    [EMP.id, today]).catch(() => {});
  await pool.query(`DELETE FROM attendance WHERE employee_id=$1 AND date=$2::date`,
    [EMP.id, today]).catch(() => {});
};

// Move both punch clocks back, as if the day had started hours ago.
const rewind = (minutes, { sessionOnly = false } = {}) => pool.query(
  sessionOnly
    ? `UPDATE attendance SET session_started_at = session_started_at - ($2 || ' minutes')::interval
        WHERE employee_id=$1 AND date=$3::date`
    : `UPDATE attendance SET check_in = check_in - ($2 || ' minutes')::interval,
              session_started_at = session_started_at - ($2 || ' minutes')::interval
        WHERE employee_id=$1 AND date=$3::date`,
  [EMP.id, String(minutes), today]);

(async () => {
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  PORT = server.address().port;

  EMP = (await pool.query(
    `SELECT id FROM employees WHERE status='active' AND deleted_at IS NULL AND role='admin' LIMIT 1`)).rows[0];
  if (!EMP) { console.log('\n  No employee to test with.\n'); process.exit(1); }
  const token = jwt.sign({ id: EMP.id }, process.env.JWT_SECRET, { expiresIn: '1h' });
  await cleanup();

  console.log('\n════ One stretch: arrive, work four hours, leave ════\n');

  let r = await call('POST', '/attendance/checkin', token, {});
  check('checked in', r.s === 200 || r.s === 201, { s: r.s, m: r.j?.message });

  const row1 = (await pool.query(
    `SELECT check_in, session_started_at FROM attendance WHERE employee_id=$1 AND date=$2::date`,
    [EMP.id, today])).rows[0];
  check('the session starts when the person arrives',
    row1.session_started_at && +row1.session_started_at === +row1.check_in,
    { check_in: row1.check_in, session: row1.session_started_at });

  await rewind(240);                       // four hours ago
  r = await call('POST', '/attendance/checkout', token, {});
  check('checked out', r.s === 200, { s: r.s, m: r.j?.message });
  const afterFirst = Number(r.j?.data?.workingHours);
  check('four hours worked', Math.abs(afterFirst - 4) < 0.05, afterFirst);

  console.log('\n════ Back again, for one more hour ════\n');

  r = await call('POST', '/attendance/checkin', token, {});
  check('re-checked in', r.s === 200 || r.s === 201, { s: r.s, m: r.j?.message });

  /* The check-in RESPONSE has to carry it, not just /today.
   *
   * The browser starts its clock from whatever this returns, and that is a
   * different code path from the one that loads the page. Fixing only the page
   * load left re-check-in still counting from the day's arrival — 34 minutes
   * banked and the clock reading 1:07 the instant they came back. */
  check('the check-in response carries the session start',
    !!r.j?.data?.sessionStartedAt, Object.keys(r.j?.data || {}));
  check('and it is this stretch, not the morning arrival',
    new Date(r.j.data.sessionStartedAt) > new Date(r.j.data.checkIn),
    { checkIn: r.j?.data?.checkIn, session: r.j?.data?.sessionStartedAt });

  const row2 = (await pool.query(
    `SELECT check_in, session_started_at, working_hours FROM attendance
      WHERE employee_id=$1 AND date=$2::date`, [EMP.id, today])).rows[0];
  check('check_in still says when they first arrived',
    +row2.check_in === +row1.check_in - 240 * 60000,
    { first: row1.check_in, now: row2.check_in });
  check('but the session clock has moved to now',
    +row2.session_started_at > +row2.check_in,
    { check_in: row2.check_in, session: row2.session_started_at });
  check('and the four hours already worked are still banked',
    Math.abs(Number(row2.working_hours) - 4) < 0.05, row2.working_hours);

  await rewind(60, { sessionOnly: true }); // one hour into the second stretch
  r = await call('POST', '/attendance/checkout', token, {});
  check('checked out again', r.s === 200, { s: r.s, m: r.j?.message });

  const total = Number(r.j?.data?.workingHours);
  // The bug: 4 banked + (now − check_in ≈ 5) = 9, not 5.
  check('the day is five hours, not nine', Math.abs(total - 5) < 0.05, total);
  check('the first stretch was NOT charged twice', total < 8, total);

  console.log('\n════ A third stretch keeps adding correctly ════\n');

  await call('POST', '/attendance/checkin', token, {});
  await rewind(30, { sessionOnly: true });
  r = await call('POST', '/attendance/checkout', token, {});
  check('five and a half hours after another half hour',
    Math.abs(Number(r.j?.data?.workingHours) - 5.5) < 0.05, r.j?.data?.workingHours);

  console.log('\n════ What the browser clock is given ════\n');

  await call('POST', '/attendance/checkin', token, {});
  r = await call('GET', '/attendance/today', token);
  check('today carries the session start, so the timer can count from it',
    !!r.j?.data?.sessionStartedAt, Object.keys(r.j?.data || {}));
  check('and it is later than the arrival, on a day with more than one stretch',
    new Date(r.j.data.sessionStartedAt) > new Date(r.j.data.checkIn),
    { checkIn: r.j.data.checkIn, session: r.j.data.sessionStartedAt });

  await cleanup();
  server.close();
  const failed = checks.filter(c => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed\n`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch(async e => { console.error(e); await cleanup().catch(() => {}); process.exit(1); });
