#!/usr/bin/env node
/* Does everyone Zoho shows as punched in also have a row here — and does
 * everyone this system marks Absent actually deserve it, or did Zoho see a
 * real check-in that never made it in?
 *
 * READ ONLY. Nothing here writes. Companion to inspect_leave_gap_scan.js —
 * that one covers leave (including permission, which Zoho files as a leave
 * type); this one covers the other half, real attendance punches.
 *
 * For each employee, walks every day in range they were on the rolls for
 * (on/after joining, on/before exit) and asks two questions of Zoho's own
 * per-employee report:
 *
 *   Zoho shows a real punch (FirstIn), but this system has no attendance
 *   row at all for that date  ->  MISSING HERE. This is exactly what shows
 *   up as a false Absent in reports here.
 *
 *   This system has NO row and Zoho's own status also reads Absent  ->
 *   agreement, not a gap, not printed.
 *
 * Zoho's attendance API is one call per employee (attendance/getUserReport),
 * not a bulk sweep like leave's forms API, so this makes one call per
 * employee in range and can take a while against ~150 people. --skip-holds
 * respects the same "patiently retry on 429/502/503" pattern zoho_restage.js
 * already uses.
 *
 *   node inspect_attendance_gap_scan.js 2026-08-26 2026-09-07
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

const START = process.argv[2];
const END = process.argv[3];
if (!/^\d{4}-\d{2}-\d{2}$/.test(START || '') || !/^\d{4}-\d{2}-\d{2}$/.test(END || '')) {
  console.error('\n  usage: node inspect_attendance_gap_scan.js <START YYYY-MM-DD> <END YYYY-MM-DD>\n');
  process.exit(1);
}

const zohoDMY = iso => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
const notDash = v => (v === '-' || v === '' || v === null || v === undefined) ? null : v;
const p2 = n => String(n).padStart(2, '0');

// Same parse zoho_restage.js uses for a Zoho timestamp -- just enough here to
// know WHETHER a punch exists, not to reconstruct the exact clock time.
const hasRealTimestamp = (s) => {
  const v = notDash(s);
  return !!v && /^\d{2}\/\d{2}\/\d{4}\s+\d{1,2}:\d{2}\s*(AM|PM)?$/i.test(String(v).trim());
};

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function patiently(fn) {
  let last;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try { return await fn(); }
    catch (err) {
      last = err;
      const code = (String(err.message).match(/\((\d{3})\)/) || [])[1];
      if (code !== '429' && code !== '503' && code !== '502') throw err;
      await sleep(attempt * 5000);
    }
  }
  throw last;
}

async function zohoAttendanceWindow(code, start, end) {
  const json = await patiently(() => zohoApi(
    `attendance/getUserReport?empId=${encodeURIComponent(code)}`
    + `&sdate=${encodeURIComponent(zohoDMY(start))}&edate=${encodeURIComponent(zohoDMY(end))}`
    + `&dateFormat=dd-MM-yyyy`));
  return json?.response?.result ?? json?.response ?? json;
}

(async () => {
  console.log(`\n=== Attendance gap scan — Zoho vs this system, ${START} to ${END} ===\n`);

  const emps = (await pool.query(
    `SELECT id, employee_id AS code, first_name || ' ' || COALESCE(last_name,'') AS name,
            date_of_joining::text AS joined, exit_date::text AS exited
       FROM employees WHERE employee_id ~ '^ANXT' ORDER BY employee_id`)).rows;

  console.log(`Checking ${emps.length} employee(s) — one Zoho call each, this takes a while...\n`);

  const missing = []; // { code, name, date, zohoStatus, checkIn, checkOut }
  let checked = 0, failed = 0;

  for (const emp of emps) {
    checked++;
    let attendance;
    try {
      attendance = await zohoAttendanceWindow(emp.code, START, END);
    } catch (err) {
      failed++;
      console.log(`  ${emp.code} ${emp.name.trim()}: could not read Zoho attendance — ${String(err.message).slice(0, 100)}`);
      continue;
    }
    if (!attendance || typeof attendance !== 'object' || 'error' in attendance || 'errors' in attendance) {
      failed++;
      continue;
    }

    const hereRows = (await pool.query(
      `SELECT date::text AS date FROM attendance WHERE employee_id = $1 AND date BETWEEN $2::date AND $3::date`,
      [emp.id, START, END])).rows;
    const hereDates = new Set(hereRows.map(r => r.date));

    for (const [iso, rec] of Object.entries(attendance)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;
      if (iso < START || iso > END) continue;
      if (emp.joined && iso < emp.joined) continue;
      if (emp.exited && iso > emp.exited) continue;

      const hasPunch = hasRealTimestamp(rec.FirstIn);
      if (!hasPunch) continue; // Zoho itself has no real punch here -- nothing to compare
      if (hereDates.has(iso)) continue; // already have a row -- not a gap

      missing.push({
        code: emp.code, name: emp.name.trim(), date: iso,
        zohoStatus: String(rec.Status ?? '').trim(),
        checkIn: notDash(rec.FirstIn), checkOut: notDash(rec.LastOut),
      });
    }
    if (checked % 20 === 0) console.log(`  ...${checked}/${emps.length} checked`);
  }

  console.log(`\n${checked} checked, ${failed} could not be read from Zoho.\n`);
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  ${missing.length} day(s) where Zoho shows a real punch and this`);
  console.log(`  system has NO attendance row at all — these show as Absent`);
  console.log(`  here today, and are the false-absence gap.`);
  console.log('══════════════════════════════════════════════════════════\n');

  const byEmployee = new Map();
  for (const m of missing) {
    if (!byEmployee.has(m.code)) byEmployee.set(m.code, []);
    byEmployee.get(m.code).push(m);
  }
  for (const [code, days] of byEmployee) {
    console.log(`  ${code}  ${days[0].name}  (${days.length} day(s))`);
    for (const d of days) {
      console.log(`      ${d.date}   Zoho: ${d.checkIn || '-'} -> ${d.checkOut || '-'}   status="${d.zohoStatus}"`);
    }
  }
  if (!missing.length) console.log('  none — every Zoho punch in range already has a row here.\n');

  await pool.end();
})().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
