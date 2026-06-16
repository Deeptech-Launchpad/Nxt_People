/* ── Comp-Off rules migration ─────────────────────────────────────────────
 *  Comp-Off becomes an earned-leave system: an employee works on a weekend or
 *  approved holiday (with attendance recorded) and earns a credit they can use
 *  on a future WORKING day within 3 months. To support that, the comp_offs row
 *  now also captures:
 *
 *    comp_off_date — the future working day the employee wants to take off
 *    expires_at    — validity end = worked_date + 3 months (credit expires after)
 *
 *  Existing rows are back-filled: expires_at = worked_date + 3 months.
 *  Approval flows through the shared hierarchy engine (approval_levels), so no
 *  comp_offs schema change is needed for that.
 *
 *  Idempotent (ADD COLUMN IF NOT EXISTS). Run once after deploying:
 *      node backend/migrate_comp_off_rules.js
 * ───────────────────────────────────────────────────────────────────────── */

const { pool } = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`ALTER TABLE comp_offs ADD COLUMN IF NOT EXISTS comp_off_date DATE`);
    await client.query(`ALTER TABLE comp_offs ADD COLUMN IF NOT EXISTS expires_at    DATE`);
    // Back-fill validity for rows created before this rule (3 months from work).
    await client.query(
      `UPDATE comp_offs
          SET expires_at = (worked_date + INTERVAL '3 months')::date
        WHERE expires_at IS NULL AND worked_date IS NOT NULL`
    );
    await client.query('COMMIT');
    console.log('✅ Comp-Off rule columns ready (comp_off_date, expires_at) + back-fill.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Comp-Off rules migration failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit(process.exitCode || 0);
  }
}

migrate();
