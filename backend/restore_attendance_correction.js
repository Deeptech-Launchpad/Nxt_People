#!/usr/bin/env node
/* Undo one batch from zoho_complete_absent_days.js.
 *
 * That script only ever UPDATEs a single existing attendance row per
 * correction — never a delete-then-reinsert over a date range — so this
 * puts each row back to its exact prior values by id, not by re-running a
 * range-based delete like restore_import_backup.js does. Using that script
 * against an 'attendance_correction' batch would be wrong: there is no
 * manifest, and its range-delete would remove rows this batch never
 * touched.
 *
 * READ ONLY until --apply.
 *
 *   node restore_attendance_correction.js absentfix-20260907120000
 *   node restore_attendance_correction.js absentfix-20260907120000 --apply
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
const pool = require('./db');

const BATCH = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!BATCH) {
  console.log('\n  usage: node restore_attendance_correction.js <batch> [--apply]\n');
  process.exit(1);
}

(async () => {
  const rows = (await pool.query(
    `SELECT ib.id AS backup_id, ib.employee_id, ib.row_data,
            TRIM(CONCAT(e.first_name,' ',e.last_name)) AS name, e.employee_id AS code
       FROM import_backups ib JOIN employees e ON e.id = ib.employee_id
      WHERE ib.batch = $1 AND ib.table_name = 'attendance_correction'
      ORDER BY ib.employee_id`, [BATCH])).rows;

  if (!rows.length) {
    console.log(`\n  No 'attendance_correction' rows found for batch "${BATCH}".\n`);
    await pool.end();
    return;
  }

  console.log(`\n=== Restoring ${rows.length} row(s) from ${BATCH} — ${APPLY ? 'APPLYING' : 'DRY RUN'} ===\n`);
  for (const r of rows) {
    const d = r.row_data;
    console.log(`  ${r.code}  ${r.name}  ${d.date}  → back to status=${d.status} in=${d.check_in || 'null'} out=${d.check_out || 'null'}`);
  }

  if (!APPLY) {
    console.log('\n  Nothing was written. Re-run with --apply.\n');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of rows) {
      const d = r.row_data;
      await client.query(
        `UPDATE attendance SET check_in = $1::timestamp, check_out = $2::timestamp,
                working_hours = $3, status = $4, late_minutes = $5,
                check_in_location = $6, check_out_location = $7,
                check_in_latitude = $8, check_in_longitude = $9,
                check_out_latitude = $10, check_out_longitude = $11
          WHERE id = $12`,
        [d.check_in, d.check_out, d.working_hours, d.status, d.late_minutes,
         d.check_in_location, d.check_out_location,
         d.check_in_latitude, d.check_in_longitude, d.check_out_latitude, d.check_out_longitude,
         d.id]);
    }
    await client.query(`UPDATE import_backups SET restored_at = NOW() WHERE batch = $1 AND table_name = 'attendance_correction'`, [BATCH]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.log(`\n  Failed, rolled back: ${err.message}\n`);
    await pool.end();
    process.exit(1);
  } finally {
    client.release();
  }

  console.log(`\n  ${rows.length} row(s) restored.\n`);
  await pool.end();
})().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
