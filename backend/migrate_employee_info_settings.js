/* Settings -> Employee Information.
 *
 * The rules behind the Operations records: which statuses exist, how an
 * employee ID is generated, which fields a role may see, and the reference
 * material HR wants alongside them.
 *
 * Two of these correct real problems rather than adding features:
 *
 *   - EMPLOYEE STATUSES are typed. "Active" and "Inactive" are the only two
 *     things the rest of the system needs to know; Terminated, Deceased and
 *     Resigned are names people use for the second. Today `employees.status`
 *     holds a free string, which is why live has 153 rows marked 'active'
 *     while only 57 are current, and why the Employees list has to guess with
 *     two separate criteria.
 *   - FIELD PERMISSIONS decide who sees which field. Identity numbers are the
 *     reason: they are presently governed by a rule hard-coded in the route,
 *     which is not something an organisation can adjust.
 *
 * Idempotent. Safe to re-run.
 *     docker compose exec backend node migrate_employee_info_settings.js
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

    /* ── Employee statuses ──────────────────────────────────────────────── */
    await client.query(`
      CREATE TABLE IF NOT EXISTS employee_statuses (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name       TEXT NOT NULL,
        /* 'active' means the person is working; 'inactive' means they are not.
         * Everything else in the product asks this question, never the name. */
        type       TEXT NOT NULL DEFAULT 'inactive',
        sort_order INT  NOT NULL DEFAULT 0,
        is_system  BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS employee_statuses_name_key
        ON employee_statuses (LOWER(name))`);
    await constraint(client, 'employee_statuses_type_chk',
      `ALTER TABLE employee_statuses
         ADD CONSTRAINT employee_statuses_type_chk CHECK (type IN ('active','inactive'))`);

    /* Seeded from what employees.status actually contains, so nothing is
     * invented and no existing row is orphaned. Everything that is not
     * literally 'active' is seeded as inactive — which is the correct reading
     * of resigned, terminated and notice_period, and the whole point of the
     * type column. `is_system` marks the two the product itself relies on. */
    await client.query(`
      INSERT INTO employee_statuses (name, type, sort_order, is_system)
      VALUES ('Active','active',0,TRUE), ('Inactive','inactive',1,TRUE)
      ON CONFLICT DO NOTHING`);
    await client.query(`
      INSERT INTO employee_statuses (name, type, sort_order)
      SELECT DISTINCT INITCAP(REPLACE(e.status,'_',' ')), 'inactive', 10
        FROM employees e
       WHERE e.status IS NOT NULL AND e.status <> '' AND LOWER(e.status) <> 'active'
         AND NOT EXISTS (
           SELECT 1 FROM employee_statuses s
            WHERE LOWER(s.name) = LOWER(INITCAP(REPLACE(e.status,'_',' '))))
      ON CONFLICT DO NOTHING`);

    /* ── Employee ID rules ──────────────────────────────────────────────── */
    /* An ID is [prefix segments] + a zero-padded number + [suffix segments].
     * Segments are ordered and each is either a literal or a field, which is
     * what lets ANXT2600164 be described as "ANXT" + joining year + counter
     * rather than hard-coded in a helper. */
    await client.query(`
      CREATE TABLE IF NOT EXISTS employee_id_rules (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name              TEXT NOT NULL,
        code              TEXT,
        color             TEXT DEFAULT '#38bdf8',
        starting_number   INT  NOT NULL DEFAULT 1,
        placeholder_digits INT NOT NULL DEFAULT 1,
        prefix            JSONB NOT NULL DEFAULT '[]'::jsonb,
        suffix            JSONB NOT NULL DEFAULT '[]'::jsonb,
        /* Zoho's "Reuse starting number for each unique combination of prefix
         * and suffix": with it on, ANXT26 and ANXT25 each count from 1. */
        reuse_per_combination BOOLEAN NOT NULL DEFAULT FALSE,
        is_default        BOOLEAN NOT NULL DEFAULT FALSE,
        is_active         BOOLEAN NOT NULL DEFAULT TRUE,
        last_generated_id TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    /* The counter per resolved prefix/suffix combination. Kept out of the rule
     * row because with reuse_per_combination there is one counter per
     * combination, not one per rule. */
    await client.query(`
      CREATE TABLE IF NOT EXISTS employee_id_counters (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        rule_id     UUID NOT NULL REFERENCES employee_id_rules(id) ON DELETE CASCADE,
        combination TEXT NOT NULL DEFAULT '',
        next_number INT  NOT NULL DEFAULT 1,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS employee_id_counters_key
        ON employee_id_counters (rule_id, combination)`);

    /* ── Streams ────────────────────────────────────────────────────────── */
    /* A named grouping of designations and/or people that cuts across
     * departments — a "QA stream" spanning three departments, say. Members are
     * one table with two nullable references rather than two tables, because
     * every reader wants "who is in this stream" as a single list. */
    await client.query(`
      CREATE TABLE IF NOT EXISTS employee_streams (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name        TEXT NOT NULL,
        description TEXT,
        is_active   BOOLEAN NOT NULL DEFAULT TRUE,
        created_by  UUID REFERENCES employees(id),
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at  TIMESTAMPTZ
      )`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS employee_stream_members (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        stream_id      UUID NOT NULL REFERENCES employee_streams(id) ON DELETE CASCADE,
        employee_id    UUID REFERENCES employees(id) ON DELETE CASCADE,
        designation_id UUID REFERENCES designations(id) ON DELETE CASCADE,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    // A member row that references neither is a row nothing can resolve.
    await constraint(client, 'employee_stream_members_target_chk',
      `ALTER TABLE employee_stream_members
         ADD CONSTRAINT employee_stream_members_target_chk
         CHECK (employee_id IS NOT NULL OR designation_id IS NOT NULL)`);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS employee_stream_members_emp
        ON employee_stream_members (stream_id, employee_id) WHERE employee_id IS NOT NULL`);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS employee_stream_members_desig
        ON employee_stream_members (stream_id, designation_id) WHERE designation_id IS NOT NULL`);

    /* ── Resources: Knowledge Base and FAQ ──────────────────────────────── */
    await client.query(`
      CREATE TABLE IF NOT EXISTS kb_references (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        module      TEXT NOT NULL DEFAULT 'employee-information',
        title       TEXT NOT NULL,
        kind        TEXT NOT NULL DEFAULT 'file',
        url         TEXT,
        file_path   TEXT,
        file_name   TEXT,
        created_by  UUID REFERENCES employees(id),
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at  TIMESTAMPTZ
      )`);
    await constraint(client, 'kb_references_kind_chk',
      `ALTER TABLE kb_references
         ADD CONSTRAINT kb_references_kind_chk CHECK (kind IN ('file','url'))`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS faqs (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        module      TEXT NOT NULL DEFAULT 'employee-information',
        question    TEXT NOT NULL,
        answer      TEXT,
        tags        TEXT,
        sort_order  INT NOT NULL DEFAULT 0,
        created_by  UUID REFERENCES employees(id),
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at  TIMESTAMPTZ
      )`);

    /* ── Access control ─────────────────────────────────────────────────── */
    /* Per role, per form, per field. Absent means "inherit the default", which
     * is why there is no seed: an empty table has to behave exactly like the
     * system did before this screen existed. */
    await client.query(`
      CREATE TABLE IF NOT EXISTS field_permissions (
        id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        form      TEXT NOT NULL DEFAULT 'employee',
        role      TEXT NOT NULL,
        field_key TEXT NOT NULL,
        can_view  BOOLEAN NOT NULL DEFAULT TRUE,
        can_edit  BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS field_permissions_key
        ON field_permissions (form, role, field_key)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS import_export_permissions (
        id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        form      TEXT NOT NULL,
        role      TEXT NOT NULL,
        can_import BOOLEAN NOT NULL DEFAULT FALSE,
        can_export BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS import_export_permissions_key
        ON import_export_permissions (form, role)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS tabular_section_permissions (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        form       TEXT NOT NULL DEFAULT 'employee',
        section    TEXT NOT NULL,
        role       TEXT NOT NULL,
        can_add    BOOLEAN NOT NULL DEFAULT FALSE,
        can_edit   BOOLEAN NOT NULL DEFAULT FALSE,
        can_delete BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS tabular_section_permissions_key
        ON tabular_section_permissions (form, section, role)`);

    /* ── Extend Service ─────────────────────────────────────────────────── */
    /* Which optional forms are switched on. Employee, Department and
     * Designation are core and have no toggle in the reference either. */
    await client.query(`
      CREATE TABLE IF NOT EXISTS extend_service_forms (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        form_key   TEXT NOT NULL UNIQUE,
        label      TEXT NOT NULL,
        is_core    BOOLEAN NOT NULL DEFAULT FALSE,
        is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await client.query(`
      INSERT INTO extend_service_forms (form_key, label, is_core, is_enabled) VALUES
        ('employee','Employee',TRUE,TRUE),
        ('department','Department',TRUE,TRUE),
        ('designation','Designation',TRUE,TRUE),
        ('employee_health','Employee Health Data',FALSE,FALSE),
        ('vaccination','Vaccination Status',FALSE,FALSE)
      ON CONFLICT (form_key) DO NOTHING`);

    /* Custom buttons. Deliberately no script column: arbitrary user code
     * cannot be executed safely here, so a custom action is criteria plus the
     * email alerts and field updates the automation engine already runs. A
     * code box that never runs would be worse than not offering one. */
    await client.query(`
      CREATE TABLE IF NOT EXISTS custom_actions (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        form          TEXT NOT NULL DEFAULT 'employee',
        name          TEXT NOT NULL,
        applicable_to JSONB NOT NULL DEFAULT '{}'::jsonb,
        placement     TEXT NOT NULL DEFAULT 'record_view',
        default_action JSONB NOT NULL DEFAULT '{}'::jsonb,
        criteria      JSONB NOT NULL DEFAULT '[]'::jsonb,
        is_active     BOOLEAN NOT NULL DEFAULT TRUE,
        created_by    UUID REFERENCES employees(id),
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at    TIMESTAMPTZ
      )`);
    await constraint(client, 'custom_actions_placement_chk',
      `ALTER TABLE custom_actions
         ADD CONSTRAINT custom_actions_placement_chk
         CHECK (placement IN ('record_view','record_listing'))`);

    /* Basic Details toggles live beside the rest of the module's policy. */
    await ensure(client, 'settings', 'employee_info_config', `JSONB NOT NULL DEFAULT '{}'::jsonb`);

    await client.query('COMMIT');

    console.log('\n  Employee Information settings schema ready');
    console.log('  ' + '-'.repeat(54));
    for (const t of ['employee_statuses', 'employee_id_rules', 'employee_streams',
                     'kb_references', 'faqs', 'field_permissions',
                     'import_export_permissions', 'tabular_section_permissions',
                     'extend_service_forms', 'custom_actions']) {
      const n = (await client.query(`SELECT COUNT(*)::int n FROM ${t}`)).rows[0].n;
      console.log(`  ${t.padEnd(30)} ${n} row(s)`);
    }
    const st = await client.query(`SELECT name, type FROM employee_statuses ORDER BY sort_order, name`);
    console.log('\n  statuses seeded from live data:');
    for (const s of st.rows) console.log(`    ${s.name.padEnd(20)} -> ${s.type}`);
    console.log('');
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
