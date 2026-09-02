/* Employee edits recorded as old -> new.
 *
 * PUT /employees/:id logged `changes: req.body` — the NEW values only. A trail
 * that says "Employee Status: Active" cannot tell you it used to be Inactive,
 * which is the entire point of Audit History, and live had exactly one
 * Employee audit row (a CREATE) to show for it.
 *
 * What has to hold:
 *
 *   1. A real before/after pair, in the {field, from, to} shape AuditLog.jsx
 *      already renders.
 *   2. Fields that did NOT move are absent. The diff runs over the columns the
 *      UPDATE wrote, and a form posts every field it holds — so without a real
 *      comparison every save would claim it changed everything and the trail
 *      would be noise.
 *   3. Identity and credential values NEVER appear, in either direction. The
 *      audit page is readable by every admin; a PAN leaking into it is worse
 *      than no entry at all. This is the reason the file exists.
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
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '\n          ' + JSON.stringify(x).slice(0, 320)}`); };

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

const madeAudit = [];
let SUBJECT = null;
let restore = null;

// The newest audit row for our subject, and remember it so cleanup removes it.
const lastAudit = async () => {
  const r = await pool.query(
    `SELECT id, changes FROM audit_log
      WHERE resource = 'Employee' AND action = 'UPDATE' AND resource_id = $1
      ORDER BY created_at DESC LIMIT 1`, [SUBJECT]);
  if (r.rows[0]) madeAudit.push(r.rows[0].id);
  return r.rows[0] || null;
};
const fieldsOf = (row) => (row?.changes?.fields) || [];
const pick = (fields, name) => fields.find(f => f.field === name);

(async () => {
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  PORT = server.address().port;

  const admin = (await pool.query(
    `SELECT id FROM employees WHERE role IN ('admin','director','hr_admin')
       AND status='active' AND deleted_at IS NULL LIMIT 1`)).rows[0];
  const subject = (await pool.query(
    `SELECT id, nick_name, work_phone, pan_number FROM employees
      WHERE role='team_member' AND status='active' AND deleted_at IS NULL
      ORDER BY created_at DESC LIMIT 1`)).rows[0];
  if (!admin || !subject) {
    console.log('  not enough employees in this database\n');
    await pool.end(); server.close(); process.exit(0);
  }
  SUBJECT = subject.id;
  restore = { nick_name: subject.nick_name, work_phone: subject.work_phone, pan_number: subject.pan_number };
  /* Every key must have been SELECTed. Restoring from a column the query never
   * fetched writes undefined, which pg sends as NULL — so a typo here silently
   * destroys the value this test borrowed instead of putting it back. */
  for (const k of Object.keys(restore)) {
    if (!(k in subject)) throw new Error(`restore key '${k}' was never selected — cleanup would null it`);
  }
  const token = jwt.sign({ id: admin.id }, process.env.JWT_SECRET, { expiresIn: '5m' });

  // Known starting point, set directly so the edits below are the only thing
  // the route is asked to record.
  await pool.query(
    `UPDATE employees SET nick_name='BeforeNick', work_phone='1111111111', pan_number='AAAAA0000A' WHERE id=$1`,
    [SUBJECT]);

  console.log('\nEmployee edits recorded as old -> new\n');

  /* 1 — one field moves. */
  {
    const res = await call('PUT', `/employees/${SUBJECT}`, token, { nickName: 'AfterNick' });
    check('the edit is accepted', res.s === 200, res);

    const row = await lastAudit();
    const f = pick(fieldsOf(row), 'nick_name');
    check('nick_name is recorded with BOTH sides',
      !!f && f.from === 'BeforeNick' && f.to === 'AfterNick', f);
  }

  /* 2 — a field posted but unchanged must not be claimed as a change. */
  {
    const res = await call('PUT', `/employees/${SUBJECT}`, token,
      { nickName: 'AfterNick', workPhone: '2222222222' });
    check('a second edit is accepted', res.s === 200, res);

    const fields = fieldsOf(await lastAudit());
    check('the field that actually moved is present', !!pick(fields, 'work_phone'), fields);
    check('  ...and the one posted unchanged is NOT listed',
      !pick(fields, 'nick_name'),
      fields.map(f => f.field));
  }

  /* 3 — the dangerous case: identity values must never be written down. */
  {
    const res = await call('PUT', `/employees/${SUBJECT}`, token, { panNumber: 'ZZZZZ9999Z' });
    check('a PAN edit is accepted', res.s === 200, res);

    const row = await lastAudit();
    const f = pick(fieldsOf(row), 'pan_number');
    check('the PAN change is recorded as having happened', !!f, fieldsOf(row));
    check('  ...with NEITHER the old nor the new value',
      !!f && f.from === '(hidden)' && f.to === '(hidden)', f);

    // Belt and braces: neither value may appear anywhere in the stored JSON.
    const blob = JSON.stringify(row?.changes || {});
    check('  ...and neither value appears anywhere in the entry',
      !blob.includes('ZZZZZ9999Z') && !blob.includes('AAAAA0000A'), blob.slice(0, 200));

    // ...and it really was written to the row, so this is redaction, not a
    // silently dropped update.
    const live = await pool.query('SELECT pan_number FROM employees WHERE id=$1', [SUBJECT]);
    check('  ...while the column itself did change', live.rows[0].pan_number === 'ZZZZZ9999Z', live.rows[0]);
  }

  /* 4 — an edit that changes nothing at all writes no audit row. */
  {
    const beforeCount = (await pool.query(
      `SELECT COUNT(*)::int n FROM audit_log WHERE resource='Employee' AND action='UPDATE' AND resource_id=$1`,
      [SUBJECT])).rows[0].n;
    const res = await call('PUT', `/employees/${SUBJECT}`, token, { nickName: 'AfterNick' });
    const afterCount = (await pool.query(
      `SELECT COUNT(*)::int n FROM audit_log WHERE resource='Employee' AND action='UPDATE' AND resource_id=$1`,
      [SUBJECT])).rows[0].n;
    check('a no-op save adds no audit noise', res.s === 200 && afterCount === beforeCount,
      { beforeCount, afterCount });
  }

  // Cleanup: the audit rows this test created, then the borrowed columns.
  for (const id of madeAudit) await pool.query('DELETE FROM audit_log WHERE id=$1', [id]);
  await pool.query(
    `UPDATE employees SET nick_name=$1, work_phone=$2, pan_number=$3 WHERE id=$4`,
    [restore.nick_name, restore.work_phone, restore.pan_number, SUBJECT]);

  const passed = checks.filter(Boolean).length;
  console.log(`\n  ${passed}/${checks.length} passed\n`);
  await pool.end(); server.close();
  process.exit(passed === checks.length ? 0 : 1);
})().catch(async e => { console.error(e); await pool.end().catch(() => {}); process.exit(1); });
