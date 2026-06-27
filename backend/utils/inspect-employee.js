/**
 * Quick inspection — print every non-null column for one employee.
 *
 * Usage:
 *   npm run inspect:employee -- ANXT220005
 *   npm run inspect:employee -- balaji@altiusnxt.com
 *
 * Identifies by employee_id first, falls back to email. Handy when the UI
 * shows a field as blank and you want to see what's actually in the DB.
 */
require('dotenv').config();
const pool = require('../db');

const arg = (process.argv[2] || '').trim();
if (!arg) {
  console.error('Usage: npm run inspect:employee -- <employee_id_or_email>');
  process.exit(1);
}

(async () => {
  const r = await pool.query(
    `SELECT * FROM employees
      WHERE employee_id = $1
         OR LOWER(email) = LOWER($1)
      LIMIT 1`,
    [arg]
  );
  if (r.rows.length === 0) {
    console.error(`No employee found matching "${arg}"`);
    await pool.end();
    process.exit(1);
  }
  const row = r.rows[0];

  // Hide noise — boolean defaults, IDs, timestamps — show only fields with
  // actual values the admin probably cares about.
  const hide = new Set([
    'id', 'password', 'mfa_secret', 'mfa_backup_codes', 'reset_password_token',
    'reset_password_expires', 'created_at', 'updated_at', 'shift_id',
  ]);

  console.log(`\nEmployee: ${row.first_name} ${row.last_name} (${row.employee_id || '—'})\n`);
  const filled = [];
  const empty  = [];
  for (const [col, val] of Object.entries(row)) {
    if (hide.has(col)) continue;
    if (val === null || val === undefined || val === '') empty.push(col);
    else filled.push({ column: col, value: typeof val === 'object' ? JSON.stringify(val) : String(val).slice(0, 80) });
  }
  console.log('── FILLED ──');
  console.table(filled);
  console.log(`\n── EMPTY (${empty.length} columns) ──`);
  console.log(empty.join(', '));

  await pool.end();
})().catch(err => { console.error(err.message); process.exit(1); });
