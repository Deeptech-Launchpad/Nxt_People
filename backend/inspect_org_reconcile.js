#!/usr/bin/env node
/* One consolidated Zoho-vs-NxtPeople check, every active employee, one range.
 *
 * READ ONLY. Nothing here writes.
 *
 * Runs the same four checks inspect_attendance_gap_scan.js, inspect_leave_gap_scan.js,
 * inspect_regularization_gap.js and inspect_lop_discrepancy.js already do one
 * employee at a time, but for everyone active in one pass, and shares the
 * Zoho attendance call across three of the four checks instead of asking
 * Zoho the same question three separate times per person:
 *
 *   1. ATTENDANCE  — Zoho shows a real punch, this system has no row at all
 *                    for that date. The false-Absent gap.
 *   2. LEAVE        — approved leave/permission totals in range, Zoho vs the
 *                    local `leaves` table, by type.
 *   3. REGULARIZATION — an approved regularization whose attendance row still
 *                    doesn't show it (wrong status, or no row at all).
 *   4. LOP          — this system's lopDaysForRange+absentDaysForRange vs a
 *                    Zoho-equivalent figure (Zoho's approved unpaid leave in
 *                    range + Zoho's own Absent-status days in range). This is
 *                    an approximation of Zoho's combined "Booked" LOP figure,
 *                    good enough to flag a real gap, not to run payroll from.
 *
 * Only prints employees where at least one check disagrees — clean people
 * are silently counted, not listed, so the output stays readable.
 *
 *   node inspect_org_reconcile.js 2026-08-26 2026-09-07
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
const { lopDaysForRange, absentDaysForRange, loadHolidaysAndRules } = require('./routes/payroll');

const START = process.argv[2];
const END = process.argv[3];
if (!/^\d{4}-\d{2}-\d{2}$/.test(START || '') || !/^\d{4}-\d{2}-\d{2}$/.test(END || '')) {
  console.error('\n  usage: node inspect_org_reconcile.js <START YYYY-MM-DD> <END YYYY-MM-DD>\n');
  process.exit(1);
}

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const TOLERANCE = 0.05;
const notDash = v => (v === '-' || v === '' || v === null || v === undefined) ? null : v;
const zohoDMY = iso => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
const fromZohoDate = (s) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(s || ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const hasRealTimestamp = (s) => {
  const v = notDash(s);
  return !!v && /^\d{2}\/\d{2}\/\d{4}\s+\d{1,2}:\d{2}\s*(AM|PM)?$/i.test(String(v).trim());
};
const isAbsence = (status, hasPunch) => !hasPunch && /\babsent\b/i.test(status);
const absentFraction = (status, hasPunch) => {
  if (!isAbsence(status, hasPunch)) return 0;
  const m = /(\d+(?:\.\d+)?)\s*day\s*Absent/i.exec(status);
  if (m) return parseFloat(m[1]);
  return /half/i.test(status) ? 0.5 : 1;
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

const LEAVE_TYPES = {
  'permission': 'permission', 'casual leave': 'casual', 'casual': 'casual',
  'sick leave': 'sick', 'sick': 'sick', 'earned leave': 'earned',
  'privilege leave': 'earned', 'loss of pay': 'unpaid', 'lop': 'unpaid',
  'unpaid leave': 'unpaid', 'leave without pay': 'unpaid', 'lwp': 'unpaid',
  'comp off': 'comp_off', 'compensatory off': 'comp_off',
};
const normaliseLeaveType = (raw) => String(raw ?? '')
  .replace(/\s*(19|20)\d{2}\s*$/, '').trim().toLowerCase();

async function zohoLeaveSweep(start, end) {
  const out = [];
  for (let i = 1; i <= 40000; i += 200) {
    const json = await patiently(() => zohoApi(`forms/leave/getRecords?sIndex=${i}&limit=200`));
    const resp = json?.response;
    if (!resp || typeof resp !== 'object' || !('result' in resp)) throw new Error(`Zoho refused the leave sweep at record ${i}`);
    const rows = resp.result || [];
    if (!Array.isArray(rows) || !rows.length) break;
    for (const w of rows) {
      const rec = Object.values(w)[0]?.[0];
      if (!rec) continue;
      const m = /\b(ANXT\w+)\b/.exec(String(rec.Employee_ID || ''));
      if (!m) continue;
      if (String(rec.ApprovalStatus || '').trim().toLowerCase() !== 'approved') continue;
      const from = fromZohoDate(rec.From);
      const to = fromZohoDate(rec.To) || from;
      if (!from || to < start || from > end) continue;
      const type = LEAVE_TYPES[normaliseLeaveType(rec.Leavetype)];
      if (!type) continue;
      out.push({ code: m[1], type, days: parseFloat(rec.Daystaken) || 0 });
    }
    if (rows.length < 200) break;
  }
  return out;
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

(async () => {
  console.log(`\n=== Org-wide reconcile — Zoho vs NxtPeople, active employees, ${START} to ${END} ===\n`);

  const emps = (await pool.query(
    `SELECT id, employee_id AS code, first_name || ' ' || COALESCE(last_name,'') AS name,
            date_of_joining::text AS joined, exit_date::text AS exited
       FROM employees WHERE employee_id ~ '^ANXT' AND status = 'active' ORDER BY employee_id`)).rows;
  console.log(`${emps.length} active employee(s). Sweeping Zoho leave (one pass)...`);

  const zohoLeaves = await zohoLeaveSweep(START, END);
  const zohoLeaveTotals = new Map(); // code|type -> days
  const zohoUnpaidByCode = new Map(); // code -> unpaid days (for LOP)
  for (const r of zohoLeaves) {
    const key = `${r.code}|${r.type}`;
    zohoLeaveTotals.set(key, round2((zohoLeaveTotals.get(key) || 0) + r.days));
    if (r.type === 'unpaid') zohoUnpaidByCode.set(r.code, round2((zohoUnpaidByCode.get(r.code) || 0) + r.days));
  }
  console.log(`  ${zohoLeaves.length} approved record(s) overlapping the range.\n`);

  const { holMap, rules } = await holidaysAndRulesFor(START, END);

  console.log(`Checking ${emps.length} employee(s) against Zoho attendance — one call each...\n`);
  let checked = 0;
  const flagged = [];

  for (const emp of emps) {
    checked++;
    if (checked % 20 === 0) console.log(`  ...${checked}/${emps.length} checked`);

    const issues = { attendance: [], leave: [], regularization: [], lop: null };

    // ── 1. Attendance: Zoho punch, no local row ──────────────────────────
    let zohoAtt;
    try { zohoAtt = await zohoAttendanceWindow(emp.code, START, END); }
    catch (err) { issues.attendance.push(`could not read Zoho attendance: ${String(err.message).slice(0, 90)}`); zohoAtt = null; }

    const hereAttRows = (await pool.query(
      `SELECT date::text AS date, check_in IS NOT NULL AS "hasIn" FROM attendance
        WHERE employee_id = $1 AND date BETWEEN $2::date AND $3::date`,
      [emp.id, START, END])).rows;
    const hereDates = new Set(hereAttRows.map(r => r.date));

    let zohoAbsentDays = 0;
    if (zohoAtt && typeof zohoAtt === 'object' && !('error' in zohoAtt) && !('errors' in zohoAtt)) {
      for (const [iso, rec] of Object.entries(zohoAtt)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || iso < START || iso > END) continue;
        if (emp.joined && iso < emp.joined) continue;
        if (emp.exited && iso > emp.exited) continue;
        const status = String(rec.Status ?? '').trim();
        const hasPunch = hasRealTimestamp(rec.FirstIn);
        if (hasPunch && !hereDates.has(iso)) {
          issues.attendance.push(`${iso}  Zoho: ${notDash(rec.FirstIn) || '-'} -> ${notDash(rec.LastOut) || '-'}  status="${status}"  (no row here)`);
        }
        zohoAbsentDays += absentFraction(status, hasPunch);
      }
    }

    // ── 2. Leave/permission totals in range ──────────────────────────────
    const hereLeave = (await pool.query(
      `SELECT leave_type AS type,
              SUM(CASE WHEN leave_type = 'permission' THEN hours ELSE total_days END) AS total
         FROM leaves WHERE employee_id = $1 AND status = 'approved'
          AND start_date <= $3::date AND end_date >= $2::date
        GROUP BY leave_type`,
      [emp.id, START, END])).rows;
    const hereLeaveTotals = new Map(hereLeave.map(r => [r.type, round2(parseFloat(r.total) || 0)]));

    const allTypes = new Set([...hereLeaveTotals.keys()]);
    for (const key of zohoLeaveTotals.keys()) {
      const [code, type] = key.split('|');
      if (code === emp.code) allTypes.add(type);
    }
    for (const type of allTypes) {
      const zoho = zohoLeaveTotals.get(`${emp.code}|${type}`) || 0;
      const here = hereLeaveTotals.get(type) || 0;
      if (Math.abs(zoho - here) > TOLERANCE) {
        const unit = type === 'permission' ? 'h' : 'd';
        issues.leave.push(`${type}: Zoho=${zoho}${unit} here=${here}${unit} (${zoho > here ? 'MISSING HERE' : 'extra here'} ${Math.abs(round2(zoho - here))}${unit})`);
      }
    }

    // ── 3. Regularization: approved, does attendance actually show it? ──
    const regs = (await pool.query(
      `SELECT date::text AS date, status FROM attendance_regularizations
        WHERE employee_id = $1 AND date BETWEEN $2::date AND $3::date AND status = 'approved'`,
      [emp.id, START, END])).rows;
    if (regs.length) {
      const attByDate = new Map((await pool.query(
        `SELECT date::text AS date, status, check_in IS NOT NULL AS "hasIn", check_out IS NOT NULL AS "hasOut"
           FROM attendance WHERE employee_id = $1 AND date BETWEEN $2::date AND $3::date`,
        [emp.id, START, END])).rows.map(r => [r.date, r]));
      for (const r of regs) {
        const a = attByDate.get(r.date);
        if (!a) { issues.regularization.push(`${r.date}: approved but NO attendance row exists`); continue; }
        if (a.status === 'absent' || !a.hasIn) issues.regularization.push(`${r.date}: approved but attendance still shows status=${a.status}`);
      }
    }

    // ── 4. LOP: local vs Zoho-equivalent ─────────────────────────────────
    // lopDaysForRange/absentDaysForRange trust the caller to only ask about
    // days the employee actually existed here -- the real payroll code
    // (computeDraftPayslip in routes/payroll.js) clamps to joining/exit
    // before ever calling them. Skipping that clamp here counted every
    // working day before somebody's joining date as an absence, which is
    // how a person who joined in July read as 156 days of LOP over a
    // Jan-to-September range.
    const rangeStart = emp.joined && emp.joined > START ? emp.joined : START;
    const rangeEnd = emp.exited && emp.exited < END ? emp.exited : END;
    if (rangeStart <= rangeEnd) {
      try {
        const lop = await lopDaysForRange(emp.id, new Date(rangeStart), new Date(rangeEnd), holMap, rules, pool);
        const absent = await absentDaysForRange(emp.id, new Date(rangeStart), new Date(rangeEnd), holMap, rules, pool);
        const hereLop = round2(lop + absent);
        const zohoLop = round2((zohoUnpaidByCode.get(emp.code) || 0) + zohoAbsentDays);
        if (Math.abs(hereLop - zohoLop) > TOLERANCE) {
          issues.lop = `here=${hereLop}d (lop=${round2(lop)}+absent=${round2(absent)})  zoho-equivalent=${zohoLop}d (unpaid=${zohoUnpaidByCode.get(emp.code) || 0}+absentstatus=${round2(zohoAbsentDays)})`;
        }
      } catch (err) {
        issues.lop = `could not compute: ${String(err.message).slice(0, 90)}`;
      }
    }

    if (issues.attendance.length || issues.leave.length || issues.regularization.length || issues.lop) {
      flagged.push({ emp, issues });
    }
  }

  console.log(`\n${checked} checked.\n`);
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  ${flagged.length} of ${emps.length} active employee(s) have at least one`);
  console.log(`  disagreement between Zoho and this system in this range.`);
  console.log('══════════════════════════════════════════════════════════\n');

  for (const { emp, issues } of flagged) {
    console.log(`${emp.code}  ${emp.name.trim()}`);
    if (issues.attendance.length) {
      console.log(`  ATTENDANCE (${issues.attendance.length}):`);
      issues.attendance.forEach(l => console.log(`      ${l}`));
    }
    if (issues.leave.length) {
      console.log(`  LEAVE:`);
      issues.leave.forEach(l => console.log(`      ${l}`));
    }
    if (issues.regularization.length) {
      console.log(`  REGULARIZATION:`);
      issues.regularization.forEach(l => console.log(`      ${l}`));
    }
    if (issues.lop) console.log(`  LOP:\n      ${issues.lop}`);
    console.log('');
  }
  if (!flagged.length) console.log('  none — every active employee agrees across all four checks.\n');

  await pool.end();
})().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
