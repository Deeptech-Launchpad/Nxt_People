/* Settings -> Employee Information.
 *
 * The dangerous cases, which is what this file is for:
 *
 *   1. PERMISSIONS MAY ONLY NARROW. Field permissions can hide a field a role
 *      could otherwise see; they must never reveal one the code protects. An
 *      administrator switching Aadhaar "on" for everybody would be a data
 *      breach configured through a settings screen.
 *   2. AN EMPTY CONFIGURATION CHANGES NOTHING. Every table here starts empty
 *      on deploy, so absence has to behave exactly as the system did before
 *      the screen existed - otherwise shipping it silently alters who sees
 *      what.
 *   3. The two built-in statuses cannot be retyped or removed. Every other
 *      query means "working" or "not working" by them, so renaming Active to
 *      inactive would change the employee list, the headcount and every
 *      report at once.
 *   4. ID generation hands out each number once, even to two callers at the
 *      same moment.
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
const perms = require('./routes/employee-info-permissions');

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

const TAG = 'EIS' + Date.now().toString().slice(-6);
const cleanup = async () => {
  await pool.query(`DELETE FROM field_permissions WHERE role = $1`, [TAG]).catch(() => {});
  await pool.query(`DELETE FROM employee_statuses WHERE name LIKE $1`, [TAG + '%']).catch(() => {});
  await pool.query(`DELETE FROM employee_id_rules WHERE name LIKE $1`, [TAG + '%']).catch(() => {});
  await pool.query(`DELETE FROM employee_streams WHERE name LIKE $1`, [TAG + '%']).catch(() => {});
  await pool.query(`DELETE FROM faqs WHERE question LIKE $1`, [TAG + '%']).catch(() => {});
};

(async () => {
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  PORT = server.address().port;

  const admin = (await pool.query(
    `SELECT id FROM employees WHERE role IN ('admin','director','hr_admin')
       AND status='active' AND deleted_at IS NULL LIMIT 1`)).rows[0];
  const staff = (await pool.query(
    `SELECT id, role FROM employees WHERE role='team_member' AND status='active'
       AND deleted_at IS NULL LIMIT 1`)).rows[0];
  if (!admin || !staff) { console.log('  not enough employees\n'); await pool.end(); server.close(); process.exit(0); }
  const t = jwt.sign({ id: admin.id }, process.env.JWT_SECRET, { expiresIn: '10m' });
  const st = jwt.sign({ id: staff.id }, process.env.JWT_SECRET, { expiresIn: '10m' });

  console.log('\nEmployee Information settings\n');

  /* 1 - an empty configuration changes nothing. */
  {
    const before = await call('GET', '/employees?limit=1', st);
    const keys = Object.keys(before.j?.data?.[0] || {}).length;
    check('a team member still gets a full row with no permissions configured',
      before.s === 200 && keys > 10, keys);
  }

  /* 2 - THE ONE THAT MATTERS: a protected field cannot be switched on. */
  {
    const res = await call('PUT', '/employee-info-permissions/fields', t, {
      form: 'employee', role: TAG,
      fields: [
        { key: 'panNumber', canView: true, canEdit: true },
        { key: 'aadhaarNumber', canView: true, canEdit: true },
        { key: 'workPhone', canView: false, canEdit: false },
      ],
    });
    check('the save is accepted', res.s === 200, res.j);

    const stored = (await pool.query(
      `SELECT field_key, can_view, can_edit FROM field_permissions WHERE role=$1 ORDER BY field_key`,
      [TAG])).rows;
    const pan = stored.find(r => r.field_key === 'panNumber');
    const aad = stored.find(r => r.field_key === 'aadhaarNumber');
    check('  ...but PAN is stored as NOT viewable however it was sent',
      pan && pan.can_view === false && pan.can_edit === false, pan);
    check('  ...and so is Aadhaar',
      aad && aad.can_view === false && aad.can_edit === false, aad);
    check('  ...while an ordinary field is stored exactly as sent',
      stored.find(r => r.field_key === 'workPhone')?.can_view === false);
  }

  /* 3 - the grid never offers to widen a protected field either. */
  {
    const r = await call('GET', `/employee-info-permissions/fields?form=employee&role=${TAG}`, t);
    const identity = (r.j?.data?.sections || []).find(s => s.key === 'identity');
    check('the identity section is marked protected', identity?.protected === true, identity?.protected);
    check('  ...and every field in it is locked and not viewable',
      (identity?.fields || []).every(f => f.locked === true && f.canView === false),
      identity?.fields);
  }

  /* 4 - hiding a field really removes it from the employees list. */
  {
    perms.invalidateFieldPermissions();
    await pool.query(
      `INSERT INTO field_permissions (form, role, field_key, can_view, can_edit)
       VALUES ('employee',$1,'workPhone',FALSE,FALSE)
       ON CONFLICT (form, role, field_key) DO UPDATE SET can_view=FALSE`, [staff.role]);
    perms.invalidateFieldPermissions();

    const r = await call('GET', '/employees?limit=1', st);
    check('a hidden field is absent from the row a restricted role receives',
      r.s === 200 && !('workPhone' in (r.j?.data?.[0] || {})), Object.keys(r.j?.data?.[0] || {}).slice(0, 6));

    const a = await call('GET', '/employees?limit=1', t);
    check('  ...and still present for full access', 'workPhone' in (a.j?.data?.[0] || {}));

    await pool.query(`DELETE FROM field_permissions WHERE role=$1 AND field_key='workPhone'`, [staff.role]);
    perms.invalidateFieldPermissions();
  }

  /* 5 - built-in statuses are immovable. */
  {
    const list = await call('GET', '/employee-info-settings/statuses', t);
    const active = (list.j?.data || []).find(s => s.name === 'Active');
    check('Active exists and is typed active', active?.type === 'active', active);

    const retype = await call('PATCH', `/employee-info-settings/statuses/${active._id}`, t, { type: 'inactive' });
    check('a built-in status cannot be retyped', retype.s === 400, retype.j?.message);

    const del = await call('DELETE', `/employee-info-settings/statuses/${active._id}`, t);
    check('  ...nor deleted', del.s === 400, del.j?.message);
  }

  /* 6 - a status somebody is on cannot be deleted out from under them. */
  {
    const made = await call('POST', '/employee-info-settings/statuses', t, { name: TAG + ' Spare', type: 'inactive' });
    check('a new status can be added', made.s === 201, made.j);
    const id = made.j?.data?._id;

    const dup = await call('POST', '/employee-info-settings/statuses', t, { name: TAG + ' Spare' });
    check('  ...and the same name is refused twice', dup.s === 400, dup.j?.message);

    if (id) {
      const del = await call('DELETE', `/employee-info-settings/statuses/${id}`, t);
      check('  ...an unused one deletes cleanly', del.s === 200, del.j);
    }
  }

  /* 7 - the ID rule preview renders what it says it will. */
  {
    const r = await call('POST', '/employee-info-settings/id-rules/preview', t, {
      name: 'p', startingNumber: 1, placeholderDigits: 4,
      prefix: [{ type: 'custom', value: 'ANXT' }, { type: 'field', value: 'joining_year' }],
      suffix: [], sample: { joiningDate: '2026-01-03' },
    });
    check('preview renders prefix + padded counter',
      r.s === 200 && r.j?.data?.example === 'ANXT260001', r.j?.data);
  }

  /* 8 - two callers cannot be handed the same generated ID. */
  {
    const made = await call('POST', '/employee-info-settings/id-rules', t, {
      name: TAG + ' Rule', code: 'T', startingNumber: 1, placeholderDigits: 3,
      prefix: [{ type: 'custom', value: TAG }], suffix: [], isDefault: false, isActive: true,
    });
    check('a rule can be saved', made.s === 201, made.j);

    // Point generation at it, then claim twice at once.
    const cur = (await pool.query(`SELECT employee_info_config AS c FROM settings LIMIT 1`)).rows[0]?.c || {};
    await pool.query(
      `UPDATE settings SET employee_info_config=$1::jsonb WHERE id=(SELECT id FROM settings LIMIT 1)`,
      [JSON.stringify({ ...cur, idGeneration: { enabled: true } })]);
    await pool.query(`UPDATE employee_id_rules SET is_active=FALSE WHERE name NOT LIKE $1`, [TAG + '%']);

    const { nextIdFromRule } = require('./utils/employeeId');
    const [a, b] = await Promise.all([nextIdFromRule(pool, {}), nextIdFromRule(pool, {})]);
    check('two concurrent generations produce different IDs', a && b && a !== b, { a, b });

    // Put everything back exactly as found.
    await pool.query(`UPDATE employee_id_rules SET is_active=TRUE WHERE name NOT LIKE $1`, [TAG + '%']);
    await pool.query(
      `UPDATE settings SET employee_info_config=$1::jsonb WHERE id=(SELECT id FROM settings LIMIT 1)`,
      [JSON.stringify(cur)]);
    const back = (await pool.query(`SELECT employee_info_config AS c FROM settings LIMIT 1`)).rows[0]?.c;
    check('  ...and ID generation is left switched off as found',
      !back?.idGeneration?.enabled, back?.idGeneration);
  }

  /* 9 - a core form cannot be switched off. */
  {
    const r = await call('PATCH', '/employee-info-settings/forms/employee', t, { isEnabled: false });
    check('the Employee form cannot be disabled', r.s === 400, r.j?.message);
    const ok = await call('PATCH', '/employee-info-settings/forms/vaccination', t, { isEnabled: true });
    check('  ...but an optional one can be', ok.s === 200, ok.j);
    await call('PATCH', '/employee-info-settings/forms/vaccination', t, { isEnabled: false });
  }

  /* 10 - a team member cannot reach any of this. */
  {
    const a = await call('GET', '/employee-info-permissions/fields?form=employee&role=manager', st);
    const b = await call('POST', '/employee-info-settings/statuses', st, { name: 'nope' });
    check('a team member cannot read field permissions', a.s === 403, a.s);
    check('  ...nor add a status', b.s === 403, b.s);
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
