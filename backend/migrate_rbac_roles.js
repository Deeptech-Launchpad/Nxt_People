/* ── RBAC role migration ──────────────────────────────────────────────────
 *  Migrates the legacy 'admin' role to the strict 4-role model's 'super_admin'.
 *  Safe to run multiple times (idempotent): once no 'admin' rows remain, the
 *  UPDATEs simply affect 0 rows.
 *
 *    admin → super_admin    (Super Admin)
 *    hr        (unchanged — newly empowered with full access)
 *    manager   (unchanged — now scoped to direct reports)
 *    employee  (unchanged)
 *
 *  Run once after deploying the RBAC changes:  node backend/migrate_rbac_roles.js
 * ───────────────────────────────────────────────────────────────────────── */

const { pool } = require('./db');

async function migrateRoles() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Employees: admin → super_admin
    const emp = await client.query(
      `UPDATE employees SET role = 'super_admin' WHERE role = 'admin'`
    );
    console.log(`✅ employees: ${emp.rowCount} 'admin' → 'super_admin'`);

    // 2. Keep MFA role config consistent: replace any "admin" entry in the
    //    settings.mfa_required_roles JSONB array with "super_admin".
    //    Guarded by to_regclass so it no-ops if the settings table/column
    //    isn't present in this environment.
    const hasSettings = await client.query(`SELECT to_regclass('public.settings') AS t`);
    if (hasSettings.rows[0].t) {
      const mfa = await client.query(`
        UPDATE settings
           SET mfa_required_roles = (
             SELECT COALESCE(jsonb_agg(
               CASE WHEN v = '"admin"'::jsonb THEN '"super_admin"'::jsonb ELSE v END
             ), '[]'::jsonb)
             FROM jsonb_array_elements(mfa_required_roles) v
           )
         WHERE mfa_required_roles @> '"admin"'::jsonb
      `);
      console.log(`✅ settings.mfa_required_roles: ${mfa.rowCount} row(s) updated`);
    }

    await client.query('COMMIT');

    // Report the resulting role distribution.
    const dist = await pool.query(
      `SELECT role, COUNT(*)::int AS n FROM employees GROUP BY role ORDER BY role`
    );
    console.log('\nRole distribution:');
    dist.rows.forEach(r => console.log(`  ${r.role.padEnd(12)} ${r.n}`));

    const leftover = dist.rows.find(r => r.role === 'admin');
    if (leftover) console.warn(`\n⚠️  ${leftover.n} row(s) still have role 'admin' — investigate.`);
    else console.log('\n✅ No legacy \'admin\' rows remain.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ RBAC role migration failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit(process.exitCode || 0);
  }
}

migrateRoles();
