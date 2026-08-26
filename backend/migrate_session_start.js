/* ── When the CURRENT session began ─────────────────────────────────────────
 *  Re-checking in cleared check_out and left check_in at the day's first
 *  arrival — correct, because that is when the person got here and what
 *  lateness is measured from. But check-out then computed the session as
 *  `now - check_in` and ADDED it to the hours already banked, so the first
 *  session was counted twice.
 *
 *  Somebody arriving at 2:02 PM, leaving at 6:21, and coming back showed
 *  8:39 worked before they had done five hours. The live timer did the same
 *  arithmetic, so the screen and the stored figure agreed with each other and
 *  both were wrong.
 *
 *  check_in stays the day's arrival. This is where the current stretch started.
 *
 *    docker compose exec backend node migrate_session_start.js
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
const pool = require('./db');

const STEPS = [
  // timestamp WITHOUT time zone, holding UTC — the same convention as
  // check_in and check_out beside it. A column here that stored local time
  // would read five and a half hours out in every comparison against them.
  `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS session_started_at TIMESTAMP`,

  /* Backfill: for a day still open, the session began at check_in. That is
   * right for every row except one already corrupted by the double count, and
   * those are repaired separately — this only has to stop NEW check-outs being
   * wrong. A closed day has no current session, so it stays null. */
  `UPDATE attendance SET session_started_at = check_in
    WHERE session_started_at IS NULL AND check_in IS NOT NULL AND check_out IS NULL`,
];

(async () => {
  console.log('');
  for (const sql of STEPS) {
    const name = (sql.match(/ADD COLUMN IF NOT EXISTS ([a-z_]+)/) || [])[1]
      || (sql.startsWith('UPDATE') ? 'backfill open days' : 'step');
    try {
      const r = await pool.query(sql);
      console.log(`  ok    ${name}${r.rowCount ? `  (${r.rowCount} row(s))` : ''}`);
    } catch (err) {
      console.log(`  FAIL  ${name}: ${err.message}`);
      process.exitCode = 1;
    }
  }

  const open = (await pool.query(
    `SELECT COUNT(*)::int n FROM attendance WHERE check_out IS NULL AND check_in IS NOT NULL`)).rows[0].n;
  console.log(`\n  ${open} day(s) currently open and now carrying a session start.\n`);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
