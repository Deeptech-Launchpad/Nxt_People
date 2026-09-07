#!/usr/bin/env node
/* What is the employees row whose employee_id is literally "1"?
 *
 * READ ONLY. Nothing here writes.
 *
 * Surfaced by zoho_all_codes.js: its code list sorted "1" ahead of every
 * real ANXT-prefixed code, meaning it would have been fed into
 * zoho_restage.js as if it were a real employee to restage.
 *
 *   node inspect_stray_employee_id.js
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
const pool = require('./db');

(async () => {
  const r = await pool.query(
    `SELECT id, employee_id, first_name, last_name, email, status, is_user,
            role, date_of_joining::text AS doj, exit_date::text AS exit_date,
            deleted_at, created_at::text AS created_at
       FROM employees WHERE employee_id = '1'`);
  console.log(`\n${r.rows.length} row(s) with employee_id = '1':\n`);
  console.log(JSON.stringify(r.rows, null, 2));

  // Also check for any OTHER employee_id that doesn't look like a real
  // ANXT-prefixed code, in case "1" isn't the only stray one.
  const bad = await pool.query(
    `SELECT id, employee_id, first_name, last_name, status, deleted_at
       FROM employees WHERE employee_id IS NOT NULL AND employee_id !~ '^ANXT'
       ORDER BY employee_id`);
  console.log(`\n${bad.rows.length} employee(s) with a non-ANXT employee_id:\n`);
  console.log(JSON.stringify(bad.rows, null, 2));

  await pool.end();
})().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
