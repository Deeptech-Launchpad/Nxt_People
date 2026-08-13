/**
 * Work Calendar — Leave Tracker Configuration, item 2.
 *
 * The work week (working_days), the work day (work_start_time / work_end_time)
 * and the half-day threshold already live in `settings` and are editable. What
 * was still hardcoded is the other end of the same rule: attendance.js and
 * regularizations.js both decide "half-day below 7.5 hours, full day at or
 * above" with a literal 7.5, so half_day_hours could be configured while the
 * figure it hands over to was fixed.
 *
 *   full_day_hours  hours needed for a full present day; below it the day is
 *                   marked half-day, below half_day_hours it is absent
 *
 * half_day_hours is also widened from INTEGER to NUMERIC — the settings screen
 * has always offered 0.5 steps, and Postgres was silently rounding them.
 *
 * Backfilled with 7.5, the value both routes hardcoded, so no attendance
 * status changes until someone edits it. Safe to re-run.
 */

const pool = require('./db');

const migrations = [
  `ALTER TABLE settings ADD COLUMN IF NOT EXISTS full_day_hours NUMERIC(4,2) NOT NULL DEFAULT 7.5`,
  `ALTER TABLE settings ALTER COLUMN half_day_hours TYPE NUMERIC(4,2)`,
  `ALTER TABLE settings ALTER COLUMN half_day_hours SET DEFAULT 4`,

  // A full day below the half-day threshold would make 'half-day' unreachable.
  `ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_day_hours_chk`,
  `ALTER TABLE settings ADD CONSTRAINT settings_day_hours_chk
     CHECK (full_day_hours >= half_day_hours)`,
];

(async () => {
  let ok = 0;
  for (const sql of migrations) {
    try { await pool.query(sql); ok++; }
    catch (err) { console.error('FAILED:', sql.split('\n')[0].trim(), '\n  ', err.message); }
  }
  console.log(`work calendar migration: ${ok}/${migrations.length} statements applied`);
  const r = await pool.query(
    `SELECT work_start_time, work_end_time, working_days, late_after_minutes,
            half_day_hours, full_day_hours FROM settings LIMIT 1`
  );
  console.table(r.rows);
  await pool.end();
})();
