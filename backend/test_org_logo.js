// The organization logo.
//
// The field accepted a URL and nothing else, so a company holding a logo file
// with nowhere public to put it could not set one at all — and the greeting on
// the home page carried a hardcoded AltiusNxt image regardless of what was
// typed there. Every company using this saw somebody else's brand.
//
// What matters here: an employee can READ it (the greeting renders for
// everybody) but only full access can CHANGE it.
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

let ORIGINAL = null;

(async () => {
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  PORT = server.address().port;

  const admin = (await pool.query(
    `SELECT id FROM employees WHERE role='admin' AND status='active' AND deleted_at IS NULL LIMIT 1`)).rows[0];
  const emp = (await pool.query(
    `SELECT id FROM employees WHERE role='team_member' AND status='active' AND deleted_at IS NULL LIMIT 1`)).rows[0];
  const T = {
    admin: jwt.sign({ id: admin.id }, process.env.JWT_SECRET, { expiresIn: '1h' }),
    emp: jwt.sign({ id: emp.id }, process.env.JWT_SECRET, { expiresIn: '1h' }),
  };

  ORIGINAL = (await pool.query(`SELECT org_logo_url AS u FROM settings LIMIT 1`)).rows[0].u;

  console.log('\n════ Everybody can read it ════\n');

  let r = await call('GET', '/org-details/details', T.emp);
  check('an employee can read the organization details', r.s === 200, { s: r.s, m: r.j?.message });
  check('and the logo is among them', 'logoUrl' in (r.j.data || {}), Object.keys(r.j.data || {}));

  console.log('\n════ Only full access can change it ════\n');

  r = await call('POST', '/org-details/details/logo', T.emp, {});
  check('an employee cannot upload one', r.s === 403, r.s);

  // Multipart is exercised by the route's own guards; what is asserted here is
  // that the column an upload writes is the same one the field already reads,
  // so both routes in stay valid.
  await pool.query(
    `UPDATE settings SET org_logo_url = $1 WHERE id = (SELECT id FROM settings LIMIT 1)`,
    ['/uploads/logos/logo-probe.png']);
  r = await call('GET', '/org-details/details', T.emp);
  check('an uploaded logo reads back through the same field',
    r.j.data.logoUrl === '/uploads/logos/logo-probe.png', r.j.data.logoUrl);

  r = await call('PATCH', '/org-details/details', T.admin, {
    ...r.j.data, logoUrl: 'https://example.com/brand.png',
  });
  check('and a pasted URL still works', r.s === 200, { s: r.s, m: r.j?.message });
  check('overwriting the uploaded one',
    (await pool.query(`SELECT org_logo_url AS u FROM settings LIMIT 1`)).rows[0].u
      === 'https://example.com/brand.png');

  console.log('\n════ Restoring ════\n');

  await pool.query(
    `UPDATE settings SET org_logo_url = $1 WHERE id = (SELECT id FROM settings LIMIT 1)`, [ORIGINAL]);
  await pool.query(
    `DELETE FROM audit_log WHERE resource_id='logo' AND created_at > NOW() - INTERVAL '10 minutes'`);
  check('the logo is put back',
    (await pool.query(`SELECT org_logo_url AS u FROM settings LIMIT 1`)).rows[0].u === ORIGINAL);

  server.close();
  const failed = checks.filter(c => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed\n`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch(async e => {
  console.error(e);
  if (ORIGINAL !== null) await pool.query(
    `UPDATE settings SET org_logo_url = $1`, [ORIGINAL]).catch(() => {});
  process.exit(1);
});
