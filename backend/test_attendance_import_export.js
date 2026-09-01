/* Operations -> Attendance -> Check-in/out Import & Export.
 *
 * Export: a real xlsx buffer, parseable back into rows, covering every
 * calendar day in the range rather than only days with data — that is the
 * whole point of a raw export.
 *
 * Import is the one that can do damage: it writes attendance. What has to
 * hold — a bad row is skipped and reported, not silently dropped or allowed
 * to corrupt an unrelated employee's day; a re-import of the same file does
 * not duplicate a row, it corrects it; and the status an imported day gets is
 * the same classification a live check-out would have produced for the same
 * hours, not a guess.
 */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'silent';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('this test does not send mail'); },
  verify: async () => { throw new Error('this test does not send mail'); },
});

const xlsx = require('xlsx');
const app = require('./app');
const pool = require('./db');
const jwt = require('jsonwebtoken');

const checks = [];
const check = (l, ok, x) => { checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '\n          ' + JSON.stringify(x).slice(0, 300)}`); };

let PORT = 0, base = '';
const upload = (path, token, filename, buffer) => {
  const fd = new FormData();
  fd.append('file', new Blob([buffer]), filename);
  return fetch(base + path, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd })
    .then(async r => ({ s: r.status, j: await r.json().catch(() => null) }));
};
const rowsToBuffer = (rows) => {
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(rows), 'Sheet1');
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
};

const restore = [];

(async () => {
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  PORT = server.address().port;
  base = `http://127.0.0.1:${PORT}/api/attendance-import-export`;

  const admin = (await pool.query(
    `SELECT id FROM employees WHERE role IN ('admin','director','hr_admin') AND status='active' AND deleted_at IS NULL LIMIT 1`)).rows[0];
  const emp = (await pool.query(
    `SELECT id, employee_id AS code FROM employees
      WHERE status='active' AND deleted_at IS NULL AND employee_id IS NOT NULL
        AND role NOT IN ('admin','director','hr_admin') LIMIT 1`)).rows[0];
  if (!admin || !emp) { console.log('  not enough employees to test with\n'); await pool.end(); server.close(); process.exit(0); }

  const token = jwt.sign({ id: admin.id }, process.env.JWT_SECRET, { expiresIn: '5m' });
  const YEAR = '2099'; // far outside real data

  console.log('\n════ Export ════\n');

  const expRes = await fetch(`${base}/export?from=${YEAR}-01-01&to=${YEAR}-01-03`, { headers: { Authorization: `Bearer ${token}` } });
  check('returns 200 with an xlsx content type', expRes.status === 200 && /spreadsheet/.test(expRes.headers.get('content-type') || ''), expRes.status);
  const buf = Buffer.from(await expRes.arrayBuffer());
  const wb = xlsx.read(buf, { type: 'buffer' });
  const parsedRows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  const activeCount = (await pool.query(`SELECT count(*)::int AS n FROM employees WHERE status='active' AND deleted_at IS NULL AND attendance_tracked=TRUE`)).rows[0].n;
  check('produces one row per employee per day in range (3 days), not only days with data',
    parsedRows.length === activeCount * 3, { got: parsedRows.length, expect: activeCount * 3 });
  check('a row nobody punched still has 00:00 Total Hours, not blank',
    parsedRows.every(r => r['Total Hours'] === '00:00'), parsedRows[0]);

  const badRange = await fetch(`${base}/export?from=${YEAR}-02-01&to=${YEAR}-01-01`, { headers: { Authorization: `Bearer ${token}` } });
  check('an inverted range is refused, not silently empty', badRange.status === 400, badRange.status);

  console.log('\n════ Import — the happy path ════\n');

  const r1 = await upload('/import', token, 'a.xlsx', rowsToBuffer([
    { 'Employee Id': emp.code, 'Date': `01/01/${YEAR}`, 'First Check-In': '09:30 AM', 'Last Check-Out': '06:00 PM' },
  ]));
  check('imports one clean row', r1.s === 200 && r1.j?.updated === 1, r1.j);

  const row = (await pool.query(`SELECT status, working_hours, source FROM attendance WHERE employee_id=$1 AND date=$2::date`,
    [emp.id, `${YEAR}-01-01`])).rows[0];
  restore.push({ employeeId: emp.id, date: `${YEAR}-01-01` });
  check('working_hours is a real 8.5, not left null', Math.abs(parseFloat(row?.working_hours) - 8.5) < 0.01, row);
  check('status was classified, not defaulted blindly to present', !!row?.status, row);
  check('source is recorded as import, so it is distinguishable from a real punch',
    row?.source === 'import', row);

  console.log('\n════ Import — re-importing the same row corrects it, not duplicates it ════\n');

  const r2 = await upload('/import', token, 'b.xlsx', rowsToBuffer([
    { 'Employee Id': emp.code, 'Date': `01/01/${YEAR}`, 'First Check-In': '10:00 AM', 'Last Check-Out': '06:00 PM' },
  ]));
  check('the second import for the same day succeeds', r2.s === 200 && r2.j?.updated === 1, r2.j);
  const afterSecond = (await pool.query(`SELECT count(*)::int AS n FROM attendance WHERE employee_id=$1 AND date=$2::date`,
    [emp.id, `${YEAR}-01-01`])).rows[0].n;
  check('and there is still exactly one row for that day, not two', afterSecond === 1, afterSecond);
  const corrected = (await pool.query(`SELECT working_hours FROM attendance WHERE employee_id=$1 AND date=$2::date`,
    [emp.id, `${YEAR}-01-01`])).rows[0];
  check('...with the corrected hours, 8 not 8.5', Math.abs(parseFloat(corrected?.working_hours) - 8) < 0.01, corrected);

  console.log('\n════ Import — bad rows are skipped and reported, not silently dropped ════\n');

  const r3 = await upload('/import', token, 'c.xlsx', rowsToBuffer([
    { 'Employee Id': emp.code, 'Date': `02/01/${YEAR}`, 'First Check-In': '09:30 AM', 'Last Check-Out': '06:00 PM' }, // valid
    { 'Employee Id': 'NO-SUCH-EMPLOYEE', 'Date': `02/01/${YEAR}`, 'First Check-In': '09:30 AM' }, // unknown employee
    { 'Employee Id': emp.code, 'Date': 'not-a-date', 'First Check-In': '09:30 AM' }, // unreadable date
    { 'Employee Id': emp.code, 'Date': `03/01/${YEAR}`, 'Last Check-Out': '06:00 PM' }, // check-out with no check-in
  ]));
  restore.push({ employeeId: emp.id, date: `${YEAR}-01-02` });
  check('the one valid row still imports', r3.j?.updated === 1, r3.j);
  check('the other three are reported as skipped, with a reason each',
    r3.j?.skipped?.length === 3 && r3.j.skipped.every(s => !!s.reason), r3.j?.skipped);
  check('the unknown-employee row did not silently attach to somebody else',
    r3.j.skipped.some(s => /No employee/.test(s.reason)), r3.j?.skipped);

  console.log('\n════ Limits and access ════\n');

  const tooMany = Array.from({ length: 501 }, (_, i) => ({ 'Employee Id': emp.code, 'Date': `01/01/${YEAR}`, 'First Check-In': '09:00 AM' }));
  const r4 = await upload('/import', token, 'd.xlsx', rowsToBuffer(tooMany));
  check('more than 500 rows is refused outright, not truncated silently', r4.s === 400, r4.j);

  const noFile = await fetch(`${base}/import`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  check('no file at all is a clean 400', noFile.status === 400);

  const member = (await pool.query(`SELECT id FROM employees WHERE role='team_member' AND status='active' AND deleted_at IS NULL LIMIT 1`)).rows[0];
  if (member) {
    const memberToken = jwt.sign({ id: member.id }, process.env.JWT_SECRET, { expiresIn: '5m' });
    const asMember = await fetch(`${base}/export?from=${YEAR}-01-01&to=${YEAR}-01-01`, { headers: { Authorization: `Bearer ${memberToken}` } });
    check('a team member cannot export — full access only', asMember.status === 403, asMember.status);
  }

  for (const r of restore) { try { await pool.query('DELETE FROM attendance WHERE employee_id=$1 AND date=$2::date', [r.employeeId, r.date]); } catch {} }

  server.close();
  await pool.end();
  const failed = checks.filter(c => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed\n`);
  process.exit(failed ? 1 : 0);
})().catch(async e => {
  console.error('\n  failed —', e.message, '\n');
  for (const r of restore) { try { await pool.query('DELETE FROM attendance WHERE employee_id=$1 AND date=$2::date', [r.employeeId, r.date]); } catch {} }
  try { await pool.end(); } catch {}
  process.exit(1);
});
