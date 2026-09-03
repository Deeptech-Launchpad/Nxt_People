/* Raising a request FOR somebody else, from User-specific Operations.
 *
 * The dangerous case is not "can HR create a row" — it is WHOSE row, and
 * whose approval chain. Two ways to get it wrong, both silent:
 *
 *   1. The row lands on the ADMIN. HR presses Request while looking at an
 *      employee and quietly regularizes their own day instead.
 *   2. The row lands on the employee but the approval chain is built from the
 *      ADMIN's hierarchy, so it routes to the admin's manager. Nobody sees an
 *      error; the wrong person is simply asked to approve, and the employee's
 *      real manager never hears about it.
 *
 * Both are checked against the database rather than the response, and the
 * ordinary self-service path is checked to be unchanged — an employee must
 * not be able to raise a request against a colleague by adding a field.
 *
 * No mail: the transport is stubbed to throw, so a notification attempt fails
 * loudly here rather than reaching anybody.
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
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '\n          ' + JSON.stringify(x).slice(0, 260)}`); };

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

const TAG = 'OB' + Date.now().toString().slice(-6);
let SUBJECT = null, MANAGER = null;

const cleanup = async () => {
  for (const id of [SUBJECT, MANAGER]) {
    if (!id) continue;
    await pool.query(`DELETE FROM approval_levels WHERE request_id IN
       (SELECT id FROM attendance_regularizations WHERE employee_id=$1
        UNION SELECT id FROM on_duty_requests WHERE employee_id=$1)`, [id]).catch(() => {});
    await pool.query(`DELETE FROM attendance_regularizations WHERE employee_id=$1`, [id]).catch(() => {});
    await pool.query(`DELETE FROM on_duty_requests WHERE employee_id=$1`, [id]).catch(() => {});
  }
  if (SUBJECT) await pool.query(`DELETE FROM employees WHERE id=$1`, [SUBJECT]).catch(() => {});
  if (MANAGER) await pool.query(`DELETE FROM employees WHERE id=$1`, [MANAGER]).catch(() => {});
};

const yesterday = () => {
  const d = new Date(); d.setDate(d.getDate() - 1);
  return d.toLocaleDateString('en-CA');
};

(async () => {
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  PORT = server.address().port;

  const admin = (await pool.query(
    `SELECT id FROM employees WHERE role IN ('admin','director','hr_admin')
       AND status='active' AND deleted_at IS NULL LIMIT 1`)).rows[0];
  if (!admin) { console.log('  need a full-access user\n'); await pool.end(); server.close(); process.exit(0); }
  const adminToken = jwt.sign({ id: admin.id }, process.env.JWT_SECRET, { expiresIn: '10m' });

  /* A manager, and an employee who reports to them. The chain has to come
   * from HERE, not from whoever presses the button. */
  MANAGER = (await pool.query(
    `INSERT INTO employees (employee_id, first_name, last_name, email, role, status, is_user, login_enabled)
     VALUES ($1,'ObTest','Manager',$2,'manager','active',TRUE,TRUE) RETURNING id`,
    [TAG + '-MGR', `${TAG.toLowerCase()}mgr@example.invalid`])).rows[0].id;
  SUBJECT = (await pool.query(
    `INSERT INTO employees (employee_id, first_name, last_name, email, role, status, is_user, login_enabled, reporting_manager_id)
     VALUES ($1,'ObTest','Subject',$2,'team_member','active',TRUE,TRUE,$3) RETURNING id`,
    [TAG + '-EMP', `${TAG.toLowerCase()}emp@example.invalid`, MANAGER])).rows[0].id;
  const subjectToken = jwt.sign({ id: SUBJECT }, process.env.JWT_SECRET, { expiresIn: '10m' });

  console.log('\nRaising a request on behalf of an employee\n');

  /* 1 — an ordinary employee cannot aim a request at somebody else. */
  {
    const r = await call('POST', '/regularizations', subjectToken, {
      date: yesterday(), checkIn: '09:30', checkOut: '18:00',
      reason: 'Forgot to check-out', employeeId: MANAGER,
    });
    const landed = await pool.query(
      `SELECT employee_id FROM attendance_regularizations WHERE employee_id=$1`, [MANAGER]);
    check('an employee naming somebody else is ignored, not obeyed',
      landed.rows.length === 0, { status: r.s, rowsOnOther: landed.rows.length });

    const own = await pool.query(
      `SELECT id FROM attendance_regularizations WHERE employee_id=$1`, [SUBJECT]);
    check('  ...the request is filed against themselves instead',
      r.s === 201 || own.rows.length === 1, { status: r.s, message: r.j?.message, own: own.rows.length });
    await pool.query(`DELETE FROM approval_levels WHERE request_id = ANY($1::uuid[])`,
      [own.rows.map(x => x.id)]).catch(() => {});
    await pool.query(`DELETE FROM attendance_regularizations WHERE employee_id=$1`, [SUBJECT]);
  }

  /* 2 — full access raises for the subject, and it belongs to the subject. */
  let regId = null;
  {
    const r = await call('POST', '/regularizations', adminToken, {
      date: yesterday(), checkIn: '09:30', checkOut: '18:00',
      reason: 'Forgot to check-out', employeeId: SUBJECT,
    });
    check('full access can raise one for an employee', r.s === 201, { status: r.s, message: r.j?.message });

    const row = (await pool.query(
      `SELECT id, employee_id FROM attendance_regularizations WHERE employee_id=$1`, [SUBJECT])).rows[0];
    check('  ...and it is filed against the EMPLOYEE, not the administrator',
      !!row && String(row.employee_id) === String(SUBJECT), row);
    regId = row?.id;

    const onAdmin = await pool.query(
      `SELECT 1 FROM attendance_regularizations WHERE employee_id=$1 AND date=$2::date`,
      [admin.id, yesterday()]);
    check('  ...and nothing was filed against the administrator',
      onAdmin.rows.length === 0, onAdmin.rows.length);
  }

  /* 3 — THE ONE THAT MATTERS: whose approvers were asked. */
  {
    const levels = (await pool.query(
      `SELECT approver_id AS "approverId", level FROM approval_levels
        WHERE request_type='regularization' AND request_id=$1 ORDER BY level`, [regId])).rows;
    check('the request has an approval chain', levels.length > 0, levels.length);

    const approvers = levels.map(l => String(l.approverId));
    check("  ...built from the EMPLOYEE's hierarchy",
      approvers.includes(String(MANAGER)), { approvers, wanted: String(MANAGER) });
    check('  ...and not routed to the administrator who raised it',
      !approvers.includes(String(admin.id)), { approvers, admin: String(admin.id) });
  }

  /* 4 — the same for on duty. */
  {
    const r = await call('POST', '/on-duty', adminToken, {
      startDate: yesterday(), endDate: yesterday(), unit: 'days',
      requestType: 'client_visit', reason: 'Client visit', employeeId: SUBJECT,
    });
    check('an on-duty request can be raised for an employee', r.s === 201, { status: r.s, message: r.j?.message });

    const row = (await pool.query(
      `SELECT id, employee_id FROM on_duty_requests WHERE employee_id=$1`, [SUBJECT])).rows[0];
    check('  ...filed against the employee', !!row && String(row.employee_id) === String(SUBJECT), row);

    if (row) {
      const approvers = (await pool.query(
        `SELECT approver_id AS "approverId" FROM approval_levels
          WHERE request_type='on_duty' AND request_id=$1`, [row.id])).rows.map(x => String(x.approverId));
      check("  ...through the employee's approvers, not the administrator's",
        approvers.includes(String(MANAGER)) && !approvers.includes(String(admin.id)), approvers);
    }
  }

  /* 5 — an employee who no longer exists is refused rather than orphaned. */
  {
    const r = await call('POST', '/regularizations', adminToken, {
      date: yesterday(), checkIn: '09:30', checkOut: '18:00', reason: 'Forgot to check-out',
      employeeId: '00000000-0000-0000-0000-000000000000',
    });
    check('an unknown employee is refused', r.s === 404, { status: r.s, message: r.j?.message });
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
