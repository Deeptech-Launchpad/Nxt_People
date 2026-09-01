/* Operations -> Leave Tracker: Delete on somebody else's leave.
 *
 * The reference offers Delete freely from the admin door, so ours does too,
 * but a delete here moves a leave balance and the two ways it can go wrong are
 * silent:
 *
 *   1. Anyone who is not full access reaching another person's leave at all.
 *      The route was scoped `WHERE id=$1 AND employee_id=$2`; opening it for
 *      admins must not open it for everybody.
 *   2. The refund landing on the ACTOR instead of the leave's owner. Nothing
 *      errors — the employee simply never gets their days back and whoever
 *      pressed the button quietly gains them.
 *
 * Both are proved against real balance rows, before and after. The same second
 * failure is proved for the reject path in PUT /:id/action, which credited
 * req.user._id — the approver — for every rejection it has ever handled.
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

const madeLeaves = [];
const madeBalances = [];
const YEAR = new Date().getFullYear();

// Dated inside the current pay period so the cancellation matrix cannot be the
// thing that refuses — the access scope is what is under test.
const soon = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };

const balanceOf = async (empId, ltId) => {
  const r = await pool.query(
    `SELECT available FROM leave_balances WHERE employee_id=$1 AND leave_type_id=$2 AND year=$3`,
    [empId, ltId, YEAR]);
  return r.rows[0] ? parseFloat(r.rows[0].available) : null;
};

// A balance row is only created if the person has none, and only those are
// removed at the end — an existing row is restored to the value it had.
const ensureBalance = async (empId, ltId, value) => {
  const existing = await pool.query(
    `SELECT available FROM leave_balances WHERE employee_id=$1 AND leave_type_id=$2 AND year=$3`,
    [empId, ltId, YEAR]);
  if (existing.rows.length) {
    madeBalances.push({ empId, ltId, restore: existing.rows[0].available });
    await pool.query(
      `UPDATE leave_balances SET available=$1 WHERE employee_id=$2 AND leave_type_id=$3 AND year=$4`,
      [value, empId, ltId, YEAR]);
  } else {
    madeBalances.push({ empId, ltId, restore: null });
    await pool.query(
      `INSERT INTO leave_balances (employee_id, leave_type_id, year, available, booked)
       VALUES ($1,$2,$3,$4,0)`, [empId, ltId, YEAR, value]);
  }
};

const makeLeave = async (empId, status) => {
  const r = await pool.query(
    `INSERT INTO leaves (employee_id, leave_type, start_date, end_date, total_days, reason, status, balance_source)
     VALUES ($1,'casual',$2,$3,1,'admin delete test',$4,'leave_balances') RETURNING id`,
    [empId, soon(6), soon(6), status]);
  madeLeaves.push(r.rows[0].id);
  return r.rows[0].id;
};

(async () => {
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  PORT = server.address().port;

  const admin = (await pool.query(
    `SELECT id FROM employees WHERE role IN ('admin','director','hr_admin')
       AND status='active' AND deleted_at IS NULL LIMIT 1`)).rows[0];
  const staff = (await pool.query(
    `SELECT id FROM employees WHERE role='team_member' AND status='active' AND deleted_at IS NULL
      ORDER BY created_at DESC LIMIT 2`)).rows;
  const lt = (await pool.query(`SELECT id FROM leave_types WHERE code='casual' LIMIT 1`)).rows[0];

  if (!admin || staff.length < 2 || !lt) {
    console.log('  not enough employees / no casual leave type in this database\n');
    await pool.end(); server.close(); process.exit(0);
  }

  const OWNER = staff[0].id;      // the leave belongs to this person
  const OUTSIDER = staff[1].id;   // another team member, no elevated role
  const adminToken    = jwt.sign({ id: admin.id },  process.env.JWT_SECRET, { expiresIn: '5m' });
  const outsiderToken = jwt.sign({ id: OUTSIDER },  process.env.JWT_SECRET, { expiresIn: '5m' });

  console.log('\nOperations — admin Delete on another employee\'s leave\n');

  await ensureBalance(OWNER, lt.id, 5);
  await ensureBalance(admin.id, lt.id, 5);
  await ensureBalance(OUTSIDER, lt.id, 5);

  /* 1 — the dangerous case: a team member must not reach it at all. */
  {
    const id = await makeLeave(OWNER, 'approved');
    const ownerBefore = await balanceOf(OWNER, lt.id);
    const res = await call('DELETE', `/leaves/${id}`, outsiderToken, { reason: 'x' });
    check('team member deleting another employee\'s leave is refused', res.s === 404 || res.s === 403, res);

    const row = await pool.query(`SELECT status FROM leaves WHERE id=$1`, [id]);
    check('  ...and the leave is untouched', row.rows[0].status === 'approved', row.rows[0]);
    check('  ...and no balance moved', (await balanceOf(OWNER, lt.id)) === ownerBefore);
  }

  /* 2 — full access may delete it, and the refund lands on the OWNER. */
  {
    const id = await makeLeave(OWNER, 'approved');
    const ownerBefore = await balanceOf(OWNER, lt.id);
    const adminBefore = await balanceOf(admin.id, lt.id);

    const res = await call('DELETE', `/leaves/${id}`, adminToken, { reason: 'admin correction' });
    check('admin deletes another employee\'s approved leave', res.s === 200, res);

    const ownerAfter = await balanceOf(OWNER, lt.id);
    const adminAfter = await balanceOf(admin.id, lt.id);
    check('  ...the OWNER is refunded the day', ownerAfter === ownerBefore + 1, { ownerBefore, ownerAfter });
    check('  ...the acting admin gains nothing', adminAfter === adminBefore, { adminBefore, adminAfter });

    const row = await pool.query(`SELECT status, cancelled_by FROM leaves WHERE id=$1`, [id]);
    check('  ...the leave is cancelled and records who did it',
      row.rows[0].status === 'cancelled' && String(row.rows[0].cancelled_by) === String(admin.id), row.rows[0]);
  }

  /* 3 — a pending leave refunds from leave_balances too, to the owner. */
  {
    const id = await makeLeave(OWNER, 'pending');
    const ownerBefore = await balanceOf(OWNER, lt.id);
    const adminBefore = await balanceOf(admin.id, lt.id);
    const res = await call('DELETE', `/leaves/${id}`, adminToken, { reason: 'admin correction' });
    check('admin deletes another employee\'s PENDING leave', res.s === 200, res);
    check('  ...the OWNER is refunded', (await balanceOf(OWNER, lt.id)) === ownerBefore + 1);
    check('  ...the acting admin gains nothing', (await balanceOf(admin.id, lt.id)) === adminBefore);
  }

  /* 4 — the override is scoped to OTHER people. An admin deleting their own
   *     leave still goes through the cancellation matrix exactly as before,
   *     so nothing about the self-service path moved. */
  {
    const id = await makeLeave(admin.id, 'approved');
    // The SAME config loader the route uses — reading settings by hand gave a
    // different (stricter) matrix than the route saw, which looked like a
    // route bug and was not.
    const { canCancel, loadConfig } = require('./utils/leaveCancellation');
    const leave = (await pool.query(
      `SELECT id, employee_id, leave_type, start_date, end_date FROM leaves WHERE id=$1`, [id])).rows[0];
    const verdict = await canCancel({
      user: { _id: admin.id, role: 'admin' }, leave, config: await loadConfig(),
    });
    const res = await call('DELETE', `/leaves/${id}`, adminToken, { reason: 'own leave' });
    // Whatever the matrix says, the route must AGREE with it for one's own
    // leave — that is what "the override does not touch self-service" means.
    check('admin\'s own leave still obeys the cancellation matrix',
      verdict.allowed ? res.s === 200 : res.s === 403, { matrixAllows: verdict.allowed, status: res.s, body: res.j });
  }

  /* 5 — the same wrong-owner refund on the reject path. This route is
   *     approver-only, so req.user._id is never the employee; crediting it
   *     refunds the approver and leaves the employee short. */
  {
    const id = await makeLeave(OWNER, 'pending');
    const ownerBefore = await balanceOf(OWNER, lt.id);
    const adminBefore = await balanceOf(admin.id, lt.id);
    const res = await call('PUT', `/leaves/${id}/action`, adminToken, { action: 'rejected', rejectionReason: 'test' });
    check('admin rejects a pending leave', res.s === 200, res);
    if (res.s === 200) {
      check('  ...the EMPLOYEE is refunded, not the approver',
        (await balanceOf(OWNER, lt.id)) === ownerBefore + 1, { ownerBefore, after: await balanceOf(OWNER, lt.id) });
      check('  ...the approver gains nothing', (await balanceOf(admin.id, lt.id)) === adminBefore);
    }
  }

  // Cleanup — leaves first, then balances back to what they were.
  for (const id of madeLeaves) await pool.query(`DELETE FROM leaves WHERE id=$1`, [id]);
  for (const b of madeBalances) {
    if (b.restore === null) {
      await pool.query(`DELETE FROM leave_balances WHERE employee_id=$1 AND leave_type_id=$2 AND year=$3`,
        [b.empId, b.ltId, YEAR]);
    } else {
      await pool.query(`UPDATE leave_balances SET available=$1 WHERE employee_id=$2 AND leave_type_id=$3 AND year=$4`,
        [b.restore, b.empId, b.ltId, YEAR]);
    }
  }

  const passed = checks.filter(Boolean).length;
  console.log(`\n  ${passed}/${checks.length} passed\n`);
  await pool.end(); server.close();
  process.exit(passed === checks.length ? 0 : 1);
})().catch(async e => { console.error(e); await pool.end().catch(() => {}); process.exit(1); });
