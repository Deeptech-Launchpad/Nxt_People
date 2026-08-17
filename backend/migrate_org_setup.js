/* ── Manage Accounts → Organization Setup ─────────────────────────────────
 *  Locations, Departments and Designations become real records instead of
 *  free text typed onto each employee.
 *
 *  Today employees carry three plain varchars — work_location, department and
 *  designation. That is why the two-work-locations rule has never been enforced
 *  anywhere: "Saibaba Colony, Coimbatore" and "WFH" are strings someone typed,
 *  not a list anyone picked from. A departments table already exists, with
 *  parent_id and head_id, but nothing has ever written to it.
 *
 *  This creates the two missing tables, fills all three from the values already
 *  in use, and links each employee to the row that matches their text. The
 *  varchars stay exactly as they are: every report, export and filter still
 *  reads them, and dropping them here would be a rewrite with no way back.
 *  They become a cache of the linked row's name, kept in step on save.
 *
 *  Nothing is invented. A value that does not match is left unlinked and
 *  printed at the end, rather than guessed at.
 *
 *  Idempotent. Safe to re-run.
 *      docker compose exec backend node migrate_org_setup.js
 * ───────────────────────────────────────────────────────────────────────── */

const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Tables ────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS work_locations (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name        VARCHAR(150) NOT NULL UNIQUE,
        mail_alias  VARCHAR(150),
        description TEXT,
        address_line1 VARCHAR(255),
        address_line2 VARCHAR(255),
        city        VARCHAR(120),
        state       VARCHAR(120),
        country     VARCHAR(120) DEFAULT 'India',
        postal_code VARCHAR(20),
        timezone    VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
        is_active   BOOLEAN NOT NULL DEFAULT TRUE,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS designations (
        id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name       VARCHAR(150) NOT NULL UNIQUE,
        mail_alias VARCHAR(150),
        is_active  BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`);

    // departments predates this and already has parent_id / head_id, which are
    // the reference's Parent Department and Department Lead. Only the columns
    // it is missing get added.
    await client.query(`ALTER TABLE departments ADD COLUMN IF NOT EXISTS mail_alias VARCHAR(150)`);
    await client.query(`ALTER TABLE departments ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS departments_name_key ON departments (name)`);

    // ── Links on employees ────────────────────────────────────────────────
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS work_location_id UUID REFERENCES work_locations(id) ON DELETE SET NULL`);
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS designation_id UUID REFERENCES designations(id) ON DELETE SET NULL`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_employees_work_location ON employees (work_location_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_employees_designation ON employees (designation_id)`);

    // ── Seed from what is already in use ──────────────────────────────────
    // TRIM, because a trailing space is what turns one location into two.
    const seed = async (table, sourceColumn) => {
      await client.query(
        `INSERT INTO ${table} (name)
         SELECT DISTINCT TRIM(${sourceColumn}) FROM employees
          WHERE ${sourceColumn} IS NOT NULL AND TRIM(${sourceColumn}) <> '' AND deleted_at IS NULL
         ON CONFLICT (name) DO NOTHING`
      );
    };
    await seed('work_locations', 'work_location');
    await seed('designations', 'designation');
    await client.query(
      `INSERT INTO departments (name)
       SELECT DISTINCT TRIM(department) FROM employees
        WHERE department IS NOT NULL AND TRIM(department) <> '' AND deleted_at IS NULL
       ON CONFLICT (name) DO NOTHING`
    );

    // Work-from-home is not a place with an address, and saying so on the
    // record stops someone later trying to geofence it.
    await client.query(
      `UPDATE work_locations SET description = 'Work From Home'
        WHERE UPPER(name) = 'WFH' AND description IS NULL`
    );

    // ── Link each employee to their row ───────────────────────────────────
    const linked = {};
    const link = async (idColumn, table, sourceColumn) => {
      const r = await client.query(
        `UPDATE employees e SET ${idColumn} = t.id
           FROM ${table} t
          WHERE t.name = TRIM(e.${sourceColumn}) AND e.${idColumn} IS NULL`
      );
      linked[idColumn] = r.rowCount;
    };
    await link('work_location_id', 'work_locations', 'work_location');
    await link('designation_id', 'designations', 'designation');
    await link('department_id', 'departments', 'department');

    await client.query('COMMIT');

    // ── Report ────────────────────────────────────────────────────────────
    const counts = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM work_locations) AS locations,
        (SELECT COUNT(*) FROM departments)    AS departments,
        (SELECT COUNT(*) FROM designations)   AS designations`);
    const c = counts.rows[0];

    const unlinked = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE work_location_id IS NULL) AS no_location,
        COUNT(*) FILTER (WHERE designation_id  IS NULL) AS no_designation,
        COUNT(*) FILTER (WHERE department_id   IS NULL) AS no_department
      FROM employees WHERE deleted_at IS NULL`);
    const u = unlinked.rows[0];

    console.log('✅ Organization setup ready.');
    console.log(`   ${c.locations} locations, ${c.departments} departments, ${c.designations} designations`);
    console.log(`   linked: ${linked.work_location_id} location, ${linked.designation_id} designation, ${linked.department_id} department`);

    if (Number(u.no_location) || Number(u.no_designation) || Number(u.no_department)) {
      console.log('\n   Left unlinked because the employee has no value to match — assign these in the UI:');
      if (Number(u.no_location))    console.log(`     ${u.no_location} employee(s) with no work location`);
      if (Number(u.no_designation)) console.log(`     ${u.no_designation} employee(s) with no designation`);
      if (Number(u.no_department))  console.log(`     ${u.no_department} employee(s) with no department`);
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Organization setup migration failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit(process.exitCode || 0);
  }
}

migrate();
