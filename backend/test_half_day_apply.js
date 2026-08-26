// Applying for half a day.
//
// The Dashboard's Apply Leave form had no half-day option at all, so somebody
// needing a morning off had to book a whole day and lose it. The shared modal
// had a checkbox but never asked WHICH half — and half_day_type is not
// decoration: the muster roll renders the other half of the day from it, so
// every half day applied for there was recorded as a morning whether or not it
// was one.
//
// This drives the real endpoint, because the forms were fixed by sending two
// more fields and the only thing worth proving is that the server stores them
// and charges half a day for them.
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

/* Thirty days out, not a far-future year: leave cannot be requested more than
 * a year in advance, and a 2097 date was rejected by that rule — so the whole
 * suite passed vacuously against rows that were never created. */
const iso = (d) => d.toISOString().slice(0, 10);
const soon = new Date(Date.now() + 30 * 86400000);
const DAY = iso(soon);
const DAY2 = iso(new Date(soon.getTime() + 86400000));
let EMP = null;
const cleanup = async () => EMP && pool.query(
  `DELETE FROM leaves WHERE employee_id=$1 AND start_date IN ($2::date, $3::date)
     AND reason LIKE '%test'`, [EMP.id, DAY, DAY2]).catch(() => {});

(async () => {
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  PORT = server.address().port;

  EMP = (await pool.query(
    `SELECT id FROM employees WHERE status='active' AND deleted_at IS NULL AND role='admin' LIMIT 1`)).rows[0];
  if (!EMP) { console.log('\n  No employee to test with.\n'); process.exit(1); }
  const token = jwt.sign({ id: EMP.id }, process.env.JWT_SECRET, { expiresIn: '1h' });
  await cleanup();

  console.log('\n════ A second-half casual leave ════\n');

  let r = await call('POST', '/leaves', token, {
    leaveType: 'casual', startDate: DAY, endDate: DAY, reason: 'half day test',
    isHalfDay: true, halfDayType: 'second_half',
  });
  check('the request is accepted', r.s === 200 || r.s === 201, { s: r.s, m: r.j?.message });

  const row = (await pool.query(
    `SELECT is_half_day, half_day_type, total_days FROM leaves
      WHERE employee_id=$1 AND start_date=$2::date`, [EMP.id, DAY])).rows[0];
  check('it is stored as a half day', row?.is_half_day === true, row);
  check('and as the SECOND half, which is what was asked for',
    row?.half_day_type === 'second_half', row);
  // The failure this guards: a session dropped on the way in reads as a
  // morning, and the muster roll then shows the wrong half of the day worked.
  check('not silently turned into a first half',
    !!row && row.half_day_type !== 'first_half', row);
  check('half a day is charged, not a whole one',
    Math.abs(Number(row?.total_days) - 0.5) < 0.001, row?.total_days);

  console.log('\n════ A first-half one ════\n');

  await cleanup();
  r = await call('POST', '/leaves', token, {
    leaveType: 'casual', startDate: DAY, endDate: DAY, reason: 'half day test',
    isHalfDay: true, halfDayType: 'first_half',
  });
  const first = (await pool.query(
    `SELECT is_half_day, half_day_type FROM leaves WHERE employee_id=$1 AND start_date=$2::date`,
    [EMP.id, DAY])).rows[0];
  check('stored as a first half', first?.half_day_type === 'first_half', first);

  console.log('\n════ A whole day carries no session ════\n');

  await cleanup();
  r = await call('POST', '/leaves', token, {
    leaveType: 'casual', startDate: DAY, endDate: DAY, reason: 'full day test',
    isHalfDay: false, halfDayType: null,
  });
  check('a full day is accepted', r.s === 200 || r.s === 201, { s: r.s, m: r.j?.message });
  const full = (await pool.query(
    `SELECT is_half_day, half_day_type, total_days FROM leaves
      WHERE employee_id=$1 AND start_date=$2::date`, [EMP.id, DAY])).rows[0];
  check('it is not a half day', !!full && full.is_half_day !== true, full);
  check('and carries no half-day session', !!full && !full.half_day_type, full);

  console.log('\n════ A range is not half of anything ════\n');

  await cleanup();
  r = await call('POST', '/leaves', token, {
    leaveType: 'casual', startDate: DAY, endDate: DAY2, reason: 'range test',
    isHalfDay: false, halfDayType: null,
  });
  check('a two-day request is accepted', r.s === 200 || r.s === 201, { s: r.s, m: r.j?.message });
  const range = (await pool.query(
    `SELECT is_half_day, total_days FROM leaves WHERE employee_id=$1 AND start_date=$2::date`,
    [EMP.id, DAY])).rows[0];
  check('and is a whole number of days', !!range && range.is_half_day !== true, range);

  console.log('\n════ The value the reports read ════\n');

  await cleanup();
  await call('POST', '/leaves', token, {
    leaveType: 'casual', startDate: DAY, endDate: DAY, reason: 'portion test',
    isHalfDay: true, halfDayType: 'second_half',
  });
  await pool.query(`UPDATE leaves SET status='approved' WHERE employee_id=$1 AND start_date=$2::date`,
    [EMP.id, DAY]);
  const portion = (await pool.query(
    `SELECT COALESCE((SELECT MAX(CASE WHEN l.is_half_day THEN 0.5 ELSE 1 END)
        FROM leaves l WHERE l.employee_id=$1 AND l.status='approved'
          AND l.leave_type <> 'permission' AND $2::date BETWEEN l.start_date AND l.end_date), 0) AS p`,
    [EMP.id, DAY])).rows[0].p;
  check('the day reads as half taken, not whole', Number(portion) === 0.5, portion);

  await cleanup();
  server.close();
  const failed = checks.filter(c => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed\n`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch(async e => { console.error(e); await cleanup().catch(() => {}); process.exit(1); });
