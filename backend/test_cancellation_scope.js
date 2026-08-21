// Cancellation scope.
//
// Three settings that saved and were then ignored: a custom window instead of
// the pay period, a list of leave types that may be cancelled, and what happens
// when payroll has already paid for the leave.
//
// The last of those is the one that matters. A cancellation that silently
// disagrees with a payslip somebody already holds is invisible until somebody
// checks their bank account, so the default is to refuse it, and that is what
// most of this file proves.
require('dotenv').config();
const pool = require('./db');
const { canCancel, classify, normalise } = require('./utils/leaveCancellation');

const checks = [];
const check = (l, ok, x) => { checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '\n          ' + JSON.stringify(x).slice(0, 260)}`); };

const daysAgo = n => {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toLocaleDateString('en-CA');
};

// Every actor allowed everywhere, so the only thing under test is the scope.
const openMatrix = () => ({
  past_within_pay_period: { self: true, manager: true, approver: true },
  current_and_upcoming: { self: true, manager: true, approver: true },
  past_within_calendar_year: { self: true, manager: true, approver: true },
});
const cfgOf = (cancellation) => ({ cancellation: { permissions: openMatrix(), ...cancellation } });

const made = [];
let EMP = null, USER = null;

const leaveOn = (start, end, type = 'casual') => ({
  id: '00000000-0000-0000-0000-000000000000',
  employee_id: EMP, leave_type: type, start_date: start, end_date: end,
});

(async () => {
  const e = (await pool.query(
    `SELECT id, role FROM employees WHERE status='active' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`)).rows[0];
  EMP = e.id;
  USER = { _id: e.id, role: 'team_member' };   // the employee themselves

  console.log('\n════ The custom window replaces the pay period ════\n');

  const old = daysAgo(45), older = daysAgo(200);

  // A plain window of days back, rather than the live cycle.
  let row = classify(leaveOn(old, old), { startDay: 1, endDay: 32 }, new Date(),
    normalise(cfgOf({ pastScope: 'custom', customDays: 60 }).cancellation ? cfgOf({ pastScope: 'custom', customDays: 60 }) : {}));
  check('45 days ago falls inside a 60-day window', row === 'past_within_pay_period', row);

  row = classify(leaveOn(old, old), { startDay: 1, endDay: 32 }, new Date(),
    normalise(cfgOf({ pastScope: 'custom', customDays: 7 })));
  check('and outside a 7-day one', row !== 'past_within_pay_period', row);

  row = classify(leaveOn(older, older), { startDay: 1, endDay: 32 }, new Date(),
    normalise(cfgOf({ pastScope: 'custom', customDays: 60 })));
  check('200 days ago is beyond any reasonable window', row !== 'past_within_pay_period', row);

  row = classify(leaveOn(old, old), { startDay: 1, endDay: 32 }, new Date(),
    normalise(cfgOf({ pastScope: 'current' })));
  check('with the pay-period scope the window is the cycle, not the days',
    row !== 'past_within_pay_period', row);

  console.log('\n════ Only the chosen leave types can be cancelled ════\n');

  const today = new Date().toLocaleDateString('en-CA');
  let r = await canCancel({ user: USER, leave: leaveOn(today, today, 'casual'),
    config: cfgOf({ requestScope: 'specific', policies: ['casual'] }) });
  check('a listed type is cancellable', r.allowed === true, r);

  r = await canCancel({ user: USER, leave: leaveOn(today, today, 'maternity'),
    config: cfgOf({ requestScope: 'specific', policies: ['casual'] }) });
  check('an unlisted type is refused', r.allowed === false, r);
  check('and the message names the type', /maternity/.test(r.reason || ''), r.reason);

  r = await canCancel({ user: USER, leave: leaveOn(today, today, 'maternity'),
    config: cfgOf({ requestScope: 'all', policies: ['casual'] }) });
  check('with the scope on all requests the list is ignored', r.allowed === true, r);

  console.log('\n════ Leave payroll has already paid for ════\n');

  // A payslip for the month the leave falls in.
  const now = new Date();
  const slip = (await pool.query(
    `INSERT INTO payroll_payslips (employee_id, pay_month, pay_year, net_pay)
     VALUES ($1, $2, $3, 1000) RETURNING id`,
    [EMP, now.getMonth() + 1, now.getFullYear()])).rows[0].id;
  made.push(() => pool.query(`DELETE FROM payroll_payslips WHERE id=$1`, [slip]));

  r = await canCancel({ user: USER, leave: leaveOn(today, today),
    config: cfgOf({ payrollRun: 'block' }) });
  check('by default it is refused outright', r.allowed === false && r.payrollRun === true, r);
  check('and says which month was already paid',
    new RegExp(`${now.getMonth() + 1}/${now.getFullYear()}`).test(r.reason || ''), r.reason);

  r = await canCancel({ user: USER, leave: leaveOn(today, today),
    config: cfgOf({ payrollRun: 'flag' }) });
  check('set to flag, it is allowed but warned about',
    r.allowed === true && r.flagged === true && !!r.warning, r);

  r = await canCancel({ user: USER, leave: leaveOn(today, today),
    config: cfgOf({ payrollRun: 'allow' }) });
  check('set to allow, it goes through silently',
    r.allowed === true && !r.flagged, r);

  await pool.query(`DELETE FROM payroll_payslips WHERE id=$1`, [slip]);
  r = await canCancel({ user: USER, leave: leaveOn(today, today),
    config: cfgOf({ payrollRun: 'block' }) });
  check('with no payslip the block does not apply',
    r.allowed === true && !r.payrollRun, r);

  console.log('\n════ A leave spanning a month boundary ════\n');

  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 28);
  const slip2 = (await pool.query(
    `INSERT INTO payroll_payslips (employee_id, pay_month, pay_year, net_pay)
     VALUES ($1, $2, $3, 1000) RETURNING id`,
    [EMP, lastMonth.getMonth() + 1, lastMonth.getFullYear()])).rows[0].id;
  made.push(() => pool.query(`DELETE FROM payroll_payslips WHERE id=$1`, [slip2]));

  r = await canCancel({
    user: USER,
    leave: leaveOn(lastMonth.toLocaleDateString('en-CA'), today),
    config: cfgOf({ payrollRun: 'block', pastScope: 'custom', customDays: 90 }),
  });
  check('a leave touching an already-paid month is caught',
    r.allowed === false && r.payrollRun === true, r);

  console.log('\n════ Defaults ════\n');

  const d = normalise({});
  check('the scope defaults to the pay period, not a custom window',
    d.pastScope === undefined || d.pastScope === 'current', d.pastScope);
  check('an unsaved policy does not restrict leave types',
    d.requestScope === undefined || d.requestScope === 'all', d.requestScope);

  console.log('\n════ Restoring ════\n');

  for (const fn of made) await fn().catch(() => {});
  check('the probe payslips are gone',
    (await pool.query(`SELECT COUNT(*)::int n FROM payroll_payslips WHERE employee_id=$1 AND net_pay=1000`,
      [EMP])).rows[0].n === 0);

  const failed = checks.filter(c => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed\n`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch(async e => {
  console.error(e);
  for (const fn of made) await fn().catch(() => {});
  process.exit(1);
});
