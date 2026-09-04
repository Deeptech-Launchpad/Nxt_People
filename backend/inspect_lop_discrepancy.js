#!/usr/bin/env node
/* Why does our LOP figure disagree with Zoho's for one person, one period?
 *
 * READ ONLY. Nothing here writes.
 *
 * Zoho's Loss of Pay report combines two different facts into one "Booked"
 * column: approved unpaid leave, and unmarked absence. This system keeps
 * them as two separate figures (lopDaysForRange, absentDaysForRange) on
 * purpose — see the comments in routes/payroll.js — but the LossOfPay page
 * shows the combined total under a header borrowed from Zoho's wording,
 * which can make the two numbers look like they should always match and
 * hide which of the two moved when they don't.
 *
 * This calls the exact same functions the report calls, but also prints
 * every underlying row — every leave application, every attendance row,
 * every on-duty request — so a 0.5-day gap can be pointed at an actual
 * date instead of argued about in the abstract. It also pulls the
 * employee's real leave records from Zoho for the same window, the same
 * technique zoho_trace_casual_balance.js already uses.
 *
 *   node inspect_lop_discrepancy.js ANXT220038 2026-08-01 2026-08-31
 */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('this script does not send mail'); },
  verify: async () => { throw new Error('this script does not send mail'); },
});

const pool = require('./db');
const { lopDaysForRange, absentDaysForRange, listWorkingDays, loadHolidaysAndRules } = require('./routes/payroll');
const { unregularizedDaysForRange } = require('./utils/unregularizedAbsence');
const { zohoApi } = require('./utils/zoho');

const CODE = process.argv[2];
const START = process.argv[3];
const END = process.argv[4];
if (!CODE || !START || !END) {
  console.error('Usage: node inspect_lop_discrepancy.js <EMPLOYEE_CODE> <START> <END>');
  process.exit(1);
}

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

const fromZohoDate = (s) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(s || ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const leaveEnvelope = (json) => {
  const resp = json?.response;
  if (!resp || typeof resp !== 'object' || Array.isArray(resp)) return 'no response object';
  if ('result' in resp) return null;
  if ('errors' in resp || 'error' in resp || 'message' in resp) {
    return String(resp.message || JSON.stringify(resp.error || resp.errors || {})).slice(0, 80);
  }
  return 'no result and no error';
};
async function zohoLeaveRecords(code) {
  const search = encodeURIComponent(JSON.stringify({
    searchField: 'Employee_ID', searchOperator: 'Contains', searchText: code,
  }));
  const out = [];
  for (let i = 1; i <= 2000; i += 200) {
    const json = await zohoApi(`forms/leave/getRecords?sIndex=${i}&limit=200&searchParams=${search}`);
    if (leaveEnvelope(json)) break;
    const rows = json?.response?.result || [];
    if (!Array.isArray(rows) || !rows.length) break;
    for (const w of rows) { const rec = Object.values(w)[0]?.[0]; if (rec) out.push(rec); }
    if (rows.length < 200) break;
  }
  return out;
}

(async () => {
  const emp = (await pool.query(
    `SELECT id, employee_id AS code, first_name || ' ' || COALESCE(last_name,'') AS name
       FROM employees WHERE employee_id = $1`, [CODE])).rows[0];
  if (!emp) { console.log(`No employee with code ${CODE}.`); await pool.end(); return; }

  console.log(`\n=== LOP breakdown for ${emp.name.trim()} (${emp.code}), ${START} to ${END} ===\n`);

  const { holMap, rules } = await holidaysAndRulesFor(START, END);

  const lop = await lopDaysForRange(emp.id, new Date(START), new Date(END), holMap, rules, pool);
  const absent = await absentDaysForRange(emp.id, new Date(START), new Date(END), holMap, rules, pool);
  const unreg = await unregularizedDaysForRange(emp.id, new Date(START), new Date(END));

  console.log(`  lopDaysForRange()          ${lop}   (approved 'unpaid' leave only)`);
  console.log(`  absentDaysForRange()       ${absent}   (unmarked absence, no leave, no on-duty)`);
  console.log(`  unregularizedDaysForRange()${String(unreg).padStart(4)}   (subset of absent, window closed)`);
  console.log(`  lopDays + absentDays       ${Math.round((lop + absent) * 100) / 100}   (what "Total unpayable" shows)\n`);

  console.log('── Every leave row overlapping this range, this system ──────\n');
  const leaves = await pool.query(
    `SELECT leave_type, start_date::text AS s, end_date::text AS e, total_days, is_half_day, half_day_type, status
       FROM leaves WHERE employee_id = $1 AND start_date <= $3::date AND end_date >= $2::date
       ORDER BY start_date`, [emp.id, START, END]);
  for (const r of leaves.rows) {
    console.log(`    ${r.s}${r.e !== r.s ? ' to ' + r.e : ''}   ${r.leave_type.padEnd(10)}`
      + `${String(r.total_days).padStart(5)}d   ${r.is_half_day ? `half (${r.half_day_type})` : 'full'}   ${r.status}`);
  }
  if (!leaves.rows.length) console.log('    none');

  console.log('\n── Every attendance row in this range, this system ───────────\n');
  const att = await pool.query(
    `SELECT date::text AS d, check_in IS NOT NULL AS "hasIn", check_out IS NOT NULL AS "hasOut", status
       FROM attendance WHERE employee_id = $1 AND date BETWEEN $2::date AND $3::date
       ORDER BY date`, [emp.id, START, END]);
  for (const r of att.rows) {
    console.log(`    ${r.d}   in=${r.hasIn ? 'y' : 'n'} out=${r.hasOut ? 'y' : 'n'}   status=${r.status || '-'}`);
  }
  if (!att.rows.length) console.log('    none');

  console.log('\n── Every on-duty request overlapping this range ──────────────\n');
  const od = await pool.query(
    `SELECT start_date::text AS s, end_date::text AS e, status FROM on_duty_requests
      WHERE employee_id = $1 AND start_date <= $3::date AND end_date >= $2::date`,
    [emp.id, START, END]).catch(() => ({ rows: [] }));
  for (const r of od.rows) console.log(`    ${r.s} to ${r.e}   ${r.status}`);
  if (!od.rows.length) console.log('    none');

  console.log('\n── Working days in this range this person is judged on ───────\n');
  const working = listWorkingDays(new Date(START), new Date(END), holMap, rules, null);
  console.log(`    ${working.length} working day(s): ${working.map(d => d.toLocaleDateString('en-CA')).join(', ')}`);

  console.log('\n── Zoho\'s real leave records for this code, same window ──────\n');
  const zRecords = await zohoLeaveRecords(CODE);
  const inRange = zRecords
    .map(r => ({ type: r.Leavetype, from: fromZohoDate(r.From), to: fromZohoDate(r.To) || fromZohoDate(r.From),
      days: r.Daystaken, status: String(r.ApprovalStatus || '').toLowerCase() }))
    .filter(r => r.from && r.from <= END && r.to >= START)
    .sort((a, b) => a.from.localeCompare(b.from));
  for (const r of inRange) {
    console.log(`    ${r.from}${r.to !== r.from ? ' to ' + r.to : ''}   ${String(r.type).padEnd(20)}${r.days}d   ${r.status}`);
  }
  if (!inRange.length) console.log('    none');

  await pool.end();
})().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
