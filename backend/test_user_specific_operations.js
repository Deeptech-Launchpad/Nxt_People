/* Operations -> Attendance -> User-specific Operations.
 *
 * Four existing endpoints — attendance/my, regularizations/my, on-duty/my,
 * reports/attendance/expected-vs-worked — each learned the same one thing:
 * a full-access caller may pass ?employeeId= to look at somebody else's
 * data. What has to hold is the guard, not the feature: everybody who is
 * NOT full access must keep seeing only their own data even if they pass
 * employeeId, exactly as if they had not passed it at all. A miss here is
 * not a cosmetic bug, it is one employee reading another's attendance.
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

const checks = [];
const check = (l, ok, x) => { checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '\n          ' + JSON.stringify(x).slice(0, 300)}`); };

let base = '';
const get = (path, token) => fetch(base + path, { headers: { Authorization: `Bearer ${token}` } })
  .then(async r => ({ s: r.status, j: await r.json().catch(() => null) }));

(async () => {
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;

  const admin = (await pool.query(
    `SELECT id FROM employees WHERE role IN ('admin','director','hr_admin') AND status='active' AND deleted_at IS NULL LIMIT 1`)).rows[0];
  const targets = (await pool.query(
    `SELECT id, employee_id AS code FROM employees
      WHERE status='active' AND deleted_at IS NULL AND role NOT IN ('admin','director','hr_admin') LIMIT 2`)).rows;
  const teamMember = (await pool.query(
    `SELECT id FROM employees WHERE role='team_member' AND status='active' AND deleted_at IS NULL LIMIT 1`)).rows[0];

  if (!admin || targets.length < 2 || !teamMember) {
    console.log('  not enough employees in this database to test against\n');
    await pool.end(); server.close(); process.exit(0);
  }

  const adminToken = jwt.sign({ id: admin.id }, process.env.JWT_SECRET, { expiresIn: '5m' });
  const memberToken = jwt.sign({ id: teamMember.id }, process.env.JWT_SECRET, { expiresIn: '5m' });
  const [personA, personB] = targets;

  console.log('\n════ attendance/my ════\n');
  {
    const asAdminForA = await get(`/attendance/my?month=0&year=2020&employeeId=${personA.id}`, adminToken);
    check('admin can fetch a named employee\'s month', asAdminForA.s === 200, asAdminForA.s);

    const asMemberSelf = await get(`/attendance/my?month=0&year=2020`, memberToken);
    const asMemberTryingA = await get(`/attendance/my?month=0&year=2020&employeeId=${personA.id}`, memberToken);
    check('a non-full-access caller passing employeeId gets exactly what they get without it — ignored, not honoured',
      asMemberTryingA.s === 200 && JSON.stringify(asMemberTryingA.j) === JSON.stringify(asMemberSelf.j),
      { withParam: asMemberTryingA.j, without: asMemberSelf.j });
  }

  console.log('\n════ regularizations/my ════\n');
  {
    const asAdminForA = await get(`/regularizations/my?employeeId=${personA.id}`, adminToken);
    check('admin can fetch a named employee\'s regularization history', asAdminForA.s === 200, asAdminForA.s);

    const asMemberSelf = await get(`/regularizations/my`, memberToken);
    const asMemberTryingA = await get(`/regularizations/my?employeeId=${personA.id}`, memberToken);
    check('a non-full-access caller cannot use employeeId to read someone else\'s regularizations',
      asMemberTryingA.s === 200 && JSON.stringify(asMemberTryingA.j) === JSON.stringify(asMemberSelf.j),
      { withParam: asMemberTryingA.j, without: asMemberSelf.j });
  }

  console.log('\n════ on-duty/my ════\n');
  {
    const asAdminForA = await get(`/on-duty/my?employeeId=${personA.id}`, adminToken);
    check('admin can fetch a named employee\'s on-duty history', asAdminForA.s === 200, asAdminForA.s);

    const asMemberSelf = await get(`/on-duty/my`, memberToken);
    const asMemberTryingA = await get(`/on-duty/my?employeeId=${personA.id}`, memberToken);
    check('a non-full-access caller cannot use employeeId to read someone else\'s on-duty requests',
      asMemberTryingA.s === 200 && JSON.stringify(asMemberTryingA.j) === JSON.stringify(asMemberSelf.j),
      { withParam: asMemberTryingA.j, without: asMemberSelf.j });
  }

  console.log('\n════ reports/attendance/expected-vs-worked ════\n');
  {
    const start = '2026-01-01', end = '2026-01-31';
    const whole = await get(`/reports/attendance/expected-vs-worked?startDate=${start}&endDate=${end}`, adminToken);
    const narrowed = await get(`/reports/attendance/expected-vs-worked?startDate=${start}&endDate=${end}&employeeId=${personA.id}`, adminToken);
    check('unfiltered still returns every tracked employee, unchanged', whole.s === 200 && whole.j.data.length > 1, whole.j?.data?.length);
    check('narrowed to one employeeId returns exactly that one row',
      narrowed.s === 200 && narrowed.j.data.length === 1 && narrowed.j.data[0]._id === personA.id,
      narrowed.j?.data);
    check('the narrowed row\'s numbers match the same row from the unfiltered call — narrowing does not change the math',
      JSON.stringify(narrowed.j.data[0]) === JSON.stringify(whole.j.data.find(r => r._id === personA.id)),
      { narrowed: narrowed.j.data[0], fromWhole: whole.j.data.find(r => r._id === personA.id) });

    const asMember = await get(`/reports/attendance/expected-vs-worked?startDate=${start}&endDate=${end}&employeeId=${personA.id}`, memberToken);
    check('a team member cannot reach this report at all — role-gated same as before',
      asMember.s === 403, asMember.s);
  }

  server.close();
  await pool.end();
  const failed = checks.filter(c => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed\n`);
  process.exit(failed ? 1 : 0);
})().catch(async e => {
  console.error('\n  failed —', e.message, '\n');
  try { await pool.end(); } catch {}
  process.exit(1);
});
