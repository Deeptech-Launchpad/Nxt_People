// The cover image on My Space.
//
// The two switches on Organization Policy have governed nothing since they were
// built. What matters now is that they govern on the WRITE — a switch that only
// hides a button is not a rule, and a browser tab left open would still be able
// to set a cover.
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
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '\n          ' + JSON.stringify(x).slice(0, 260)}`); };

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

let ORIG = null, EMP = null;

const setPolicy = (patch) => pool.query(
  `UPDATE settings SET organization_policy_config = $1::jsonb`,
  [JSON.stringify({ ...(ORIG || {}), coverImage: { ...((ORIG || {}).coverImage || {}), ...patch } })]);

(async () => {
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  PORT = server.address().port;

  const emp = (await pool.query(
    `SELECT id FROM employees WHERE role='team_member' AND status='active' AND deleted_at IS NULL
      ORDER BY created_at DESC LIMIT 1`)).rows[0];
  const admin = (await pool.query(
    `SELECT id FROM employees WHERE role='admin' AND status='active' AND deleted_at IS NULL LIMIT 1`)).rows[0];
  EMP = emp.id;
  const T = {
    emp: jwt.sign({ id: emp.id }, process.env.JWT_SECRET, { expiresIn: '1h' }),
    admin: jwt.sign({ id: admin.id }, process.env.JWT_SECRET, { expiresIn: '1h' }),
  };

  ORIG = (await pool.query(`SELECT organization_policy_config AS c FROM settings LIMIT 1`)).rows[0].c;
  await pool.query(`UPDATE employees SET cover_image_url = NULL WHERE id = $1`, [EMP]);

  console.log('\n════ Both switches off means nothing can be set ════\n');

  await setPolicy({ allowSystemOptions: false, allowCustomUpload: false });

  let r = await call('GET', '/cover-image', T.emp);
  check('the cover still reads back', r.s === 200, r.s);
  check('and reports that neither is allowed',
    r.j.data.allowSystemOptions === false && r.j.data.allowCustomUpload === false, r.j.data);

  r = await call('PUT', '/cover-image', T.emp, { cover: 'preset:forest' });
  check('choosing one is refused on the route, not just hidden',
    r.s === 403, { s: r.s, m: r.j?.message });

  console.log('\n════ With presets allowed ════\n');

  await setPolicy({ allowSystemOptions: true, allowCustomUpload: false });

  r = await call('PUT', '/cover-image', T.emp, { cover: 'preset:forest' });
  check('a preset can be chosen', r.s === 200, { s: r.s, m: r.j?.message });

  const stored = (await pool.query(
    `SELECT cover_image_url AS c FROM employees WHERE id=$1`, [EMP])).rows[0].c;
  check('and it is what was stored', stored === 'preset:forest', stored);

  r = await call('PUT', '/cover-image', T.emp, { cover: 'preset:nonsense' });
  check('an unknown preset is refused', r.s === 400, { s: r.s, m: r.j?.message });

  r = await call('PUT', '/cover-image', T.emp, { cover: '/uploads/covers/../../etc/passwd' });
  check('a path outside the cover directory is refused', r.s === 400, { s: r.s, m: r.j?.message });

  r = await call('PUT', '/cover-image', T.emp, { cover: null });
  check('and it can be cleared back to the organization cover', r.s === 200, r.s);
  check('which stores null, not a copy of the org cover',
    (await pool.query(`SELECT cover_image_url AS c FROM employees WHERE id=$1`, [EMP])).rows[0].c === null);

  console.log('\n════ The organization cover answers for everybody else ════\n');

  r = await call('PUT', '/cover-image/org', T.admin, { cover: 'preset:tide' });
  check('an admin can set it', r.s === 200, { s: r.s, m: r.j?.message });

  r = await call('PUT', '/cover-image/org', T.emp, { cover: 'preset:ember' });
  check('an employee cannot', r.s === 403, r.s);

  r = await call('GET', '/cover-image', T.emp);
  check('somebody with no cover of their own sees the organization one',
    r.j.data.cover === 'preset:tide' && r.j.data.own === null, r.j.data);

  await call('PUT', '/cover-image', T.emp, { cover: 'preset:plum' });
  r = await call('GET', '/cover-image', T.emp);
  check('and their own choice wins once made',
    r.j.data.cover === 'preset:plum', r.j.data);

  console.log('\n════ The org cover survives an unrelated policy save ════\n');

  // org-details rebuilds the coverImage object on every save, so a key it does
  // not know about is silently dropped. That would erase the cover the moment
  // somebody toggled a switch on the same screen.
  const before = (await pool.query(`SELECT organization_policy_config AS c FROM settings LIMIT 1`)).rows[0].c;
  r = await call('PATCH', '/org-details/policy', T.admin, {
    coverImage: {
      allowSystemOptions: true, allowCustomUpload: true,
      orgImageUrl: before.coverImage?.orgImageUrl || null,
    },
  });
  const after = (await pool.query(`SELECT organization_policy_config AS c FROM settings LIMIT 1`)).rows[0].c;
  check('saving the switches does not erase the organization cover',
    after.coverImage?.orgImageUrl === 'preset:tide',
    { status: r.s, after: after.coverImage });

  console.log('\n════ Uploads follow their own switch ════\n');

  await setPolicy({ allowSystemOptions: true, allowCustomUpload: false });
  r = await call('POST', '/cover-image/upload', T.emp, {});
  check('with uploads off the route refuses', r.s === 403, { s: r.s, m: r.j?.message });

  console.log('\n════ An administrator can always set the one everybody sees ════\n');

  // Both switches off. Previously this left NOBODY able to set the banner, so
  // it stayed on the default gradient forever.
  await setPolicy({ allowSystemOptions: false, allowCustomUpload: false });

  r = await call('PUT', '/cover-image', T.emp, { cover: 'preset:ember' });
  check('an employee still cannot choose their own', r.s === 403, r.s);

  r = await call('PUT', '/cover-image/org', T.admin, { cover: 'preset:ember' });
  check('but an admin can set the organization cover', r.s === 200, { s: r.s, m: r.j?.message });

  // This employee picked their own earlier, and their own correctly wins. The
  // organization cover only answers for somebody who has not chosen.
  await pool.query(`UPDATE employees SET cover_image_url = NULL WHERE id = $1`, [EMP]);
  r = await call('GET', '/cover-image', T.emp);
  check('and anybody without a cover of their own sees it',
    r.j.data.cover === 'preset:ember' && r.j.data.own === null, r.j.data);

  r = await call('POST', '/cover-image/upload?target=org', T.emp, {});
  check('an employee cannot upload one for the organization', r.s === 403, r.s);

  console.log('\n════ The shared library ════\n');

  await setPolicy({ allowSystemOptions: true, allowCustomUpload: false, library: [] });

  r = await call('GET', '/cover-image', T.emp);
  check('the library comes back empty to start',
    Array.isArray(r.j.data.library) && r.j.data.library.length === 0, r.j.data.library);

  // Seeded directly. The upload itself is multipart and its guards are covered
  // above; what matters here is that a listed image can be chosen and an
  // unlisted one cannot — otherwise any path under /uploads/covers would do.
  const LIB = '/uploads/covers/probe-library.jpg';
  await setPolicy({ allowSystemOptions: true, allowCustomUpload: false, library: [LIB] });

  r = await call('GET', '/cover-image', T.emp);
  check('and carries the image once added', (r.j.data.library || [])[0] === LIB, r.j.data.library);

  r = await call('PUT', '/cover-image', T.emp, { cover: LIB });
  check('an employee can choose a library banner', r.s === 200, { s: r.s, m: r.j?.message });

  r = await call('PUT', '/cover-image', T.emp, { cover: '/uploads/covers/not-in-the-library.jpg' });
  check('but not an upload that is not in the library', r.s === 400, { s: r.s, m: r.j?.message });

  r = await call('DELETE', '/cover-image/library', T.emp, { cover: LIB });
  check('an employee cannot remove one', r.s === 403, r.s);

  r = await call('DELETE', '/cover-image/library', T.admin, { cover: LIB });
  check('an admin can', r.s === 200, { s: r.s, m: r.j?.message });

  r = await call('GET', '/cover-image', T.admin);
  check('and it leaves the library', !(r.j.data.library || []).includes(LIB), r.j.data.library);

  const stillSet = (await pool.query(
    `SELECT cover_image_url AS c FROM employees WHERE id=$1`, [EMP])).rows[0].c;
  check('somebody already using it keeps it', stillSet === LIB, stillSet);

  console.log('\n════ Restoring ════\n');

  await pool.query(`UPDATE employees SET cover_image_url = NULL WHERE id = $1`, [EMP]);
  await pool.query(`UPDATE settings SET organization_policy_config = $1::jsonb`, [JSON.stringify(ORIG)]);
  await pool.query(`DELETE FROM audit_log WHERE resource_id='coverImage' AND created_at > NOW() - INTERVAL '10 minutes'`);
  const back = (await pool.query(`SELECT organization_policy_config AS c FROM settings LIMIT 1`)).rows[0].c;
  check('the policy is put back', JSON.stringify(back) === JSON.stringify(ORIG));

  server.close();
  const failed = checks.filter(c => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed\n`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch(async e => {
  console.error(e);
  if (ORIG) await pool.query(
    `UPDATE settings SET organization_policy_config = $1::jsonb`, [JSON.stringify(ORIG)]).catch(() => {});
  process.exit(1);
});
