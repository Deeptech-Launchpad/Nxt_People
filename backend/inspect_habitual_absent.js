#!/usr/bin/env node
/* For one employee, print a sample of their attendance rows in full --
 * check_in, check_out, status, work_mode, hours, created_at -- plus their
 * shift, department and designation. Built to find the real cause behind
 * an employee who has an attendance row for nearly every working day but
 * almost all of them read 'absent', which is a different shape of problem
 * than a one-off forgot-checkout.
 *
 * READ ONLY. Nothing here writes.
 *
 *   node inspect_habitual_absent.js ANXT2400136
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
const pool = require('./db');

const CODE = process.argv[2];
if (!CODE) { console.error('Usage: node inspect_habitual_absent.js <CODE>'); process.exit(1); }

(async () => {
  const emp = (await pool.query(
    `SELECT e.id, e.employee_id AS code, TRIM(CONCAT(e.first_name,' ',e.last_name)) AS name,
            e.shift_id, sh.name AS "shiftName", e.department_id, d.name AS "deptName",
            e.designation_id, dg.name AS "desigName", e.date_of_joining::text AS joined
       FROM employees e
       LEFT JOIN shifts sh ON sh.id = e.shift_id
       LEFT JOIN departments d ON d.id = e.department_id
       LEFT JOIN designations dg ON dg.id = e.designation_id
      WHERE e.employee_id = $1`, [CODE])).rows[0];
  if (!emp) { console.log(`No employee ${CODE}`); await pool.end(); return; }

  console.log(`\n=== ${emp.name} (${emp.code}), joined ${emp.joined} ===`);
  console.log(`    shift: ${emp.shiftName || 'none'} (id=${emp.shift_id})   dept: ${emp.deptName || 'none'}   designation: ${emp.desigName || 'none'}\n`);

  const rows = (await pool.query(
    `SELECT date::text AS date, check_in::text AS "checkIn", check_out::text AS "checkOut",
            status, working_hours AS hours, work_mode AS "workMode", created_at::text AS "createdAt"
       FROM attendance WHERE employee_id = $1 ORDER BY date LIMIT 15`, [emp.id])).rows;

  console.log('First 15 rows on file:\n');
  for (const r of rows) {
    console.log(`  ${r.date}  status=${(r.status || '-').padEnd(8)} in=${r.checkIn || 'null'}  out=${r.checkOut || 'null'}  `
      + `hours=${r.hours ?? '-'}  work_mode=${r.workMode || 'null'}  created=${r.createdAt}`);
  }

  const byStatus = (await pool.query(
    `SELECT status, COUNT(*)::int n, COUNT(check_in)::int "hasIn", COUNT(check_out)::int "hasOut"
       FROM attendance WHERE employee_id = $1 GROUP BY status ORDER BY n DESC`, [emp.id])).rows;
  console.log('\nBy status, whole history:\n');
  for (const s of byStatus) console.log(`  ${(s.status || '-').padEnd(10)} ${s.n} row(s), ${s.hasIn} with check-in, ${s.hasOut} with check-out`);

  await pool.end();
})().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
