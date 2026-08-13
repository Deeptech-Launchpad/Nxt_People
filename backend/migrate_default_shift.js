/* ── Default shift assignment ──────────────────────────────────────────────
 *  Early/Late Check-in and Check-out measures every punch against the
 *  employee's shift. Employees imported from Zoho arrived with no shift_id,
 *  so there was nothing to be early or late against and the whole Entry /
 *  Exit / Net hours half of the report read "-".
 *
 *  This creates General Shift if it is missing, sets it to 09:30–18:00, and
 *  links every employee without a shift to it. Those times are not a guess:
 *  the reference's own deltas work back to them on every row — a 10:24
 *  check-in reads 54 minutes late, a 19:04 check-out reads 64 minutes late,
 *  and 08:40 worked reads +00:10 net.
 *
 *  Working days are Mon–Sat. Which Saturdays are actually off is not the
 *  shift's business — weekend_rules owns that (Sunday, plus the 1st and 3rd
 *  Saturday), and the reports read it from there.
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
const WORKING_DAYS = JSON.stringify(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const found = await client.query(
      `SELECT id, start_time, end_time FROM shifts WHERE name = $1 LIMIT 1`,
      [GENERAL_SHIFT]
    );

    let shiftId = found.rows[0]?.id;
    let created = false;
    if (!shiftId) {
      // An empty shifts table means nobody has chosen a working pattern yet,
      // not that some other shift was meant — so create the one the reports
      // are written against rather than leaving every delta blank. If other
      // shifts already exist this branch never runs: only a missing General
      // Shift gets made, never a replacement for someone's real choice.
      const other = await client.query(`SELECT count(*)::int AS n FROM shifts`);
      const ins = await client.query(
        `INSERT INTO shifts (name, start_time, end_time, working_days, is_default)
         VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING id`,
        [GENERAL_SHIFT, START, END, WORKING_DAYS, other.rows[0].n === 0]
      );
      shiftId = ins.rows[0].id;
      created = true;
    }

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
    console.log(created
      ? `✅ Created ${GENERAL_SHIFT} ${START}–${END}, Mon–Sat.`
      : `✅ ${GENERAL_SHIFT} set to ${START}–${END} (${timed.rowCount} shift row updated).`);
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
