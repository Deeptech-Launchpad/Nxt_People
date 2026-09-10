#!/usr/bin/env node
/* Dump Zoho's raw per-day attendance Status for one employee, one window.
 *
 * READ ONLY. Nothing here writes. Makes exactly ONE Zoho call.
 *
 * inspect_org_reconcile.js's LOP check counts a day toward zohoAbsentDays
 * whenever Zoho's Status text implies a whole-day absence, regardless of
 * whether Zoho also shows a punch for that day. inspect_lop_discrepancy.js
 * never prints that column at all -- it shows Zoho's LEAVE records, never
 * Zoho's raw attendance Status -- so a mismatch that lives entirely in that
 * field is invisible to both narrower checks that already ran clean.
 *
 *   node inspect_zoho_attendance_days.js ANXT2600157 2026-09-01 2026-09-09
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

const CODE = process.argv[2];
const START = process.argv[3];
const END = process.argv[4];

if (!CODE || !/^\d{4}-\d{2}-\d{2}$/.test(START || '') || !/^\d{4}-\d{2}-\d{2}$/.test(END || '')) {
  console.log('\n  usage: node inspect_zoho_attendance_days.js <CODE> <START> <END>\n');
  process.exit(1);
}

const zohoDMY = iso => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
const notDash = v => (v === '-' || v === '' || v === null || v === undefined) ? null : v;
const pad = (s, n) => String(s ?? '').padEnd(n);

(async () => {
  const emp = (await pool.query(
    `SELECT id, employee_id AS code, TRIM(first_name||' '||COALESCE(last_name,'')) AS name
       FROM employees WHERE employee_id = $1`, [CODE])).rows[0];
  if (!emp) { console.log(`  No employee ${CODE} here.\n`); await pool.end(); process.exit(1); }

  console.log(`\n  Zoho's raw per-day attendance for ${emp.name} (${CODE}), ${START} to ${END}\n`);

  const json = await zohoApi(
    `attendance/getUserReport?empId=${encodeURIComponent(CODE)}`
    + `&sdate=${encodeURIComponent(zohoDMY(START))}&edate=${encodeURIComponent(zohoDMY(END))}`
    + `&dateFormat=dd-MM-yyyy`);
  const zohoAtt = json?.response?.result ?? json?.response ?? json;

  if (!zohoAtt || typeof zohoAtt !== 'object' || 'error' in zohoAtt || 'errors' in zohoAtt) {
    console.log('  Zoho attendance not usable:', JSON.stringify(zohoAtt));
    await pool.end(); process.exit(1);
  }

  const hereRows = new Map((await pool.query(
    `SELECT date::text AS date, status, check_in IS NOT NULL AS "hasIn", check_out IS NOT NULL AS "hasOut"
       FROM attendance WHERE employee_id = $1 AND date BETWEEN $2::date AND $3::date`,
    [emp.id, START, END])).rows.map(r => [r.date, r]));

  const dates = Object.keys(zohoAtt).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k) && k >= START && k <= END).sort();
  for (const iso of dates) {
    const rec = zohoAtt[iso];
    const status = String(rec.Status ?? '').trim();
    const here = hereRows.get(iso);
    console.log(`  ${iso}  zoho: in=${pad(notDash(rec.FirstIn) || '-', 20)}out=${pad(notDash(rec.LastOut) || '-', 20)}status="${status}"`);
    console.log(`             here: ${here ? `status=${here.status} in=${here.hasIn} out=${here.hasOut}` : 'NO ROW'}`);
  }
  console.log('');
  await pool.end();
})().catch(async e => {
  console.error(e);
  try { await pool.end(); } catch {}
  process.exit(1);
});
