/* Read-only. Writes nothing, sends nothing.
 *
 * PUT /leaves/:id/action refunded a rejected leave to `req.user._id`. That
 * route is approver-only, so req.user is the APPROVER, never the employee:
 * every rejection gave the days to whoever pressed Reject and left the
 * employee short by the same amount. Nothing errored, so nothing surfaced.
 *
 * This counts what that would have cost on whichever database it is pointed
 * at, per employee and per approver. It only reports — repairing balances is a
 * separate, deliberate step, and should not happen as a side effect of looking.
 */
require('dotenv').config();
const pool = require('./db');

const R = (n) => Math.round((parseFloat(n) || 0) * 100) / 100;

(async () => {
  const { rows: [tot] } = await pool.query(`
    SELECT COUNT(*)::int AS n, COALESCE(SUM(total_days),0) AS days,
           MIN(start_date) AS first, MAX(start_date) AS last
      FROM leaves
     WHERE status='rejected' AND leave_type <> 'unpaid' AND COALESCE(total_days,0) > 0`);

  console.log('\n  Rejected leaves that should have been refunded');
  console.log('  ─────────────────────────────────────────────────────────');
  console.log(`  ${tot.n} rejection(s), ${R(tot.days)} day(s) total`);
  if (tot.n === 0) {
    console.log('  Nothing to repair on this database.\n');
    await pool.end(); return;
  }
  console.log(`  spanning ${String(tot.first).slice(0,10)} to ${String(tot.last).slice(0,10)}\n`);

  const { rows: short } = await pool.query(`
    SELECT e.employee_id AS code, e.first_name, e.last_name, l.leave_type,
           EXTRACT(YEAR FROM l.start_date)::int AS yr,
           COUNT(*)::int AS n, SUM(l.total_days) AS days
      FROM leaves l JOIN employees e ON e.id = l.employee_id
     WHERE l.status='rejected' AND l.leave_type <> 'unpaid' AND COALESCE(l.total_days,0) > 0
     GROUP BY 1,2,3,4,5 ORDER BY days DESC`);

  console.log('  Employees short by this (they never got the days back)');
  console.log('  ─────────────────────────────────────────────────────────');
  for (const r of short) {
    console.log(`  ${String(r.code || '').padEnd(8)} ${`${r.first_name} ${r.last_name}`.padEnd(26)} ` +
      `${String(r.leave_type).padEnd(12)} ${r.yr}  ${String(R(r.days)).padStart(6)} day(s) over ${r.n}`);
  }

  const { rows: gained } = await pool.query(`
    SELECT e.employee_id AS code, e.first_name, e.last_name, l.leave_type,
           EXTRACT(YEAR FROM l.start_date)::int AS yr,
           COUNT(*)::int AS n, SUM(l.total_days) AS days
      FROM leaves l JOIN employees e ON e.id = l.approved_by
     WHERE l.status='rejected' AND l.leave_type <> 'unpaid' AND COALESCE(l.total_days,0) > 0
       AND l.approved_by IS NOT NULL AND l.approved_by <> l.employee_id
     GROUP BY 1,2,3,4,5 ORDER BY days DESC`);

  console.log('\n  Approvers wrongly credited (only where they hold a balance row');
  console.log('  for that type and year did the UPDATE actually land)');
  console.log('  ─────────────────────────────────────────────────────────');
  if (!gained.length) console.log('  none');
  for (const r of gained) {
    const hit = await pool.query(
      `SELECT 1 FROM leave_balances lb JOIN leave_types lt ON lt.id = lb.leave_type_id
        WHERE lb.employee_id = (SELECT id FROM employees WHERE employee_id=$1)
          AND lt.code = $2 AND lb.year = $3`,
      [r.code, r.leave_type === 'comp_off' ? 'compoff' : r.leave_type, r.yr]);
    console.log(`  ${String(r.code || '').padEnd(8)} ${`${r.first_name} ${r.last_name}`.padEnd(26)} ` +
      `${String(r.leave_type).padEnd(12)} ${r.yr}  +${String(R(r.days)).padStart(6)} ` +
      `${hit.rows.length ? '(balance row exists — credit landed)' : '(no balance row — credit was a no-op)'}`);
  }
  console.log('');
  await pool.end();
})().catch(async e => { console.error(e); await pool.end().catch(() => {}); process.exit(1); });
