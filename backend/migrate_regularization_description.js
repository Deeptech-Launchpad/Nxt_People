/* ── Reason and Description are two different fields, not one ───────────────
 *  The Regularization popup always had both — Reason (a closed, configured
 *  list, for reporting) and an optional free-text Description — but
 *  attendance_regularizations only ever had one `reason` column. The
 *  frontend's workaround was to concatenate them into that single column
 *  before sending, which broke the very validation the closed list exists
 *  for: "Forgot to check-in — some detail" is not "Forgot to check-in", so
 *  every submission with a description filled in was refused with "Choose
 *  one of the configured reasons".
 *
 *  Real column instead of another concatenation trick.
 *
 *    docker compose exec backend node migrate_regularization_description.js
 * ────────────────────────────────────────────────────────────────────────── */
const pool = require('./db');

(async () => {
  await pool.query(`ALTER TABLE attendance_regularizations ADD COLUMN IF NOT EXISTS description TEXT`);
  console.log('  ok   attendance_regularizations.description');
  await pool.end();
})().catch(async (e) => {
  console.error(e);
  try { await pool.end(); } catch {}
  process.exit(1);
});
