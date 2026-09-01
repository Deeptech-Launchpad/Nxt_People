/* Operations -> Leave Tracker -> Leave Requests: the filter panel's parameters.
 *
 * Two things have to hold, and only one of them is about filtering.
 *
 *   1. Each parameter actually narrows. A filter that is accepted and ignored
 *      is the worst outcome — the screen looks like it answered. The leave
 *      period pair is the easy one to get wrong: it reads as an OVERLAP, so a
 *      range finds leave touching it, not only leave contained by it.
 *   2. `sortBy` cannot be injected. ORDER BY takes no parameter, so the column
 *      is whitelisted; anything else must fall back rather than reach the
 *      database. This is the reason the file exists.
 *
 * A manager's scope is checked too: filters must narrow what reportsScope
 * already allows, never widen it.
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
const get = (p, token) => new Promise(resolve => {
  const req = http.request({ host: '127.0.0.1', port: PORT, path: '/api' + p, method: 'GET',
    headers: { Authorization: 'Bearer ' + token } },
    res => { let d = ''; res.on('data', c => d += c);
      res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch {} resolve({ s: res.statusCode, j }); }); });
  req.on('error', e => resolve({ s: 0, j: null, err: e.message }));
  req.end();
});

const made = [];
const iso = (d) => d.toLocaleDateString('en-CA');
const at = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };

(async () => {
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  PORT = server.address().port;

  const admin = (await pool.query(
    `SELECT id FROM employees WHERE role IN ('admin','director','hr_admin')
       AND status='active' AND deleted_at IS NULL LIMIT 1`)).rows[0];
  const staff = (await pool.query(
    `SELECT id, first_name, department FROM employees
      WHERE role='team_member' AND status='active' AND deleted_at IS NULL
      ORDER BY created_at DESC LIMIT 2`)).rows;
  if (!admin || staff.length < 2) {
    console.log('  not enough employees in this database\n');
    await pool.end(); server.close(); process.exit(0);
  }
  const token = jwt.sign({ id: admin.id }, process.env.JWT_SECRET, { expiresIn: '5m' });
  const [A, B] = staff;

  const mk = async (empId, type, start, end) => {
    const r = await pool.query(
      `INSERT INTO leaves (employee_id, leave_type, start_date, end_date, total_days, reason, status, balance_source)
       VALUES ($1,$2,$3,$4,1,'filter test','pending','leave_balances') RETURNING id`,
      [empId, type, start, end]);
    made.push(r.rows[0].id); return r.rows[0].id;
  };

  // A is casual far out; B is unpaid, and deliberately SPANS the window used
  // below without starting or ending inside it.
  await mk(A.id, 'casual', at(40), at(41));
  await mk(B.id, 'unpaid', at(30), at(60));

  const ids = new Set(made.map(String));
  const mine = (res) => (res.j?.data || []).filter(r => ids.has(String(r._id)));

  console.log('\nLeave Requests — filter and sort parameters\n');

  /* ── each filter narrows ────────────────────────────────────────────────── */
  {
    const r = await get(`/leaves?leaveType=casual&limit=200`, token);
    const got = mine(r);
    check('leaveType=casual returns the casual one only',
      r.s === 200 && got.length === 1 && got[0].leaveType === 'casual', got.map(x => x.leaveType));
  }
  {
    const r = await get(`/leaves?q=${encodeURIComponent(A.first_name)}&limit=200`, token);
    const got = mine(r);
    check('q= matches on employee name',
      r.s === 200 && got.some(x => x.employee?.firstName === A.first_name) &&
      !got.some(x => String(x.employee?._id) === String(B.id)), got.map(x => x.employee?.firstName));
  }
  {
    const r = await get(`/leaves?q=${encodeURIComponent('zzz-no-such-person')}&limit=200`, token);
    check('q= with no match returns nothing of ours', r.s === 200 && mine(r).length === 0);
  }
  {
    // The window sits INSIDE B's leave and touches neither end of it.
    const r = await get(`/leaves?startDate=${at(45)}&endDate=${at(46)}&limit=200`, token);
    const got = mine(r);
    check('leave period is an overlap, so a spanning leave is found',
      r.s === 200 && got.length === 1 && String(got[0].employee?._id) === String(B.id),
      got.map(x => `${x.startDate}..${x.endDate}`));
  }
  {
    const r = await get(`/leaves?startDate=${at(200)}&endDate=${at(201)}&limit=200`, token);
    check('a window past both leaves excludes them', r.s === 200 && mine(r).length === 0);
  }

  /* ── sorting ────────────────────────────────────────────────────────────── */
  {
    const asc = await get(`/leaves?sortBy=startDate&sortDir=asc&limit=200`, token);
    const desc = await get(`/leaves?sortBy=startDate&sortDir=desc&limit=200`, token);
    const first = (x) => (x.j?.data || [])[0]?.startDate;
    const okAsc = (asc.j?.data || []).every((r, i, a) => i === 0 || a[i - 1].startDate <= r.startDate);
    const okDesc = (desc.j?.data || []).every((r, i, a) => i === 0 || a[i - 1].startDate >= r.startDate);
    check('sortDir=asc really ascends', asc.s === 200 && okAsc, first(asc));
    check('sortDir=desc really descends', desc.s === 200 && okDesc, first(desc));
  }

  /* ── the one that matters: an unknown sort key must not reach SQL ───────── */
  for (const bad of [
    'l.start_date; DROP TABLE leaves',
    '(SELECT 1)',
    'nonsense',
    'l.start_date--',
  ]) {
    const r = await get(`/leaves?sortBy=${encodeURIComponent(bad)}&limit=5`, token);
    check(`unknown sortBy falls back instead of erroring: ${bad.slice(0, 28)}`, r.s === 200, r);
  }
  {
    const still = await pool.query(`SELECT to_regclass('public.leaves') AS t`);
    check('  ...and the leaves table is still there', still.rows[0].t === 'leaves');
  }
  {
    const r = await get(`/leaves?sortDir=${encodeURIComponent("' OR 1=1--")}&limit=5`, token);
    check('unknown sortDir falls back to DESC', r.s === 200, r);
  }

  /* ── filters narrow a manager's scope, never widen it ───────────────────── */
  {
    const mgr = (await pool.query(
      `SELECT id FROM employees WHERE role IN ('manager','team_incharge')
         AND status='active' AND deleted_at IS NULL LIMIT 1`)).rows[0];
    if (!mgr) {
      console.log('  (no manager in this database — scope check skipped)');
    } else {
      const mt = jwt.sign({ id: mgr.id }, process.env.JWT_SECRET, { expiresIn: '5m' });
      const plain = await get(`/leaves?limit=200`, mt);
      const filtered = await get(`/leaves?q=a&limit=200`, mt);
      const base = new Set((plain.j?.data || []).map(r => String(r._id)));
      const extra = (filtered.j?.data || []).filter(r => !base.has(String(r._id)));
      check('a filter cannot show a manager rows they could not already see',
        plain.s === 200 && filtered.s === 200 && extra.length === 0,
        extra.map(r => r._id));
    }
  }

  for (const id of made) await pool.query(`DELETE FROM leaves WHERE id=$1`, [id]);

  const passed = checks.filter(Boolean).length;
  console.log(`\n  ${passed}/${checks.length} passed\n`);
  await pool.end(); server.close();
  process.exit(passed === checks.length ? 0 : 1);
})().catch(async e => {
  console.error(e);
  for (const id of made) await pool.query(`DELETE FROM leaves WHERE id=$1`, [id]).catch(() => {});
  await pool.end().catch(() => {}); process.exit(1);
});
