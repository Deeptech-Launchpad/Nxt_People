/* ── Generalize the hierarchy approval table ──────────────────────────────
 *  Renames `leave_approval_levels` → `approval_levels` and makes it generic so
 *  the one hierarchy engine (utils/leaveApproval.js) can serve every request
 *  type (leave, regularization, …) instead of a separate system per type:
 *    - leave_id            → request_id (FK dropped; now polymorphic)
 *    - + request_type      VARCHAR(30) NOT NULL DEFAULT 'leave'
 *    - UNIQUE(leave_id,level) → UNIQUE(request_type, request_id, level)
 *  Existing rows backfill to request_type='leave', so leave approvals keep
 *  working untouched.
 *
 *  Idempotent — safe to run multiple times.
 *  Run once:  node backend/migrate_generalize_approvals.js
 * ───────────────────────────────────────────────────────────────────────── */

const { pool } = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const hasOld = await client.query(`SELECT to_regclass('public.leave_approval_levels') AS t`);
    const hasNew = await client.query(`SELECT to_regclass('public.approval_levels') AS t`);

    if (hasNew.rows[0].t && !hasOld.rows[0].t) {
      console.log('• approval_levels already present — nothing to migrate.');
    } else if (hasOld.rows[0].t) {
      // 1. Rename table + the id column.
      await client.query(`ALTER TABLE leave_approval_levels RENAME TO approval_levels`);
      await client.query(`ALTER TABLE approval_levels RENAME COLUMN leave_id TO request_id`);

      // 2. Drop the old FK to leaves (request_id is now polymorphic).
      const fk = await client.query(`
        SELECT conname FROM pg_constraint
         WHERE conrelid = 'approval_levels'::regclass AND contype = 'f'`);
      for (const row of fk.rows) {
        await client.query(`ALTER TABLE approval_levels DROP CONSTRAINT "${row.conname}"`);
      }

      // 3. Add request_type (defaults 'leave' for existing rows).
      await client.query(`ALTER TABLE approval_levels ADD COLUMN IF NOT EXISTS request_type VARCHAR(30) NOT NULL DEFAULT 'leave'`);

      // 4. Swap the unique constraint + indexes.
      await client.query(`ALTER TABLE approval_levels DROP CONSTRAINT IF EXISTS leave_approval_levels_leave_id_level_key`);
      await client.query(`DROP INDEX IF EXISTS idx_lal_leave`);
      await client.query(`DROP INDEX IF EXISTS idx_lal_approver`);
      await client.query(`ALTER TABLE approval_levels ADD CONSTRAINT approval_levels_req_level_key UNIQUE (request_type, request_id, level)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_apl_request  ON approval_levels(request_type, request_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_apl_approver ON approval_levels(approver_id, status)`);

      console.log('✅ leave_approval_levels → approval_levels (generalized).');
    } else {
      // Fresh DB without the old table — create the generic one.
      await client.query(`
        CREATE TABLE IF NOT EXISTS approval_levels (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          request_type VARCHAR(30) NOT NULL DEFAULT 'leave',
          request_id   UUID NOT NULL,
          level        INT  NOT NULL,
          approver_id  UUID REFERENCES employees(id),
          status       VARCHAR(20) NOT NULL DEFAULT 'pending',
          acted_by     UUID REFERENCES employees(id),
          acted_at     TIMESTAMPTZ,
          on_behalf    BOOLEAN NOT NULL DEFAULT false,
          by_hr        BOOLEAN NOT NULL DEFAULT false,
          UNIQUE (request_type, request_id, level)
        )`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_apl_request  ON approval_levels(request_type, request_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_apl_approver ON approval_levels(approver_id, status)`);
      console.log('✅ created approval_levels (fresh).');
    }

    await client.query('COMMIT');

    const counts = await pool.query(
      `SELECT request_type, COUNT(*)::int AS n FROM approval_levels GROUP BY request_type ORDER BY request_type`
    );
    console.log('\napproval_levels by request_type:');
    if (!counts.rows.length) console.log('  (empty)');
    counts.rows.forEach(r => console.log(`  ${r.request_type.padEnd(16)} ${r.n}`));
    console.log('\n✅ Migration complete.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Migration failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit(process.exitCode || 0);
  }
}

migrate();
