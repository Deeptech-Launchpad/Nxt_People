/* ── Permission-as-hours migration ────────────────────────────────────────
 *  Permission is a SHORT, hourly leave (not day-based): up to 4 hours per
 *  calendar month, NO carry-forward. To support that we capture the time
 *  window and the computed hours on the leaves row. Day-based leave types
 *  (casual, comp_off, unpaid) keep total_days and ignore these columns.
 *
 *    start_time / end_time — the permission window (TIME, e.g. 14:00–16:00)
 *    hours                 — computed duration in hours (NUMERIC(4,2))
 *
 *  Idempotent (ADD COLUMN IF NOT EXISTS). Run once after deploying:
 *      node backend/migrate_permission_hours.js
 * ───────────────────────────────────────────────────────────────────────── */

const { pool } = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`ALTER TABLE leaves ADD COLUMN IF NOT EXISTS start_time TIME`);
    await client.query(`ALTER TABLE leaves ADD COLUMN IF NOT EXISTS end_time   TIME`);
    await client.query(`ALTER TABLE leaves ADD COLUMN IF NOT EXISTS hours      NUMERIC(4,2)`);
    // Helps the monthly-usage rollups for the HR Permission tracker.
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_leaves_permission_month
         ON leaves (employee_id, start_date)
       WHERE leave_type = 'permission'`
    );
    await client.query('COMMIT');
    console.log('✅ Permission-hours columns ready (start_time, end_time, hours) + index.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Permission-hours migration failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit(process.exitCode || 0);
  }
}

migrate();
