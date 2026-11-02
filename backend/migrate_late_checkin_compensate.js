/* ── Late check-in decision: Permission vs. Compensate Working Hours ────────
 *  Employee-role, General-Shift check-ins after 9:45 AM must choose between
 *  applying Permission (the existing leave workflow — nothing new stored for
 *  this choice beyond the usual leaves row) or Compensate Working Hours (a
 *  new, independent commitment to work a full 8h30m that day with no
 *  permission/leave deduction).
 *
 *  Both columns live on `attendance` because the decision is inherently
 *  about ONE employee's ONE day, exactly like check_in/status/working_hours
 *  already on this row — a separate table would just be this same row
 *  split in two for no reason, and would complicate the report that needs
 *  check-in time, late reason and working hours together in one query.
 *
 *  late_checkin_action is set once, at the day's FIRST check-in only — a
 *  later re-check-in (after a permission break, say) does not re-ask or
 *  overwrite it. late_checkin_reason is only ever populated when the
 *  action is 'compensate' (Apply Permission needs no reason of its own).
 *
 *  Idempotent. Safe to re-run.
 *      docker compose exec backend node migrate_late_checkin_compensate.js
 * ───────────────────────────────────────────────────────────────────────── */

const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS late_checkin_action VARCHAR(20)`
    );
    await client.query(
      `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS late_checkin_reason TEXT`
    );
    // Closed, documented vocabulary — mirrors how other small-enum columns
    // in this schema are constrained (e.g. leaves.status), so a typo'd
    // value fails loudly at write time instead of silently breaking the
    // report's WHERE late_checkin_action = 'compensate' filter.
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'attendance_late_checkin_action_check'
        ) THEN
          ALTER TABLE attendance ADD CONSTRAINT attendance_late_checkin_action_check
            CHECK (late_checkin_action IS NULL OR late_checkin_action IN ('permission', 'compensate'));
        END IF;
      END $$;
    `);

    await client.query('COMMIT');

    const r = await pool.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE late_checkin_action = 'compensate')::int AS compensate
         FROM attendance`
    );
    console.log('✅ late_checkin_action / late_checkin_reason ready.');
    console.log(`   ${r.rows[0].total} attendance row(s), ${r.rows[0].compensate} already marked compensate (none expected on first run)`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ late_checkin_compensate migration failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit(process.exitCode || 0);
  }
}

migrate();
