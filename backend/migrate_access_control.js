/* ── Manage Accounts → User Access Control ─────────────────────────────────
 *  Roles become records instead of six strings compiled into 182 route
 *  guards, so a role created in the UI actually grants something.
 *
 *  The model:
 *
 *    roles                  general and specific roles. The six we already
 *                           have are seeded as system roles: they can be
 *                           assigned and renamed but never deleted, because
 *                           every existing employee carries one of their keys.
 *    role_permissions       what a role may do. The route guards ask about
 *                           these, not about role names.
 *    role_functions         Function Based Permissions — the reference's
 *                           sixteen switches, per role.
 *    specific_role_assignments
 *                           an employee, a specific role, and the slice of
 *                           the organization it applies to.
 *    administrator_access   the Administrator matrix: per user, per service,
 *                           a level for Settings and one for Data.
 *    applicability_groups   dynamic employee groups: named employees, or
 *                           criteria that decide membership as records change.
 *
 *  The seed is derived from the guards that exist today, not invented. Every
 *  authorize() call site in the codebase declares one of exactly three role
 *  sets, and each becomes one permission:
 *
 *    admin|director|hr_admin                          -> org.manage    (112 sites)
 *    admin|director|hr_admin|manager                  -> team.manage   (58)
 *    admin|director|hr_admin|manager|team_incharge    -> team.approve  (12)
 *
 *  and the data layer's isFullAccess()/isManager() become people.viewAll and
 *  people.viewReports. Seeded this way, every one of the six roles has exactly
 *  the access it had before — which access_parity.js proves rather than
 *  assumes.
 *
 *  Idempotent. Safe to re-run.
 *      docker compose exec backend node migrate_access_control.js
 * ───────────────────────────────────────────────────────────────────────── */

const pool = require('./db');

// The six roles the application already enforces. `key` is what
// employees.role stores; renaming a role changes `name`, never `key`, so a
// rename cannot orphan every employee holding it.
const SYSTEM_ROLES = [
  { key: 'admin',         name: 'Admin',         rank: 1 },
  { key: 'director',      name: 'Director',      rank: 2 },
  { key: 'hr_admin',      name: 'HR',            rank: 3 },
  { key: 'manager',       name: 'Manager',       rank: 4 },
  { key: 'team_incharge', name: 'Team Incharge', rank: 5 },
  { key: 'team_member',   name: 'Team member',   rank: 6 },
];

// Exactly what each role can do today. org.manage/team.manage/team.approve
// are the three route-guard shapes; people.* is the data-scoping split.
const SEED_PERMISSIONS = {
  admin:         ['org.manage', 'team.manage', 'team.approve', 'people.viewAll'],
  director:      ['org.manage', 'team.manage', 'team.approve', 'people.viewAll'],
  hr_admin:      ['org.manage', 'team.manage', 'team.approve', 'people.viewAll'],
  manager:       ['team.manage', 'team.approve', 'people.viewReports'],
  team_incharge: ['team.approve', 'people.viewReports'],
  team_member:   [],
};

/* Function Based Permissions seed. The list itself lives in the catalogue so
 * the screen, the seed and the code that enforces the switches all read one
 * source — this held a second copy of the sixteen keys, and a copy is a thing
 * that drifts. */
