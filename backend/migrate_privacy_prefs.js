/**
 * migrate_privacy_prefs.js
 *
 * "Enable to give employees the choice to share or hide their birthday."
 *
 * The org toggle grants the choice; this is where the choice itself lives.
 * Without it the setting had nothing to switch on — there was no per-person
 * preference for it to enable, which is why the card carried a badge rather
 * than a wire.
 *
 * Defaults to sharing. Somebody who has never opened the setting is in exactly
 * the position they were in before it existed, and nothing disappears from the
 * directory the day this ships.
 */
const pool = require('./db');

const DEFAULT = { birthday: true, workAnniversary: true, mobileNumber: true };

const migrations = [
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS privacy_prefs JSONB`,
  [`UPDATE employees SET privacy_prefs = $1::jsonb WHERE privacy_prefs IS NULL`,
   [JSON.stringify(DEFAULT)]],
];

(async () => {
  let ok = 0;
  for (const entry of migrations) {
    const [sql, params] = Array.isArray(entry) ? entry : [entry, []];
    try { await pool.query(sql, params); ok++; }
    catch (err) {
      if (err.code === '42710' || err.code === '42P07') { ok++; continue; }
      console.error('FAILED:', sql.split('\n')[0].trim(), '\n  ', err.message);
    }
  }
  console.log(`privacy prefs migration: ${ok}/${migrations.length} statements applied`);
  const r = await pool.query(
    `SELECT COUNT(*)::int total, COUNT(privacy_prefs)::int withPrefs FROM employees`);
  console.log(`  ${r.rows[0].withprefs}/${r.rows[0].total} employees carry a preference`);
  await pool.end();
})();
