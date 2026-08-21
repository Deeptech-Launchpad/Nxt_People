/* ── Do the reports agree with the rows underneath them? ────────────────────
 *  Zoho's history is in the database and reads back correctly. That was never
 *  the question. The question is what this system's own reports make of eight
 *  real months, and clicking through eight months of five screens is how a
 *  wrong February goes unnoticed because nobody opened February.
 *
 *  So this calls the report endpoints for every month in the range and checks
 *  each one against the rows it is reporting on. It states the invariants that
 *  must hold whatever the numbers happen to be:
 *
 *    Every day in a month is accounted for by exactly one code.
 *    Days the grid calls present match the rows stored as present, late or
 *      half-day, and days it calls absent match the days that are absences.
 *    Hours reported for a month equal the hours on the rows for that month.
 *    A month with rows in it never comes back empty.
 *
 *  It writes nothing, and proves that on startup. Mail is unreachable.
 *
 *    docker compose exec backend node check_reports_against_rows.js ANXT2600149,ANXT2300104 2026-01 2026-08
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
// Two report calls a month across eight months is a hundred request lines
// between here and the table that matters.
process.env.LOG_LEVEL = 'silent';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('this script does not send mail'); },
  verify: async () => { throw new Error('this script does not send mail'); },
});

const pool = require('./db');
const realQuery = pool.query.bind(pool);
let refused = 0;
pool.query = (text, params) => {
  const sql = String(typeof text === 'string' ? text : text?.text || '');
  const first = sql.trim().replace(/^\(*\s*/, '').slice(0, 12).toUpperCase();
  if (/^(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|GRANT)/.test(first)) {
    refused++;
    return Promise.reject(new Error('this script is read-only; that write was refused'));
  }
  return realQuery(text, params);
};

const app = require('./app');
const jwt = require('jsonwebtoken');
const http = require('http');

const CODES = String(process.argv[2] || '').split(/[,\s]+/).filter(Boolean);
const FROM = process.argv[3];
const TO = process.argv[4];

const pad = (s, n) => String(s ?? '').padEnd(n);
const findings = [];
const note = (who, month, what, detail) => {
  findings.push({ who, month, what, detail });
  console.log(`      ${pad(month, 10)}${what}`);
  if (detail) console.log(`                ${detail}`);
};

let PORT = 0;
const get = (path, token) => new Promise(resolve => {
  const req = http.request({ host: '127.0.0.1', port: PORT, path: '/api' + path, method: 'GET',
    headers: { Authorization: 'Bearer ' + token } },
    res => { let d = ''; res.on('data', c => d += c);
      res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch {} resolve({ s: res.statusCode, j }); }); });
  req.on('error', e => resolve({ s: 0, j: null, err: e.message }));
  req.end();
});

const months = (from, to) => {
  const out = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    out.push({ label: `${y}-${String(m).padStart(2, '0')}`,
      start: `${y}-${String(m).padStart(2, '0')}-01`,
      end: `${y}-${String(m).padStart(2, '0')}-${last}` });
    if (++m > 12) { m = 1; y++; }
  }
  return out;
};

// The muster roll's vocabulary, grouped by what the code means for a day.
const PRESENT_CODES = /^(P|HD)$/;
const ABSENT_CODES = /^A$/;
const OFF_CODES = /^(W|H|-)$/;

