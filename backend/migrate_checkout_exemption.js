/* ── Per-employee checkout minimum-hours exemption ──────────────────────────
 *  Admin/HR can permanently exempt an individual employee from the
 *  8h30m minimum checkout-hours restriction (General Shift / UK Shift —
 *  see utils/checkoutMinHours.js). Per-person, not per-role or per-shift,
 *  same reasoning as employees.attendance_tracked: a title or a shift
 *  assignment is not a promise about this either, and a rule keyed off
 *  either would silently mis-set the next person in that role/shift.
 *
 *  Defaults to FALSE, so nobody's checkout behaviour changes until an
 *  admin switches it on for them by name.
 *
 *  Idempotent. Safe to re-run.
 *      docker compose exec backend node migrate_checkout_exemption.js
 * ───────────────────────────────────────────────────────────────────────── */

const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `ALTER TABLE employees ADD COLUMN IF NOT EXISTS checkout_min_hours_exempt BOOLEAN NOT NULL DEFAULT FALSE`
    );

    await client.query('COMMIT');

    const r = await pool.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE checkout_min_hours_exempt = TRUE)::int AS exempt
         FROM employees WHERE deleted_at IS NULL`
    );
    console.log('✅ checkout_min_hours_exempt ready.');
    console.log(`   ${r.rows[0].total} employee(s), ${r.rows[0].exempt} exempt (new column defaults everyone to not exempt)`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ checkout_min_hours_exempt migration failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit(process.exitCode || 0);
  }
}

migrate();
