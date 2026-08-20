// Editing a reportee's attendance entry.
//
// The dangerous parts of this feature are not the happy path. They are: a
// manager reaching somebody who does not report to them, an edit that leaves
// no trace, and an edit the employee never learns about. Those are what most
// of the checks below are for.
//
// The mail transport is stubbed and every send is recorded, so the "only the
// configured address is written to" check is a real assertion rather than a
// promise — and nothing leaves this machine.
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('this test does not send mail'); },
  verify: async () => { throw new Error('this test does not send mail'); },
});

// Two layers, deliberately. EMAIL_DISABLED stops the mailer before it reaches
// a transport at all, which is why the transport stub above never records
// anything — so the recipient assertion is made one level up, by replacing the
// send helper itself before the routes destructure it. Nothing can leave this
// machine, and what would have been addressed is still observable.
const mailer = require('./utils/mailer');
const sent = [];
mailer.sendCheckOutReminderEmail = async (m) => { sent.push(m); return { ok: true }; };

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
    res => { let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{ let j=null; try{j=JSON.parse(d);}catch{} resolve({s:res.statusCode,j}); }); });
  req.on('error', e => resolve({ s: 0, j: null, err: e.message }));
  if (data) req.write(data); req.end();
});

const DATE = '2019-09-11';
const made = [];
let ORIG_CHECKIN = null, ORIG_POLICY = null, ORIG_MGR = null;