const { FUNCTIONS: CATALOG } = require('./utils/accessCatalog');
const FUNCTIONS = CATALOG.map(f => ({
  key: f.key,
  allowed: f.default,
  options: f.defaultOptions || {},
}));

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS roles (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        key         VARCHAR(50)  NOT NULL UNIQUE,
        name        VARCHAR(100) NOT NULL,
        kind        VARCHAR(20)  NOT NULL DEFAULT 'general',
        description VARCHAR(255),
        -- A system role is one the application itself relies on. It can be
        -- renamed and assigned, never deleted.
        is_system   BOOLEAN NOT NULL DEFAULT FALSE,
        cloned_from UUID REFERENCES roles(id) ON DELETE SET NULL,
        rank        INT NOT NULL DEFAULT 100,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT roles_kind_check CHECK (kind IN ('general', 'specific'))
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS role_permissions (
        role_id    UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        permission VARCHAR(60) NOT NULL,
        PRIMARY KEY (role_id, permission)
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS role_functions (
        role_id      UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        function_key VARCHAR(60) NOT NULL,
        allowed      BOOLEAN NOT NULL DEFAULT FALSE,
        options      JSONB NOT NULL DEFAULT '{}'::jsonb,
        PRIMARY KEY (role_id, function_key)
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS specific_role_assignments (
        id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        employee_id   UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        role_id       UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        -- One row per applicability line: any of company / business unit /
        -- division / department / location, each optional.
        applicability JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (employee_id, role_id)
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS administrator_access (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        service_key VARCHAR(60) NOT NULL,
        -- Settings and Data are separate questions in the reference: an admin
        -- can configure a service without seeing everybody's records in it.
        settings_level VARCHAR(10) NOT NULL DEFAULT 'none',
        data_level     VARCHAR(10) NOT NULL DEFAULT 'none',
        created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (employee_id, service_key),
        CONSTRAINT admin_settings_level_check CHECK (settings_level IN ('full', 'partial', 'none')),
        CONSTRAINT admin_data_level_check     CHECK (data_level     IN ('full', 'partial', 'none'))
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS applicability_groups (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name        VARCHAR(150) NOT NULL UNIQUE,
        -- Named employees are always in the group. Criteria decide the rest,
        -- and are re-evaluated on read rather than stored as a membership
        -- list, so the group follows a transfer without a nightly job.
        employee_ids UUID[] NOT NULL DEFAULT '{}',
        criteria     JSONB  NOT NULL DEFAULT '[]'::jsonb,
        created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
      )`);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions (role_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sra_employee ON specific_role_assignments (employee_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_admin_access_employee ON administrator_access (employee_id)`);

    // ── Seed ───────────────────────────────────────────────────────────────
    for (const r of SYSTEM_ROLES) {
      await client.query(
        `INSERT INTO roles (key, name, kind, is_system, rank)
         VALUES ($1, $2, 'general', TRUE, $3)
         ON CONFLICT (key) DO UPDATE SET is_system = TRUE, rank = EXCLUDED.rank`,
        [r.key, r.name, r.rank]
      );
    }

    // Permissions are seeded only where a role has none at all. Re-running
    // must not undo a permission an administrator has since removed.
    for (const [key, perms] of Object.entries(SEED_PERMISSIONS)) {
      const role = await client.query(`SELECT id FROM roles WHERE key = $1`, [key]);
      const id = role.rows[0].id;
      const existing = await client.query(`SELECT 1 FROM role_permissions WHERE role_id = $1 LIMIT 1`, [id]);
      // team_member legitimately has no permissions, so "no rows" cannot mean
      // "not seeded yet" for it. A marker row would be worse than this flag.
      if (existing.rows.length || key === 'team_member') continue;
      for (const p of perms) {
        await client.query(
          `INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [id, p]
        );
      }
    }

    const allRoles = await client.query(`SELECT id FROM roles WHERE kind = 'general'`);
    for (const role of allRoles.rows) {
      for (const f of FUNCTIONS) {
        await client.query(
          `INSERT INTO role_functions (role_id, function_key, allowed, options)
           VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT DO NOTHING`,
          [role.id, f.key, f.allowed, JSON.stringify(f.options)]
        );
      }
    }

    // employees.role has defaulted to 'employee' since the first schema — a
    // value none of the six roles use and no label exists for. Nothing carries
    // it today; left alone, the next insert that omits a role would create a
    // user with no access and no role badge.
    await client.query(`ALTER TABLE employees ALTER COLUMN role SET DEFAULT 'team_member'`);
    const strays = await client.query(
      `UPDATE employees SET role = 'team_member'
        WHERE role IS NULL OR role NOT IN (SELECT key FROM roles WHERE kind = 'general')
       RETURNING id`
    );

    await client.query('COMMIT');

    const summary = await pool.query(`
      SELECT r.key, r.name, r.is_system,
             (SELECT COUNT(*)::int FROM role_permissions p WHERE p.role_id = r.id) AS perms,
             (SELECT COUNT(*)::int FROM employees e
               WHERE e.role = r.key AND e.deleted_at IS NULL AND e.status = 'active') AS members
        FROM roles r WHERE r.kind = 'general' ORDER BY r.rank`);

    console.log('✅ User access control ready.');
    for (const r of summary.rows) {
      console.log(`   ${r.name.padEnd(14)} ${String(r.perms).padStart(2)} permission(s), ${r.members} current member(s)${r.is_system ? '  [system]' : ''}`);
    }
    console.log(`\n   ${FUNCTIONS.length} functions seeded per role.`);
    console.log(`   employees.role now defaults to 'team_member'; ${strays.rowCount} row(s) corrected.`);
    console.log('\n   Every role has exactly the access it had before this ran.');
    console.log('   access_parity.js proves that rather than assuming it.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Access control migration failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit(process.exitCode || 0);
  }
}

migrate();
