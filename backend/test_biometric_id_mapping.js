/* Operations -> Attendance -> Biometric ID mapping.
 *
 * A record, not a workflow: employee <-> device user ID, one each. What has
 * to hold is what the frontend leans on to explain a failure rather than show
 * a raw constraint error — a person or a device ID already in use is refused
 * with which one and why, and the row it produces is real ($id from the
 * insert, not guessed).
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
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '\n          ' + JSON.stringify(x).slice(0, 300)}`); };

let PORT = 0;
const call = (method, p, token, body) => new Promise(resolve => {
  const data = body === undefined ? null : JSON.stringify(body);
  const req = http.request({ host: '127.0.0.1', port: PORT, path: '/api' + p, method,
    headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) } },
    res => { let d = ''; res.on('data', c => d += c);
      res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch {} resolve({ s: res.statusCode, j }); }); });
  req.on('error', e => resolve({ s: 0, j: null, err: e.message }));
  if (data) req.write(data); req.end();
});

const created = [];

(async () => {
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  PORT = server.address().port;

  const admin = (await pool.query(
    `SELECT id FROM employees WHERE role IN ('admin','director','hr_admin') AND status='active' AND deleted_at IS NULL LIMIT 1`)).rows[0];
  const staff = (await pool.query(
    `SELECT id, employee_id AS code FROM employees
      WHERE status='active' AND deleted_at IS NULL AND role NOT IN ('admin','director','hr_admin')
      ORDER BY created_at DESC LIMIT 2`)).rows;
  const nonFullAccess = (await pool.query(
    `SELECT id FROM employees WHERE role='team_member' AND status='active' AND deleted_at IS NULL LIMIT 1`)).rows[0];

  if (!admin || staff.length < 2) {
    console.log('  not enough employees in this database to test against\n');
    await pool.end(); server.close(); process.exit(0);
  }

  const adminToken = jwt.sign({ id: admin.id }, process.env.JWT_SECRET, { expiresIn: '5m' });
  const memberToken = nonFullAccess
    ? jwt.sign({ id: nonFullAccess.id }, process.env.JWT_SECRET, { expiresIn: '5m' }) : null;

  console.log('\n════ Creating a mapping ════\n');

  const r1 = await call('POST', '/biometric-id-mapping', adminToken,
    { employeeId: staff[0].id, biometricId: '__test_bio_1__' });
  check('creates successfully', r1.s === 201 && !!r1.j?.data?._id, r1);
  if (r1.j?.data?._id) created.push(r1.j.data._id);

  const r2 = await call('GET', '/biometric-id-mapping', adminToken);
  check('shows up in the list, with the employee joined in',
    r2.s === 200 && r2.j.data.some(m => m.employeeId === staff[0].id && m.biometricId === '__test_bio_1__'),
    r2.j?.data);

  console.log('\n════ Both sides are unique ════\n');

  const dupEmployee = await call('POST', '/biometric-id-mapping', adminToken,
    { employeeId: staff[0].id, biometricId: '__test_bio_2__' });
  check('the same employee cannot be mapped twice',
    dupEmployee.s === 400 && /already has a biometric ID/.test(dupEmployee.j?.message || ''), dupEmployee);

  const dupDevice = await call('POST', '/biometric-id-mapping', adminToken,
    { employeeId: staff[1].id, biometricId: '__test_bio_1__' });
  check('the same device ID cannot be mapped to a second employee',
    dupDevice.s === 400 && /already mapped to another employee/.test(dupDevice.j?.message || ''), dupDevice);

  console.log('\n════ Validation ════\n');

  const noEmp = await call('POST', '/biometric-id-mapping', adminToken, { biometricId: 'x' });
  check('an employee is required', noEmp.s === 400, noEmp);

  const noId = await call('POST', '/biometric-id-mapping', adminToken, { employeeId: staff[1].id });
  check('a biometric ID is required', noId.s === 400, noId);

  const blankId = await call('POST', '/biometric-id-mapping', adminToken, { employeeId: staff[1].id, biometricId: '   ' });
  check('whitespace-only is treated as missing, not a real ID', blankId.s === 400, blankId);

  const fakeEmp = await call('POST', '/biometric-id-mapping', adminToken,
    { employeeId: '00000000-0000-0000-0000-000000000000', biometricId: '__test_bio_3__' });
  check('an employee that does not exist is refused, not silently inserted',
    fakeEmp.s === 404, fakeEmp);

  console.log('\n════ Access ════\n');

  if (memberToken) {
    const asMember = await call('GET', '/biometric-id-mapping', memberToken);
    check('a team member cannot list the mappings — full access only',
      asMember.s === 403, asMember);
  } else {
    console.log('  skipped — no non-full-access employee to test with');
  }

  const noAuth = await call('GET', '/biometric-id-mapping', null);
  check('no token at all is refused', noAuth.s === 401, noAuth);

  console.log('\n════ Removing a mapping ════\n');

  const del = await call('DELETE', `/biometric-id-mapping/${r1.j.data._id}`, adminToken);
  check('deletes cleanly', del.s === 200, del);
  created.splice(created.indexOf(r1.j.data._id), 1);

  const gone = await call('GET', '/biometric-id-mapping', adminToken);
  check('and is gone from the list', !gone.j.data.some(m => m._id === r1.j.data._id), gone.j?.data);

  const delAgain = await call('DELETE', `/biometric-id-mapping/${r1.j.data._id}`, adminToken);
  check('deleting an already-gone mapping is a 404, not a silent success',
    delAgain.s === 404, delAgain);

  const reuse = await call('POST', '/biometric-id-mapping', adminToken,
    { employeeId: staff[1].id, biometricId: '__test_bio_1__' });
  check('the freed device ID can now be reused by someone else',
    reuse.s === 201, reuse);
  if (reuse.j?.data?._id) created.push(reuse.j.data._id);

  for (const id of created) { try { await pool.query('DELETE FROM biometric_id_mappings WHERE id = $1', [id]); } catch {} }

  server.close();
  await pool.end();
  const failed = checks.filter(c => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed\n`);
  process.exit(failed ? 1 : 0);
})().catch(async e => {
  console.error('\n  failed —', e.message, '\n');
  for (const id of created) { try { await pool.query('DELETE FROM biometric_id_mappings WHERE id = $1', [id]); } catch {} }
  try { await pool.end(); } catch {}
  process.exit(1);
});
