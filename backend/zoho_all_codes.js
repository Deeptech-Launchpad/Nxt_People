/* ── Every employee code this system knows, one line, comma-joined ──────────
 *  zoho_restage.js takes named codes on purpose — "never everybody" — so
 *  running it company-wide still means naming everybody explicitly rather
 *  than a magic keyword that could silently grow to include somebody nobody
 *  meant to touch. This is that list, read straight from our own database
 *  so it can be captured and handed to zoho_restage.js directly:
 *
 *    CODES=$(docker compose exec -T backend node zoho_all_codes.js)
 *    docker compose exec backend node zoho_restage.js "$CODES" 2026-09-01 2026-09-03
 *
 *  Includes everyone, active and left, the same as the original migration
 *  covered both. Read-only.
 *
 *    docker compose exec backend node zoho_all_codes.js
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
const pool = require('./db');

(async () => {
  const r = await pool.query(`SELECT employee_id FROM employees WHERE employee_id IS NOT NULL ORDER BY employee_id`);
  process.stdout.write(r.rows.map(x => x.employee_id).join(','));
  process.stdout.write('\n');
  await pool.end();
})().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