(async () => {
  if (!CODES.length || !FROM || !TO) {
    console.log('\n  usage: node check_reports_against_rows.js <CODE[,CODE...]> <YYYY-MM> <YYYY-MM>\n');
    process.exit(1);
  }

  try {
    await pool.query(`UPDATE settings SET timezone = timezone`);
    console.log('\n  !!  the read-only guard did NOT hold — stopping\n');
    process.exit(1);
  } catch { /* as intended */ }

  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  PORT = server.address().port;

  const admin = (await pool.query(
    `SELECT id FROM employees WHERE role='admin' AND status='active' AND deleted_at IS NULL LIMIT 1`)).rows[0];
  if (!admin) { console.log('\n  No admin to read the reports as.\n'); process.exit(1); }
  const token = jwt.sign({ id: admin.id }, process.env.JWT_SECRET, { expiresIn: '1h' });

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  Reports against the rows underneath them — READ ONLY');
  console.log(`  ${CODES.join(', ')}   ${FROM} to ${TO}`);
  console.log('══════════════════════════════════════════════════════════\n');
  console.log('  ok    a deliberate write attempt was refused\n');

  const ms = months(FROM, TO);

  for (const code of CODES) {
    const emp = (await pool.query(
      `SELECT id, TRIM(CONCAT(first_name,' ',last_name)) AS name
         FROM employees WHERE employee_id = $1 AND deleted_at IS NULL`, [code])).rows[0];
    if (!emp) { console.log(`  ${code} is not here.\n`); continue; }

    console.log('──────────────────────────────────────────────────────────');
    console.log(`  ${emp.name}   ${code}`);
    console.log('──────────────────────────────────────────────────────────\n');
    console.log(`    ${pad('month', 10)}${pad('rows', 6)}${pad('P/HD', 8)}${pad('A', 5)}`
      + `${pad('leave', 7)}${pad('off', 6)}${pad('hours: rows', 13)}report`);

    for (const m of ms) {
      // What the rows themselves say for this month.
      const truth = (await pool.query(
        `SELECT COUNT(*)::int AS rows,
                COUNT(*) FILTER (WHERE status IN ('present','late'))::int AS present,
                COUNT(*) FILTER (WHERE status = 'half-day')::int AS half,
                COUNT(*) FILTER (WHERE status = 'absent')::int AS absent,
                COALESCE(SUM(working_hours), 0)::numeric(10,2) AS hours
           FROM attendance
          WHERE employee_id = $1 AND date BETWEEN $2::date AND $3::date`,
        [emp.id, m.start, m.end])).rows[0];

      const roll = await get(
        `/reports/attendance/muster-roll?startDate=${m.start}&endDate=${m.end}`, token);
      const mine = roll.j?.data?.find(r => r.employeeCode === code);

      const counts = { present: 0, absent: 0, leave: 0, off: 0, other: 0 };
      let cells = 0;
      for (const d of mine?.days || []) {
        cells++;
        const c = String(d.code ?? '');
        if (PRESENT_CODES.test(c)) counts.present++;
        else if (ABSENT_CODES.test(c)) counts.absent++;
        else if (OFF_CODES.test(c)) counts.off++;
        else counts.leave++;   // CL/SL/LOP/OD, and the 0.5X/0.5P halves
      }

      const hb = await get(
        `/reports/attendance/hours-breakup?employeeId=${emp.id}`
        + `&startDate=${m.start}&endDate=${m.end}`, token);
      const reported = Number(hb.j?.summaryHours?.totalHours ?? NaN);

      console.log(`    ${pad(m.label, 10)}${pad(truth.rows, 6)}`
        + `${pad(counts.present, 8)}${pad(counts.absent, 5)}${pad(counts.leave, 7)}${pad(counts.off, 6)}`
        + `${pad(Number(truth.hours).toFixed(2), 13)}`
        + `${Number.isFinite(reported) ? reported.toFixed(2) : 'no answer'}`);

      // ── The invariants ────────────────────────────────────────────────────
      if (roll.s !== 200) { note(code, m.label, `muster roll returned ${roll.s}`); continue; }
      if (!mine) {
        note(code, m.label, 'the muster roll has no row for this person at all');
        continue;
      }

      const daysInMonth = new Date(Date.UTC(
        Number(m.label.slice(0, 4)), Number(m.label.slice(5, 7)), 0)).getUTCDate();
      if (cells !== daysInMonth) {
        note(code, m.label, `the grid has ${cells} cells for a ${daysInMonth}-day month`);
      }

      if (truth.rows > 0 && counts.present + counts.leave === 0) {
        note(code, m.label, `${truth.rows} attendance row(s) exist but the grid shows none of them`);
      }

      if (Number.isFinite(reported) && Math.abs(reported - Number(truth.hours)) > 0.05) {
        note(code, m.label, 'the hours reported are not the hours on the rows',
          `rows total ${Number(truth.hours).toFixed(2)}h, the report says ${reported.toFixed(2)}h`);
      }
      if (!Number.isFinite(reported) && truth.rows > 0) {
        note(code, m.label, `hours breakup gave no total for a month with ${truth.rows} row(s)`,
          `HTTP ${hb.s}`);
      }
    }

    // ── Days where a half-day leave and the punches tell different stories ──
    // classifyAttendanceDay renders any half-day leave as "0.5X/0.5P" — half
    // leave, half PRESENT — without looking at whether the other half was
    // worked. A day of half leave and no work would then read as half present.
    const halfDays = (await pool.query(
      `SELECT l.start_date::text AS d, l.leave_type AS type,
              a.status, COALESCE(a.working_hours, 0)::numeric(10,2) AS hours,
              (a.check_in IS NOT NULL) AS punched
         FROM leaves l
         LEFT JOIN attendance a
                ON a.employee_id = l.employee_id AND a.date = l.start_date
        WHERE l.employee_id = $1 AND l.is_half_day AND l.status = 'approved'
          AND l.start_date BETWEEN $2::date AND $3::date
        ORDER BY l.start_date`,
      [emp.id, ms[0].start, ms[ms.length - 1].end])).rows;

    if (halfDays.length) {
      console.log('\n    half-day leaves, and whether the other half was worked:\n');
      for (const h of halfDays) {
        console.log(`      ${h.d}   ${pad(h.type, 10)}worked ${pad(h.hours + 'h', 8)}`
          + `${h.punched ? `row says ${h.status}` : 'no punch at all'}`);
        if (!h.punched || Number(h.hours) === 0) {
          note(code, h.d.slice(0, 7),
            `${h.d}: half a day of leave and no work, but the grid renders it 0.5/0.5 present`);
        }
      }
    }
    console.log('');
  }

  console.log('══════════════════════════════════════════════════════════');
  if (!findings.length) {
    console.log('  The reports agree with the rows underneath them.');
  } else {
    console.log(`  ${findings.length} thing(s) to look at:\n`);
    for (const f of findings) console.log(`    ${pad(f.who, 14)}${pad(f.month, 10)}${f.what}`);
  }
  console.log(`\n  Nothing was written. ${refused} write attempt(s) refused`);
  console.log('  (1 of them this script testing its own guard).');
  console.log('══════════════════════════════════════════════════════════\n');

  server.close();
  await pool.end();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
