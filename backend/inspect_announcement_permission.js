#!/usr/bin/env node
/* Why is the New Announcement button not showing for somebody who should see it?
 *
 * READ ONLY. Nothing here writes.
 *
 * The button is gated on three things at once (frontend Announcements.jsx:34):
 *
 *   isFullAccess(user)                  role is admin, director or hr_admin
 *   can('announcements')                role_functions.allowed for this role
 *   optionOf('announcements').manage    role_functions.options->>'manage'
 *
 * All three must pass, and the API enforces the same pair, so the button
 * missing means one of them is false for THIS user's role. Ticking the box in
 * Settings writes against whichever role was selected on that screen — which
 * is not necessarily the role the person actually holds. That mismatch is the
 * usual cause, and it is invisible from the UI.
 *
 *   node inspect_announcement_permission.js ANXT2600149
 *   node inspect_announcement_permission.js Balaji
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
const pool = require('./db');

const QUERY = process.argv[2];
if (!QUERY) {
  console.error('\n  usage: node inspect_announcement_permission.js <employee code or name>\n');
  process.exit(1);
}

const FULL_ACCESS = ['admin', 'director', 'hr_admin'];

(async () => {
  const emps = (await pool.query(
    `SELECT id, employee_id AS code, TRIM(CONCAT(first_name,' ',last_name)) AS name,
            role, status, is_user
       FROM employees
      WHERE employee_id ILIKE $1 OR first_name ILIKE $1 OR last_name ILIKE $1
         OR TRIM(CONCAT(first_name,' ',last_name)) ILIKE $1`,
    [`%${QUERY}%`])).rows;

  if (!emps.length) { console.log(`\n  Nobody matches "${QUERY}".\n`); await pool.end(); return; }

  for (const emp of emps) {
    console.log(`\n══════════════════════════════════════════════════════════`);
    console.log(`  ${emp.name}  (${emp.code})`);
    console.log(`══════════════════════════════════════════════════════════\n`);
    console.log(`  role         ${emp.role}`);
    console.log(`  status       ${emp.status}`);
    console.log(`  is_user      ${emp.is_user}`);

    const passesRole = FULL_ACCESS.includes(String(emp.role));
    console.log(`\n  1. isFullAccess(user)            ${passesRole ? 'PASS' : 'FAIL'}`
      + `${passesRole ? '' : `  <- role '${emp.role}' is not admin/director/hr_admin`}`);

    /* Exactly the query utils/functionAccess.js runs. Both conditions matter:
     * the role row is matched on `key`, and it must be kind = 'general'. A
     * permission saved against a SPECIFIC role is invisible to enforcement,
     * however correct it looks on the settings screen. */
    const rows = (await pool.query(
      `SELECT rf.allowed, rf.options, r.id AS role_id, r.name, r.kind
         FROM role_functions rf
         JOIN roles r ON r.id = rf.role_id
        WHERE r.key = $1 AND r.kind = 'general' AND rf.function_key = 'announcements'`,
      [emp.role])).rows;

    if (!rows.length) {
      console.log(`\n  2. can('announcements')          NO ROW`);
      console.log(`  3. options.manage                NO ROW`);
      console.log(`\n     No general role with key '${emp.role}' has an announcements row, so`);
      console.log(`     can() falls back to the catalogue default — allowed=true, manage=true.`);
      console.log(`     On that basis the button SHOULD be showing.`);
    }

    for (const r of rows) {
      const manage = r.options && r.options.manage;
      console.log(`\n  role row      ${r.name} (key ${emp.role}, kind ${r.kind})`);
      console.log(`  2. can('announcements')          ${r.allowed ? 'PASS' : 'FAIL'}   (allowed = ${r.allowed})`);
      console.log(`  3. options.manage                ${manage ? 'PASS' : 'FAIL'}   (options = ${JSON.stringify(r.options)})`);
    }
  }

  // Every role that DOES have it, so the mismatch is obvious at a glance.
  console.log(`\n──────────────────────────────────────────────────────────`);
  console.log(`  Which roles currently have Announcements manage enabled`);
  console.log(`──────────────────────────────────────────────────────────\n`);
  const all = (await pool.query(
    `SELECT r.name, r.key, r.kind, rf.allowed, rf.options
       FROM role_functions rf JOIN roles r ON r.id = rf.role_id
      WHERE rf.function_key = 'announcements'
      ORDER BY r.kind, r.name`)).rows;
  if (!all.length) console.log('  none — no role has an announcements row at all.');
  for (const r of all) {
    const manage = r.options && r.options.manage;
    console.log(`  ${String(r.name).padEnd(22)} key=${String(r.key).padEnd(14)} kind=${String(r.kind).padEnd(9)}`
      + ` allowed=${r.allowed}  manage=${!!manage}`);
  }

  // Every general role, so a key mismatch against employees.role is visible.
  console.log(`
  General roles that exist (employees.role must match one of these keys):
`);
  const generals = (await pool.query(
    `SELECT key, name, rank FROM roles WHERE kind = 'general' ORDER BY rank`)).rows;
  for (const g of generals) console.log(`  ${String(g.key).padEnd(16)} ${g.name}  (rank ${g.rank})`);
  console.log('');

  await pool.end();
})().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
