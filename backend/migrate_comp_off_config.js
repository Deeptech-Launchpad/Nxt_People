/**
 * Compensatory Off — Leave Tracker Configuration, item 4.
 *
 * comp-off.js decided eligibility for itself: "earned for working a Saturday,
 * Sunday, or any row in the holidays table; usable Monday–Friday; valid for 3
 * months". None of that consulted the work calendar the rest of the app runs
 * on, so with this company's actual rules (Sundays, 1st & 3rd Saturdays, 2nd
 * Mondays) it granted credit for working an ordinary 2nd Saturday, refused
 * credit for working a 2nd Monday, and refused to let a credit be taken on a
 * working Saturday. It also counted a Working Day Exception as a holiday.
 *
 * The eligibility rules now read the work calendar. The one figure that was
 * a policy rather than a calendar fact becomes a setting:
 *
 *   comp_off_expiry_months  how long an earned credit stays usable
 *
 * Backfilled with 3, the value the route hardcoded, so no existing credit
 * changes. Safe to re-run.
 */

const pool = require('./db');

const migrations = [
  `ALTER TABLE settings ADD COLUMN IF NOT EXISTS comp_off_expiry_months INTEGER NOT NULL DEFAULT 3`,
  `ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_comp_off_expiry_chk`,
  `ALTER TABLE settings ADD CONSTRAINT settings_comp_off_expiry_chk
     CHECK (comp_off_expiry_months BETWEEN 1 AND 60)`,
];

(async () => {
  let ok = 0;
  for (const sql of migrations) {
    try { await pool.query(sql); ok++; }
    catch (err) { console.error('FAILED:', sql.split('\n')[0].trim(), '\n  ', err.message); }
  }
  console.log(`comp-off config migration: ${ok}/${migrations.length} statements applied`);
  const r = await pool.query('SELECT comp_off_expiry_months FROM settings LIMIT 1');
  console.table(r.rows);
  await pool.end();
})();
