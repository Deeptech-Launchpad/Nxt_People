#!/usr/bin/env node
/* Two questions payroll turns on, both answered from our own data.
 *
 * READ ONLY. Nothing here writes.
 *
 * 1. DAYS THE TWO HALVES OF THIS SYSTEM DISAGREE ABOUT.
 *    The attendance engine classifies a day and writes it to
 *    attendance.status. absentDaysForRange — what LOP and the payslip
 *    actually count — never reads that column. It treats a day as attended
 *    whenever BOTH punches exist:
 *
 *      AND ((check_in IS NOT NULL AND check_out IS NOT NULL) OR status = 'on_duty')
 *
 *    So a row the engine marked 'absent' because it was far too short —
 *    seen live: in 16:32, out 18:01, an hour and a half — is still counted
 *    as a full attended day by payroll, and nothing is deducted. Zoho calls
 *    that same day Absent. This lists every such day.
 *
 * 2. HOLIDAYS ZOHO OBSERVES THAT THIS SYSTEM DOES NOT.
 *    A holiday missing from the holidays table here is a working day here,
 *    so everybody who correctly did not come in reads as absent on it.
 *
 *   node inspect_absent_but_paid.js 2026-01-01 2026-09-07
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
const pool = require('./db');

const START = process.argv[2] || '2026-01-01';
const END = process.argv[3] || new Date().toLocaleDateString('en-CA');

// Every holiday Zoho showed in the status vocabulary scan, with the date it
// fell on. Named here rather than re-fetched: this is a comparison against
// what Zoho actually reported, not a fresh opinion about the calendar.
const ZOHO_HOLIDAYS = [
  ['2026-01-01', 'Happy New Year 2026'],
  ['2026-01-15', 'Pongal Thirunal 2026'],
  ['2026-01-16', 'Thiruvalluvar Day 2026'],
  ['2026-01-17', 'Uzhavar Thirunal 2026'],
  ['2026-01-26', 'Republic Day 2026'],
  ['2026-04-13', 'Pre-Tamil New Year 2026'],
  ['2026-04-14', 'Tamil New Year 2026'],
  ['2026-04-23', 'Tamilnadu Election Day 2026'],
  ['2026-05-01', 'May (Labour) Day 2026'],
  ['2026-08-03', 'Aadi Perukku 2026'],
  ['2026-08-15', 'India Independence Day 2026'],
];

(async () => {
  console.log(`\n=== Absent rows that payroll still counts as attended, ${START} to ${END} ===\n`);

  const rows = (await pool.query(
    `SELECT e.employee_id AS code, TRIM(CONCAT(e.first_name,' ',e.last_name)) AS name,
            a.date::text AS date, a.working_hours AS hours,
            a.check_in::text AS "checkIn", a.check_out::text AS "checkOut"
       FROM attendance a JOIN employees e ON e.id = a.employee_id
      WHERE a.date BETWEEN $1::date AND $2::date
        AND a.status = 'absent'
        AND a.check_in IS NOT NULL AND a.check_out IS NOT NULL
      ORDER BY e.employee_id, a.date`,
    [START, END])).rows;

  console.log(`  ${rows.length} day(s) marked absent on the attendance row, yet counted as a full`);
  console.log(`  attended day by lopDaysForRange/absentDaysForRange — so no deduction.\n`);
  for (const r of rows) {
    console.log(`  ${r.code.padEnd(14)}${r.name.slice(0, 24).padEnd(26)}${r.date}  ${String(r.hours ?? '-').padStart(6)}h`
      + `   in=${(r.checkIn || '').slice(11, 16)} out=${(r.checkOut || '').slice(11, 16)}`);
  }
  if (!rows.length) console.log('  none.');

  const byEmp = new Map();
  for (const r of rows) byEmp.set(r.code, (byEmp.get(r.code) || 0) + 1);
  if (byEmp.size) {
    console.log(`\n  across ${byEmp.size} employee(s):`);
    for (const [code, n] of [...byEmp].sort((a, b) => b[1] - a[1])) console.log(`     ${code.padEnd(14)}${n} day(s)`);
  }

  console.log(`\n\n=== Holidays Zoho observes vs this system's holidays table ===\n`);
  for (const [date, name] of ZOHO_HOLIDAYS) {
    if (date < START || date > END) continue;
    const here = (await pool.query(
      `SELECT name, date::text AS date FROM holidays WHERE date = $1::date`, [date])).rows;
    console.log(`  ${date}  ${name.padEnd(30)}${here.length ? `here: "${here[0].name}"` : 'NOT IN holidays TABLE HERE'}`);
  }

  await pool.end();
})().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
