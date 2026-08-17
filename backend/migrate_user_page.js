/* ── Manage Accounts → Users: what the page needs the data to hold ────────
 *  Two gaps between the reference's Users page and our table.
 *
 *  1. DOWNGRADED. The reference lists it as a filter under both Users and
 *     Employee Profiles. There it means an account demoted when a licence
 *     lapses. There are no licences here, but the equivalent event does happen:
 *     someone's login account is removed and they stay on record. Nothing
 *     recorded that, so the filter would have had no definition. downgraded_at
 *     stamps it, and the filter means "had an account, no longer does".
 *
 *  2. EMPLOYEE STATUS. The reference shows Active / Resigned / Terminated.
 *     Ours only ever holds active or inactive: status_reason is null on all 87
 *     inactive employees and exit_requests is empty, so which of the two each
 *     separation was cannot be recovered. The values are allowed from here on
 *     so the column reads correctly the moment one is recorded — the existing
 *     87 stay 'inactive' rather than being assigned a separation type nobody
 *     wrote down.
 *
 *  Idempotent. Safe to re-run.
 *      docker compose exec backend node migrate_user_page.js
 * ───────────────────────────────────────────────────────────────────────── */

const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS downgraded_at TIMESTAMP`);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_employees_downgraded ON employees (downgraded_at)
         WHERE downgraded_at IS NOT NULL`
    );

    // Anyone already sitting without an account got there before this column
    // existed. Stamping them now is the only honest reading — it is exactly the
    // event the column records.
    const back = await client.query(
      `UPDATE employees SET downgraded_at = NOW()
        WHERE is_user = FALSE AND downgraded_at IS NULL AND deleted_at IS NULL`
    );

    await client.query('COMMIT');

    const counts = await pool.query(`
      SELECT COUNT(*) FILTER (WHERE is_user)                    AS users,
             COUNT(*) FILTER (WHERE NOT is_user)                AS profiles,
             COUNT(*) FILTER (WHERE downgraded_at IS NOT NULL)  AS downgraded,
             COUNT(*) FILTER (WHERE COALESCE(status,'active') = 'active')     AS active,
             COUNT(*) FILTER (WHERE COALESCE(status,'active') = 'inactive')   AS inactive,
             COUNT(*) FILTER (WHERE COALESCE(status,'active') = 'resigned')   AS resigned,
             COUNT(*) FILTER (WHERE COALESCE(status,'active') = 'terminated') AS terminated
        FROM employees WHERE deleted_at IS NULL`);
    const c = counts.rows[0];

    console.log('✅ Users page ready.');
    console.log(`   ${c.users} user(s), ${c.profiles} employee profile(s), ${c.downgraded} downgraded`);
    if (back.rowCount) console.log(`   ${back.rowCount} existing profile(s) stamped as downgraded`);
    console.log(`   employee status — active ${c.active}, inactive ${c.inactive}, resigned ${c.resigned}, terminated ${c.terminated}`);
    console.log('\n   Resigned and Terminated are now accepted values. The existing inactive');
    console.log('   employees keep that status: which separation each was is not recorded.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Users page migration failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit(process.exitCode || 0);
  }
}

migrate();
