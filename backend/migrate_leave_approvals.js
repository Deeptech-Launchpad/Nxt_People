/* ── Leave approval hierarchy migration ───────────────────────────────────
 *  Creates the leave_approval_levels table and backfills approval levels for
 *  every in-flight leave (status pending / pending_approval) from the current
 *  Employee Tree, so existing requests keep working under the new hierarchy
 *  workflow. Already-approved / rejected leaves are left as-is (the timeline
 *  falls back to the overall status for those).
 *
 *  Idempotent — safe to run multiple times.
 *  Run once after deploying:  node backend/migrate_leave_approvals.js
 * ───────────────────────────────────────────────────────────────────────── */

const { pool } = require('./db');
const { createLevels } = require('./utils/leaveApproval');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Table + indexes (mirrors schema.sql).
    await client.query(`
      CREATE TABLE IF NOT EXISTS leave_approval_levels (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        leave_id    UUID NOT NULL REFERENCES leaves(id) ON DELETE CASCADE,
        level       INT  NOT NULL,
        approver_id UUID REFERENCES employees(id),
        status      VARCHAR(20) NOT NULL DEFAULT 'pending',
        acted_by    UUID REFERENCES employees(id),
        acted_at    TIMESTAMPTZ,
        on_behalf   BOOLEAN NOT NULL DEFAULT false,
        by_hr       BOOLEAN NOT NULL DEFAULT false,
        UNIQUE (leave_id, level)
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_lal_leave    ON leave_approval_levels(leave_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_lal_approver ON leave_approval_levels(approver_id, status);`);

    // 2. Normalise the legacy in-flight status: pending_approval → pending.
    //    Per-level tracking now lives in leave_approval_levels.
    const norm = await client.query(
      `UPDATE leaves SET status='pending' WHERE status='pending_approval'`
    );
    console.log(`✅ normalised ${norm.rowCount} 'pending_approval' → 'pending'`);

    // 3. Backfill levels for in-flight leaves that don't have any yet.
    const inflight = await client.query(
      `SELECT l.id, l.employee_id
         FROM leaves l
        WHERE l.status = 'pending'
          AND NOT EXISTS (SELECT 1 FROM leave_approval_levels x WHERE x.leave_id = l.id)`
    );
    let filled = 0;
    for (const row of inflight.rows) {
      const levels = await createLevels(client, row.id, row.employee_id);
      if (levels.length > 0) filled++;
    }
    console.log(`✅ backfilled approval levels for ${filled}/${inflight.rows.length} in-flight leave(s)`);

    await client.query('COMMIT');

    const counts = await pool.query(
      `SELECT status, COUNT(*)::int AS n FROM leave_approval_levels GROUP BY status ORDER BY status`
    );
    console.log('\nleave_approval_levels rows by status:');
    if (counts.rows.length === 0) console.log('  (none yet)');
    counts.rows.forEach(r => console.log(`  ${r.status.padEnd(10)} ${r.n}`));
    console.log('\n✅ Leave approval migration complete.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Leave approval migration failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit(process.exitCode || 0);
  }
}

migrate();
