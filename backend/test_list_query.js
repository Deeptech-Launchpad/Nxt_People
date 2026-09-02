/* The shared list-view engine: criteria, sort, scope, paging.
 *
 * Employees, Departments and Designations are one screen with three column
 * sets, so they share utils/listQuery.js. That file concatenates column names
 * and operators into SQL — neither can be a bound parameter — which makes the
 * field registry a security boundary, not a convenience.
 *
 * What has to hold:
 *
 *   1. Filters actually narrow. One that is accepted and ignored is worse than
 *      one that is refused, because the screen looks like it answered.
 *   2. Nothing from the request reaches SQL. An unknown field, an unknown
 *      operator or an injected sort key is DROPPED, not guessed at.
 *   3. Neither criteria nor the All Data scope can WIDEN what the caller may
 *      already see. This is the one that matters: the employee list carries
 *      salary, identity and contact details, and a manager is restricted to
 *      their own reports.
 *   4. Identity numbers never leave in a list response, in any shape.
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
const { buildCriteria, buildOrder } = require('./utils/listQuery');

const checks = [];
const check = (l, ok, x) => { checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '\n          ' + JSON.stringify(x).slice(0, 300)}`); };

let PORT = 0;
const get = (p, token) => new Promise(resolve => {
  http.get({ host: '127.0.0.1', port: PORT, path: '/api' + p, headers: { Authorization: 'Bearer ' + token } },
    res => { let d = ''; res.on('data', c => d += c);
      res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch {} resolve({ s: res.statusCode, j }); }); })
    .on('error', e => resolve({ s: 0, j: null, err: e.message }));
});
const crit = (rows) => encodeURIComponent(JSON.stringify(rows));

(async () => {
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  PORT = server.address().port;

  const admin = (await pool.query(
    `SELECT id FROM employees WHERE role IN ('admin','director','hr_admin')
       AND status='active' AND deleted_at IS NULL LIMIT 1`)).rows[0];
  if (!admin) { console.log('  no admin in this database\n'); await pool.end(); server.close(); process.exit(0); }
  const token = jwt.sign({ id: admin.id }, process.env.JWT_SECRET, { expiresIn: '5m' });

  console.log('\nShared list-view engine\n');

  /* 1 - the registry is a closed set (unit level, no HTTP). */
  {
    const fields = { name: { column: 'e.first_name', type: 'text' } };
    const ok = buildCriteria(fields, [{ field: 'name', operator: 'is', value: 'x' }], 1);
    check('a known field/operator builds a bound predicate',
      ok.clause.includes('e.first_name = $1') && ok.params[0] === 'x', ok);

    const badField = buildCriteria(fields, [{ field: 'password', operator: 'is', value: 'x' }], 1);
    check('an unknown FIELD is dropped, not interpolated',
      badField.clause === '' && badField.params.length === 0, badField);

    const badOp = buildCriteria(fields, [{ field: 'name', operator: 'DROP TABLE', value: 'x' }], 1);
    check('an unknown OPERATOR is dropped', badOp.clause === '' && badOp.params.length === 0, badOp);

    const injected = buildCriteria(fields,
      [{ field: 'name', operator: 'is', value: "x'; DROP TABLE employees; --" }], 1);
    check('a hostile VALUE stays a bound parameter, never SQL',
      injected.clause === ' AND e.first_name = $1' &&
      injected.params[0] === "x'; DROP TABLE employees; --", injected);

    check('an unknown sort key falls back to the default',
      buildOrder(fields, 'e.id; DROP TABLE employees', 'asc', 'e.created_at').startsWith('e.created_at'),
      buildOrder(fields, 'e.id; DROP TABLE employees', 'asc', 'e.created_at'));

    check('malformed criteria JSON yields no filter rather than a 500',
      buildCriteria(fields, '{not json', 1).clause === '');
  }

  /* 2 - filters narrow over HTTP, on both modules. */
  {
    const all = await get('/employees?limit=1', token);
    const active = await get(`/employees?limit=1&criteria=${crit([{ field: 'status', operator: 'is', value: 'active' }])}`, token);
    check('employees: a status filter narrows the total',
      all.s === 200 && active.s === 200 && active.j.total < all.j.total,
      { all: all.j?.total, active: active.j?.total });

    const none = await get(`/employees?limit=1&criteria=${crit([{ field: 'status', operator: 'is', value: 'zzz-nope' }])}`, token);
    check('  ...and a filter matching nobody returns nothing', none.s === 200 && none.j.total === 0, none.j?.total);
  }
  {
    const all = await get('/org-setup/departments?page=1&limit=5', token);
    const one = await get(`/org-setup/departments?page=1&limit=5&criteria=${crit([{ field: 'name', operator: 'contains', value: 'a' }])}`, token);
    check('departments: a contains filter narrows',
      all.s === 200 && one.s === 200 && one.j.total <= all.j.total, { all: all.j?.total, one: one.j?.total });
  }

  /* 3 - Settings still gets the unpaged list it has always got. */
  {
    const r = await get('/org-setup/departments', token);
    check('an unpaged call still returns every row (Settings is unchanged)',
      r.s === 200 && Array.isArray(r.j.data) && r.j.data.length === r.j.total, r.j?.total);
  }

  /* 4 - sorting on a JOINed column does not break the count query. */
  {
    const r = await get('/employees?limit=2&sortBy=reportingManager&sortDir=asc', token);
    check('sorting on the reporting manager works, count included',
      r.s === 200 && typeof r.j.total === 'number', r.j);
  }

  /* 5 - THE DANGEROUS ONE: scope and criteria may not widen a manager. */
  {
    /* A skipped security check is worth nothing, so rather than bail when the
     * database has no manager, borrow a team member into the role for the
     * duration and put them back afterwards. */
    let mgr = (await pool.query(
      `SELECT id FROM employees WHERE role='manager' AND status='active' AND deleted_at IS NULL LIMIT 1`)).rows[0];
    let borrowed = null;
    if (!mgr) {
      const victim = (await pool.query(
        `SELECT id, role FROM employees WHERE role='team_member' AND status='active'
           AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`)).rows[0];
      if (victim) {
        borrowed = victim;
        await pool.query(`UPDATE employees SET role='manager' WHERE id=$1`, [victim.id]);
        mgr = { id: victim.id };
        console.log('  (no manager on file - borrowed a team member for this check)');
      }
    }
    if (!mgr) {
      console.log('  (no employee available to test manager scope with)');
      check('manager widening check could run', false, 'no candidate');
    } else {
      const mt = jwt.sign({ id: mgr.id }, process.env.JWT_SECRET, { expiresIn: '5m' });
      const base = await get('/employees?limit=200', mt);
      const seen = new Set((base.j?.data || []).map(r => String(r._id)));

      for (const scope of ['all', 'reportees', 'reportees_and_me', 'direct', 'my']) {
        const r = await get(`/employees?limit=200&scope=${scope}`, mt);
        const extra = (r.j?.data || []).filter(x => !seen.has(String(x._id)));
        check(`scope=${scope} cannot reveal anyone new to a manager`,
          r.s === 200 && extra.length === 0, extra.map(x => x.employeeId));
      }

      // A criteria row naming somebody outside their line must still return
      // nothing, not that person.
      const outsider = (await pool.query(
        `SELECT employee_id FROM employees
          WHERE deleted_at IS NULL AND id <> $1
            AND (reporting_manager_id IS DISTINCT FROM $1) LIMIT 1`, [mgr.id])).rows[0];
      if (outsider) {
        const r = await get(
          `/employees?limit=200&criteria=${crit([{ field: 'employeeId', operator: 'is', value: outsider.employee_id }])}`, mt);
        const got = (r.j?.data || []).filter(x => !seen.has(String(x._id)));
        check('a filter naming someone outside the line returns them not at all',
          r.s === 200 && got.length === 0, got.map(x => x.employeeId));
      }
    }
    if (borrowed) await pool.query(`UPDATE employees SET role=$1 WHERE id=$2`, [borrowed.role, borrowed.id]);
  }

  /* 6 - identity numbers never appear in a list payload. */
  {
    const r = await get('/employees?limit=50', token);
    const blob = JSON.stringify(r.j?.data || []);
    const leaked = ['aadhaarNumber', 'panNumber', 'uanNumber', 'aadhaar_number', 'pan_number']
      .filter(k => blob.includes(k));
    check('no identity number field is present in the list at all',
      r.s === 200 && leaked.length === 0, leaked);
    check('  ...only the has-one-on-file flags are',
      (r.j?.data || []).every(x => 'hasPan' in x && 'hasAadhaar' in x));
  }

  const passed = checks.filter(Boolean).length;
  console.log(`\n  ${passed}/${checks.length} passed\n`);
  await pool.end(); server.close();
  process.exit(passed === checks.length ? 0 : 1);
})().catch(async e => { console.error(e); await pool.end().catch(() => {}); process.exit(1); });
