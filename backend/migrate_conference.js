/* ── Conference hall booking migration ────────────────────────────────────
 *  Creates the conference_bookings table for the Operations → Conference
 *  feature: book a hall (Floor 1 / Floor 2) for a date + time window, with
 *  overlap prevention per hall. Additive — touches nothing else.
 *
 *  Idempotent. Run once after deploying:
 *      node backend/migrate_conference.js
 * ───────────────────────────────────────────────────────────────────────── */

const { pool } = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS conference_bookings (
        id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        title        VARCHAR(255) NOT NULL,
        booking_date DATE NOT NULL,
        start_time   TIME NOT NULL,
        end_time     TIME NOT NULL,
        hall         VARCHAR(50)  NOT NULL,          -- 'Floor 1' | 'Floor 2'
        description  TEXT,
        booked_by    UUID REFERENCES employees(id) ON DELETE SET NULL,
        status       VARCHAR(20) NOT NULL DEFAULT 'booked',  -- 'booked' | 'cancelled'
        created_at   TIMESTAMPTZ DEFAULT NOW(),
        updated_at   TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    // "Book for Others": the name of the employee the hall is booked for.
    // Purely descriptive — never affects overlap/validation. NULL = booked for
    // the logged-in user (booked_by).
    await client.query(`ALTER TABLE conference_bookings ADD COLUMN IF NOT EXISTS booked_for VARCHAR(255)`);
    // Fast lookups for the per-hall, per-day overlap check + schedule view.
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_conf_hall_date
         ON conference_bookings (hall, booking_date)
       WHERE status = 'booked'`
    );
    await client.query('COMMIT');
    console.log('✅ conference_bookings table ready (+ index).');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Conference migration failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit(process.exitCode || 0);
  }
}

migrate();
