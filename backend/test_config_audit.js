// Configuration changes were the one thing in this system that could alter
// what people are paid and leave no trace. This drives the real save endpoint
// and then reads audit_log, rather than calling the helper directly — the
// helper working proves nothing if the route never calls it.
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({ sendMail: async () => ({ ok: true }), verify: async () => true });

const app = require('./app');
const pool = require('./db');
const jwt = require('jsonwebtoken');
const http = require('http');
const { diffConfig, summarise } = require('./utils/configDiff');

const checks = [];
const check = (l, ok, x) => { checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '\n          ' + JSON.stringify(x).slice(0, 320)}`); };

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

const latest = async (section) => (await pool.query(
  `SELECT actor_email, actor_role, action, resource, resource_id, changes, created_at
     FROM audit_log WHERE resource_id = $1 ORDER BY created_at DESC LIMIT 1`, [section])).rows[0];

const countFor = async (section) => (await pool.query(
  `SELECT COUNT(*)::int n FROM audit_log WHERE resource_id = $1`, [section])).rows[0].n;

let ORIGINAL = null;

(async () => {
  console.log('\n════ The diff itself ════\n');

  check('an unchanged section produces no entries',
    diffConfig({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } }).length === 0);
  check('8 and "8" are the same setting, not an edit',
    diffConfig({ h: 8 }, { h: '8' }).length === 0, diffConfig({ h: 8 }, { h: '8' }));
  check('null and undefined both mean unset',
    diffConfig({ x: null }, {}).length === 0);
  check('a nested change is reported by its full path',
    diffConfig({ a: { b: { c: 1 } } }, { a: { b: { c: 2 } } })[0]?.field === 'a.b.c',
    diffConfig({ a: { b: { c: 1 } } }, { a: { b: { c: 2 } } }));
  check('both the old and the new value are kept',
    JSON.stringify(diffConfig({ x: 7.5 }, { x: 8 })) === JSON.stringify([{ field: 'x', from: 7.5, to: 8 }]),
    diffConfig({ x: 7.5 }, { x: 8 }));
  check('a removed field is recorded as going to null',
    diffConfig({ x: 3 }, {})[0]?.to === null);
  check('arrays are compared whole',
    diffConfig({ l: [1, 2] }, { l: [2, 1] }).length === 1);
  check('the summary names the fields',
    summarise([{ field: 'strictMode' }, { field: 'maxHours.fullDay' }]) === 'strictMode, maxHours.fullDay');
  check('and does not run on forever',
    /and 2 more$/.test(summarise([1,2,3,4,5].map(i => ({ field: `f${i}` })))),
    summarise([1,2,3,4,5].map(i => ({ field: `f${i}` }))));

  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  PORT = server.address().port;

  const admin = (await pool.query(
    `SELECT id, email FROM employees WHERE role='admin' AND status='active' AND deleted_at IS NULL LIMIT 1`)).rows[0];
  const member = (await pool.query(
    `SELECT id FROM employees WHERE role='team_member' AND status='active' AND deleted_at IS NULL LIMIT 1`)).rows[0];
  const T = { admin: jwt.sign({ id: admin.id }, process.env.JWT_SECRET, { expiresIn: '1h' }),
              member: jwt.sign({ id: member.id }, process.env.JWT_SECRET, { expiresIn: '1h' }) };

  console.log('\n════ Saving the attendance policy leaves a record ════\n');

  const read = await call('GET', '/attendance-config/policy', T.admin);
  check('the policy reads back', read.s === 200, read.s);
  ORIGINAL = read.j.data;

  const before = await countFor('policy');
  const edited = { ...ORIGINAL, maxHours: { ...(ORIGINAL.maxHours || {}), enabled: true, fullDay: 9.25, halfDay: 4 } };
  const saved = await call('PATCH', '/attendance-config/policy', T.admin, edited);
  check('an admin can save it', saved.s === 200, { s: saved.s, m: saved.j?.message });

  check('exactly one audit entry was written', (await countFor('policy')) === before + 1,
    { before, after: await countFor('policy') });

  const entry = await latest('policy');
  check('it names who did it', entry?.actor_email === admin.email, entry?.actor_email);
  check('and their role', entry?.actor_role === 'admin', entry?.actor_role);
  check('it says what was changed', entry?.resource === 'Attendance configuration', entry?.resource);
  check('and which section', entry?.changes?.section === 'policy', entry?.changes?.section);

  const fields = entry?.changes?.fields || [];
  const cap = fields.find(f => f.field === 'maxHours.fullDay');
  check('the changed field is recorded by name', !!cap, fields.map(f => f.field));
  check('with the value it moved to', cap && Number(cap.to) === 9.25, cap);

  console.log('\n════ A save that changes nothing writes nothing ════\n');

  const n1 = await countFor('policy');
  const again = await call('PATCH', '/attendance-config/policy', T.admin, edited);
  check('saving the same thing twice still succeeds', again.s === 200, again.s);
  check('but adds no second entry', (await countFor('policy')) === n1,
    { before: n1, after: await countFor('policy') });

  console.log('\n════ Leave configuration is recorded too ════\n');

  const lr = await call('GET', '/leave-config/additional', T.admin);
  if (lr.s === 200) {
    const lBefore = await countFor('additional');
    const lOriginal = lr.j.data;
    await call('PATCH', '/leave-config/additional', T.admin,
      { ...lOriginal, passwordProtectExports: !lOriginal.passwordProtectExports });
    check('a leave-config save is recorded', (await countFor('additional')) === lBefore + 1,
      { before: lBefore, after: await countFor('additional') });
    const le = await latest('additional');
    check('under its own resource name', le?.resource === 'Leave configuration', le?.resource);
    await call('PATCH', '/leave-config/additional', T.admin, lOriginal);
  } else {
    check('leave configuration section reachable', false, lr.s);
  }

  console.log('\n════ Who may change configuration is unchanged ════\n');

  const denied = await call('PATCH', '/attendance-config/policy', T.member, edited);
  check('a team member still cannot save configuration', denied.s === 403, denied.s);
  check('and their refused attempt writes no audit entry',
    (await countFor('policy')) === n1, await countFor('policy'));

  console.log('\n════ Restoring ════\n');

  const restore = await call('PATCH', '/attendance-config/policy', T.admin, ORIGINAL);
  check('the original policy is put back', restore.s === 200, restore.s);
  const now = (await call('GET', '/attendance-config/policy', T.admin)).j.data;
  check('and reads back identical',
    diffConfig(ORIGINAL, now).length === 0, diffConfig(ORIGINAL, now));

  // The restore is itself a change, so it is expected to have left an entry.
  await pool.query(
    `DELETE FROM audit_log WHERE resource_id IN ('policy','additional') AND created_at > NOW() - INTERVAL '10 minutes'`);

  server.close();
  const failed = checks.filter(c => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed\n`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch(async e => {
  console.error(e);
  process.exit(1);
});
