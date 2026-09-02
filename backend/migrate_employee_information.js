/* Operations -> Employee Information: the tables behind the tabs.
 *
 * Groups, Delegation, and the saved-view builder that Employees /
 * Departments / Designations share. Also widens `tasks` for the Add New Task
 * form the employee row menu opens.
 *
 * `applicability_groups` already exists and is NOT this. That table decides
 * which policy applies to whom; these groups are a named list of people with
 * an admin and members, used for announcements and distribution. Conflating
 * them would mean an HR mailing list silently changing who a leave policy
 * covers, so they stay separate tables on purpose.
 *
 * CREATE TABLE IF NOT EXISTS only applies constraints to a table it actually
 * creates, so a table already present in some earlier shape keeps that shape
 * and every constraint below is silently skipped. Each added column is
 * therefore also ensured individually afterwards.
 *
 * Idempotent. Safe to re-run.
 *     docker compose exec backend node migrate_employee_information.js
 */

const pool = require('./db');

const ensure = (client, table, column, definition) =>
  client.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${definition}`);

const constraint = (client, name, sql) => client.query(`
  DO $do$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${name}') THEN
      ${sql};
    END IF;
  END $do$`);

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    /* Groups.
     * The per-member role is exactly two values in the reference, so it is a
     * CHECK rather than a lookup table: a third value would be a product
     * decision, not data entry. */
    await client.query(`
      CREATE TABLE IF NOT EXISTS employee_groups (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name        TEXT NOT NULL,
        description TEXT,
        email       TEXT,
        created_by  UUID REFERENCES employees(id),
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at  TIMESTAMPTZ
      )`);
    await ensure(client, 'employee_groups', 'description', 'TEXT');
    await ensure(client, 'employee_groups', 'email',       'TEXT');
    await ensure(client, 'employee_groups', 'deleted_at',  'TIMESTAMPTZ');

    await client.query(`
      CREATE TABLE IF NOT EXISTS employee_group_members (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        group_id    UUID NOT NULL REFERENCES employee_groups(id) ON DELETE CASCADE,
        employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        role        TEXT NOT NULL DEFAULT 'member',
        added_by    UUID REFERENCES employees(id),
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    // One row per person per group, whatever their role.
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS employee_group_members_unique
        ON employee_group_members (group_id, employee_id)`);
    await constraint(client, 'employee_group_members_role_chk',
      `ALTER TABLE employee_group_members
         ADD CONSTRAINT employee_group_members_role_chk CHECK (role IN ('admin','member'))`);

    /* Delegation: reassigns approvals from one person to another for a window.
     * A permanent delegation has no end date, which is why ends_at is nullable
     * rather than defaulted to something far in the future. */
    await client.query(`
      CREATE TABLE IF NOT EXISTS approval_delegations (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        delegator_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        delegatee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        type         TEXT NOT NULL DEFAULT 'temporary',
        starts_at    DATE,
        ends_at      DATE,
        notify       TEXT NOT NULL DEFAULT 'both',
        description  TEXT,
        is_active    BOOLEAN NOT NULL DEFAULT TRUE,
        created_by   UUID REFERENCES employees(id),
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await constraint(client, 'approval_delegations_type_chk',
      `ALTER TABLE approval_delegations
         ADD CONSTRAINT approval_delegations_type_chk CHECK (type IN ('temporary','permanent'))`);
    await constraint(client, 'approval_delegations_notify_chk',
      `ALTER TABLE approval_delegations
         ADD CONSTRAINT approval_delegations_notify_chk CHECK (notify IN ('both','delegatee'))`);
    // Delegating to yourself is a no-op that would silently swallow approvals.
    await constraint(client, 'approval_delegations_not_self',
      `ALTER TABLE approval_delegations
         ADD CONSTRAINT approval_delegations_not_self CHECK (delegator_id <> delegatee_id)`);

    /* Saved views. One row per view per module ('employees' | 'departments' |
     * 'designations'). `columns` is an ordered array so the dual-list picker
     * keeps the order chosen; `criteria` holds the builder's rows. Visibility
     * 'shared' is scoped by share_with, which names employees, departments,
     * roles or locations to match the reference's four share targets. */
    await client.query(`
      CREATE TABLE IF NOT EXISTS saved_views (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        module     TEXT NOT NULL,
        name       TEXT NOT NULL,
        owner_id   UUID REFERENCES employees(id) ON DELETE CASCADE,
        is_public  BOOLEAN NOT NULL DEFAULT FALSE,
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        visibility TEXT NOT NULL DEFAULT 'private',
        share_with JSONB NOT NULL DEFAULT '{}'::jsonb,
        columns    JSONB NOT NULL DEFAULT '[]'::jsonb,
        criteria   JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )`);
    await ensure(client, 'saved_views', 'share_with', `JSONB NOT NULL DEFAULT '{}'::jsonb`);
    await ensure(client, 'saved_views', 'criteria',   `JSONB NOT NULL DEFAULT '[]'::jsonb`);
    await ensure(client, 'saved_views', 'deleted_at', 'TIMESTAMPTZ');
    await constraint(client, 'saved_views_visibility_chk',
      `ALTER TABLE saved_views
         ADD CONSTRAINT saved_views_visibility_chk CHECK (visibility IN ('private','everyone','shared'))`);
    await client.query(`
      CREATE INDEX IF NOT EXISTS saved_views_module_idx
        ON saved_views (module) WHERE deleted_at IS NULL`);

    /* Per-person column visibility: the small popover on the header row, which
     * is NOT the view builder. Kept off saved_views so hiding a column for
     * yourself can never edit a view somebody else can see. */
    await client.query(`
      CREATE TABLE IF NOT EXISTS list_column_prefs (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        module      TEXT NOT NULL,
        hidden      JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS list_column_prefs_unique
        ON list_column_prefs (employee_id, module)`);

    /* The Add New Task form on the employee row carries a start date and a
     * reminder; the table had neither. */
    await ensure(client, 'tasks', 'start_date',  'DATE');
    await ensure(client, 'tasks', 'reminder_at', 'TIMESTAMPTZ');

    /* Departments and Designations list Added By / Modified By. Both tables
     * already carry created_at / updated_at but never recorded WHO, so those
     * columns could only ever have rendered blank. Nullable on purpose: every
     * existing row genuinely has no known author and inventing one would be
     * worse than an empty cell. */
    for (const t of ['departments', 'designations']) {
      await ensure(client, t, 'created_by', 'UUID REFERENCES employees(id)');
      await ensure(client, t, 'updated_by', 'UUID REFERENCES employees(id)');
    }

    await client.query('COMMIT');

    console.log('\n  Employee Information schema ready');
    console.log('  ' + '-'.repeat(52));
    for (const t of ['employee_groups', 'employee_group_members', 'approval_delegations',
                     'saved_views', 'list_column_prefs']) {
      const n = (await client.query(`SELECT COUNT(*)::int n FROM ${t}`)).rows[0].n;
      console.log(`  ${t.padEnd(26)} ${n} row(s)`);
    }
    console.log('  tasks                      + start_date, reminder_at\n');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('  migration failed, rolled back:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
