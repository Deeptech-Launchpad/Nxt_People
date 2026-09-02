/* Import, Export, History Export, bulk photos, and the identity reveal.
 *
 * The dangerous cases, which is all this file is for:
 *
 *   1. An import must not half-write. The default is a DRY RUN, and a preview
 *      that reported "5 created" while creating nothing — or worse, created
 *      them — is the failure that matters. Both directions are checked against
 *      the real row count.
 *   2. A correction sheet with two columns must not blank the other twenty.
 *   3. Export must honour the filters on screen, or it hands somebody a file
 *      that silently disagrees with the table they were looking at.
 *   4. Revealing identity numbers must be full access only, capped, and must
 *      leave an audit row naming who looked. That trail is the entire reason
 *      the reveal is allowed to exist.
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
const xlsx = require('xlsx');

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

// multipart by hand: no form-data dependency in this project.
const postSheet = (p, token, rows, extra = {}) => new Promise(resolve => {
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(rows), 'Sheet1');
  const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const B = '----nxt' + Date.now();
  const parts = [];
  for (const [k, v] of Object.entries(extra)) {
    parts.push(Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(Buffer.from(
    `--${B}\r\nContent-Disposition: form-data; name="file"; filename="import.xlsx"\r\n` +
    `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`));
  parts.push(buf, Buffer.from(`\r\n--${B}--\r\n`));
  const payload = Buffer.concat(parts);

  const req = http.request({ host: '127.0.0.1', port: PORT, path: '/api' + p, method: 'POST',
    headers: { Authorization: 'Bearer ' + token,
      'Content-Type': `multipart/form-data; boundary=${B}`, 'Content-Length': payload.length } },
    res => { let d = ''; res.on('data', c => d += c);
      res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch {} resolve({ s: res.statusCode, j }); }); });
  req.on('error', e => resolve({ s: 0, j: null, err: e.message }));
  req.write(payload); req.end();
});

const madeAudit = [];
const TAG = 'IOTEST-' + Date.now().toString().slice(-6);

const countDesignations = async (name) =>
  (await pool.query(`SELECT COUNT(*)::int n FROM designations WHERE name = $1`, [name])).rows[0].n;

(async () => {
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  PORT = server.address().port;

  const admin = (await pool.query(
    `SELECT id FROM employees WHERE role IN ('admin','director','hr_admin')
       AND status='active' AND deleted_at IS NULL LIMIT 1`)).rows[0];
  if (!admin) { console.log('  no admin'); await pool.end(); server.close(); process.exit(0); }

  /* Its OWN throwaway employee, created here and deleted at the end.
   *
   * An earlier version borrowed the newest real team member and put the
   * columns back afterwards. That is the wrong shape whatever the restore
   * does: an import test WRITES to the row, so a crash between the write and
   * the restore leaves a real person renamed — which is exactly what happened
   * — and it silently changed an email address, which is a login. */
  const staff = (await pool.query(
    `INSERT INTO employees (employee_id, first_name, last_name, email, department,
        nick_name, role, status, is_user, pan_number, aadhaar_number, uan_number)
     VALUES ($1,'IoTest','Subject',$2,'IO-Dept','IoNick','team_member','active',TRUE,
             'AAAAA1111A','111122223333','100000000001')
     RETURNING id, employee_id, first_name, last_name, email, nick_name, department`,
    [TAG + '-EMP', TAG.toLowerCase() + '@example.invalid'])).rows[0];

  const adminToken = jwt.sign({ id: admin.id }, process.env.JWT_SECRET, { expiresIn: '10m' });
  const staffToken = jwt.sign({ id: staff.id }, process.env.JWT_SECRET, { expiresIn: '10m' });

  console.log('\nImport, Export, History Export, photos, reveal\n');

  /* 1 - dry run really is dry. */
  {
    const before = await countDesignations(TAG);
    const r = await postSheet('/employee-io/import/designations', adminToken,
      [{ 'Designation Name': TAG, 'Mail Alias': 'x@example.com' }]);
    check('a preview import reports what it would do', r.s === 200 && r.j.created === 1, r.j);
    check('  ...says nothing was saved', r.j?.committed === false && /nothing saved/i.test(r.j?.message || ''), r.j?.message);
    check('  ...and really wrote nothing', (await countDesignations(TAG)) === before, await countDesignations(TAG));
  }

  /* 2 - committing writes exactly once, and re-importing updates. */
  {
    const r = await postSheet('/employee-io/import/designations', adminToken,
      [{ 'Designation Name': TAG, 'Mail Alias': 'x@example.com' }], { commit: 'true' });
    check('committing creates the row', r.s === 200 && r.j.committed === true && r.j.created === 1, r.j);
    check('  ...exactly once', (await countDesignations(TAG)) === 1, await countDesignations(TAG));

    const again = await postSheet('/employee-io/import/designations', adminToken,
      [{ 'Designation Name': TAG, 'Mail Alias': 'y@example.com' }], { commit: 'true' });
    check('re-importing the same name UPDATES rather than duplicating',
      again.j?.updated === 1 && again.j?.created === 0, again.j);
    check('  ...still one row', (await countDesignations(TAG)) === 1, await countDesignations(TAG));
  }

  /* 3 - bad rows are reported with a line number, not swallowed. */
  {
    const r = await postSheet('/employee-io/import/designations', adminToken, [
      { 'Designation Name': TAG + '-A' },
      { 'Designation Name': '' },
      { 'Designation Name': TAG + '-A' },
    ]);
    check('a blank required cell is skipped with its line',
      r.j?.skipped?.some(x => x.line === 3 && /Missing/i.test(x.reason)), r.j?.skipped);
    check('a duplicate within the same sheet is skipped, not applied twice',
      r.j?.skipped?.some(x => x.line === 4 && /Duplicate/i.test(x.reason)), r.j?.skipped);
  }

  /* 4 - a missing required COLUMN is refused outright. */
  {
    const r = await postSheet('/employee-io/import/designations', adminToken, [{ 'Mail Alias': 'a@b.c' }]);
    check('a sheet without the required column is refused', r.s === 400 && /missing required column/i.test(r.j?.message || ''), r.j);
  }

  /* 5 - a two-column correction must not blank everything else. */
  {
    const r = await postSheet('/employee-io/import/employees', adminToken, [{
      'Employee ID': staff.employee_id, 'First Name': staff.first_name,
      'Last Name': 'ZZTest', 'Email address': 'unchanged@example.com',
    }], { commit: 'true' });
    check('an employee correction sheet applies', r.s === 200 && r.j.updated === 1, r.j);

    const after = (await pool.query(
      `SELECT department, nick_name, last_name FROM employees WHERE id=$1`, [staff.id])).rows[0];
    check('  ...and leaves columns the sheet did not mention alone',
      after.department === staff.department && after.nick_name === staff.nick_name,
      { was: { d: staff.department, n: staff.nick_name }, now: after });

    // No restore needed: this row exists only for this test and is deleted below.
  }

  /* 6 - export honours the filter. */
  {
    const bogus = encodeURIComponent(JSON.stringify(
      [{ field: 'name', operator: 'is', value: 'zzz-no-such-designation' }]));
    const filtered = await new Promise(r => http.get(
      { host: '127.0.0.1', port: PORT, path: `/api/employee-io/export/designations?criteria=${bogus}`,
        headers: { Authorization: 'Bearer ' + adminToken } },
      res => { const c = []; res.on('data', x => c.push(x)); res.on('end', () => r(Buffer.concat(c))); }));
    const wb = xlsx.read(filtered, { type: 'buffer' });
    const rows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    check('an export with a filter that matches nothing is empty', rows.length === 0, rows.length);
  }

  /* 7 - THE ONE THAT MATTERS: reveal is gated, capped and audited. */
  {
    const denied = await call('POST', '/employee-io/reveal', staffToken, { employeeIds: [staff.id] });
    check('a team member cannot reveal identity numbers', denied.s === 403, denied.s);

    const tooMany = await call('POST', '/employee-io/reveal', adminToken,
      { employeeIds: Array.from({ length: 101 }, () => staff.id) });
    check('revealing more than the cap is refused', tooMany.s === 400, tooMany.j);

    const before = (await pool.query(
      `SELECT COUNT(*)::int n FROM audit_log WHERE action='REVEAL'`)).rows[0].n;

    const ok = await call('POST', '/employee-io/reveal', adminToken,
      { employeeIds: [staff.id], reason: 'payroll check' });
    check('full access can reveal', ok.s === 200 && Array.isArray(ok.j.data), ok.j);
    check('  ...and gets the actual fields back',
      ok.j?.data?.[0] && 'panNumber' in ok.j.data[0] && 'aadhaarNumber' in ok.j.data[0], ok.j?.data?.[0]);

    const after = (await pool.query(
      `SELECT id, changes FROM audit_log WHERE action='REVEAL' ORDER BY created_at DESC LIMIT 1`)).rows[0];
    if (after) madeAudit.push(after.id);
    const count = (await pool.query(`SELECT COUNT(*)::int n FROM audit_log WHERE action='REVEAL'`)).rows[0].n;
    check('  ...and it is written down', count === before + 1, { before, after: count });
    check('  ...naming who was looked at and why',
      JSON.stringify(after?.changes || {}).includes(staff.employee_id) &&
      JSON.stringify(after?.changes || {}).includes('payroll check'), after?.changes);
  }

  /* 8 - the template round-trips through the importer that produced it. */
  {
    const buf = await new Promise(r => http.get(
      { host: '127.0.0.1', port: PORT, path: '/api/employee-io/import-template/designations',
        headers: { Authorization: 'Bearer ' + adminToken } },
      res => { const c = []; res.on('data', x => c.push(x)); res.on('end', () => r(Buffer.concat(c))); }));
    const wb = xlsx.read(buf, { type: 'buffer' });
    const headings = Object.keys(xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })[0] || {});
    const filled = [{ ...Object.fromEntries(headings.map(h => [h, ''])), 'Designation Name': TAG + '-TPL' }];
    const r = await postSheet('/employee-io/import/designations', adminToken, filled);
    check('the download template is accepted by the importer',
      r.s === 200 && r.j.created === 1 && (r.j.unknownColumns || []).length === 0,
      { status: r.s, unknown: r.j?.unknownColumns, skipped: r.j?.skipped });
  }

  // Cleanup.
  await pool.query(`DELETE FROM employees WHERE employee_id = $1`, [TAG + '-EMP']);
  await pool.query(`DELETE FROM designations WHERE name LIKE $1`, [TAG + '%']);
  for (const id of madeAudit) await pool.query(`DELETE FROM audit_log WHERE id=$1`, [id]);
  await pool.query(
    `DELETE FROM audit_log WHERE action IN ('IMPORT','EXPORT') AND created_at > NOW() - INTERVAL '5 minutes'`);

  const passed = checks.filter(Boolean).length;
  console.log(`\n  ${passed}/${checks.length} passed\n`);
  await pool.end(); server.close();
  process.exit(passed === checks.length ? 0 : 1);
})().catch(async e => {
  console.error(e);
  await pool.query(`DELETE FROM employees WHERE employee_id = $1`, [TAG + '-EMP']).catch(() => {});
  await pool.query(`DELETE FROM designations WHERE name LIKE $1`, [TAG + '%']).catch(() => {});
  await pool.end().catch(() => {});
  process.exit(1);
});
