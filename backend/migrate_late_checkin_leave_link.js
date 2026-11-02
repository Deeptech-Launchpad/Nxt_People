/* ── Linking a late check-in to its actual Permission application ───────────
 *  Choosing "Apply Permission" in the late-check-in popup used to tag
 *  attendance.late_checkin_action = 'permission' the instant the choice was
 *  made — before the employee had actually opened, filled in, or submitted
 *  anything. The report then read that tag and showed "Applied Permission"
 *  for check-ins where no Permission request existed at all.
 *
 *  The fix (routes/attendance.js) now requires the real leaves.id of a
 *  successfully-submitted Permission request before it will write
 *  late_checkin_action = 'permission' at all — this column is where that id
 *  is stored, so the report can tell a genuinely-linked application apart
 *  from the old, pre-fix rows that only ever recorded the choice.
 *
 *  Nullable and NOT backfilled: every attendance row written before this
 *  fix shipped keeps late_checkin_leave_id = NULL, exactly as it already
 *  implicitly was. Nothing about those historical rows is rewritten.
 *
 *  Idempotent. Safe to re-run.
 *      docker compose exec backend node migrate_late_checkin_leave_link.js
 * ───────────────────────────────────────────────────────────────────────── */

const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS late_checkin_leave_id UUID REFERENCES leaves(id)`
    );

    await client.query('COMMIT');

    const r = await pool.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE late_checkin_leave_id IS NOT NULL)::int AS linked,
              count(*) FILTER (WHERE late_checkin_action = 'permission' AND late_checkin_leave_id IS NULL)::int AS unlinked_permission
         FROM attendance`
    );
    console.log('✅ late_checkin_leave_id ready.');
    console.log(`   ${r.rows[0].total} attendance row(s), ${r.rows[0].linked} already linked (none expected on first run), `
      + `${r.rows[0].unlinked_permission} pre-existing 'permission' row(s) with no link (left as historical data, not modified)`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ late_checkin_leave_id migration failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit(process.exitCode || 0);
  }
}

migrate();
