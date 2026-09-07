#!/usr/bin/env node
/* Which exact days does this system count as absence and Zoho does not, or
 * the other way round?
 *
 * READ ONLY. Nothing here writes.
 *
 * inspect_org_reconcile.js reports a per-employee LOP total, and a total is
 * useless for finding out WHY: three rounds of reasoning about that number
 * produced two real fixes and one that changed nothing. This prints the
 * days themselves.
 *
 * The local verdict is not reimplemented here — absentDaysForRange is called
 * for one single day at a time, so what this prints is exactly what the
 * report counts, not a second opinion that could drift from it.
 *
 *   node inspect_lop_day_diff.js ANXT2400134 2026-01-01 2026-09-07
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('this script does not send mail'); },
  verify: async () => { throw new Error('this script does not send mail'); },
});

const pool = require('./db');
const { zohoApi } = require('./utils/zoho');
const { absentDaysForRange, loadHolidaysAndRules, listWorkingDays } = require('./routes/payroll');

const CODE = process.argv[2];
const START = process.argv[3];
const END = process.argv[4];
if (!CODE || !/^\d{4}-\d{2}-\d{2}$/.test(START || '') || !/^\d{4}-\d{2}-\d{2}$/.test(END || '')) {
  console.log('\n  usage: node inspect_lop_day_diff.js <CODE> <START> <END>\n');
  process.exit(1);
}

const zohoDMY = iso => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
const absentFraction = (status) => {
  const tail = String(status ?? '').split(',').pop().trim();
  const m = /^(?:([\d.]+)\s*day\s+)?absent$/i.exec(tail);
  if (!m) return 0;
  return m[1] ? parseFloat(m[1]) : 1;
};

async function holidaysAndRulesFor(startDate, endDate) {
  const start = new Date(startDate), end = new Date(endDate);
  const holMap = new Map();
  let rules = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor <= end) {
    const monthData = await loadHolidaysAndRules(cursor.getMonth() + 1, cursor.getFullYear());
    monthData.holMap.forEach((v, k) => holMap.set(k, v));
    rules = monthData.rules;
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return { holMap, rules };
}

(async () => {
  const emp = (await pool.query(
    `SELECT id, employee_id AS code, TRIM(CONCAT(first_name,' ',last_name)) AS name,
            date_of_joining::text AS joined, exit_date::text AS exited
       FROM employees WHERE employee_id = $1`, [CODE])).rows[0];
  if (!emp) { console.log(`No employee ${CODE}`); await pool.end(); return; }

  const rangeStart = emp.joined && emp.joined > START ? emp.joined : START;
  const rangeEnd = emp.exited && emp.exited < END ? emp.exited : END;

  console.log(`\n=== ${emp.name} (${emp.code}), judged ${rangeStart} to ${rangeEnd} ===\n`);

  const json = await zohoApi(
    `attendance/getUserReport?empId=${encodeURIComponent(CODE)}`
    + `&sdate=${encodeURIComponent(zohoDMY(rangeStart))}&edate=${encodeURIComponent(zohoDMY(rangeEnd))}`
    + `&dateFormat=dd-MM-yyyy`);
  const zohoAtt = json?.response?.result ?? json?.response ?? json;

  const { holMap, rules } = await holidaysAndRulesFor(rangeStart, rangeEnd);
  const workingDates = listWorkingDays(new Date(rangeStart), new Date(rangeEnd), holMap, rules, null)
    .map(d => d.toLocaleDateString('en-CA'));

  const att = new Map((await pool.query(
    `SELECT date::text AS date, status, check_in IS NOT NULL AS "hasIn", check_out IS NOT NULL AS "hasOut"
       FROM attendance WHERE employee_id = $1 AND date BETWEEN $2::date AND $3::date`,
    [emp.id, rangeStart, rangeEnd])).rows.map(r => [r.date, r]));

  const diffs = [];
  let hereTotal = 0, zohoTotal = 0;

  for (const iso of workingDates) {
    // One day at a time, through the real function, so this cannot drift
    // from what the report actually counts.
    const here = await absentDaysForRange(emp.id, new Date(iso), new Date(iso), holMap, rules, pool);
    const rec = zohoAtt && typeof zohoAtt === 'object' ? zohoAtt[iso] : undefined;
    const zoho = rec ? (absentFraction(rec.Status) >= 1 ? 1 : 0) : 0;
    hereTotal += here;
    zohoTotal += zoho;
    if (here !== zoho) {
      diffs.push({ iso, here, zoho, status: rec ? String(rec.Status ?? '').trim() : '(NO ZOHO ENTRY)',
        firstIn: rec ? rec.FirstIn : '-', lastOut: rec ? rec.LastOut : '-', row: att.get(iso) });
    }
  }

  console.log(`  here counts ${hereTotal} absent day(s), Zoho counts ${zohoTotal} — ${diffs.length} day(s) disagree\n`);
  for (const d of diffs) {
    console.log(`  ${d.iso}   here=${d.here}  zoho=${d.zoho}`);
    console.log(`      Zoho: "${d.status}"   in=${d.firstIn || '-'}  out=${d.lastOut || '-'}`);
    console.log(`      here: ${d.row ? `status=${d.row.status} hasIn=${d.row.hasIn} hasOut=${d.row.hasOut}` : 'NO ATTENDANCE ROW'}\n`);
  }
  if (!diffs.length) console.log('  none — every working day agrees.\n');

  await pool.end();
})().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
