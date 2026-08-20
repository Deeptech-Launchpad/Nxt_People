/* ── Put back the arrival times a second check-in overwrote ────────────────
 *  Until routes/attendance.js was corrected, checking in a second time on the
 *  same day replaced check_in outright:
 *
 *      SET check_in = EXCLUDED.check_in
 *
 *  working_hours was left alone and carried on accumulating, so the totals
 *  stayed right while the punches became nonsense — on live, somebody who
 *  worked 8.55 hours and then tapped in and out again two seconds later had a
 *  row reading "arrived and left, two seconds apart, 8.55 hours worked".
 *
 *  The hours were never wrong. What was lost was the arrival time, which is
 *  what First In, late marking and the early/late report are all built on.
 *
 *  It is recoverable: attendance_sessions records every check-in separately and
 *  was never overwritten. This puts the earliest session's arrival back.
 *
 *  Run with no arguments to see what WOULD change and write nothing:
 *
 *    docker compose exec backend node repair_first_checkin.js
 *    docker compose exec backend node repair_first_checkin.js --apply
 *
 *  Only check_in moves, and only ever backwards in time. check_out,
 *  working_hours and status are not touched — they were already correct, and
 *  recomputing them would risk changing figures that are not wrong.
 * ────────────────────────────────────────────────────────────────────────── */
const pool = require('./db');

const APPLY = process.argv.includes('--apply');

(async () => {
  console.log(`\n  Repair first check-in — ${APPLY ? 'APPLYING' : 'DRY RUN, nothing will be written'}\n`);

  // Rows whose stored arrival is later than the earliest session recorded for
  // that day. Only those: a row already showing its first session is right.
  const candidates = await pool.query(
    `SELECT a.id, e.employee_id AS code,
            TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS name,
            a.date::text AS d,
            a.check_in AS stored_in, a.check_out AS stored_out, a.working_hours,
            s.first_in,
            EXTRACT(EPOCH FROM (a.check_in - s.first_in))/60.0 AS minutes_lost
       FROM attendance a
       JOIN employees e ON e.id = a.employee_id
       JOIN (SELECT employee_id, date, MIN(check_in) AS first_in
               FROM attendance_sessions GROUP BY employee_id, date) s
         ON s.employee_id = a.employee_id AND s.date = a.date
      WHERE a.check_in IS NOT NULL
        AND s.first_in < a.check_in
      ORDER BY a.date, e.employee_id`);

  if (!candidates.rows.length) {
    console.log('  Nothing to repair: every stored arrival already matches the earliest session.\n');
    await pool.end();
    return;
  }

  console.log(`  ${candidates.rows.length} row(s) where the stored arrival is later than the first session:\n`);
  for (const r of candidates.rows) {
    const lost = Math.round(Number(r.minutes_lost));
    console.log(`    ${r.code.padEnd(14)} ${r.d}  stored ${String(r.stored_in).slice(11, 19)}`
              + `  ->  ${String(r.first_in).slice(11, 19)}   (${lost} min earlier)`);
  }

  if (!APPLY) {
    console.log(`\n  Nothing was written. Re-run with --apply to make these changes.`);
    console.log(`  Only check_in moves, and only backwards. Hours and check-out are left alone.\n`);
    await pool.end();
    return;
  }

  // One statement, one transaction: a half-finished repair would be worse than
  // no repair, because the two halves would be indistinguishable afterwards.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `UPDATE attendance a
          SET check_in = s.first_in, updated_at = NOW()
         FROM (SELECT employee_id, date, MIN(check_in) AS first_in
                 FROM attendance_sessions GROUP BY employee_id, date) s
        WHERE s.employee_id = a.employee_id AND s.date = a.date
          AND a.check_in IS NOT NULL
          AND s.first_in < a.check_in`);
    await client.query('COMMIT');
    console.log(`\n  ${r.rowCount} row(s) repaired.`);
    console.log('  Hours, check-out times and statuses were not touched.\n');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\n  Repair failed and was rolled back:', err.message, '\n');
    process.exitCode = 1;
  } finally {
    client.release();
  }
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
