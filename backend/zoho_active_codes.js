/* Same as zoho_all_codes.js, but active employees only -- for tools like
 * zoho_complete_absent_days.js where the point is fixing current attendance,
 * not touching people who have already left.
 *
 *    docker compose exec backend node zoho_active_codes.js
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
const pool = require('./db');

(async () => {
  const r = await pool.query(
    `SELECT employee_id FROM employees WHERE employee_id ~ '^ANXT' AND status = 'active' ORDER BY employee_id`);
  process.stdout.write(r.rows.map(x => x.employee_id).join(','));
  process.stdout.write('\n');
  await pool.end();
})().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
