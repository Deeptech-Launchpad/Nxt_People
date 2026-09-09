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

    // Which role row do this person's permissions actually come from?
    const roles = (await pool.query(
      `SELECT id, name, code FROM roles WHERE LOWER(code) = LOWER($1) OR LOWER(name) = LOWER($1)`,
      [emp.role])).rows;

    if (!roles.length) {
      console.log(`\n  2. role row for '${emp.role}'       NOT FOUND in roles table`);
      console.log(`     Function permissions are stored per role_id, so with no row there is`);
      console.log(`     nothing for can() to read and it falls back to the catalog default.`);
    }

    for (const role of roles) {
      const rf = (await pool.query(
        `SELECT allowed, options FROM role_functions WHERE role_id = $1 AND function_key = 'announcements'`,
        [role.id])).rows[0];

      console.log(`\n  role row      ${role.name} (code ${role.code}, id ${role.id})`);
      if (!rf) {
        console.log(`  2. can('announcements')          NO ROW in role_functions`);
        console.log(`  3. options.manage                NO ROW`);
        console.log(`\n     Nothing has been saved for this role. The tick on the settings`);
        console.log(`     screen was written against a DIFFERENT role.`);
      } else {
        const manage = rf.options && rf.options.manage;
        console.log(`  2. can('announcements')          ${rf.allowed ? 'PASS' : 'FAIL'}   (allowed = ${rf.allowed})`);
        console.log(`  3. options.manage                ${manage ? 'PASS' : 'FAIL'}   (options = ${JSON.stringify(rf.options)})`);
      }
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
