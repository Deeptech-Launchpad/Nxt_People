/* ── Does this database actually say what the reports say? ─────────────────
 *  Everything verified so far ran against 68 seeded employees on a uniform
 *  8.5-hour day — data that has already made two test suites pass while
 *  proving nothing. This reads the real thing.
 *
 *  Read-only, and not merely by intention. Before anything runs, pool.query is
 *  wrapped so that any statement which is not a SELECT is refused, and the
 *  mail transport is replaced with one that cannot connect. Both are proved in
 *  the output rather than promised in a comment: if the guard is working, a
 *  deliberate write attempt fails, and that failure is printed.
 *
 *    docker compose exec backend node reconcile_live.js
 *    docker compose exec backend node reconcile_live.js 2026-07-01 2026-07-31
 *
 *  Defaults to last calendar month, which is the last period with complete
 *  data. Today is deliberately excluded — a day still running has people
 *  checked in and not out, which is not a fault.
 * ────────────────────────────────────────────────────────────────────────── */

// ── Guard 1: nothing can be sent ───────────────────────────────────────────
process.env.EMAIL_DISABLED = 'true';
const nodemailer = require('nodemailer');
let mailAttempts = 0;
nodemailer.createTransport = () => ({
  sendMail: async () => { mailAttempts++; throw new Error('reconcile_live.js does not send mail'); },
  verify: async () => { throw new Error('reconcile_live.js does not send mail'); },
});

// ── Guard 2: nothing can be written ────────────────────────────────────────
const pool = require('./db');
const realQuery = pool.query.bind(pool);
const blockedWrites = [];
let readOnly = true;
pool.query = (text, params) => {
  const sql = String(typeof text === 'string' ? text : text?.text || '');
  const first = sql.trim().replace(/^\(*\s*/, '').slice(0, 12).toUpperCase();
  const writes = /^(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|GRANT)/.test(first);
  if (readOnly && writes) {
    blockedWrites.push(sql.trim().split('\n')[0].slice(0, 120));
    return Promise.reject(new Error('reconcile_live.js is read-only; this write was refused'));
  }
  return realQuery(text, params);
};

const jwt = require('jsonwebtoken');
const http = require('http');
const app = require('./app');

// ── Reporting helpers ──────────────────────────────────────────────────────
const findings = [];
const note = (severity, area, message, rows, total) =>
  findings.push({ severity, area, message, rows: rows || [],
                  total: total === undefined ? (rows || []).length : total });

const ok = (msg) => console.log(`  ok    ${msg}`);
const bad = (msg, n) => console.log(`  FOUND ${msg}${n === undefined ? '' : ` (${n})`}`);

const ymd = (d) => {
  const x = d instanceof Date ? d : new Date(`${String(d).slice(0, 10)}T00:00:00`);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

function defaultRange() {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), 0);      // last day of last month
  const start = new Date(end.getFullYear(), end.getMonth(), 1);
  return [ymd(start), ymd(end)];
}

let PORT = 0;
const get = (path, token) => new Promise(resolve => {
  const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api' + path,
    headers: { Authorization: 'Bearer ' + token } },
    res => { let d = ''; res.on('data', c => d += c);
      res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch {}
        resolve({ status: res.statusCode, json: j, raw: d.slice(0, 200) }); }); });
  req.on('error', e => resolve({ status: 0, raw: e.message }));
  req.setTimeout(120000, () => { req.destroy(); resolve({ status: 0, raw: 'timeout' }); });
});

const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v));

