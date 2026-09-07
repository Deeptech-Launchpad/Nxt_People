#!/usr/bin/env node
/* For a list of employee codes, how much local attendance history actually
 * exists, and since when? Built to test one hypothesis: that the huge LOP
 * numbers inspect_org_reconcile.js showed for a full-year range (98, 156,
 * 181, 187+ days) are because these employees simply have little or no
 * local attendance data for most of the year -- not hundreds of individual
 * forgot-checkout incidents.
 *
 * READ ONLY. Nothing here writes.
 *
 *   node inspect_attendance_coverage.js ANXT2600163,ANXT2400136,ANXT2400137
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
const pool = require('./db');

const CODES = String(process.argv[2] || '').split(/[,\s]+/).filter(Boolean);
if (!CODES.length) {
  console.error('Usage: node inspect_attendance_coverage.js <CODE[,CODE...]>');
  process.exit(1);
}

(async () => {
  const r = await pool.query(
    `SELECT e.employee_id AS code, TRIM(CONCAT(e.first_name,' ',e.last_name)) AS name,
            e.date_of_joining::text AS joined, e.exit_date::text AS exited, e.status,
            COUNT(a.id)::int AS "attRows",
            MIN(a.date)::text AS "firstAtt", MAX(a.date)::text AS "lastAtt",
            COUNT(a.id) FILTER (WHERE a.status = 'absent')::int AS "absentRows"
       FROM employees e LEFT JOIN attendance a ON a.employee_id = e.id AND a.date >= '2026-01-01'
      WHERE e.employee_id = ANY($1)
      GROUP BY e.id ORDER BY e.employee_id`, [CODES]);

  console.log(`\n=== Local attendance coverage since 2026-01-01, ${CODES.length} employee(s) ===\n`);
  for (const row of r.rows) {
    console.log(`  ${row.code.padEnd(14)}${row.name.padEnd(26)}joined ${row.joined || '?'}  status=${row.status}`);
    console.log(`      ${row.attRows} row(s) total, ${row.firstAtt || 'none'} to ${row.lastAtt || 'none'}, ${row.absentRows} marked absent\n`);
  }
  await pool.end();
})().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
