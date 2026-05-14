/**
 * migrate_indexes.js
 * Adds performance indexes across all major tables.
 * Safe to run multiple times — uses IF NOT EXISTS.
 * Run: node backend/migrate_indexes.js
 */

const { pool } = require('./db');

const INDEXES = [
  // ── Attendance ────────────────────────────────────────────────────────────
  `CREATE INDEX IF NOT EXISTS idx_attendance_employee_date  ON attendance(employee_id, date)`,
  `CREATE INDEX IF NOT EXISTS idx_attendance_date           ON attendance(date)`,
  `CREATE INDEX IF NOT EXISTS idx_attendance_status         ON attendance(status)`,

  // ── Leaves ────────────────────────────────────────────────────────────────
  `CREATE INDEX IF NOT EXISTS idx_leaves_employee_id        ON leaves(employee_id)`,
  `CREATE INDEX IF NOT EXISTS idx_leaves_status             ON leaves(status)`,
  `CREATE INDEX IF NOT EXISTS idx_leaves_dates              ON leaves(start_date, end_date)`,
  // Reports + "Recent Leaves" widgets sort by created_at DESC. Without this
  // index, at 50k+ rows the query plans an ORDER BY sort over the whole table.
  `CREATE INDEX IF NOT EXISTS idx_leaves_created_at         ON leaves(created_at DESC)`,

  // ── Timesheets ────────────────────────────────────────────────────────────
  `CREATE INDEX IF NOT EXISTS idx_timesheets_employee_id    ON timesheets(employee_id)`,
  `CREATE INDEX IF NOT EXISTS idx_timesheets_dates          ON timesheets(week_start_date, week_end_date)`,
  `CREATE INDEX IF NOT EXISTS idx_timesheets_status         ON timesheets(status)`,
  // Same rationale as leaves: ORDER BY created_at on the admin timesheets list.
  `CREATE INDEX IF NOT EXISTS idx_timesheets_created_at     ON timesheets(created_at DESC)`,

  // ── Employees ─────────────────────────────────────────────────────────────
  `CREATE INDEX IF NOT EXISTS idx_employees_email           ON employees(email)`,
  `CREATE INDEX IF NOT EXISTS idx_employees_manager_id      ON employees(manager_id)`,
  `CREATE INDEX IF NOT EXISTS idx_employees_status          ON employees(status)`,
  `CREATE INDEX IF NOT EXISTS idx_employees_department      ON employees(department)`,

  // ── Notifications ─────────────────────────────────────────────────────────
  `CREATE INDEX IF NOT EXISTS idx_notifications_employee    ON notifications(employee_id, is_read)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_created     ON notifications(created_at DESC)`,

  // ── Exit requests ─────────────────────────────────────────────────────────
  `CREATE INDEX IF NOT EXISTS idx_exit_employee_id          ON exit_requests(employee_id)`,
  `CREATE INDEX IF NOT EXISTS idx_exit_status               ON exit_requests(status)`,

  // ── Performance reviews ───────────────────────────────────────────────────
  `CREATE INDEX IF NOT EXISTS idx_perf_reviews_employee     ON performance_reviews(employee_id)`,
  `CREATE INDEX IF NOT EXISTS idx_perf_goals_review         ON performance_goals(review_id)`,

  // ── WFH / Comp-off / Regularizations ─────────────────────────────────────
  `CREATE INDEX IF NOT EXISTS idx_wfh_employee_status       ON wfh_requests(employee_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_compoff_employee          ON comp_off_requests(employee_id)`,
  `CREATE INDEX IF NOT EXISTS idx_regularize_employee       ON attendance_regularizations(employee_id, status)`,
];

async function runIndexes() {
  console.log('\n🚀 Adding database indexes...\n');
  let success = 0;
  let failed = 0;

  for (const sql of INDEXES) {
    const label = sql.match(/idx_\w+/)?.[0] || sql.substring(0, 60);
    try {
      await pool.query(sql);
      console.log(`  ✅ ${label}`);
      success++;
    } catch (err) {
      console.error(`  ❌ ${label} — ${err.message}`);
      failed++;
    }
  }

  console.log(`\n📊 Done: ${success} indexes created, ${failed} failed\n`);
  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

runIndexes().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

