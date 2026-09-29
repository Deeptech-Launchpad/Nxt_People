/* ── Accuracy per session, alongside its location ──────────────────────────
 *  attendance_sessions already carries a label + lat/lng for each side of a
 *  session (migrate_session_location.js), but not the accuracy radius the
 *  browser reported with that fix. Without it, a low-confidence network fix
 *  (common indoors, where real GPS often cannot get a lock) looks exactly
 *  like a precise one on screen — same five decimal places, no hint that two
 *  fixes taken minutes apart could legitimately land hundreds of metres
 *  apart. This gives each side of a session the accuracy figure it already
 *  computes but previously discarded.
 *
 *  Idempotent. Safe to re-run.
 *      docker compose exec backend node migrate_session_accuracy.js
 * ───────────────────────────────────────────────────────────────────────── */
const pool = require('./db');

const migrations = [
  `ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS check_in_accuracy_meters DOUBLE PRECISION`,
  `ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS check_out_accuracy_meters DOUBLE PRECISION`,
];

async function runMigrations() {
  console.log('🚀 Migrating attendance_sessions accuracy columns...\n');
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
