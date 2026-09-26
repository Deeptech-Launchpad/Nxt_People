/* ── Location per session, not per day ────────────────────────────────────
 *  attendance carries exactly one check-in location and one check-out
 *  location for the whole day, so a re-check-in or a mid-day check-out
 *  only ever had two shared slots to compete for — a location captured for
 *  a middle session was found successfully and then had nowhere to go.
 *
 *  attendance_sessions already has one row per check-in/check-out pair;
 *  this gives each of those rows its own location, the same three fields
 *  (label, latitude, longitude) attendance already carries per side.
 *
 *  Idempotent. Safe to re-run.
 *      docker compose exec backend node migrate_session_location.js
 * ───────────────────────────────────────────────────────────────────────── */
const pool = require('./db');

const migrations = [
  `ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS check_in_location VARCHAR(255)`,
  `ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS check_in_latitude DOUBLE PRECISION`,
  `ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS check_in_longitude DOUBLE PRECISION`,
  `ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS check_out_location VARCHAR(255)`,
  `ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS check_out_latitude DOUBLE PRECISION`,
  `ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS check_out_longitude DOUBLE PRECISION`,
];

async function runMigrations() {
  console.log('🚀 Migrating attendance_sessions location columns...\n');
  let success = 0, failed = 0;
  for (const sql of migrations) {
    const preview = sql.trim().substring(0, 80).replace(/\s+/g, ' ');
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
