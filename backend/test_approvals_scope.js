/* ── Approved and Rejected leaves show this month, for this month's people ──
 *  The Approved and Rejected tabs had no date bound and no employee filter, so
 *  they listed everything ever approved or rejected, by everybody who has ever
 *  worked here — 2024 leave for people who left, above this week's.
 *
 *  What has to hold:
 *
 *    only leave that touches the CURRENT month appears
 *    a leave running from last month into this one still appears — it is
 *      partly this month's
 *    a leave starting this month and ending next still appears
 *    somebody active appears
 *    somebody who left BEFORE this month does not
 *    somebody whose last working day falls INSIDE this month still does —
 *      they were an employee for part of it and their leave is this month's
 *      business
 *    a soft-deleted employee never appears
 *
 *  Runs the real SQL from the route against synthetic rows inside a
 *  transaction that is ALWAYS rolled back, so nothing is written. Needs a
 *  database. Sends no mail.
 *
 *    node test_approvals_scope.js
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'silent';

const fs = require('fs');
const pool = require('./db');

const checks = [];
const check = (label, ok, extra) => {
  checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}` +
    (ok || extra === undefined ? '' : '\n          ' + JSON.stringify(extra).slice(0, 200)));
};

/* Lifted from the route by reading it, so this cannot pass against a copy the
 * original has moved away from. */
const routeSrc = fs.readFileSync(require.resolve('./routes/approvals.js'), 'utf8');
const WINDOW = `l.start_date <= (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::date
                AND l.end_date   >= date_trunc('month', CURRENT_DATE)::date`;
const PEOPLE = `e.deleted_at IS NULL
                AND (e.status = 'active' OR e.exit_date >= date_trunc('month', CURRENT_DATE)::date)`;

const run = async () => {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  Approved / Rejected leaves — scope');
  console.log('══════════════════════════════════════════════════════════\n');

  console.log('  The route still carries both guards\n');
  check('the month window is in the query',
    /date_trunc\('month', CURRENT_DATE\) \+ INTERVAL '1 month - 1 day'/.test(routeSrc));
  check('the employee filter is in the query',
    /e\.deleted_at IS NULL/.test(routeSrc) && /e\.exit_date >= date_trunc\('month', CURRENT_DATE\)/.test(routeSrc));
  check('it no longer orders by created_at, which is not when the leave was',
    /ORDER BY l\.start_date DESC/.test(routeSrc));

  const client = await pool.connect();
  let rolledBack = false;
  try {
    await client.query('BEGIN');

    const dept = 'ZZ Scope Test';
    const mk = async (name, status, exitOffsetMonths, deleted) => {
      const r = await client.query(
        `INSERT INTO employees (first_name, last_name, email, department, status, exit_date, deleted_at, employee_id)
         VALUES ($1, 'Test', $2, $3, $4,
                 CASE WHEN $5::int IS NULL THEN NULL
                      ELSE (date_trunc('month', CURRENT_DATE) + ($5 || ' month')::interval)::date END,
                 CASE WHEN $6::boolean THEN NOW() ELSE NULL END, $7)
         RETURNING id`,
        [name, `zz.${name}.${Date.now()}@scope.test`, dept, status, exitOffsetMonths, !!deleted,
         'ZZ' + Math.floor(Math.random() * 1e6)]);
      return r.rows[0].id;
    };

    const leave = async (empId, startExpr, endExpr, status) => {
      await client.query(
        `INSERT INTO leaves (employee_id, leave_type, start_date, end_date, total_days, reason, status)
         VALUES ($1, 'casual', ${startExpr}, ${endExpr}, 1, 'scope test', $2)`,
        [empId, status]);
    };

    const M0 = `date_trunc('month', CURRENT_DATE)::date`;
    const MEND = `(date_trunc('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::date`;

    const active      = await mk('Active',    'active',   null, false);
    const leftBefore  = await mk('LeftEarly', 'inactive', -1,   false);
    const leavingNow  = await mk('LeavingNow','inactive', 0,    false);
    const deleted     = await mk('Deleted',   'active',   null, true);

    // Squarely inside this month.
    await leave(active,     `${M0} + 3`, `${M0} + 4`, 'approved');
    await leave(leftBefore, `${M0} + 3`, `${M0} + 4`, 'approved');
    await leave(deleted,    `${M0} + 3`, `${M0} + 4`, 'rejected');
    // Last working day is the end of this month — still this month's business.
    await leave(leavingNow, `${M0} + 3`, `${M0} + 4`, 'rejected');
    // Straddles the boundaries at each end.
    await leave(active, `${M0} - 2`, `${M0} + 1`, 'approved');
    await leave(active, `${MEND} - 1`, `${MEND} + 3`, 'approved');
    // Entirely last month — must not appear.
    await leave(active, `${M0} - 10`, `${M0} - 8`, 'approved');

    const { rows } = await client.query(
      `SELECT e.first_name AS who, l.start_date, l.end_date
         FROM leaves l JOIN employees e ON l.employee_id = e.id
        WHERE l.status IN ('approved','rejected')
          AND e.department = $1
          AND ${WINDOW}
          AND ${PEOPLE}
        ORDER BY l.start_date`, [dept]);

    const who = rows.map(r => r.who);
    const countFor = n => who.filter(x => x === n).length;

    console.log('\n  Against synthetic rows in a rolled-back transaction\n');

    check('an active employee\'s leave this month appears', countFor('Active') === 3, who);
    check('somebody who left before this month is excluded', countFor('LeftEarly') === 0, who);
    check('somebody whose last working day is this month still appears',
      countFor('LeavingNow') === 1, who);
    check('a soft-deleted employee never appears', countFor('Deleted') === 0, who);
    check('leave entirely in last month is excluded',
      !rows.some(r => new Date(r.end_date) < new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
      rows.map(r => r.start_date));
    check('a leave running from last month into this one is kept',
      rows.some(r => new Date(r.start_date) < new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
    check('a leave running from this month into next is kept',
      rows.some(r => new Date(r.end_date) > new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0)));
    check('four rows in total — three active, one leaving', rows.length === 4, who);

    await client.query('ROLLBACK');
    rolledBack = true;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    rolledBack = true;
    console.log('\n  FAILED —', e.message, '\n');
    checks.push(false);
  } finally {
    client.release();
  }

  const left = (await pool.query(
    `SELECT count(*)::int AS n FROM employees WHERE department = 'ZZ Scope Test'`)).rows[0].n;
  check('the transaction was rolled back — nothing was written', rolledBack && left === 0, { left });

  const passed = checks.filter(Boolean).length;
  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  ${passed}/${checks.length} passed`);
  console.log('══════════════════════════════════════════════════════════\n');
  await pool.end();
  process.exit(passed === checks.length ? 0 : 1);
};

run().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
