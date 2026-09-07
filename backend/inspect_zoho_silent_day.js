#!/usr/bin/env node
/* For one employee/range, print every date this system judges them on,
 * whether Zoho's attendance report has ANY entry for that date at all (not
 * just present/absent -- literally present as a key), and the raw record
 * if so. Built to chase down the "here says absent, Zoho has nothing"
 * pattern inspect_org_reconcile.js keeps flagging, where the day isn't a
 * missing-punch case -- Zoho's response is simply silent on the date.
 *
 * READ ONLY. Nothing here writes.
 *
 *   node inspect_zoho_silent_day.js ANXT220017 2026-09-01 2026-09-07
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
const pool = require('./db');
const { zohoApi } = require('./utils/zoho');
const { loadHolidaysAndRules, listWorkingDays } = require('./routes/payroll');

const CODE = process.argv[2];
const START = process.argv[3];
const END = process.argv[4];
if (!CODE || !START || !END) {
  console.error('Usage: node inspect_zoho_silent_day.js <CODE> <START> <END>');
  process.exit(1);
}
const zohoDMY = iso => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;

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
    `SELECT id, employee_id AS code, first_name || ' ' || COALESCE(last_name,'') AS name,
            date_of_joining::text AS joined, exit_date::text AS exited
       FROM employees WHERE employee_id = $1`, [CODE])).rows[0];
  if (!emp) { console.log(`No employee with code ${CODE}.`); await pool.end(); return; }

  console.log(`\n=== ${emp.name.trim()} (${emp.code}), ${START} to ${END} ===\n`);

  const json = await zohoApi(
    `attendance/getUserReport?empId=${encodeURIComponent(CODE)}`
    + `&sdate=${encodeURIComponent(zohoDMY(START))}&edate=${encodeURIComponent(zohoDMY(END))}`
    + `&dateFormat=dd-MM-yyyy`);
  const zohoAtt = json?.response?.result ?? json?.response ?? json;

  const { holMap, rules } = await holidaysAndRulesFor(START, END);
  const working = listWorkingDays(new Date(START), new Date(END), holMap, rules, null);
  const workingDates = new Set(working.map(d => d.toLocaleDateString('en-CA')));

  const hereAtt = new Map((await pool.query(
    `SELECT date::text AS date, status, check_in IS NOT NULL AS "hasIn"
       FROM attendance WHERE employee_id = $1 AND date BETWEEN $2::date AND $3::date`,
    [emp.id, START, END])).rows.map(r => [r.date, r]));
  const hereLeave = (await pool.query(
    `SELECT leave_type, start_date::text AS s, end_date::text AS e, status
       FROM leaves WHERE employee_id = $1 AND start_date <= $3::date AND end_date >= $2::date`,
    [emp.id, START, END])).rows;

  let cursor = new Date(START);
  const end = new Date(END);
  while (cursor <= end) {
    const iso = cursor.toLocaleDateString('en-CA');
    const isWorking = workingDates.has(iso);
    const zRec = zohoAtt && typeof zohoAtt === 'object' ? zohoAtt[iso] : undefined;
    const here = hereAtt.get(iso);
    const leave = hereLeave.filter(l => l.s <= iso && l.e >= iso);

    console.log(`${iso}  ${isWorking ? 'working day (our calendar)' : 'NOT a working day (our calendar)'}`);
    console.log(`    Zoho record:  ${zRec ? JSON.stringify(zRec) : 'NO ENTRY AT ALL FOR THIS DATE'}`);
    console.log(`    here:         ${here ? `status=${here.status} hasIn=${here.hasIn}` : 'no attendance row'}`
      + `${leave.length ? `  leave: ${leave.map(l => `${l.leave_type}(${l.status})`).join(', ')}` : ''}`);
    console.log('');
    cursor.setDate(cursor.getDate() + 1);
  }

  await pool.end();
})().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
