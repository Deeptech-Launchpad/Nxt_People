#!/usr/bin/env node
/* Put back the attendance rows an earlier batch closed with the NEXT day's
 * punch.
 *
 * Dry run by default. Only ever restores a row to the exact values it held
 * before that batch touched it — the backup taken at the time — and only
 * rows whose checkout landed on a different date than the day itself.
 *
 * WHY: zoho_complete_absent_days.js now refuses these, because Zoho fills
 * LastOut with the following check-in when somebody forgets to check out, so
 * the day reads as roughly 24 hours. Batch absentfix-20260907121008 ran
 * before that guard existed and wrote three of them — 23.92h, 23.97h,
 * 23.97h. Left alone they inflate payable hours and overtime off a checkout
 * that never happened.
 *
 * The other rows in that batch are correct and are NOT touched: this picks
 * out the overnight ones by looking at what was actually written, rather
 * than reverting a whole batch to reach three rows.
 *
 *   node fix_overnight_span_rows.js absentfix-20260907121008
 *   node fix_overnight_span_rows.js absentfix-20260907121008 --apply
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
const pool = require('./db');

const BATCH = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!BATCH) {
  console.log('\n  usage: node fix_overnight_span_rows.js <batch> [--apply]\n');
  process.exit(1);
}
const pad = (s, n) => String(s ?? '').padEnd(n);

(async () => {
  const backups = (await pool.query(
    `SELECT ib.row_data, e.employee_id AS code, TRIM(CONCAT(e.first_name,' ',e.last_name)) AS name
       FROM import_backups ib JOIN employees e ON e.id = ib.employee_id
      WHERE ib.batch = $1 AND ib.table_name = 'attendance_correction'
      ORDER BY e.employee_id`, [BATCH])).rows;

  if (!backups.length) {
    console.log(`\n  No 'attendance_correction' backups found for batch "${BATCH}".\n`);
    await pool.end();
    return;
  }

  console.log(`\n=== Overnight-span rows in ${BATCH} — ${APPLY ? 'APPLYING' : 'DRY RUN'} ===\n`);
  console.log(`  ${backups.length} row(s) in this batch. Checking what each one holds NOW.\n`);

  const bad = [];
  for (const b of backups) {
    const prior = b.row_data;
    const now = (await pool.query(
      `SELECT id, date::text AS date, check_in::text AS "checkIn", check_out::text AS "checkOut",
              status, working_hours AS hours
         FROM attendance WHERE id = $1`, [prior.id])).rows[0];
    if (!now || !now.checkOut) continue;
    // The signature: a checkout dated later than the day it belongs to.
    if (now.checkOut.slice(0, 10) === now.date) continue;
    bad.push({ code: b.code, name: b.name, now, prior });
  }

  console.log(`  ${bad.length} row(s) closed with a later day's punch:\n`);
  for (const r of bad) {
    console.log(`  ${pad(r.code, 14)}${pad(r.name.slice(0, 24), 26)}${r.now.date}`);
    console.log(`      now:       ${r.now.checkIn} -> ${r.now.checkOut}   ${r.now.hours}h  status=${r.now.status}`);
    console.log(`      goes back: ${r.prior.check_in || 'null'} -> ${r.prior.check_out || 'null'}   `
      + `${r.prior.working_hours ?? '-'}h  status=${r.prior.status}\n`);
  }
  if (!bad.length) { console.log('  none.\n'); await pool.end(); return; }

  if (!APPLY) {
    console.log('  Nothing was written. Re-run with --apply.\n');
    console.log('  These days then need a regularization with the real checkout time,');
    console.log('  which only the employee knows.\n');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of bad) {
      const p = r.prior;
      await client.query(
        `UPDATE attendance SET check_in = $1::timestamp, check_out = $2::timestamp,
                working_hours = $3, status = $4, late_minutes = $5,
                check_in_location = $6, check_out_location = $7,
                check_in_latitude = $8, check_in_longitude = $9,
                check_out_latitude = $10, check_out_longitude = $11
          WHERE id = $12`,
        [p.check_in, p.check_out, p.working_hours, p.status, p.late_minutes,
         p.check_in_location, p.check_out_location,
         p.check_in_latitude, p.check_in_longitude, p.check_out_latitude, p.check_out_longitude,
         p.id]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.log(`\n  Failed, rolled back: ${err.message}\n`);
    await pool.end();
    process.exit(1);
  } finally {
    client.release();
  }

  console.log(`  ${bad.length} row(s) put back as they were.\n`);
  console.log('  They read as absent again, which is what this system says about a');
  console.log('  day with no checkout. A regularization with the real time is the fix.\n');
  await pool.end();
})().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
