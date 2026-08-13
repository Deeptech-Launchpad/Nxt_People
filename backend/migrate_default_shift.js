/* ── Default shift assignment ──────────────────────────────────────────────
 *  Early/Late Check-in and Check-out measures every punch against the
 *  employee's shift. Employees imported from Zoho arrived with no shift_id,
 *  so there was nothing to be early or late against and the whole Entry /
 *  Exit / Net hours half of the report read "-".
 *
 *  This links every employee without a shift to General Shift, and corrects
 *  that shift's start time to 09:30. 09:30–18:00 (8h30 expected) is what the
 *  reference's own deltas work back to on every row: a 10:24 check-in reads
 *  54 minutes late, a 19:04 check-out reads 64 minutes late, and 08:40 worked
 *  reads +00:10 net.
 *
 *  Only employees with a NULL shift_id are touched, so anyone deliberately
 *  put on another shift keeps it. Idempotent — safe to re-run.
 *
 *      docker compose exec backend node migrate_default_shift.js
 * ───────────────────────────────────────────────────────────────────────── */

const { pool } = require('./db');

const GENERAL_SHIFT = 'General Shift';
const START = '09:30';
const END = '18:00';

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const found = await client.query(
      `SELECT id, start_time, end_time FROM shifts WHERE name = $1 LIMIT 1`,
      [GENERAL_SHIFT]
    );
    if (!found.rows.length) {
      // Creating a shift out of nothing would be inventing policy, so stop
      // and say so rather than guessing which shift everyone belongs to.
      console.error(`❌ No shift named "${GENERAL_SHIFT}" exists. Create it in Configuration → Shifts first.`);
      await client.query('ROLLBACK');
      process.exit(1);
    }
    const shiftId = found.rows[0].id;

    const timed = await client.query(
      // start_time/end_time are VARCHAR 'HH:MM' on this table, not TIME, so
      // compare them as text — a ::time cast errors out here.
      `UPDATE shifts SET start_time = $2, end_time = $3
        WHERE id = $1 AND (start_time IS DISTINCT FROM $2 OR end_time IS DISTINCT FROM $3)`,
      [shiftId, START, END]
    );

    const linked = await client.query(
      `UPDATE employees SET shift_id = $1 WHERE shift_id IS NULL AND deleted_at IS NULL`,
      [shiftId]
    );

    await client.query('COMMIT');
    console.log(`✅ ${GENERAL_SHIFT} set to ${START}–${END} (${timed.rowCount} shift row updated).`);
    console.log(`✅ ${linked.rowCount} employees linked to ${GENERAL_SHIFT}.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Default-shift migration failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit(process.exitCode || 0);
  }
}

migrate();
