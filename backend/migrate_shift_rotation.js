/* ── Settings → Shifts → Automation → Shift Rotation ───────────────────────
 *  "To automatically change the assigned shift for employees based on the
 *  specified frequency" — the reference's words, and the one thing in the
 *  Shifts Automation tab that is not already built elsewhere.
 *
 *  Distinct from a shift pattern, which rosters specific days. A rotation
 *  changes the STANDING shift: on the scheduled day, anybody on shift A moves
 *  to shift B. That is what "General Shift to General" means on its form.
 *
 *  Idempotent. Safe to re-run.
 *      docker compose exec backend node migrate_shift_rotation.js
 * ───────────────────────────────────────────────────────────────────────── */

const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS shift_rotations (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name        VARCHAR(150) NOT NULL UNIQUE,
        is_active   BOOLEAN NOT NULL DEFAULT TRUE,

        frequency   VARCHAR(10) NOT NULL DEFAULT 'weekly',
        -- 0 = Sunday, matching JavaScript's getDay and the reference's picker.
        day_of_week INT NOT NULL DEFAULT 0,
        day_of_month INT NOT NULL DEFAULT 1,
        run_at      VARCHAR(5) NOT NULL DEFAULT '00:00',
        -- The reference states the period the changed shifts hold for, which
        -- is what its "employees will remain in the changed shifts between"
        -- line is computed from.
        period_from INT NOT NULL DEFAULT 0,

        -- Who it applies to: criteria, named employees, or both. Empty means
        -- nobody, not everybody — a rotation that silently moved the whole
        -- organization would be the worst possible default.
        criteria     JSONB NOT NULL DEFAULT '[]'::jsonb,
        employee_ids UUID[] NOT NULL DEFAULT '{}',

        last_run_at TIMESTAMP,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMP NOT NULL DEFAULT NOW(),

        CONSTRAINT shift_rotations_frequency_check CHECK (frequency IN ('weekly', 'monthly')),
        CONSTRAINT shift_rotations_dow_check CHECK (day_of_week BETWEEN 0 AND 6),
        CONSTRAINT shift_rotations_dom_check CHECK (day_of_month BETWEEN 1 AND 28)
      )`);

    // One row per "from this shift, to that one". A rotation with several
    // steps moves each group at once, which is how A→B and B→A swap a pair.
    await client.query(`
      CREATE TABLE IF NOT EXISTS shift_rotation_steps (
        id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        rotation_id   UUID NOT NULL REFERENCES shift_rotations(id) ON DELETE CASCADE,
        from_shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
        to_shift_id   UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
        sort_order    INT NOT NULL DEFAULT 0,
        UNIQUE (rotation_id, from_shift_id)
      )`);

    // What a rotation actually did, so a shift that changed under somebody can
    // be explained rather than guessed at.
    await client.query(`
      CREATE TABLE IF NOT EXISTS shift_rotation_runs (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        rotation_id UUID REFERENCES shift_rotations(id) ON DELETE CASCADE,
        rotation_name VARCHAR(150) NOT NULL,
        employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
        from_shift_id UUID REFERENCES shifts(id) ON DELETE SET NULL,
        to_shift_id   UUID REFERENCES shifts(id) ON DELETE SET NULL,
        status      VARCHAR(12) NOT NULL DEFAULT 'success',
        message     TEXT,
        ran_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_rotation_runs_at ON shift_rotation_runs (ran_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_rotation_steps_rot ON shift_rotation_steps (rotation_id)`);

    await client.query('COMMIT');

    const r = await pool.query(`
      SELECT (SELECT COUNT(*)::int FROM shift_rotations) AS rotations,
             (SELECT COUNT(*)::int FROM shifts) AS shifts`);
    console.log('✅ Shift rotation ready.');
    console.log(`   ${r.rows[0].rotations} rotation(s), ${r.rows[0].shifts} shift(s) to rotate between`);
    console.log('\n   Nothing rotates until one is created, and there are none.');
    console.log('   A rotation with no criteria and no named employee moves nobody.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Shift rotation migration failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit(process.exitCode || 0);
  }
}

migrate();
