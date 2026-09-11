/* ── Operations → Shift → Shift Group, and a reason on a rostered day ──────
 *  Two things the reference's Shift module has that this one had nowhere to
 *  put.
 *
 *  SHIFT GROUPS. A named bucket of people with an effective period, used for
 *  two things in the reference: filtering the schedule down to a group, and
 *  assigning a shift to that group in one go. Membership carries its own
 *  dates — "these twelve are on Night Crew for October" — so the same person
 *  can belong to different groups in different months without the history
 *  being rewritten each time.
 *
 *  Membership is deliberately NOT unique on (group, employee) alone: it is
 *  unique on (group, employee, effective_from), so October and November are
 *  two rows rather than one row that forgets October.
 *
 *  REASON ON A ROSTERED DAY. The reference's Assign shift form has a Reason
 *  field on every path — user-specific, and the bulk criteria one. shift_roster
 *  had nowhere to keep it, so the answer to "why is this person on Client
 *  Shift on the 14th" lived only in whoever's memory made the change.
 *
 *  Idempotent. Safe to re-run.
 *      docker compose exec backend node migrate_shift_groups.js
 * ───────────────────────────────────────────────────────────────────────── */

const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS shift_groups (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name        VARCHAR(150) NOT NULL UNIQUE,
        description TEXT,
        is_active   BOOLEAN NOT NULL DEFAULT TRUE,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS shift_group_members (
        id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        group_id       UUID NOT NULL REFERENCES shift_groups(id) ON DELETE CASCADE,
        employee_id    UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        effective_from DATE NOT NULL,
        -- NULL means open-ended: on this group until somebody says otherwise.
        effective_to   DATE,
        created_by     UUID REFERENCES employees(id),
        created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT shift_group_members_period_check
          CHECK (effective_to IS NULL OR effective_to >= effective_from),
        UNIQUE (group_id, employee_id, effective_from)
      )`);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_sgm_group ON shift_group_members(group_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sgm_employee ON shift_group_members(employee_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sgm_period ON shift_group_members(effective_from, effective_to)`);

    await client.query(`ALTER TABLE shift_roster ADD COLUMN IF NOT EXISTS reason TEXT`);

    await client.query('COMMIT');

    const groups = (await client.query(`SELECT COUNT(*)::int n FROM shift_groups`)).rows[0].n;
    const members = (await client.query(`SELECT COUNT(*)::int n FROM shift_group_members`)).rows[0].n;
    const hasReason = (await client.query(
      `SELECT COUNT(*)::int n FROM information_schema.columns
        WHERE table_name = 'shift_roster' AND column_name = 'reason'`)).rows[0].n;

    console.log(`\n  shift_groups         ready (${groups} group(s))`);
    console.log(`  shift_group_members  ready (${members} membership row(s))`);
    console.log(`  shift_roster.reason  ${hasReason ? 'ready' : 'MISSING'}\n`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n  Migration failed, nothing was changed:', err.message, '\n');
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