(async () => {
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  PORT = server.address().port;

  const admin = (await pool.query(
    `SELECT id FROM employees WHERE role='admin' AND status='active' AND deleted_at IS NULL LIMIT 1`)).rows[0];
  const members = (await pool.query(
    `SELECT id, employee_id AS code, reporting_manager_id FROM employees
      WHERE role='team_member' AND status='active' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 2`)).rows;
  // The scoping check — a manager reaching somebody who is not theirs — is the
  // most important assertion here, and it is meaningless without a real
  // manager. A local database with none would have skipped it silently, so one
  // is promoted for the run and put back afterwards.
  let mgr = (await pool.query(
    `SELECT id, role FROM employees WHERE role='manager' AND status='active' AND deleted_at IS NULL LIMIT 1`)).rows[0];
  let promoted = null;
  if (!mgr) {
    const pick = (await pool.query(
      `SELECT id, role FROM employees
        WHERE role='team_member' AND status='active' AND deleted_at IS NULL
        ORDER BY created_at ASC LIMIT 1`)).rows[0];
    if (!pick) { console.log('  no employees to test with'); process.exit(1); }
    await pool.query(`UPDATE employees SET role='manager' WHERE id=$1`, [pick.id]);
    promoted = pick;
    mgr = pick;
    made.push(() => pool.query(`UPDATE employees SET role=$1 WHERE id=$2`, [pick.role, pick.id]));
    console.log('  (no manager existed locally — promoted one for this run)');
  }

  if (members.length < 2) { console.log('  needs two team members locally'); process.exit(1); }

  const [subject, stranger] = members;
  ORIG_MGR = subject.reporting_manager_id;
  await pool.query(`UPDATE employees SET reporting_manager_id=$1 WHERE id=$2`, [mgr.id, subject.id]);
  // The second person deliberately does NOT report to that manager.
  await pool.query(`UPDATE employees SET reporting_manager_id=NULL WHERE id=$1`, [stranger.id]);

  const T = {
    admin: jwt.sign({ id: admin.id }, process.env.JWT_SECRET, { expiresIn: '1h' }),
    mgr: jwt.sign({ id: mgr.id }, process.env.JWT_SECRET, { expiresIn: '1h' }),
    subject: jwt.sign({ id: subject.id }, process.env.JWT_SECRET, { expiresIn: '1h' }),
  };

  ORIG_CHECKIN = (await pool.query(`SELECT attendance_checkin_config AS c FROM settings LIMIT 1`)).rows[0].c;
  ORIG_POLICY = (await pool.query(`SELECT attendance_policy_config AS c FROM settings LIMIT 1`)).rows[0].c;

  const setCheckin = async (patch) => {
    await pool.query(`UPDATE settings SET attendance_checkin_config = $1::jsonb`,
      [JSON.stringify({ ...(ORIG_CHECKIN || {}), ...patch })]);
    // The config layer caches for 30s with a generation counter; the save route
    // invalidates it, a direct UPDATE does not.
    require('./utils/attendanceConfig').invalidate();
  };

  await pool.query(`DELETE FROM attendance WHERE employee_id=$1 AND date=$2`, [subject.id, DATE]);
  made.push(() => pool.query(`DELETE FROM attendance WHERE employee_id=$1 AND date=$2`, [subject.id, DATE]));

  console.log('\n════ The setting gates it ════\n');

  await setCheckin({ allowViewReporteeEntries: true, allowEditReporteeEntries: false });
  let r = await call('PUT', `/attendance-entry/${subject.id}/${DATE}`, T.admin, { checkIn: '09:30', checkOut: '18:00' });
  check('with editing switched off the write is refused', r.s === 403, { s: r.s, m: r.j?.message });

  await setCheckin({ allowViewReporteeEntries: true, allowEditReporteeEntries: true,
    notifyOnReporteeEdit: { enabled: false, email: '' } });

  console.log('\n════ Who may edit whom ════\n');

  r = await call('PUT', `/attendance-entry/${stranger.id}/${DATE}`, T.mgr, { checkIn: '09:30', checkOut: '18:00' });
  check('a manager cannot edit somebody who does not report to them', r.s === 403, { s: r.s, m: r.j?.message });

  r = await call('PUT', `/attendance-entry/${subject.id}/${DATE}`, T.subject, { checkIn: '09:30', checkOut: '18:00' });
  check('an employee cannot use this route at all', r.s === 403, r.s);

  r = await call('PUT', `/attendance-entry/${admin.id}/${DATE}`, T.admin, { checkIn: '09:30', checkOut: '18:00' });
  check('an admin cannot edit their own entry this way', r.s === 403, { s: r.s, m: r.j?.message });

  r = await call('PUT', `/attendance-entry/${subject.id}/${DATE}`, T.mgr, { checkIn: '09:30', checkOut: '18:00' });
  check('but the real manager can', r.s === 200, { s: r.s, m: r.j?.message });

  console.log('\n════ What it writes ════\n');

  const row = (await pool.query(
    `SELECT to_char(check_in  AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata','HH24:MI') AS ci,
            to_char(check_out AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata','HH24:MI') AS co,
            working_hours, status, late_minutes
       FROM attendance WHERE employee_id=$1 AND date=$2`, [subject.id, DATE])).rows[0];
  check('the times read back as they were entered, not shifted',
    row.ci === '09:30' && row.co === '18:00', row);
  check('the hours are computed from them', Number(row.working_hours) === 8.5, row.working_hours);
  check('the day is classified by the same engine, not left as it was',
    ['present', 'late', 'half-day', 'absent'].includes(row.status), row.status);

  console.log('\n════ Bad input is refused ════\n');

  const bad = async (body, why) => {
    const x = await call('PUT', `/attendance-entry/${subject.id}/${DATE}`, T.admin, body);
    check(why, x.s === 400, { s: x.s, m: x.j?.message });
  };
  await bad({ checkIn: '18:00', checkOut: '09:30' }, 'a check-out before the check-in');
  await bad({ checkIn: '9:30 AM' }, 'a time that is not HH:MM');
  await bad({ checkOut: '18:00' }, 'a check-out with no check-in');
  const future = new Date(Date.now() + 3 * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const f = await call('PUT', `/attendance-entry/${subject.id}/${future}`, T.admin, { checkIn: '09:30' });
  check('a future date', f.s === 400, { s: f.s, m: f.j?.message });

  console.log('\n════ Every edit leaves a trace ════\n');

  await call('PUT', `/attendance-entry/${subject.id}/${DATE}`, T.admin,
    { checkIn: '10:00', checkOut: '17:00', reason: 'biometric missed' });

  const audit = (await pool.query(
    `SELECT actor_role, action, resource, changes FROM audit_log
      WHERE resource = 'Attendance entry' ORDER BY created_at DESC LIMIT 1`)).rows[0];
  check('the edit is in the audit trail', !!audit, audit);
  check('with who did it', audit?.actor_role === 'admin', audit?.actor_role);
  check('the reason they gave', audit?.changes?.reason === 'biometric missed', audit?.changes?.reason);
  const ciChange = (audit?.changes?.fields || []).find(f => f.field === 'checkIn');
  check('and the old time beside the new one',
    ciChange?.from === '09:30' && ciChange?.to === '10:00', ciChange);

  console.log('\n════ The employee is told ════\n');

  const note = (await pool.query(
    `SELECT title, message FROM notifications WHERE employee_id=$1 ORDER BY created_at DESC LIMIT 1`,
    [subject.id])).rows[0];
  check('a notification reaches the person whose record changed',
    /attendance was edited/i.test(note?.title || ''), note);
  check('and it names the day', (note?.message || '').includes(DATE), note?.message);

  console.log('\n════ Mail goes only where it was configured ════\n');

  sent.length = 0;
  await call('PUT', `/attendance-entry/${subject.id}/${DATE}`, T.admin, { checkIn: '09:45', checkOut: '18:15' });
  check('with notify off, no mail is attempted at all', sent.length === 0, sent.map(m => m.to));

  await setCheckin({ allowViewReporteeEntries: true, allowEditReporteeEntries: true,
    notifyOnReporteeEdit: { enabled: true, email: 'balaji@altiusnxt.com' } });
  sent.length = 0;
  await call('PUT', `/attendance-entry/${subject.id}/${DATE}`, T.admin, { checkIn: '09:55', checkOut: '18:25' });
  await new Promise(r => setTimeout(r, 150));
  check('with notify on, exactly one message is produced', sent.length === 1, sent.map(m => m.to));
  check('addressed only to the configured address, nobody else',
    sent.length === 1 && String(sent[0].to) === 'balaji@altiusnxt.com', sent.map(m => m.to));

  console.log('\n════ A save that changes nothing says so ════\n');

  const same = await call('PUT', `/attendance-entry/${subject.id}/${DATE}`, T.admin, { checkIn: '09:55', checkOut: '18:25' });
  check('re-saving identical times reports no change',
    same.j?.data?.changes?.length === 0, same.j?.data?.changes);

  console.log('\n════ Restoring ════\n');

  for (const fn of made) await fn().catch(() => {});
  await pool.query(`UPDATE employees SET reporting_manager_id=$1 WHERE id=$2`, [ORIG_MGR, subject.id]);
  await pool.query(`UPDATE employees SET reporting_manager_id=$1 WHERE id=$2`, [ORIG_MGR, stranger.id]);
  await pool.query(`UPDATE settings SET attendance_checkin_config = $1::jsonb`, [JSON.stringify(ORIG_CHECKIN)]);
  await pool.query(`UPDATE settings SET attendance_policy_config = $1::jsonb`, [JSON.stringify(ORIG_POLICY)]);
  require('./utils/attendanceConfig').invalidate();
  await pool.query(`DELETE FROM audit_log WHERE resource='Attendance entry' AND created_at > NOW() - INTERVAL '10 minutes'`);
  await pool.query(`DELETE FROM notifications WHERE employee_id=$1 AND title='Your attendance was edited'`, [subject.id]);

  const back = (await pool.query(`SELECT attendance_checkin_config AS c FROM settings LIMIT 1`)).rows[0].c;
  check('the configuration is put back', JSON.stringify(back) === JSON.stringify(ORIG_CHECKIN));
  check('and the probe day is gone',
    (await pool.query(`SELECT COUNT(*)::int n FROM attendance WHERE employee_id=$1 AND date=$2`,
      [subject.id, DATE])).rows[0].n === 0);

  server.close();
  const failed = checks.filter(c => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed\n`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch(async e => {
  console.error(e);
  for (const fn of made) await fn().catch(() => {});
  if (ORIG_CHECKIN) await pool.query(
    `UPDATE settings SET attendance_checkin_config = $1::jsonb`, [JSON.stringify(ORIG_CHECKIN)]).catch(() => {});
  process.exit(1);
});
