#!/usr/bin/env node
/* Does an approved regularization actually show as Present?
 *
 * READ ONLY. Nothing here writes.
 *
 * Prints, for one employee and month, every regularization request
 * (whatever its status — the admin screen can be filtered to "Approved"
 * only, which hides a day that is pending or was rejected) beside the
 * actual attendance row for that same date, so "approved but still shows
 * Absent" can be checked against real data instead of read off a screenshot.
 *
 *   node inspect_regularization_gap.js ANXT2600148 2026-08
 */
require('dotenv').config();
const pool = require('./db');

const CODE = process.argv[2];
const MONTH = process.argv[3]; // 'YYYY-MM'
if (!CODE || !MONTH) {
  console.error('Usage: node inspect_regularization_gap.js <EMPLOYEE_CODE> <YYYY-MM>');
  process.exit(1);
}

(async () => {
  const emp = (await pool.query(
    `SELECT id, employee_id AS code, first_name || ' ' || COALESCE(last_name,'') AS name
       FROM employees WHERE employee_id = $1`, [CODE])).rows[0];
  if (!emp) { console.log(`No employee with code ${CODE}.`); await pool.end(); return; }

  const start = `${MONTH}-01`;
  const end = new Date(new Date(start).getFullYear(), new Date(start).getMonth() + 1, 0).toLocaleDateString('en-CA');

  console.log(`\n=== ${emp.name.trim()} (${emp.code}), ${MONTH} ===\n`);

  const regs = await pool.query(
    `SELECT date::text AS date, check_in::text AS "checkIn", check_out::text AS "checkOut",
            status, reason, created_at::text AS "requestedAt"
       FROM attendance_regularizations
      WHERE employee_id = $1 AND date BETWEEN $2::date AND $3::date
      ORDER BY date`, [emp.id, start, end]);

  console.log(`── Every regularization request this month, any status (${regs.rows.length}) ──\n`);
  for (const r of regs.rows) {
    console.log(`  ${r.date}   ${String(r.status).padEnd(10)} requested ${r.checkIn || '-'}..${r.checkOut || '-'}   "${r.reason || ''}"`);
  }
  if (!regs.rows.length) console.log('  none on file this month');

  const att = await pool.query(
    `SELECT date::text AS date, check_in::text AS "checkIn", check_out::text AS "checkOut",
            status, working_hours AS "workingHours"
       FROM attendance
      WHERE employee_id = $1 AND date BETWEEN $2::date AND $3::date
      ORDER BY date`, [emp.id, start, end]);
  const attByDate = new Map(att.rows.map(r => [r.date, r]));

  console.log(`\n── What the attendance row actually says for each regularized date ──\n`);
  for (const r of regs.rows) {
    const a = attByDate.get(r.date);
    if (!a) {
      console.log(`  ${r.date}   NO ATTENDANCE ROW AT ALL — regularization was ${r.status} but nothing was ever written`);
      continue;
    }
    console.log(`  ${r.date}   attendance: check_in=${a.checkIn || 'null'} check_out=${a.checkOut || 'null'}`
      + ` status=${a.status} hours=${a.workingHours ?? 'null'}   (regularization: ${r.status})`);
  }

  console.log(`\n── Every attendance row this month, for full context (${att.rows.length}) ──\n`);
  for (const a of att.rows) {
    console.log(`  ${a.date}   check_in=${a.checkIn ? 'y' : 'n'} check_out=${a.checkOut ? 'y' : 'n'}   status=${a.status}   hours=${a.workingHours ?? '-'}`);
  }

  await pool.end();
})().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
