/* ── A location-based holiday can defer to a shift-based one ────────────────
 *  Zoho's "Preference" radio on Add Holiday: a holiday scoped to locations
 *  only can either apply to literally everyone at those locations ('all'),
 *  or leave alone anyone who is also covered by a separate, shift-scoped
 *  holiday landing on the same date ('except_shift_based' — the default,
 *  and Zoho's own pre-selected option). The second is what "Shift based
 *  holiday will override the location based holiday" (shown on Edit) means:
 *  the shift-scoped row wins for whoever it reaches.
 *
 *  Only meaningful for a holiday with locations set and no shifts of its
 *  own — see holidayTypeFor() in utils/workingDays.js for where this is
 *  read. Every existing row defaults to 'except_shift_based', but today
 *  there are no shift-only holidays on the calendar for it to defer to, so
 *  nothing already recorded is judged differently by this migration alone.
 *
 *    docker compose exec backend node migrate_holiday_preference.js
 * ────────────────────────────────────────────────────────────────────────── */
const pool = require('./db');

(async () => {
  await pool.query(`
    ALTER TABLE holidays
      ADD COLUMN IF NOT EXISTS preference VARCHAR(20) DEFAULT 'except_shift_based'
        CHECK (preference IN ('all', 'except_shift_based'))
  `);
  console.log('  ok   holidays.preference');
  await pool.end();
})().catch(async (e) => {
  console.error(e);
  try { await pool.end(); } catch {}
  process.exit(1);
});
