/* ── Expected hours per day ───────────────────────────────────────────────
 *  The reports computed a day's payable/expected hours from the shift span —
 *  09:30 to 18:00, so 8h30. That is not what the reference does. Its
 *  Attendance Policy has an "Expected hours per day" block with two modes:
 *
 *      ● Set manually   Full day 08:00   Half day 04:00
 *      ○ Shift hours
 *
 *  and this org has it set manually to 08:00. Every payable figure it reports
 *  follows from that, not from the shift: 14 days x 08:00 = 112:00 Expected
 *  Hours, a weekend showing 08:00 Payable Hours on Presence Hours Break-up,
 *  and its system account's 32:00 over four non-working days.
 *
 *  Ours produced 8h30 for all of those — thirty minutes per person per day
 *  too high on Expected vs Worked, Attendance Data for Payroll and Presence
 *  Hours Break-up.
 *
 *  This is deliberately NOT settings.full_day_hours. That one decides whether
 *  a finished day counts as present or half-day at check-out; reusing it would
 *  silently reclassify attendance. Different question, different setting.
 *
 *  Early/Late Check-in keeps measuring against the shift span, because its Net
 *  hours column does too — the reference's own rows work back to 8h30 there.
 *
 *  Idempotent. Safe to re-run.
 *      docker compose exec backend node migrate_expected_hours.js
 * ───────────────────────────────────────────────────────────────────────── */

const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 'manual' uses expected_hours_per_day; 'shift' falls back to the
    // employee's own shift length, which is what the code did before.
    await client.query(
      `ALTER TABLE settings ADD COLUMN IF NOT EXISTS expected_hours_mode VARCHAR(10) NOT NULL DEFAULT 'manual'`
    );
    await client.query(
      `ALTER TABLE settings ADD COLUMN IF NOT EXISTS expected_hours_per_day NUMERIC(4,2) NOT NULL DEFAULT 8.00`
    );
    await client.query(
      `ALTER TABLE settings ADD COLUMN IF NOT EXISTS expected_half_day_hours NUMERIC(4,2) NOT NULL DEFAULT 4.00`
    );

    const r = await client.query(
      `SELECT expected_hours_mode AS mode, expected_hours_per_day AS full, expected_half_day_hours AS half FROM settings LIMIT 1`
    );
    await client.query('COMMIT');

    const s = r.rows[0];
    console.log('✅ Expected-hours settings ready.');
    if (s) console.log(`   mode=${s.mode}  full day=${s.full}h  half day=${s.half}h`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Expected-hours migration failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit(process.exitCode || 0);
  }
}

migrate();
