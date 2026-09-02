/* The three gaps the Employee Information module had labelled as not built.
 *
 *   1. WORK EXPERIENCE and DEPENDENTS — the two tabular sections that had no
 *      table behind them, so their permission grids governed nothing.
 *   2. EMPLOYEE HEALTH DATA and VACCINATION STATUS — the two optional forms
 *      whose Extend Service toggles recorded a choice and changed nothing.
 *   3. RECORD-CHANGE APPROVALS — holding an edit to an employee, department or
 *      designation pending consent, rather than writing it straight through.
 *
 * The third is the one with teeth. It changes how the employee record saves:
 * with approval on, PUT stops writing and starts queueing. The escape hatch is
 * deliberate and defaults to ON — see `skip_for_full_access` below.
 *
 * Idempotent. Safe to re-run.
 *     docker compose exec backend node migrate_employee_records_extra.js
 */

const pool = require('./db');

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

    /* ── Work experience ────────────────────────────────────────────────── */
    /* `relevant` is the reference's own column: whether this role counts
     * toward the total experience figure on the record. */
    await client.query(`
      CREATE TABLE IF NOT EXISTS employee_work_experience (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        employee_id     UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        company_name    TEXT NOT NULL,
        job_title       TEXT,
        from_date       DATE,
        to_date         DATE,
        job_description TEXT,
        relevant        BOOLEAN NOT NULL DEFAULT FALSE,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    // A stint that ends before it starts is a typo, not a record.
    await constraint(client, 'employee_work_experience_dates_chk',
      `ALTER TABLE employee_work_experience
         ADD CONSTRAINT employee_work_experience_dates_chk
         CHECK (from_date IS NULL OR to_date IS NULL OR to_date >= from_date)`);
    await client.query(`
      CREATE INDEX IF NOT EXISTS employee_work_experience_emp
        ON employee_work_experience (employee_id)`);

    /* ── Dependents ─────────────────────────────────────────────────────── */
    await client.query(`
      CREATE TABLE IF NOT EXISTS employee_dependents (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        employee_id   UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        name          TEXT NOT NULL,
        relationship  TEXT,
        date_of_birth DATE,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await client.query(`
      CREATE INDEX IF NOT EXISTS employee_dependents_emp
        ON employee_dependents (employee_id)`);

    /* ── Employee Health Data ───────────────────────────────────────────── */
    /* One row per person: this is an extension of the employee record, not a
     * log. Health information is the most sensitive thing in the product, so
     * it lives in its own table rather than as more columns on `employees` —
     * a route that selects e.* cannot then leak it by accident. */
    await client.query(`
      CREATE TABLE IF NOT EXISTS employee_health_data (
        id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        employee_id          UUID NOT NULL UNIQUE REFERENCES employees(id) ON DELETE CASCADE,
        blood_group          TEXT,
        height_cm            NUMERIC(5,1),
        weight_kg            NUMERIC(5,1),
        allergies            TEXT,
        chronic_conditions   TEXT,
        medications          TEXT,
        emergency_contact_name  TEXT,
        emergency_contact_phone TEXT,
        doctor_name          TEXT,
        doctor_phone         TEXT,
        insurance_provider   TEXT,
        insurance_number     TEXT,
        notes                TEXT,
        updated_by           UUID REFERENCES employees(id),
        created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);

    /* ── Vaccination status ─────────────────────────────────────────────── */
    /* Many rows per person: a dose is an event with a date. */
    await client.query(`
      CREATE TABLE IF NOT EXISTS employee_vaccinations (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        employee_id   UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        vaccine       TEXT NOT NULL,
        dose          TEXT,
        vaccinated_on DATE,
        certificate_path TEXT,
        certificate_name TEXT,
        notes         TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await client.query(`
      CREATE INDEX IF NOT EXISTS employee_vaccinations_emp
        ON employee_vaccinations (employee_id)`);

    /* ── Record-change approvals ────────────────────────────────────────── */
    /* Configuration, one row per form. */
    await client.query(`
      CREATE TABLE IF NOT EXISTS record_approval_configs (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        form       TEXT NOT NULL UNIQUE,
        is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        /* Defaults to TRUE on purpose. HR editing a record IS the normal path;
         * holding their own edit pending their own approval is a loop that
         * would make the module unusable the moment anybody switched this on.
         * Turn it off to require a second pair of eyes on everyone. */
        skip_for_full_access BOOLEAN NOT NULL DEFAULT TRUE,
        approver_mode TEXT NOT NULL DEFAULT 'roles',
        approver_roles JSONB NOT NULL DEFAULT '["admin","hr_admin","director"]'::jsonb,
        watched_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await constraint(client, 'record_approval_configs_mode_chk',
      `ALTER TABLE record_approval_configs
         ADD CONSTRAINT record_approval_configs_mode_chk
         CHECK (approver_mode IN ('roles','auto_approve','auto_reject'))`);
    await client.query(`
      INSERT INTO record_approval_configs (form) VALUES ('employee'),('department'),('designation')
      ON CONFLICT (form) DO NOTHING`);

    /* The queue. `changes` holds the {field, from, to} shape the audit trail
     * already uses, so one renderer serves the pending view and the history. */
    await client.query(`
      CREATE TABLE IF NOT EXISTS pending_record_changes (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        form          TEXT NOT NULL,
        record_id     UUID NOT NULL,
        submitted_by  UUID REFERENCES employees(id),
        changes       JSONB NOT NULL DEFAULT '[]'::jsonb,
        payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
        status        TEXT NOT NULL DEFAULT 'pending',
        decided_by    UUID REFERENCES employees(id),
        decided_at    TIMESTAMPTZ,
        decision_note TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await constraint(client, 'pending_record_changes_status_chk',
      `ALTER TABLE pending_record_changes
         ADD CONSTRAINT pending_record_changes_status_chk
         CHECK (status IN ('pending','approved','rejected','withdrawn'))`);
    await client.query(`
      CREATE INDEX IF NOT EXISTS pending_record_changes_open
        ON pending_record_changes (form, record_id) WHERE status = 'pending'`);

    await client.query('COMMIT');

    console.log('\n  Employee record extensions ready');
    console.log('  ' + '-'.repeat(52));
    for (const t of ['employee_work_experience', 'employee_dependents',
                     'employee_health_data', 'employee_vaccinations',
                     'record_approval_configs', 'pending_record_changes']) {
      const n = (await client.query(`SELECT COUNT(*)::int n FROM ${t}`)).rows[0].n;
      console.log(`  ${t.padEnd(28)} ${n} row(s)`);
    }
    console.log('\n  Record approvals are OFF for every form until switched on.\n');
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
