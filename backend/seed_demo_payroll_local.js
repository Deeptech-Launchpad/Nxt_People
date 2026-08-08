/**
 * seed_demo_payroll_local.js — LOCAL-ONLY demo data for testing Payroll Run.
 *
 * Refuses to run against anything but localhost. Not part of migrate.js —
 * run manually: `node seed_demo_payroll_local.js`.
 *
 * What it creates:
 *   - A salary structure (effective 2026-01-01) for every active employee
 *     that doesn't already have one.
 *   - July 2026 attendance for those employees, computed against the real
 *     weekend_rules + holidays tables (via utils/workingDays.isNonWorkingDay)
 *     so it matches exactly what Payroll Run itself will compute.
 *   - A mix of profiles per employee: mostly fully-present, some with
 *     unmarked absences (no leave behind them), some with an approved
 *     Unpaid Leave (LOP) request, some with both.
 *
 * Does NOT touch payroll_payslips — run "Run Payroll" from the UI yourself
 * to see the result.
 */
require('dotenv').config();
const pool = require('./db');
const { isNonWorkingDay } = require('./utils/workingDays');

async function main() {
  const host = (process.env.DB_HOST || '').toLowerCase();
  if (host !== 'localhost' && host !== '127.0.0.1') {
    console.error(`Refusing to run — DB_HOST is "${process.env.DB_HOST}", not localhost. This script is local-only.`);
    process.exit(1);
  }
  console.log(`Seeding demo payroll data into ${process.env.DB_NAME} @ ${process.env.DB_HOST} ...`);

  const empRes = await pool.query(
    `SELECT e.id, e.employee_id, e.first_name, e.last_name, e.state
       FROM employees e
      WHERE e.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM salary_structures ss WHERE ss.employee_id = e.id)
      ORDER BY e.first_name`
  );
  const employees = empRes.rows;
  console.log(`${employees.length} active employees without a salary structure.`);

  // ── 1. Salary structures ────────────────────────────────────────────
  let structuresCreated = 0;
  for (const emp of employees) {
    const monthlyCtc = 20000 + Math.floor(Math.random() * 30) * 1000; // 20k–49k/month
    const ctcAnnual = monthlyCtc * 12;
    const basic = Math.round(monthlyCtc * 0.5);
    const hra = Math.round(monthlyCtc * 0.2);
    const conveyance = 1600;
    const special = Math.max(0, monthlyCtc - basic - hra - conveyance);
    const esiApplicable = monthlyCtc <= 21000;

    await pool.query(
      `INSERT INTO salary_structures
         (employee_id, effective_from, ctc_annual, basic, hra, conveyance, other_components, pf_applicable, esi_applicable, notes)
       VALUES ($1, '2026-01-01', $2, $3, $4, $5, $6, TRUE, $7, 'Demo data — local only')`,
      [emp.id, ctcAnnual, basic, hra, conveyance, JSON.stringify([{ name: 'Special Allowance', value: special }]), esiApplicable]
    );
    structuresCreated++;
  }
  console.log(`Created ${structuresCreated} salary structures (effective 2026-01-01).`);

  // ── 2. Assign a demo profile per employee ───────────────────────────
  // ~70% clean / ~10% absences-only / ~10% LOP-only / ~10% both
  const profiles = employees.map((emp, i) => {
    const bucket = i % 10;
    let profile = 'clean';
    if (bucket === 0) profile = 'absent';
    else if (bucket === 1) profile = 'lop';
    else if (bucket === 2) profile = 'both';
    return { emp, profile };
  });

  // ── 3. Walk every day in July 2026, mark working days per employee ─
  const julyDays = [];
  for (let d = 1; d <= 31; d++) julyDays.push(new Date(2026, 6, d)); // month=6 → July (0-indexed)
  const workingDays = [];
  for (const d of julyDays) {
    const nonWorking = await isNonWorkingDay(d);
    if (!nonWorking) workingDays.push(d);
  }
  console.log(`July 2026 has ${workingDays.length} working days per current weekend rules/holidays.`);

  // Fixed offsets (into workingDays[]) for LOP/absence days — same for every
  // affected employee, keeps the demo predictable to spot-check.
  const lopDayIdxs = [8, 9];       // 2 consecutive working days → one leave request
  const absentDayIdxs = [3, 12, 20]; // 3 scattered working days, no leave behind them

  let attendanceRows = 0;
  let lopRequests = 0;

  for (const { emp, profile } of profiles) {
    const lopSet = new Set();
    const absentSet = new Set();
    if (profile === 'lop' || profile === 'both') lopDayIdxs.forEach(i => workingDays[i] && lopSet.add(+workingDays[i]));
    if (profile === 'absent' || profile === 'both') absentDayIdxs.forEach(i => workingDays[i] && absentSet.add(+workingDays[i]));

    for (const day of workingDays) {
      const t = +day;
      if (lopSet.has(t)) continue; // no attendance row on an LOP day
      const ymd = day.toLocaleDateString('en-CA');
      if (absentSet.has(t)) {
        await pool.query(
          `INSERT INTO attendance (employee_id, date, status) VALUES ($1, $2::date, 'absent')`,
          [emp.id, ymd]
        );
      } else {
        const checkIn = `${ymd}T09:30:00`;
        const checkOut = `${ymd}T18:30:00`;
        await pool.query(
          `INSERT INTO attendance (employee_id, date, check_in, check_out, working_hours, status)
           VALUES ($1, $2::date, $3, $4, 8.5, 'present')`,
          [emp.id, ymd, checkIn, checkOut]
        );
      }
      attendanceRows++;
    }

    if (profile === 'lop' || profile === 'both') {
      const lopDates = lopDayIdxs.map(i => workingDays[i]).filter(Boolean);
      if (lopDates.length) {
        const start = lopDates[0].toLocaleDateString('en-CA');
        const end = lopDates[lopDates.length - 1].toLocaleDateString('en-CA');
        await pool.query(
          `INSERT INTO leaves (employee_id, leave_type, start_date, end_date, total_days, reason, status, approved_at)
           VALUES ($1, 'unpaid', $2::date, $3::date, $4, 'Demo unpaid leave — local only', 'approved', NOW())`,
          [emp.id, start, end, lopDates.length]
        );
        lopRequests++;
      }
    }
  }

  console.log(`Inserted ${attendanceRows} attendance rows.`);
  console.log(`Created ${lopRequests} approved Unpaid Leave (LOP) requests.`);

  const counts = profiles.reduce((acc, p) => { acc[p.profile] = (acc[p.profile] || 0) + 1; return acc; }, {});
  console.log('\nProfile breakdown:', counts);
  console.log('\nSample employees to spot-check after you Run Payroll for July 2026:');
  for (const p of ['lop', 'absent', 'both']) {
    const ex = profiles.find(x => x.profile === p);
    if (ex) console.log(`  ${p.padEnd(6)} → ${ex.emp.first_name} ${ex.emp.last_name} (${ex.emp.employee_id})`);
  }

  await pool.end();
}

main().catch(err => { console.error('Seed failed:', err); process.exit(1); });
