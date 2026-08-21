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
const fs = require('fs');
const path = require('path');

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

  r = await call('PUT', '/cover-image', T.emp, { cover: 'preset:meadow' });
  check('choosing one is refused on the route, not just hidden',
    r.s === 403, { s: r.s, m: r.j?.message });

  console.log('\n════ With presets allowed ════\n');

  await setPolicy({ allowSystemOptions: true, allowCustomUpload: false });

  r = await call('PUT', '/cover-image', T.emp, { cover: 'preset:meadow' });
  check('a preset can be chosen', r.s === 200, { s: r.s, m: r.j?.message });

  const stored = (await pool.query(
    `SELECT cover_image_url AS c FROM employees WHERE id=$1`, [EMP])).rows[0].c;
  check('and it is what was stored', stored === 'preset:meadow', stored);

  r = await call('PUT', '/cover-image', T.emp, { cover: 'preset:nonsense' });
  check('an unknown preset is refused', r.s === 400, { s: r.s, m: r.j?.message });

  r = await call('GET', '/cover-image', T.emp);
  const presets = r.j.data.presets || {};
  check('six banners ship with the app', Object.keys(presets).length === 6, Object.keys(presets));
  check('and each one points at a real file',
    Object.values(presets).every(p => typeof p.url === 'string' && p.url.startsWith('/covers/')),
    Object.values(presets).map(p => p.url));

  // The path existing in the config says nothing about the file existing on
  // disk. A preset naming a missing image is a broken banner that only shows
  // up when somebody picks it.
  const missing = Object.entries(presets).filter(([, p]) =>
    !fs.existsSync(path.join(__dirname, '..', 'frontend', 'public', p.url.replace(/^\//, ''))));
  check('and the file is actually there', missing.length === 0, missing.map(([k]) => k));

  r = await call('PUT', '/cover-image', T.emp, { cover: '/uploads/covers/../../etc/passwd' });
  check('a path outside the cover directory is refused', r.s === 400, { s: r.s, m: r.j?.message });

  r = await call('PUT', '/cover-image', T.emp, { cover: null });
  check('and it can be cleared back to the organization cover', r.s === 200, r.s);
  check('which stores null, not a copy of the org cover',
    (await pool.query(`SELECT cover_image_url AS c FROM employees WHERE id=$1`, [EMP])).rows[0].c === null);

  console.log('\n════ The organization cover answers for everybody else ════\n');

  r = await call('PUT', '/cover-image/org', T.admin, { cover: 'preset:tide' });
  check('an admin can set it', r.s === 200, { s: r.s, m: r.j?.message });

  r = await call('PUT', '/cover-image/org', T.emp, { cover: 'preset:dunes' });
  check('an employee cannot', r.s === 403, r.s);

  r = await call('GET', '/cover-image', T.emp);
  check('somebody with no cover of their own sees the organization one',
    r.j.data.cover === 'preset:tide' && r.j.data.own === null, r.j.data);

  await call('PUT', '/cover-image', T.emp, { cover: 'preset:pine' });
  r = await call('GET', '/cover-image', T.emp);
  check('and their own choice wins once made',
    r.j.data.cover === 'preset:pine', r.j.data);

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

  r = await call('PUT', '/cover-image', T.emp, { cover: 'preset:dunes' });
  check('an employee still cannot choose their own', r.s === 403, r.s);

  r = await call('PUT', '/cover-image/org', T.admin, { cover: 'preset:dunes' });
  check('but an admin can set the organization cover', r.s === 200, { s: r.s, m: r.j?.message });

  // This employee picked their own earlier, and their own correctly wins. The
  // organization cover only answers for somebody who has not chosen.
  await pool.query(`UPDATE employees SET cover_image_url = NULL WHERE id = $1`, [EMP]);
  r = await call('GET', '/cover-image', T.emp);
  check('and anybody without a cover of their own sees it',
    r.j.data.cover === 'preset:dunes' && r.j.data.own === null, r.j.data);

  r = await call('POST', '/cover-image/upload?target=org', T.emp, {});
  check('an employee cannot upload one for the organization', r.s === 403, r.s);

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
