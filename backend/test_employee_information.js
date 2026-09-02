/* Groups, Delegation, Saved Views and Insights.
 *
 * The happy paths are dull; these are the ways each one goes quietly wrong.
 *
 *   Groups      - demoting or removing the LAST administrator leaves a group
 *                 nobody can maintain, and nothing on screen would say so.
 *   Delegation  - delegating to yourself, or two overlapping delegations from
 *                 the same person, leave it undefined who holds an approval.
 *   Saved views - a view SHARED with you is not a view you own. Without that,
 *                 sharing hands every recipient the ability to rewrite it for
 *                 everybody else.
 *   Insights    - the whole organisation's shape including attrition, so it is
 *                 full access only however senior a manager is.
 *
 * Nothing here sends mail, and the two routes that offer to notify are checked
 * for saying plainly that they did not.
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

const madeGroups = [], madeDelegations = [], madeViews = [];
const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };

(async () => {
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  PORT = server.address().port;

  const admin = (await pool.query(
    `SELECT id, role FROM employees WHERE role IN ('admin','director','hr_admin')
       AND status='active' AND deleted_at IS NULL LIMIT 1`)).rows[0];
  const staff = (await pool.query(
    `SELECT id FROM employees WHERE role='team_member' AND status='active' AND deleted_at IS NULL
      ORDER BY created_at DESC LIMIT 3`)).rows;
  if (!admin || staff.length < 3) {
    console.log('  not enough employees in this database\n');
    await pool.end(); server.close(); process.exit(0);
  }
  const [A, B, C] = staff.map(s => s.id);
  const adminToken = jwt.sign({ id: admin.id }, process.env.JWT_SECRET, { expiresIn: '10m' });
  const staffToken = jwt.sign({ id: A },        process.env.JWT_SECRET, { expiresIn: '10m' });

  console.log('\nEmployee Information: Groups, Delegation, Views, Insights\n');

  /* ---------- Groups ---------- */
  let groupId = null;
  {
    const res = await call('POST', '/employee-groups', adminToken,
      { name: 'Test Group', description: 'made by a test', administrators: [A], members: [B] });
    check('a group is created with an administrator', res.s === 201, res);
    groupId = res.j?.data?._id;
    if (groupId) madeGroups.push(groupId);

    const got = await call('GET', `/employee-groups/${groupId}`, adminToken);
    const members = got.j?.data?.members || [];
    check('  ...and lists both people, admin first',
      members.length === 2 && members[0].role === 'admin', members.map(m => m.role));
  }
  {
    const res = await call('POST', '/employee-groups', adminToken,
      { name: 'No Admin Group', administrators: [] });
    check('a group with no administrator is refused', res.s === 400, res.j);
  }
  {
    // The dangerous one: the only admin must not be demotable or removable.
    const demote = await call('PUT', `/employee-groups/${groupId}/members/${A}`, adminToken, { role: 'member' });
    check('the LAST administrator cannot be demoted', demote.s === 400, demote.j);

    const remove = await call('DELETE', `/employee-groups/${groupId}/members/${A}`, adminToken);
    check('  ...nor removed', remove.s === 400, remove.j);

    // With a second admin in place both become allowed.
    await call('POST', `/employee-groups/${groupId}/members`, adminToken, { employeeIds: [C], role: 'admin' });
    const now = await call('PUT', `/employee-groups/${groupId}/members/${A}`, adminToken, { role: 'member' });
    check('  ...but once somebody else is admin, demotion is allowed', now.s === 200, now.j);
  }
  {
    const dup = await call('POST', `/employee-groups/${groupId}/members`, adminToken, { employeeIds: [B] });
    check('adding somebody already in the group is a no-op, not an error',
      dup.s === 200 && dup.j.added === 0, dup.j);
  }
  {
    const res = await call('POST', '/employee-groups', staffToken, { name: 'Nope', administrators: [A] });
    check('a team member cannot create a group', res.s === 403, res.s);
  }
  {
    const res = await call('POST', '/employee-groups', adminToken,
      { name: 'Notify Group', administrators: [A], notify: true });
    check('asking to notify does NOT send, and says so',
      res.s === 201 && /not sent automatically|nobody has been emailed/i.test(res.j?.message || ''),
      res.j?.message);
    if (res.j?.data?._id) madeGroups.push(res.j.data._id);
  }

  /* ---------- Delegation ---------- */
  {
    const res = await call('POST', '/delegations', adminToken,
      { delegatorId: A, delegateeId: A, type: 'temporary', startsAt: iso(1), endsAt: iso(5) });
    check('delegating to yourself is refused', res.s === 400, res.j);
  }
  {
    const res = await call('POST', '/delegations', adminToken,
      { delegatorId: A, delegateeId: B, type: 'temporary' });
    check('a temporary delegation without dates is refused', res.s === 400, res.j);
  }
  {
    const res = await call('POST', '/delegations', adminToken,
      { delegatorId: A, delegateeId: B, type: 'temporary', startsAt: iso(10), endsAt: iso(2) });
    check('an end date before the start is refused', res.s === 400, res.j);
  }
  {
    const ok = await call('POST', '/delegations', adminToken,
      { delegatorId: A, delegateeId: B, type: 'temporary', startsAt: iso(1), endsAt: iso(10) });
    check('a valid delegation is saved', ok.s === 201, ok.j);
    if (ok.j?.data?._id) madeDelegations.push(ok.j.data._id);
    check('  ...and says nobody was emailed',
      /not sent automatically|nobody has been emailed/i.test(ok.j?.message || ''), ok.j?.message);

    const clash = await call('POST', '/delegations', adminToken,
      { delegatorId: A, delegateeId: C, type: 'temporary', startsAt: iso(5), endsAt: iso(15) });
    check('a second, OVERLAPPING delegation from the same person is refused',
      clash.s === 400, clash.j);
    if (clash.j?.data?._id) madeDelegations.push(clash.j.data._id);

    const after = await call('POST', '/delegations', adminToken,
      { delegatorId: A, delegateeId: C, type: 'temporary', startsAt: iso(20), endsAt: iso(25) });
    check('  ...but a non-overlapping one is fine', after.s === 201, after.j);
    if (after.j?.data?._id) madeDelegations.push(after.j.data._id);
  }
  {
    // A person party to a delegation sees it; the rest of the org does not.
    const mine = await call('GET', '/delegations', staffToken);
    const ids = (mine.j?.data || []).map(d => String(d._id));
    check('a team member sees the delegations they are party to',
      mine.s === 200 && ids.length > 0, ids.length);
    const outsiderToken = jwt.sign({ id: C }, process.env.JWT_SECRET, { expiresIn: '10m' });
    const theirs = await call('GET', '/delegations', outsiderToken);
    const notParty = (theirs.j?.data || []).filter(
      d => String(d.delegator?.id) !== String(C) && String(d.delegatee?.id) !== String(C));
    check('  ...and none they are not party to', notParty.length === 0, notParty.length);
  }

  /* ---------- Saved views ---------- */
  let viewId = null;
  {
    const res = await call('POST', '/saved-views', adminToken,
      { module: 'employees', name: 'Test View', visibility: 'everyone', columns: ['employeeId', 'firstName'] });
    check('a public view is created', res.s === 201, res.j);
    viewId = res.j?.data?._id;
    if (viewId) madeViews.push(viewId);
  }
  {
    const res = await call('POST', '/saved-views', adminToken,
      { module: 'employees', name: 'No Columns', columns: [] });
    check('a view with no columns is refused', res.s === 400, res.j);
  }
  {
    const res = await call('POST', '/saved-views', adminToken,
      { module: 'employees', name: 'Empty Share', visibility: 'shared', columns: ['employeeId'], shareWith: {} });
    check('"shared" with nobody is refused', res.s === 400, res.j);
  }
  {
    const res = await call('POST', '/saved-views', adminToken,
      { module: 'not_a_module', name: 'X', columns: ['a'] });
    check('an unknown module is refused', res.s === 400, res.j);
  }
  {
    // The dangerous one: a recipient of a shared view must not be able to
    // rewrite it for everybody.
    const res = await call('PUT', `/saved-views/${viewId}`, staffToken,
      { module: 'employees', name: 'Hijacked', columns: ['employeeId'] });
    check('somebody who did not create a view cannot edit it', res.s === 403, res.j);

    const del = await call('DELETE', `/saved-views/${viewId}`, staffToken);
    check('  ...nor delete it', del.s === 403, del.j);

    const still = await call('GET', '/saved-views?module=employees', staffToken);
    check('  ...and it is still there, unrenamed',
      (still.j?.data || []).some(v => v.name === 'Test View'),
      (still.j?.data || []).map(v => v.name));
  }
  {
    // Column prefs are always the caller's own.
    await call('PUT', '/saved-views/column-prefs/employees', staffToken, { hidden: ['gender'] });
    const mine = await call('GET', '/saved-views/column-prefs/employees', staffToken);
    const other = await call('GET', '/saved-views/column-prefs/employees', adminToken);
    check('column prefs are per person',
      (mine.j?.data?.hidden || []).includes('gender') &&
      !(other.j?.data?.hidden || []).includes('gender'),
      { mine: mine.j?.data, other: other.j?.data });
  }

  /* ---------- Insights ---------- */
  {
    const res = await call('GET', '/employee-insights', adminToken);
    const d = res.j?.data;
    check('insights returns headcount, trend and distributions',
      res.s === 200 && typeof d?.headcount?.current === 'number' &&
      d.trend.length === 6 && Array.isArray(d.departments), Object.keys(d || {}));
    check('  ...and every trend month carries a headcount to compute against',
      (d?.trend || []).every(m => typeof m.headcount === 'number'), d?.trend?.[0]);

    const denied = await call('GET', '/employee-insights', staffToken);
    check('a team member cannot read org-wide attrition', denied.s === 403, denied.s);
  }

  // Cleanup.
  for (const id of madeDelegations) await pool.query('DELETE FROM approval_delegations WHERE id=$1', [id]);
  for (const id of madeViews) await pool.query('DELETE FROM saved_views WHERE id=$1', [id]);
  for (const id of madeGroups) await pool.query('DELETE FROM employee_groups WHERE id=$1', [id]);
  await pool.query('DELETE FROM list_column_prefs WHERE employee_id = ANY($1::uuid[])', [[A, admin.id]]);

  const passed = checks.filter(Boolean).length;
  console.log(`\n  ${passed}/${checks.length} passed\n`);
  await pool.end(); server.close();
  process.exit(passed === checks.length ? 0 : 1);
})().catch(async e => { console.error(e); await pool.end().catch(() => {}); process.exit(1); });
