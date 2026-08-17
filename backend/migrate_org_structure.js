/* ── Organization Setup → Organization Structure ──────────────────────────
 *  The three levels the reference puts above departments:
 *
 *      Legal entity   independently operated companies under one parent
 *      Business unit  operational units inside an organization
 *      Division       functional units; departments can be tagged to one
 *
 *  Each component's NAME is editable — the reference lets an org call a legal
 *  entity a "Company" or anything else — so the labels are configuration, not
 *  hardcoded strings.
 *
 *  companies already existed and now carries the legal entities. business_units
 *  and divisions are new. Divisions nest, so the parent link is guarded against
 *  a division becoming its own ancestor.
 *
 *  The structure ships DISABLED. Turning it on is what makes the three
 *  assignments appear on an employee, and an org with one of each does not need
 *  three more fields on every record until it has a second.
 *
 *  Idempotent. Safe to re-run.
 *      docker compose exec backend node migrate_org_structure.js
 * ───────────────────────────────────────────────────────────────────────── */

const pool = require('./db');

const DEFAULT_CONFIG = {
  enabled: false,
  labels: { legalEntity: 'Company', businessUnit: 'Business Unit', division: 'Division' },
};

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS business_units (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name        VARCHAR(150) NOT NULL UNIQUE,
        description VARCHAR(100),
        company_id  UUID REFERENCES companies(id) ON DELETE SET NULL,
        is_active   BOOLEAN NOT NULL DEFAULT TRUE,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS divisions (
        id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name          VARCHAR(150) NOT NULL UNIQUE,
        description   VARCHAR(100),
        parent_id     UUID REFERENCES divisions(id) ON DELETE SET NULL,
        business_unit_id UUID REFERENCES business_units(id) ON DELETE SET NULL,
        is_active     BOOLEAN NOT NULL DEFAULT TRUE,
        created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
      )`);

    // Where an employee sits in the structure. Nullable throughout: the
    // structure is off by default and nobody is assigned until it is on.
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS business_unit_id UUID REFERENCES business_units(id) ON DELETE SET NULL`);
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS division_id UUID REFERENCES divisions(id) ON DELETE SET NULL`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_employees_business_unit ON employees (business_unit_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_employees_division ON employees (division_id)`);

    // The reference says departments can be tagged to a division.
    await client.query(`ALTER TABLE departments ADD COLUMN IF NOT EXISTS division_id UUID REFERENCES divisions(id) ON DELETE SET NULL`);

    await client.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS org_structure_config JSONB`);
    await client.query(
      `UPDATE settings SET org_structure_config = $1::jsonb WHERE org_structure_config IS NULL`,
      [JSON.stringify(DEFAULT_CONFIG)]
    );

    await client.query('COMMIT');

    const r = await pool.query(`
      SELECT (SELECT COUNT(*) FROM companies)      AS companies,
             (SELECT COUNT(*) FROM business_units) AS business_units,
             (SELECT COUNT(*) FROM divisions)      AS divisions,
             (SELECT org_structure_config->>'enabled' FROM settings LIMIT 1) AS enabled`);
    const c = r.rows[0];
    console.log('✅ Organization structure ready.');
    console.log(`   ${c.companies} legal entit(ies), ${c.business_units} business unit(s), ${c.divisions} division(s)`);
    console.log(`   structure enabled: ${c.enabled}`);
    console.log('\n   It is off until switched on under Organization Structure → Configuration.');
    console.log('   Nobody is assigned to a business unit or division yet.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Organization structure migration failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit(process.exitCode || 0);
  }
}

migrate();
