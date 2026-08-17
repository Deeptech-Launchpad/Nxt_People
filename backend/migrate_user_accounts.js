/* ── Users, account access, and the company they belong to ────────────────
 *  Three things, all the same shape of problem: something the product talks
 *  about but the database cannot express.
 *
 *  1. ACCOUNT ACCESS. Nothing separates "has left the company" from "cannot
 *     sign in". employees.status carries the first; the second does not exist.
 *     Worse, neither /login nor /refresh consults status at all — they check
 *     registration_status, which is 'active' for all 155 people including the
 *     87 marked inactive. The comment on the notice-period cron in server.js
 *     claims status revokes access; it does not. Only 4 employees have a
 *     password set, so nobody has walked through the gap, but it is an accident
 *     rather than a defence.
 *
 *     login_enabled makes it real, and is backfilled from status so the intent
 *     that was already recorded finally takes effect.
 *
 *  2. USERS vs EMPLOYEE PROFILES. The reference splits people with a login from
 *     people who are only recorded. There it is a licensing boundary; here it
 *     is simply whether an account exists. is_user carries that, and everyone
 *     currently has one.
 *
 *  3. COMPANY. A companies table exists with one row, "Nxt People Corp", and
 *     nothing references it — while every employee carries the text
 *     "AltiusNxt". This links employees to a real record, seeded from the value
 *     actually in use. The orphaned row is reported, not deleted: which of the
 *     two names is right is not something a migration can know.
 *
 *  Idempotent. Safe to re-run.
 *      docker compose exec backend node migrate_user_accounts.js
 * ───────────────────────────────────────────────────────────────────────── */

const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Account columns ───────────────────────────────────────────────────
    // Defaults are permissive so an existing row is unaffected until the
    // backfill below decides otherwise.
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_user BOOLEAN NOT NULL DEFAULT TRUE`);
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS login_enabled BOOLEAN NOT NULL DEFAULT TRUE`);
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS login_disabled_at TIMESTAMP`);
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS login_disabled_reason TEXT`);

    // Backfilled once. A later run must not re-disable someone an admin has
    // deliberately re-enabled, so this only fires while the marker is absent.
    const marker = await client.query(
      `SELECT COUNT(*)::int AS n FROM employees WHERE login_disabled_at IS NOT NULL`
    );
    let disabled = 0;
    if (marker.rows[0].n === 0) {
      const r = await client.query(
        `UPDATE employees
            SET login_enabled = FALSE,
                login_disabled_at = NOW(),
                login_disabled_reason = 'Backfilled from employment status'
          WHERE COALESCE(status, 'active') <> 'active' AND deleted_at IS NULL`
      );
      disabled = r.rowCount;
    }

    await client.query(`CREATE INDEX IF NOT EXISTS idx_employees_login_enabled ON employees (login_enabled)`);

    // ── Company ───────────────────────────────────────────────────────────
    await client.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`);
    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_employees_company ON employees (company_id)`);

    await client.query(
      `INSERT INTO companies (name)
       SELECT DISTINCT TRIM(company) FROM employees
        WHERE company IS NOT NULL AND TRIM(company) <> '' AND deleted_at IS NULL
       ON CONFLICT (name) DO NOTHING`
    );
    const linked = await client.query(
      `UPDATE employees e SET company_id = c.id
         FROM companies c
        WHERE c.name = TRIM(e.company) AND e.company_id IS NULL`
    );

    await client.query('COMMIT');

    // ── Report ────────────────────────────────────────────────────────────
    const counts = await pool.query(`
      SELECT COUNT(*) FILTER (WHERE is_user)                        AS users,
             COUNT(*) FILTER (WHERE NOT is_user)                    AS profiles,
             COUNT(*) FILTER (WHERE is_user AND login_enabled)      AS enabled,
             COUNT(*) FILTER (WHERE is_user AND NOT login_enabled)  AS blocked
        FROM employees WHERE deleted_at IS NULL`);
    const c = counts.rows[0];

    const companies = await pool.query(`
      SELECT co.name, COUNT(e.id)::int AS employees
        FROM companies co
        LEFT JOIN employees e ON e.company_id = co.id AND e.deleted_at IS NULL
       GROUP BY co.name ORDER BY 2 DESC`);

    console.log('✅ User accounts ready.');
    console.log(`   ${c.users} user(s) with an account, ${c.profiles} profile(s) without one`);
    console.log(`   ${c.enabled} may sign in, ${c.blocked} blocked`);
    if (disabled) console.log(`   ${disabled} blocked by this run, from their employment status`);
    console.log('\n   Companies:');
    companies.rows.forEach(r => console.log(`     ${String(r.employees).padStart(4)}  ${r.name}`));

    const orphan = companies.rows.filter(r => r.employees === 0);
    if (orphan.length) {
      console.log('\n   ⚠ No employees are assigned to:');
      orphan.forEach(r => console.log(`     ${r.name}`));
      console.log('     Rename it to the real company name, or delete it in Manage Accounts.');
    }
    console.log('\n   Sign-in is now refused for a blocked account. Check the counts above before');
    console.log('   anyone tries to log in — this is the first time employment status has bitten.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ User accounts migration failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit(process.exitCode || 0);
  }
}

migrate();
