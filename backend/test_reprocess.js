// "Update older attendance entries" — the button that re-applies the saved
// policy to days already recorded.
//
// This drives the real endpoint against seeded days whose answers are known,
// because the one failure mode that matters is a button that rewrites thousands
// of rows and reports a number nobody checked.
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({ sendMail: async () => ({ ok: true }), verify: async () => true });

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

// Old enough that no real data sits alongside, recent enough to be past.
const D = n => `2019-06-${String(n).padStart(2, '0')}`;
const made = [];
let ORIGINAL = null, ORIG_COLS = null;

const statusOf = async (empId, date) => (await pool.query(
  `SELECT status, working_hours FROM attendance WHERE employee_id=$1 AND date=$2`, [empId, date])).rows[0];

(async () => {
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  PORT = server.address().port;

  const admin = (await pool.query(
    `SELECT id FROM employees WHERE role='admin' AND status='active' AND deleted_at IS NULL LIMIT 1`)).rows[0];
  const member = (await pool.query(
    `SELECT id FROM employees WHERE role='team_member' AND status='active' AND deleted_at IS NULL LIMIT 1`)).rows[0];
  const T = { admin: jwt.sign({ id: admin.id }, process.env.JWT_SECRET, { expiresIn: '1h' }),
              member: jwt.sign({ id: member.id }, process.env.JWT_SECRET, { expiresIn: '1h' }) };
  const EMP = member.id;

  ORIGINAL = (await pool.query(`SELECT attendance_policy_config AS c FROM settings LIMIT 1`)).rows[0].c;
  ORIG_COLS = (await pool.query(
    `SELECT expected_hours_mode AS m, expected_hours_per_day AS f, expected_half_day_hours AS h FROM settings LIMIT 1`)).rows[0];

  // HR's rule: eight hours, no tolerance, a short day is absent.
  await pool.query(
    `UPDATE settings SET attendance_policy_config = $1::jsonb,
            expected_hours_mode = 'manual', expected_hours_per_day = 8, expected_half_day_hours = 4`,
    [JSON.stringify({ ...(ORIGINAL || {}), calculateHoursFrom: 'every', mode: 'custom',
      strictMode: true, shortDayBecomes: 'absent', toleranceMinutes: 0,
      leaveReducesExpected: true, permissionReducesExpected: true,
      halfDayLeaveOtherHalf: 'leave', exemptOnDuty: false,
      ruleEffectiveFrom: D(10), allowOvertimeAndDeviation: true })]);

  // Four days, all currently stored as 'present':
  //   D(5)  before the effective date — must be left alone entirely
  //   D(11) 7.6h — was present under the old 7.5h rule, absent under 8h
  //   D(12) 8.2h — genuinely a full day, must not move
  //   D(13) 6h with 2h permission — owed 6h, so it must NOT become absent
  const seeds = [[D(5), 7.6], [D(11), 7.6], [D(12), 8.2], [D(13), 6]];
  for (const [d, h] of seeds) {
    await pool.query(`DELETE FROM attendance WHERE employee_id=$1 AND date=$2`, [EMP, d]);
    const id = (await pool.query(
      `INSERT INTO attendance (employee_id, date, check_in, check_out, status, working_hours, late_minutes)
       VALUES ($1,$2,($2::date + '09:30'::time),($2::date + '18:00'::time),'present',$3,0) RETURNING id`,
      [EMP, d, h])).rows[0].id;
    made.push(() => pool.query(`DELETE FROM attendance WHERE id=$1`, [id]));
  }

  const perm = (await pool.query(
    `INSERT INTO leaves (employee_id, leave_type, start_date, end_date, total_days, hours, reason, status)
     VALUES ($1,'permission',$2::date,$2::date,0,2,'reprocess probe','approved') RETURNING id`,
    [EMP, D(13)])).rows[0].id;
  made.push(() => pool.query(`DELETE FROM leaves WHERE id=$1`, [perm]));

  console.log('\n  seeded 7.6h before the effective date, 7.6h after, 8.2h, and 6h with 2h permission\n');

  console.log('════ The dry run reports without writing ════\n');

  const dry = await call('POST', '/attendance-config/policy/reprocess', T.admin, { apply: false });
  check('the dry run succeeds', dry.s === 200, { s: dry.s, m: dry.j?.message });
  const d = dry.j?.data || {};
  check('it counts from the effective date', d.from === D(10), d.from);
  check('and says it did not apply', d.applied === false, d.applied);

  const mine = (d.sample || []).filter(x => x.date >= D(1) && x.date <= D(30));
  check('exactly one of the seeded days would change', mine.length === 1, mine);
  check('and it is the 7.6h day after the effective date',
    mine[0]?.date === D(11) && mine[0]?.to === 'absent', mine[0]);

  check('nothing was written yet', (await statusOf(EMP, D(11))).status === 'present',
    await statusOf(EMP, D(11)));

  console.log('\n════ The effective date protects earlier days ════\n');

  check('the identical day before the effective date is not listed',
    !(d.sample || []).some(x => x.date === D(5)), (d.sample || []).map(x => x.date));

  console.log('\n════ Permission is honoured, not treated as a short day ════\n');

  check('6h worked against 2h permission is not listed as changing',
    !(d.sample || []).some(x => x.date === D(13)), (d.sample || []).map(x => x.date));
  check('and a genuinely full day is not listed either',
    !(d.sample || []).some(x => x.date === D(12)));

  console.log('\n════ Applying ════\n');

  const applied = await call('POST', '/attendance-config/policy/reprocess', T.admin, { apply: true });
  check('applying succeeds', applied.s === 200, applied.s);
  check('and reports what it wrote', applied.j?.data?.written === applied.j?.data?.changed,
    applied.j?.data);

  check('the 7.6h day after the effective date is now absent',
    (await statusOf(EMP, D(11))).status === 'absent', await statusOf(EMP, D(11)));
  check('the same day BEFORE the effective date is untouched',
    (await statusOf(EMP, D(5))).status === 'present', await statusOf(EMP, D(5)));
  check('the permission day stays present',
    (await statusOf(EMP, D(13))).status === 'present', await statusOf(EMP, D(13)));
  check('the full day stays present',
    (await statusOf(EMP, D(12))).status === 'present', await statusOf(EMP, D(12)));

  check('working hours were not touched',
    Number((await statusOf(EMP, D(11))).working_hours) === 7.6,
    await statusOf(EMP, D(11)));

  console.log('\n════ Running it again has nothing left to do ════\n');

  const again = await call('POST', '/attendance-config/policy/reprocess', T.admin, { apply: false });
  const mineAgain = (again.j?.data?.sample || []).filter(x => x.date >= D(1) && x.date <= D(30));
  check('the seeded days no longer appear', mineAgain.length === 0, mineAgain);

  console.log('\n════ Who may run it ════\n');

  const denied = await call('POST', '/attendance-config/policy/reprocess', T.member, { apply: true });
  check('a team member cannot run it', denied.s === 403, denied.s);

  console.log('\n════ It leaves an audit entry ════\n');

  const audit = (await pool.query(
    `SELECT changes FROM audit_log WHERE resource_id='policy' ORDER BY created_at DESC LIMIT 1`)).rows[0];
  check('the apply was recorded', /re-applied the policy/.test(audit?.changes?.summary || ''),
    audit?.changes?.summary);

  console.log('\n════ Restoring ════\n');

  for (const fn of made) await fn().catch(() => {});
  await pool.query(
    `UPDATE settings SET attendance_policy_config = $1::jsonb,
            expected_hours_mode = $2, expected_hours_per_day = $3, expected_half_day_hours = $4`,
    [JSON.stringify(ORIGINAL), ORIG_COLS.m, ORIG_COLS.f, ORIG_COLS.h]);
  await pool.query(
    `DELETE FROM audit_log WHERE resource_id='policy' AND created_at > NOW() - INTERVAL '10 minutes'`);
  const back = (await pool.query(`SELECT attendance_policy_config AS c FROM settings LIMIT 1`)).rows[0].c;
  check('the policy is put back', JSON.stringify(back) === JSON.stringify(ORIGINAL));
  check('and the seeded days are gone',
    (await pool.query(`SELECT COUNT(*)::int n FROM attendance WHERE employee_id=$1 AND date BETWEEN $2 AND $3`,
      [EMP, D(1), D(30)])).rows[0].n === 0);

  server.close();
  const failed = checks.filter(c => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed\n`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch(async e => {
  console.error(e);
  for (const fn of made) await fn().catch(() => {});
  if (ORIGINAL) await pool.query(
    `UPDATE settings SET attendance_policy_config = $1::jsonb`, [JSON.stringify(ORIGINAL)]).catch(() => {});
  process.exit(1);
});
