/* Read-only. Writes nothing, sends nothing.
 *
 * PUT /leaves/:id/action refunded a rejected leave to `req.user._id`. That
 * route is approver-only, so req.user is the APPROVER, never the employee:
 * a rejection handled there gave the days to whoever pressed Reject and left
 * the employee short. Nothing errored, so nothing surfaced.
 *
 * The catch, and the reason this script leads with provenance: a rejected row
 * is only owed a refund if it was DEBITED in the first place. Applying through
 * POST /leaves debits leave_balances.available; a row inserted by the Zoho
 * migration never touched a balance. Refunding a migrated rejection would
 * invent days rather than restore them, so the two populations are separated
 * before anything is counted, and only the second is repairable.
 *
 * It only reports. Repair is a separate, deliberate step.
 */
require('dotenv').config();
const pool = require('./db');

const R = (n) => Math.round((parseFloat(n) || 0) * 100) / 100;
const d10 = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const line = () => console.log('  ' + '─'.repeat(66));

(async () => {
  const REJECTED = `status='rejected' AND leave_type <> 'unpaid' AND COALESCE(total_days,0) > 0`;

  const { rows: [tot] } = await pool.query(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(total_days),0) AS days,
            MIN(start_date) AS first, MAX(start_date) AS last
       FROM leaves WHERE ${REJECTED}`);

  console.log('\n  Rejected leaves holding days\n');
  line();
  console.log(`  ${tot.n} rejection(s), ${R(tot.days)} day(s)` +
    (tot.n ? `, ${d10(tot.first)} to ${d10(tot.last)}` : ''));
  if (tot.n === 0) { console.log('  Nothing to look at on this database.\n'); await pool.end(); return; }

  /* ── Which of these our own reject route actually handled ──────────────── */
  const { rows: [split] } = await pool.query(`
    SELECT COUNT(*) FILTER (WHERE approved_by IS NOT NULL)::int          AS routed_n,
           COALESCE(SUM(total_days) FILTER (WHERE approved_by IS NOT NULL),0) AS routed_d,
           COUNT(*) FILTER (WHERE approved_by IS NULL)::int              AS bare_n,
           COALESCE(SUM(total_days) FILTER (WHERE approved_by IS NULL),0)     AS bare_d
      FROM leaves WHERE ${REJECTED}`);

  console.log('');
  console.log(`  went through our reject route (approved_by set) : ${String(split.routed_n).padStart(4)}  ` +
    `${String(R(split.routed_d)).padStart(6)} day(s)   <- repairable`);
  console.log(`  no approver recorded                            : ${String(split.bare_n).padStart(4)}  ` +
    `${String(R(split.bare_d)).padStart(6)} day(s)   <- inserted, never debited`);

  /* When rows were created is the clearest migration signal: an import lands
   * thousands of rows inside one minute, real usage does not. */
  const { rows: days } = await pool.query(`
    SELECT DATE(created_at) AS day, COUNT(*)::int AS n,
           COUNT(*) FILTER (WHERE approved_by IS NOT NULL)::int AS routed
      FROM leaves WHERE ${REJECTED} AND created_at IS NOT NULL
     GROUP BY 1 ORDER BY n DESC LIMIT 8`);
  console.log('\n  Created on (top days) — a spike is the migration, not usage');
  line();
  for (const r of days) {
    console.log(`  ${d10(r.day)}   ${String(r.n).padStart(4)} row(s), ${r.routed} with an approver`);
  }

  if (split.routed_n === 0) {
    console.log('\n  No rejection on this database was processed by the buggy route.');
    console.log('  Nothing is owed. Do NOT credit these days — they were never taken.\n');
    await pool.end(); return;
  }

  /* ── Only the routed ones, per employee ────────────────────────────────── */
  const { rows: short } = await pool.query(`
    SELECT e.employee_id AS code, e.first_name, e.last_name, l.leave_type,
           EXTRACT(YEAR FROM l.start_date)::int AS yr,
           COUNT(*)::int AS n, SUM(l.total_days) AS days
      FROM leaves l JOIN employees e ON e.id = l.employee_id
     WHERE l.status='rejected' AND l.leave_type <> 'unpaid' AND COALESCE(l.total_days,0) > 0
       AND l.approved_by IS NOT NULL
     GROUP BY 1,2,3,4,5 ORDER BY days DESC`);

  console.log('\n  Employees short, from routed rejections only');
  line();
  for (const r of short) {
    console.log(`  ${String(r.code || '').padEnd(11)} ${`${r.first_name} ${r.last_name}`.slice(0, 26).padEnd(27)} ` +
      `${String(r.leave_type).padEnd(10)} ${r.yr}  ${String(R(r.days)).padStart(5)} day(s) over ${r.n}`);
  }

  /* ── And where the days actually went ──────────────────────────────────── */
  const { rows: gained } = await pool.query(`
    SELECT e.employee_id AS code, e.first_name, e.last_name, l.leave_type,
           EXTRACT(YEAR FROM l.start_date)::int AS yr, SUM(l.total_days) AS days
      FROM leaves l JOIN employees e ON e.id = l.approved_by
     WHERE l.status='rejected' AND l.leave_type <> 'unpaid' AND COALESCE(l.total_days,0) > 0
       AND l.approved_by IS NOT NULL AND l.approved_by <> l.employee_id
     GROUP BY 1,2,3,4,5 ORDER BY days DESC`);

  console.log('\n  Approvers credited instead (only landed where they hold');
  console.log('  a balance row for that type and year)');
  line();
  if (!gained.length) console.log('  none');
  for (const r of gained) {
    const hit = await pool.query(
      `SELECT 1 FROM leave_balances lb
         JOIN leave_types lt ON lt.id = lb.leave_type_id
         JOIN employees e ON e.id = lb.employee_id
        WHERE e.employee_id = $1 AND lt.code = $2 AND lb.year = $3`,
      [r.code, r.leave_type === 'comp_off' ? 'compoff' : r.leave_type, r.yr]);
    console.log(`  ${String(r.code || '').padEnd(11)} ${`${r.first_name} ${r.last_name}`.slice(0, 26).padEnd(27)} ` +
      `${String(r.leave_type).padEnd(10)} ${r.yr}  +${String(R(r.days)).padStart(5)} ` +
      `${hit.rows.length ? '(landed)' : '(no-op)'}`);
  }
  console.log('');
  await pool.end();
})().catch(async e => { console.error(e); await pool.end().catch(() => {}); process.exit(1); });
