/* A check-out that is not after the check-in.
 *
 * Found on live: two approved regularizations reading 09:30 to 06:00 and
 * 10:21 to 03:30. Somebody meant 6 PM and typed 6. Nothing refused it; the
 * approval's `if (diffMs > 0)` branch simply did not fire, so working_hours
 * stayed null and the day was stamped PRESENT WITH ZERO HOURS.
 *
 * That is the worst shape a bug can take here. The employee is told their day
 * was corrected, the approver sees it approved, and the hours never arrive —
 * silently, on a screen nobody re-reads. It is also exactly the mechanism
 * behind payable hours coming out short against the reference.
 *
 * Two guards, and this pins both:
 *   1. Submission refuses it, and says what the person probably meant.
 *   2. Approving one that already exists refuses too, rather than writing a
 *      worked day worth nothing.
 * And the one case where an earlier clock time is legitimate — a shift that
 * runs through midnight — still works.
 */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'silent';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('this test does not send mail'); },
  verify: async () => { throw new Error('this test does not send mail'); },
});

const app = require('./app');
const pool = require('./db');
const jwt = require('jsonwebtoken');
const http = require('http');

const checks = [];
const check = (l, ok, x) => { checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '\n          ' + JSON.stringify(x).slice(0, 280)}`); };

let PORT = 0;
const call = (method, p, token, body) => new Promise(resolve => {
  const data = body === undefined ? null : JSON.stringify(body);
  const req = http.request({ host: '127.0.0.1', port: PORT, path: '/api' + p, method,
    headers: { Authorization: 'Bearer ' + token,
      ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) } },
    res => { let d = ''; res.on('data', c => d += c);
      res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch {} resolve({ s: res.statusCode, j }); }); });
  req.on('error', e => resolve({ s: 0, j: null, err: e.message }));
  if (data) req.write(data); req.end();
});

const TAG = 'IR' + Date.now().toString().slice(-6);
let DAY = null, NIGHT = null, NIGHT_SHIFT = null;

const cleanup = async () => {
  for (const id of [DAY, NIGHT]) {
    if (!id) continue;
    await pool.query(`DELETE FROM approval_levels WHERE request_id IN
      (SELECT id FROM attendance_regularizations WHERE employee_id=$1)`, [id]).catch(() => {});
    await pool.query(`DELETE FROM attendance_regularizations WHERE employee_id=$1`, [id]).catch(() => {});
    await pool.query(`DELETE FROM attendance WHERE employee_id=$1`, [id]).catch(() => {});
    await pool.query(`DELETE FROM employees WHERE id=$1`, [id]).catch(() => {});
  }
  if (NIGHT_SHIFT) await pool.query(`DELETE FROM shifts WHERE id=$1`, [NIGHT_SHIFT]).catch(() => {});
};

const yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toLocaleDateString('en-CA'); };

(async () => {
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  PORT = server.address().port;

  const admin = (await pool.query(
    `SELECT id FROM employees WHERE role IN ('admin','director','hr_admin')
       AND status='active' AND deleted_at IS NULL LIMIT 1`)).rows[0];
  if (!admin) { console.log('  need a full-access user\n'); await pool.end(); server.close(); process.exit(0); }
  const adminToken = jwt.sign({ id: admin.id }, process.env.JWT_SECRET, { expiresIn: '10m' });

  const dayShift = (await pool.query(
    `SELECT id FROM shifts ORDER BY is_default DESC NULLS LAST LIMIT 1`)).rows[0];
  NIGHT_SHIFT = (await pool.query(
    `INSERT INTO shifts (name, start_time, end_time) VALUES ($1,'22:00','06:00') RETURNING id`,
    [TAG + ' Night'])).rows[0].id;

  DAY = (await pool.query(
    `INSERT INTO employees (employee_id, first_name, last_name, email, role, status, is_user, login_enabled, shift_id)
     VALUES ($1,'Inv','DayShift',$2,'team_member','active',TRUE,TRUE,$3) RETURNING id`,
    [TAG + '-DAY', `${TAG.toLowerCase()}day@example.invalid`, dayShift?.id || null])).rows[0].id;
  NIGHT = (await pool.query(
    `INSERT INTO employees (employee_id, first_name, last_name, email, role, status, is_user, login_enabled, shift_id)
     VALUES ($1,'Inv','NightShift',$2,'team_member','active',TRUE,TRUE,$3) RETURNING id`,
    [TAG + '-NIGHT', `${TAG.toLowerCase()}night@example.invalid`, NIGHT_SHIFT])).rows[0].id;

  console.log('\nA check-out at or before the check-in\n');

  /* 1 — the live shape: 09:30 to 06:00 on a day shift. */
  {
    const r = await call('POST', '/regularizations', adminToken, {
      date: yesterday(), checkIn: '09:30', checkOut: '06:00',
      reason: 'Forgot to check-out', employeeId: DAY,
    });
    check('a 6 PM typed as 06:00 is refused', r.s === 400, { status: r.s, message: r.j?.message });
    check('  ...and the message says what was probably meant',
      /18:00/.test(r.j?.message || ''), r.j?.message);

    const rows = await pool.query(
      `SELECT 1 FROM attendance_regularizations WHERE employee_id=$1`, [DAY]);
    check('  ...and nothing was filed', rows.rows.length === 0, rows.rows.length);
  }

  /* 2 — equal times are not a day's work either. */
  {
    const r = await call('POST', '/regularizations', adminToken, {
      date: yesterday(), checkIn: '09:30', checkOut: '09:30',
      reason: 'Forgot to check-out', employeeId: DAY,
    });
    check('a check-out equal to the check-in is refused', r.s === 400, { status: r.s, message: r.j?.message });
  }

  /* 3 — a real correction still goes through untouched. */
  {
    const r = await call('POST', '/regularizations', adminToken, {
      date: yesterday(), checkIn: '09:30', checkOut: '18:00',
      reason: 'Forgot to check-out', employeeId: DAY,
    });
    check('an ordinary correction is still accepted', r.s === 201, { status: r.s, message: r.j?.message });
    await pool.query(`DELETE FROM approval_levels WHERE request_id IN
      (SELECT id FROM attendance_regularizations WHERE employee_id=$1)`, [DAY]).catch(() => {});
    await pool.query(`DELETE FROM attendance_regularizations WHERE employee_id=$1`, [DAY]);
  }

  /* 4 — and a night shift, where an earlier clock time is the whole point. */
  {
    const r = await call('POST', '/regularizations', adminToken, {
      date: yesterday(), checkIn: '22:00', checkOut: '06:00',
      reason: 'Forgot to check-out', employeeId: NIGHT,
    });
    check('a night shift may still end at an earlier clock time', r.s === 201, { status: r.s, message: r.j?.message });
  }

  /* 5 — THE ONE THAT MATTERS: approving a row that already looks like this
     must not write a worked day worth nothing. */
  {
    const bad = (await pool.query(
      `INSERT INTO attendance_regularizations (employee_id, date, check_in, check_out, reason, status)
       VALUES ($1, $2::date, '09:30', '06:00', 'System Error', 'pending') RETURNING id`,
      [DAY, yesterday()])).rows[0].id;

    const r = await call('PUT', `/regularizations/${bad}/action`, adminToken, { action: 'approved' });
    check('approving an inverted request is refused', r.s === 400, { status: r.s, message: r.j?.message });

    const day = await pool.query(
      `SELECT working_hours AS hours, status FROM attendance WHERE employee_id=$1 AND date=$2::date`,
      [DAY, yesterday()]);
    check('  ...and no day was stamped present with zero hours',
      day.rows.length === 0 || Number(day.rows[0].hours) > 0,
      day.rows[0]);

    const still = await pool.query(
      `SELECT status FROM attendance_regularizations WHERE id=$1`, [bad]);
    check('  ...and the request is still pending, not silently approved',
      still.rows[0]?.status === 'pending', still.rows[0]);
  }

  await cleanup();
  const passed = checks.filter(Boolean).length;
  console.log(`\n  ${passed}/${checks.length} passed\n`);
  await pool.end(); server.close();
  process.exit(passed === checks.length ? 0 : 1);
})().catch(async e => {
  console.error(e);
  await cleanup();
  await pool.end().catch(() => {});
  process.exit(1);
});
