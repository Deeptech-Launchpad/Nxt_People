/**
 * migrate_location_logs.js — Attendance location history
 *
 * Adds a dedicated, additive log of where each check-in / check-out happened,
 * captured by the browser at the moment of the action. This is SEPARATE from
 * the existing `attendance` table (which already stores the latest lat/long on
 * the day's row) so the existing check-in/check-out workflow is left untouched —
 * we only append rows here.
 *
 * Run once:  node migrate_location_logs.js
 * Idempotent (CREATE TABLE / INDEX IF NOT EXISTS) — safe to re-run.
 */
const pool = require('./db');

const migrations = [
  `CREATE TABLE IF NOT EXISTS attendance_location_logs (
     id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
     employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
     type VARCHAR(16) NOT NULL,                 -- 'checkin' | 'checkout'
     latitude DOUBLE PRECISION,
     longitude DOUBLE PRECISION,
     accuracy DOUBLE PRECISION,                 -- metres, from the GPS fix
     location_label VARCHAR(255),
     permission_status VARCHAR(32),             -- 'always' | 'once' | 'denied' | 'unavailable'
     captured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE INDEX IF NOT EXISTS idx_attloc_emp_time
     ON attendance_location_logs(employee_id, captured_at DESC)`,
];

async function runMigrations() {
  console.log('🚀 Migrating attendance_location_logs...\n');
  let success = 0, failed = 0;
  for (const sql of migrations) {
    const preview = sql.trim().substring(0, 70).replace(/\s+/g, ' ');
    try {
      await pool.query(sql);
      console.log(`  ✅ ${preview}...`);
      success++;
    } catch (err) {
      console.error(`  ❌ FAILED: ${preview}`);
      console.error(`     ${err.message}`);
      failed++;
    }
  }
  console.log(`\n📊 Migration complete: ${success} succeeded, ${failed} failed`);
  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

runMigrations().catch(err => {
  console.error('Fatal migration error:', err);
  process.exit(1);
});
