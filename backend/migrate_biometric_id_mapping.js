/* ── Biometric ID mapping ─────────────────────────────────────────────────
 *  Operations -> Attendance -> Biometric ID mapping. Associates an employee
 *  with the numeric user ID their biometric device reports, so that a device
 *  export can eventually be translated into "this punch belongs to this
 *  employee" the way Zoho's own screen describes: "Map biometric user IDs to
 *  Zoho People User IDs to facilitate biometric based check-in system".
 *
 *  Nothing in this project talks to a biometric device yet — no device SDK,
 *  no sync job, no import path that reads this table. This is the mapping
 *  Zoho stores; a device integration would be separate, later work that
 *  consumes it. Said here rather than left implicit, the way the frontend
 *  already marks other saved-but-unconsumed settings ("Saved, but not
 *  enforced yet").
 *
 *  One employee can be mapped once — a second mapping attempt should replace
 *  it, not create a duplicate the UI would then have to explain. One
 *  biometric ID likewise names exactly one employee, or two people's punches
 *  would land on the same record.
 *
 *  Idempotent. Safe to re-run.
 *      docker compose exec backend node migrate_biometric_id_mapping.js
 * ───────────────────────────────────────────────────────────────────────── */

const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS biometric_id_mappings (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        employee_id   UUID NOT NULL UNIQUE REFERENCES employees(id) ON DELETE CASCADE,
        biometric_id  VARCHAR(60) NOT NULL UNIQUE,
        created_by    UUID REFERENCES employees(id) ON DELETE SET NULL,
        created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
      )`);

    await client.query('COMMIT');

    const r = await pool.query(`SELECT count(*)::int AS n FROM biometric_id_mappings`);
    console.log('✅ biometric_id_mappings ready.');
    console.log(`   ${r.rows[0].n} mapping(s) on record.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Biometric ID mapping migration failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit(process.exitCode || 0);
  }
}

migrate();
