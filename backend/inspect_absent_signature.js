#!/usr/bin/env node
/* For a list of employee codes and a date range, print every local
 * attendance row marked status='absent' along with whether it has a
 * check-in and a check-out. Built to test one specific hypothesis: that
 * the "here says absent, Zoho has no matching entry" LOP pattern
 * inspect_org_reconcile.js keeps flagging is actually forgot-to-check-out
 * days (check-in recorded, check-out never happened, never regularized) --
 * a genuine local gap, not a Zoho data-transfer problem.
 *
 * READ ONLY. Nothing here writes.
 *
 *   node inspect_absent_signature.js ANXT220017,ANXT220025 2026-09-01 2026-09-07
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
const pool = require('./db');

const CODES = String(process.argv[2] || '').split(/[,\s]+/).filter(Boolean);
const START = process.argv[3];
const END = process.argv[4];
if (!CODES.length || !START || !END) {
  console.error('Usage: node inspect_absent_signature.js <CODE[,CODE...]> <START> <END>');
  process.exit(1);
}

(async () => {
  const r = await pool.query(
    `SELECT e.employee_id AS code, TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS name,
            a.date::text AS date, a.status,
            a.check_in IS NOT NULL AS "hasIn", a.check_out IS NOT NULL AS "hasOut"
       FROM attendance a JOIN employees e ON e.id = a.employee_id
      WHERE e.employee_id = ANY($1) AND a.date BETWEEN $2::date AND $3::date AND a.status = 'absent'
      ORDER BY e.employee_id, a.date`,
    [CODES, START, END]);

  console.log(`\n=== ${r.rows.length} local 'absent' row(s) for ${CODES.length} employee(s), ${START} to ${END} ===\n`);
  for (const row of r.rows) {
    console.log(`  ${row.code.padEnd(14)}${row.name.padEnd(26)}${row.date}   hasIn=${row.hasIn} hasOut=${row.hasOut}`
      + `${row.hasIn && !row.hasOut ? '   <- checked in, never checked out' : ''}`
      + `${!row.hasIn ? '   <- no punch at all, plain absence' : ''}`);
  }
  if (!r.rows.length) console.log('  none.');

  const forgotCheckout = r.rows.filter(row => row.hasIn && !row.hasOut).length;
  const noPunch = r.rows.filter(row => !row.hasIn).length;
  console.log(`\n  ${forgotCheckout} forgot-to-check-out, ${noPunch} plain no-punch absence, `
    + `${r.rows.length - forgotCheckout - noPunch} other.\n`);

  await pool.end();
})().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