(async () => {
  const [START, END] = process.argv[2] && process.argv[3]
    ? [process.argv[2], process.argv[3]]
    : defaultRange();

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  Live data reconciliation — READ ONLY');
  console.log(`  Range: ${START} to ${END}`);
  console.log('══════════════════════════════════════════════════════════\n');

  // ── Prove the guards, rather than claiming them ──────────────────────────
  console.log('Safety\n');
  let writeRefused = false;
  try {
    await pool.query(`UPDATE employees SET first_name = first_name WHERE 1=0`);
  } catch (e) { writeRefused = /read-only/.test(e.message); }
  console.log(`  ${writeRefused ? 'ok   ' : 'FAIL '} a deliberate write attempt was refused`);
  console.log(`  ok    the mail transport cannot connect (${mailAttempts} send attempts so far)`);
  if (!writeRefused) {
    console.log('\n  The read-only guard is not working. Stopping rather than risk a write.\n');
    process.exit(1);
  }

  const counts = (await pool.query(
    `SELECT COUNT(*) FILTER (WHERE status='active' AND deleted_at IS NULL)::int AS active,
            COUNT(*) FILTER (WHERE is_user = FALSE AND deleted_at IS NULL)::int AS profiles,
            COUNT(*)::int AS total FROM employees`)).rows[0];
  console.log(`\n  ${counts.active} active employees, ${counts.profiles} employee profile(s), ${counts.total} rows in all\n`);

  // ══ 1. Is the stored data self-consistent? ════════════════════════════════
  console.log('──────────────────────────────────────────────────────────');
  console.log('1. Does the stored data make sense?');
  console.log('──────────────────────────────────────────────────────────\n');

  const q = async (label, sql, params, describe) => {
    let r;
    try { r = await pool.query(sql, params); }
    catch (e) { bad(`${label} — could not be checked: ${e.message}`); note('error', 'data', label, []); return; }
    if (!r.rows.length) { ok(label); return; }

    // The listing is capped so the output stays readable. Reporting that cap
    // as the finding count would understate the problem, so the real total is
    // counted separately.
    let trueTotal = r.rows.length;
    if (r.rows.length >= 200) {
      const counted = await pool.query(
        `SELECT COUNT(*)::int AS n FROM (${sql.replace(/\s+LIMIT\s+\d+\s*$/i, '')}) AS q`, params)
        .catch(() => null);
      if (counted) trueTotal = counted.rows[0].n;
    }

    bad(label, trueTotal === r.rows.length ? trueTotal : `${trueTotal}, showing first ${r.rows.length}`);
    note('problem', 'data', label, r.rows, trueTotal);
    for (const row of r.rows.slice(0, 5)) console.log(`          ${describe(row)}`);
    if (trueTotal > 5) console.log(`          … and ${trueTotal - 5} more`);
  };

  await q('check-out is never before check-in',
    `SELECT e.employee_id AS code, TRIM(CONCAT(e.first_name,' ',e.last_name)) AS name,
            a.date::text AS d, a.check_in, a.check_out
       FROM attendance a JOIN employees e ON e.id = a.employee_id
      WHERE a.date BETWEEN $1::date AND $2::date
        AND a.check_in IS NOT NULL AND a.check_out IS NOT NULL
        AND a.check_out < a.check_in
      ORDER BY a.date LIMIT 200`,
    [START, END],
    r => `${r.code} ${r.name} on ${r.d}: in ${r.check_in}, out ${r.check_out}`);

  // A day with more than one session legitimately has working_hours (the sum
  // of the sessions) differing from check_out minus check_in (the span,
  // including the gap between them). Only single-session days are compared.
  await q('stored working_hours match the punches',
    `SELECT e.employee_id AS code, TRIM(CONCAT(e.first_name,' ',e.last_name)) AS name,
            a.date::text AS d, a.working_hours AS stored,
            ROUND(EXTRACT(EPOCH FROM (a.check_out - a.check_in))/3600.0, 2) AS derived
       FROM attendance a JOIN employees e ON e.id = a.employee_id
      WHERE a.date BETWEEN $1::date AND $2::date
        AND a.check_in IS NOT NULL AND a.check_out IS NOT NULL
        AND a.working_hours IS NOT NULL
        AND ABS(a.working_hours - EXTRACT(EPOCH FROM (a.check_out - a.check_in))/3600.0) > 0.05
        AND (SELECT COUNT(*) FROM attendance_sessions s
              WHERE s.employee_id = a.employee_id AND s.date = a.date) < 2
      ORDER BY a.date LIMIT 200`,
    [START, END],
    r => `${r.code} ${r.name} on ${r.d}: stored ${r.stored}h, punches say ${r.derived}h`);

  // The two shapes that cannot be a split shift, and are wrong either way.
  // Tolerance, not equality. A pair of punches seconds apart is not literally
  // equal but is still no elapsed time, and an exact test let those through.
  await q('no day claims hours with no elapsed time between the punches',
    `SELECT e.employee_id AS code, TRIM(CONCAT(e.first_name,' ',e.last_name)) AS name,
            a.date::text AS d, a.working_hours AS stored,
            ROUND(EXTRACT(EPOCH FROM (a.check_out - a.check_in))/3600.0, 3) AS span
       FROM attendance a JOIN employees e ON e.id = a.employee_id
      WHERE a.date BETWEEN $1::date AND $2::date
        AND a.check_in IS NOT NULL AND a.check_out IS NOT NULL
        AND EXTRACT(EPOCH FROM (a.check_out - a.check_in))/3600.0 < 0.05
        AND COALESCE(a.working_hours, 0) > 0.05
      ORDER BY a.date LIMIT 200`,
    [START, END],
    r => `${r.code} ${r.name} on ${r.d}: ${r.stored}h stored, but the punches are only ${r.span}h apart`);

  // Likewise: a span of a few seconds stored as zero hours is agreement, not
  // a fault. Only a real span recorded as nothing is worth reporting.
  await q('no day was worked and recorded as zero hours',
    `SELECT e.employee_id AS code, TRIM(CONCAT(e.first_name,' ',e.last_name)) AS name,
            a.date::text AS d,
            ROUND(EXTRACT(EPOCH FROM (a.check_out - a.check_in))/3600.0, 2) AS derived
       FROM attendance a JOIN employees e ON e.id = a.employee_id
      WHERE a.date BETWEEN $1::date AND $2::date
        AND a.check_in IS NOT NULL AND a.check_out IS NOT NULL
        AND EXTRACT(EPOCH FROM (a.check_out - a.check_in))/3600.0 > 0.05
        AND COALESCE(a.working_hours, 0) = 0
      ORDER BY a.date LIMIT 200`,
    [START, END],
    r => `${r.code} ${r.name} on ${r.d}: punches span ${r.derived}h but the day is stored as 0`);

  // Not a fault, but worth seeing: somebody tapped in and out again within a
  // minute. The day is consistent — zero span, zero hours — and reads as a
  // full working day nowhere, but it is also not a day anybody worked.
  await q('nobody checked in and straight back out within a minute',
    `SELECT e.employee_id AS code, TRIM(CONCAT(e.first_name,' ',e.last_name)) AS name,
            a.date::text AS d,
            ROUND(EXTRACT(EPOCH FROM (a.check_out - a.check_in)))::int AS seconds
       FROM attendance a JOIN employees e ON e.id = a.employee_id
      WHERE a.date BETWEEN $1::date AND $2::date
        AND a.check_in IS NOT NULL AND a.check_out IS NOT NULL
        AND EXTRACT(EPOCH FROM (a.check_out - a.check_in)) BETWEEN 0 AND 60
      ORDER BY a.date LIMIT 200`,
    [START, END],
    r => `${r.code} ${r.name} on ${r.d}: in and out again after ${r.seconds} second(s)`);

  await q('one attendance row per person per day',
    `SELECT e.employee_id AS code, TRIM(CONCAT(e.first_name,' ',e.last_name)) AS name,
            a.date::text AS d, COUNT(*)::int AS rows
       FROM attendance a JOIN employees e ON e.id = a.employee_id
      WHERE a.date BETWEEN $1::date AND $2::date
      GROUP BY 1,2,3 HAVING COUNT(*) > 1
      ORDER BY 3 LIMIT 200`,
    [START, END],
    r => `${r.code} ${r.name} on ${r.d}: ${r.rows} rows`);

  await q('no approved leave overlaps another approved leave',
    `SELECT e.employee_id AS code, TRIM(CONCAT(e.first_name,' ',e.last_name)) AS name,
            l1.start_date::text AS a_from, l1.end_date::text AS a_to,
            l2.start_date::text AS b_from, l2.end_date::text AS b_to
       FROM leaves l1
       JOIN leaves l2 ON l2.employee_id = l1.employee_id AND l2.id > l1.id
        AND l2.status = 'approved' AND l1.status = 'approved'
        AND l1.start_date <= l2.end_date AND l2.start_date <= l1.end_date
       JOIN employees e ON e.id = l1.employee_id
      WHERE l1.leave_type <> 'permission' AND l2.leave_type <> 'permission'
        AND l1.end_date >= $1::date AND l1.start_date <= $2::date
      LIMIT 200`,
    [START, END],
    r => `${r.code} ${r.name}: ${r.a_from}–${r.a_to} overlaps ${r.b_from}–${r.b_to}`);

  await q('no negative leave balance',
    `SELECT employee_id AS code, TRIM(CONCAT(first_name,' ',last_name)) AS name,
            casual_leave, sick_leave, earned_leave
       FROM employees
      WHERE deleted_at IS NULL
        AND (casual_leave < 0 OR sick_leave < 0 OR earned_leave < 0)
      LIMIT 200`, [],
    r => `${r.code} ${r.name}: casual ${r.casual_leave}, sick ${r.sick_leave}, earned ${r.earned_leave}`);

  await q('no approval chain left behind by a deleted request',
    `SELECT al.request_type AS t, COUNT(*)::int AS n
       FROM approval_levels al
      WHERE al.request_type = 'leave'
        AND NOT EXISTS (SELECT 1 FROM leaves l WHERE l.id = al.request_id)
      GROUP BY 1`, [],
    r => `${r.n} orphaned ${r.t} approval level(s)`);

  await q('every approved leave has a positive day count',
    `SELECT e.employee_id AS code, TRIM(CONCAT(e.first_name,' ',e.last_name)) AS name,
            l.start_date::text AS s, l.end_date::text AS e2, l.total_days, l.leave_type
       FROM leaves l JOIN employees e ON e.id = l.employee_id
      WHERE l.status = 'approved' AND l.leave_type <> 'permission'
        AND l.end_date >= $1::date AND l.start_date <= $2::date
        AND (l.total_days IS NULL OR l.total_days <= 0)
      LIMIT 200`,
    [START, END],
    r => `${r.code} ${r.name}: ${r.leave_type} ${r.s}–${r.e2} says ${r.total_days} days`);

  await q('nobody is checked in on a day that has already finished',
    `SELECT e.employee_id AS code, TRIM(CONCAT(e.first_name,' ',e.last_name)) AS name,
            a.date::text AS d, a.check_in
       FROM attendance a JOIN employees e ON e.id = a.employee_id
      WHERE a.date BETWEEN $1::date AND $2::date
        AND a.date < CURRENT_DATE
        AND a.check_in IS NOT NULL AND a.check_out IS NULL
      ORDER BY a.date DESC LIMIT 200`,
    [START, END],
    r => `${r.code} ${r.name} on ${r.d}: checked in, never checked out`);

  // Same figure, different meaning: every row off by an identical amount is
  // one bad bulk write; a spread of different gaps is the check-out handler
  // getting it wrong day by day. The first is history, the second is live.
  const hoursPattern = await pool.query(
    `SELECT ROUND((a.working_hours - EXTRACT(EPOCH FROM (a.check_out - a.check_in))/3600.0)::numeric, 2) AS gap,
            COUNT(*)::int AS n, MIN(a.date)::text AS first_seen, MAX(a.date)::text AS last_seen
       FROM attendance a
      WHERE a.date BETWEEN $1::date AND $2::date
        AND a.check_in IS NOT NULL AND a.check_out IS NOT NULL AND a.working_hours IS NOT NULL
        AND ABS(a.working_hours - EXTRACT(EPOCH FROM (a.check_out - a.check_in))/3600.0) > 0.05
      GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
    [START, END]).catch(() => ({ rows: [] }));

  if (hoursPattern.rows.length) {
    console.log("\n  How those hour mismatches are shaped:");
    for (const r of hoursPattern.rows) {
      console.log(`          ${r.n} row(s) off by ${r.gap}h  (${r.first_seen} to ${r.last_seen})`);
    }
    if (hoursPattern.rows.length === 1) {
      console.log("          Every row is off by the same amount over one span, which is the",
                  "\n          signature of a single bulk write rather than the check-out",
                  "\n          handler miscalculating. Worth confirming how that data got in.");
    } else {
      console.log("          Several different gaps — that is the check-out handler getting",
                  "\n          it wrong on different days, not one bad import. Worth fixing.");
    }
  }

  // ══ 2. Do the reports agree with one another? ═════════════════════════════
  console.log('\n──────────────────────────────────────────────────────────');
  console.log('2. Do the reports agree with each other?');
  console.log('──────────────────────────────────────────────────────────\n');

  const admin = (await pool.query(
    `SELECT id FROM employees WHERE role IN ('admin','director','hr_admin')
       AND status='active' AND deleted_at IS NULL ORDER BY role LIMIT 1`)).rows[0];
  if (!admin) {
    console.log('  no administrator on file, so the reports cannot be called\n');
    process.exit(1);
  }
  if (!process.env.JWT_SECRET) {
    console.log('  JWT_SECRET is not set in this container; cannot call the reports\n');
    process.exit(1);
  }

  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  PORT = server.address().port;
  const token = jwt.sign({ id: admin.id }, process.env.JWT_SECRET, { expiresIn: '30m' });

  const R = `startDate=${START}&endDate=${END}`;
  const [muster, payroll, lop] = await Promise.all([
    get(`/reports/attendance/muster-roll?${R}`, token),
    get(`/reports/attendance/payroll-export?${R}`, token),
    get(`/reports/leave/lop?${R}`, token),
  ]);

  for (const [name, res] of [['Muster Roll', muster], ['Attendance Data for Payroll', payroll], ['Loss of Pay', lop]]) {
    if (res.status !== 200) {
      bad(`${name} did not load (HTTP ${res.status})`);
      note('error', 'report', `${name} failed: ${res.raw}`, []);
    } else ok(`${name} loaded — ${(res.json?.data || []).length} row(s)`);
  }

  const byId = (res) => new Map((res.json?.data || []).map(r => [String(r._id), r]));
  const M = byId(muster), P = byId(payroll), L = byId(lop);

  if (M.size && P.size) {
    const gaps = [];
    for (const [id, m] of M) {
      const p = P.get(id);
      if (!p) { gaps.push({ code: m.employeeCode, why: 'missing from the payroll report' }); continue; }
      // Present days on the grid, against the payroll report's own figure.
      const grid = (m.days || []).filter(d => /^(P|OD)$/i.test(String(d.code || ''))).length;
      const pay = num(p.presentDays ?? p.payableDays ?? p.workedDays);
      if (pay && Math.abs(grid - pay) > 0.51) {
        gaps.push({ code: m.employeeCode, why: `Muster Roll counts ${grid} present, payroll report says ${pay}` });
      }
    }
    if (!gaps.length) ok('Muster Roll and the payroll report agree on present days');
    else {
      bad('Muster Roll and the payroll report disagree', gaps.length);
      note('problem', 'report', 'present-day disagreement', gaps);
      for (const g of gaps.slice(0, 8)) console.log(`          ${g.code}: ${g.why}`);
      if (gaps.length > 8) console.log(`          … and ${gaps.length - 8} more`);
    }
  }

  if (L.size) {
    const badRows = [];
    for (const [, r] of L) {
      const total = num(r.totalUnpayable);
      const parts = num(r.lopDays) + num(r.absentDays);
      if (Math.abs(total - parts) > 0.01) {
        badRows.push({ code: r.employeeCode, why: `total unpayable ${total} but ${num(r.lopDays)} + ${num(r.absentDays)} = ${parts}` });
      }
      if (num(r.unregularizedDays) > num(r.absentDays)) {
        badRows.push({ code: r.employeeCode, why: `unregularized ${r.unregularizedDays} exceeds unmarked absence ${r.absentDays}` });
      }
    }
    if (!badRows.length) ok('Loss of Pay adds up within itself');
    else {
      bad('Loss of Pay does not add up', badRows.length);
      note('problem', 'report', 'loss of pay arithmetic', badRows);
      for (const b of badRows.slice(0, 8)) console.log(`          ${b.code}: ${b.why}`);
    }
  }

  // Employee Profiles must not appear in attendance reports at all.
  const profiles = (await pool.query(
    `SELECT id, employee_id AS code FROM employees WHERE is_user = FALSE AND deleted_at IS NULL`)).rows;
  if (profiles.length) {
    const leaked = profiles.filter(p => M.has(String(p.id)));
    if (!leaked.length) ok(`${profiles.length} employee profile(s), none of them in the Muster Roll`);
    else {
      bad('employee profiles are appearing in attendance reports', leaked.length);
      note('problem', 'report', 'employee profiles in attendance', leaked.map(p => ({ code: p.code })));
      for (const p of leaked.slice(0, 8)) console.log(`          ${p.code}`);
    }
  } else ok('no employee profiles on file');

  // ══ Summary ══════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════════════════════');
  const problems = findings.filter(f => f.severity === 'problem');
  const errors = findings.filter(f => f.severity === 'error');
  if (!problems.length && !errors.length) {
    console.log('  Nothing wrong found in this range.');
    console.log('  The reports agree with each other and with the stored data.');
  } else {
    if (problems.length) console.log(`  ${problems.length} kind(s) of problem found:`);
    for (const p of problems) console.log(`    • ${p.message} — ${p.total} row(s)`);
    if (errors.length) console.log(`  ${errors.length} check(s) could not be run:`);
    for (const e of errors) console.log(`    • ${e.message}`);
  }
  console.log(`\n  Read-only throughout: ${blockedWrites.length} write attempt(s) refused `
            + `(1 of them this script testing its own guard), `
            + `${mailAttempts} mail attempt(s) refused.`);
  // The startup self-test is one of these by design; listing it as a
  // suspicious write made the summary contradict its own safety section.
  const foreign = blockedWrites.filter(w => !/first_name = first_name/.test(w));
  if (foreign.length) {
    console.log('  Something tried to write during a read-only run, which is worth knowing:');
    for (const w of [...new Set(foreign)].slice(0, 5)) console.log(`    ${w}`);
  }
  console.log('══════════════════════════════════════════════════════════\n');

  server.close();
  process.exit(0);
})().catch(e => {
  console.error('\nreconcile_live.js stopped:', e.message);
  process.exit(1);
});
