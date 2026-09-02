/* Record-change approvals, and the child sections that back the tabular grids.
 *
 * The dangerous cases:
 *
 *   1. A HELD EDIT MUST NOT WRITE. If the record changes anyway, the approval
 *      is theatre — the reviewer is asked about something that already
 *      happened. This is checked against the row, not the response.
 *   2. Approving replays the payload, so the change lands only on approval.
 *   3. Nobody decides their own request. Full access is NOT exempt: an
 *      organisation that switched off skip_for_full_access did so precisely to
 *      get a second pair of eyes, and letting an admin wave their own change
 *      through would hand the setting back.
 *   4. Switching approvals on takes effect on the NEXT save, not after a cache
 *      expires. A setting that appears to do nothing for thirty seconds is
 *      indistinguishable from one that does not work.
 *   5. The optional forms refuse writes while switched off. A toggle that only
 *      hides a screen while the API keeps accepting data is not a switch.
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
    headers: { Authorization: 'Bearer ' + token,
      ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) } },
    res => { let d = ''; res.on('data', c => d += c);
      res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch {} resolve({ s: res.statusCode, j }); }); });
  req.on('error', e => resolve({ s: 0, j: null, err: e.message }));
  if (data) req.write(data); req.end();
});

const TAG = 'RA' + Date.now().toString().slice(-6);
let SUBJECT = null;

const cleanup = async () => {
  // Approvals back off, forms back off, test rows gone.
  await pool.query(`UPDATE record_approval_configs SET is_enabled=FALSE, skip_for_full_access=TRUE`).catch(() => {});
  await pool.query(`UPDATE extend_service_forms SET is_enabled=FALSE WHERE form_key IN ('employee_health','vaccination')`).catch(() => {});
  if (SUBJECT) await pool.query(`DELETE FROM employees WHERE id=$1`, [SUBJECT]).catch(() => {});
  await pool.query(`DELETE FROM pending_record_changes WHERE form='employee' AND record_id NOT IN (SELECT id FROM employees)`).catch(() => {});
};

(async () => {
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  PORT = server.address().port;

  const admins = (await pool.query(
    `SELECT id, role FROM employees WHERE role IN ('admin','director','hr_admin')
       AND status='active' AND deleted_at IS NULL LIMIT 2`)).rows;
  if (admins.length < 2) { console.log('  need two full-access users\n'); await pool.end(); server.close(); process.exit(0); }
  const [a1, a2] = admins;
  const t1 = jwt.sign({ id: a1.id }, process.env.JWT_SECRET, { expiresIn: '10m' });
  const t2 = jwt.sign({ id: a2.id }, process.env.JWT_SECRET, { expiresIn: '10m' });

  // Its own subject, created and deleted here.
  SUBJECT = (await pool.query(
    `INSERT INTO employees (employee_id, first_name, last_name, email, role, status, is_user)
     VALUES ($1,'RaTest','Subject',$2,'team_member','active',TRUE) RETURNING id`,
    [TAG + '-EMP', `${TAG.toLowerCase()}@example.invalid`])).rows[0].id;

  console.log('\nRecord-change approvals and child sections\n');

  /* 1 - with approvals off, an edit writes as it always did. */
  {
    const r = await call('PUT', `/employees/${SUBJECT}`, t1, { nickName: 'BeforeApprovals' });
    const row = (await pool.query(`SELECT nick_name FROM employees WHERE id=$1`, [SUBJECT])).rows[0];
    check('with approvals off the edit writes straight through',
      r.s === 200 && !r.j.pending && row.nick_name === 'BeforeApprovals', { res: r.j, row });
  }

  /* 2 - switching on takes effect immediately, and full access is exempt. */
  {
    const cfg = await call('PATCH', '/record-approvals/config/employee', t1,
      { isEnabled: true, skipForFullAccess: true, approverMode: 'roles', approverRoles: ['admin', 'hr_admin', 'director'] });
    check('approvals can be switched on', cfg.s === 200, cfg.j);

    const r = await call('PUT', `/employees/${SUBJECT}`, t1, { nickName: 'StillDirect' });
    const row = (await pool.query(`SELECT nick_name FROM employees WHERE id=$1`, [SUBJECT])).rows[0];
    check('  ...full access still writes directly while the skip is on',
      r.s === 200 && !r.j.pending && row.nick_name === 'StillDirect', { res: r.j, row });
  }

  /* 3 - THE ONE THAT MATTERS: with the skip off, the edit is held. */
  let requestId = null;
  {
    await call('PATCH', '/record-approvals/config/employee', t1, { skipForFullAccess: false });

    const before = (await pool.query(`SELECT nick_name FROM employees WHERE id=$1`, [SUBJECT])).rows[0].nick_name;
    const r = await call('PUT', `/employees/${SUBJECT}`, t1, { nickName: 'HeldValue' });
    check('the edit reports itself as pending', r.s === 200 && r.j.pending === true, r.j);
    requestId = r.j?.requestId;

    const after = (await pool.query(`SELECT nick_name FROM employees WHERE id=$1`, [SUBJECT])).rows[0].nick_name;
    check('  ...and the record is UNCHANGED', after === before, { before, after });
    check('  ...the change takes effect on the next save, not after a cache expires',
      !!requestId, requestId);
  }

  /* 4 - the queue shows the diff, and nobody decides their own. */
  {
    const q = await call('GET', '/record-approvals/queue', t1);
    const mine = (q.j?.data || []).find(x => String(x._id) === String(requestId));
    check('the request appears in the queue', !!mine, (q.j?.data || []).length);
    check('  ...carrying the field that changed',
      (mine?.changes || []).some(c => c.field === 'nick_name'), mine?.changes);

    const self = await call('PUT', `/record-approvals/queue/${requestId}/action`, t1, { action: 'approved' });
    check('the submitter cannot approve their own request, even with full access',
      self.s === 403, self.j?.message);

    const stillUnchanged = (await pool.query(`SELECT nick_name FROM employees WHERE id=$1`, [SUBJECT])).rows[0].nick_name;
    check('  ...and the record is still unchanged after the refusal',
      stillUnchanged !== 'HeldValue', stillUnchanged);
  }

  /* 5 - somebody else approves, and only then does it land. */
  {
    const ok = await call('PUT', `/record-approvals/queue/${requestId}/action`, t2, { action: 'approved' });
    check('a different approver can approve', ok.s === 200, ok.j);

    const row = (await pool.query(`SELECT nick_name FROM employees WHERE id=$1`, [SUBJECT])).rows[0];
    check('  ...and the change lands only now', row.nick_name === 'HeldValue', row);

    const again = await call('PUT', `/record-approvals/queue/${requestId}/action`, t2, { action: 'rejected' });
    check('  ...a decided request cannot be decided twice', again.s === 400, again.j?.message);
  }

  /* 6 - a rejected request never writes. */
  {
    const r = await call('PUT', `/employees/${SUBJECT}`, t1, { nickName: 'ShouldNeverLand' });
    const id = r.j?.requestId;
    const rej = await call('PUT', `/record-approvals/queue/${id}/action`, t2, { action: 'rejected', note: 'no' });
    check('a request can be rejected', rej.s === 200, rej.j);
    const row = (await pool.query(`SELECT nick_name FROM employees WHERE id=$1`, [SUBJECT])).rows[0];
    check('  ...and the record never took the value', row.nick_name !== 'ShouldNeverLand', row);

    await call('PATCH', '/record-approvals/config/employee', t1, { isEnabled: false, skipForFullAccess: true });
  }

  /* 7 - work experience and dependents are real now. */
  {
    const w = await call('POST', `/employee-records/${SUBJECT}/experience`, t1,
      { companyName: 'Prior Co', jobTitle: 'Analyst', fromDate: '2022-01-01', toDate: '2023-01-01', relevant: true });
    check('work experience can be added', w.s === 201, w.j);

    const bad = await call('POST', `/employee-records/${SUBJECT}/experience`, t1,
      { companyName: 'Bad Co', fromDate: '2024-01-01', toDate: '2023-01-01' });
    check('  ...and a stint ending before it starts is refused', bad.s === 400, bad.j?.message);

    const d = await call('POST', `/employee-records/${SUBJECT}/dependents`, t1,
      { name: 'A Dependent', relationship: 'Child', dateOfBirth: '2015-05-05' });
    check('dependents can be added', d.s === 201, d.j);

    const list = await call('GET', `/employee-records/${SUBJECT}/experience`, t1);
    check('  ...and read back', (list.j?.data || []).length === 1, list.j?.data?.length);
  }

  /* 8 - the optional forms refuse writes while switched off. */
  {
    const off = await call('PUT', `/employee-records/${SUBJECT}/health`, t1, { bloodGroup: 'O+' });
    check('health data is refused while the form is switched off', off.s === 400, off.j?.message);

    await call('PATCH', '/employee-info-settings/forms/employee_health', t1, { isEnabled: true });
    const on = await call('PUT', `/employee-records/${SUBJECT}/health`, t1, { bloodGroup: 'O+', allergies: 'None' });
    check('  ...and accepted once it is on', on.s === 200, on.j);

    const read = await call('GET', `/employee-records/${SUBJECT}/health`, t1);
    check('  ...and reads back', read.j?.data?.bloodGroup === 'O+', read.j?.data);

    const vOff = await call('POST', `/employee-records/${SUBJECT}/vaccinations`, t1, { vaccine: 'X' });
    check('vaccinations are refused while that form is off', vOff.s === 400, vOff.j?.message);

    await call('PATCH', '/employee-info-settings/forms/employee_health', t1, { isEnabled: false });
  }

  /* 9 - somebody else's health record is not readable by a colleague. */
  {
    await call('PATCH', '/employee-info-settings/forms/employee_health', t1, { isEnabled: true });
    /* Must be somebody who can actually sign in — an inactive account is
     * refused by `protect` with a 401, which would pass this check for
     * entirely the wrong reason. */
    const other = (await pool.query(
      `SELECT id FROM employees
        WHERE role='team_member' AND id <> $1 AND deleted_at IS NULL
          AND status='active' AND is_user AND login_enabled LIMIT 1`,
      [SUBJECT])).rows[0];
    if (other) {
      const ot = jwt.sign({ id: other.id }, process.env.JWT_SECRET, { expiresIn: '10m' });
      const r = await call('GET', `/employee-records/${SUBJECT}/health`, ot);
      check("a colleague cannot read somebody else's health record",
        r.s === 403, { status: r.s, message: r.j?.message });
      const own = await call('GET', `/employee-records/${other.id}/health`, ot);
      check('  ...but can read their own', own.s === 200, own.s);
    }
    await call('PATCH', '/employee-info-settings/forms/employee_health', t1, { isEnabled: false });
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
