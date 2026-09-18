/* ── Two regularizations for one day ────────────────────────────────────────
 *  Found on live: one person had two approved requests for 2026-09-18 —
 *  10:29-19:15 and then 10:29-19:25, the second correcting the first — and the
 *  day ended up with 17.72 hours, which nobody worked. Entry mode is 'create',
 *  so each approval added a second STINT and its hours landed on top of the
 *  first. A third request would have added more.
 *
 *  A request over hours the day already covers is a correction of that stint.
 *  A request over hours it does not is a genuine second stint. Overlap is what
 *  tells them apart, and this pins both down:
 *
 *    correcting a stint leaves ONE stint and the corrected hours
 *    the day's check-out follows the correction, later or earlier
 *    a genuinely separate stint still adds, and hours still sum
 *    correcting a stint on a day with two stints leaves the other alone
 *    a one-sided "forgot to check out" still completes the day
 *
 *  Runs the real route over HTTP against nxt_people_demo, and removes
 *  everything it made. Sends no mail.
 *
 *    node test_regularization_double_count.js
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
process.env.DB_NAME = process.env.DB_NAME || 'nxt_people_demo';
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'silent';

const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('this test does not send mail'); },
  verify: async () => { throw new Error('this test does not send mail'); },
});

const jwt = require('jsonwebtoken');
const pool = require('./db');

const checks = [];
const check = (label, ok, extra) => {
  checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`
    + (ok || extra === undefined ? '' : '\n          ' + JSON.stringify(extra).slice(0, 220)));
};

const TZ = 'Asia/Kolkata';
const REASON = 'double-count test';
const made = { days: [] };

(async () => {
  console.log('\n  TWO REGULARIZATIONS FOR ONE DAY  [double-count v1]\n');

  const admin = (await pool.query(
    `SELECT id FROM employees WHERE role = 'admin' AND status = 'active' AND deleted_at IS NULL LIMIT 1`)).rows[0];
  const emp = (await pool.query(
    `SELECT id FROM employees WHERE status = 'active' AND deleted_at IS NULL AND id <> $1 LIMIT 1`,
    [admin.id])).rows[0];
  if (!admin || !emp) { console.log('  Needs an admin and one other employee.\n'); await pool.end(); return; }

  const token = jwt.sign({ id: admin.id }, process.env.JWT_SECRET, { expiresIn: '5m' });
  const app = require('./app');
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const day = async (date, checkIn, checkOut, hours) => {
    await pool.query('DELETE FROM attendance WHERE employee_id=$1 AND date=$2::date', [emp.id, date]);
    made.days.push(date);
    await pool.query(
      `INSERT INTO attendance (employee_id, date, check_in, check_out, status, working_hours)
       VALUES ($1, $2::date,
               (($2::date + $3::time) AT TIME ZONE '${TZ}' AT TIME ZONE 'UTC'),
               CASE WHEN $4::time IS NULL THEN NULL
                    ELSE (($2::date + $4::time) AT TIME ZONE '${TZ}' AT TIME ZONE 'UTC') END,
               'present', $5)`,
      [emp.id, date, checkIn, checkOut, hours || 0]);
  };

  const regularize = async (date, checkIn, checkOut) => {
    const r = await pool.query(
      `INSERT INTO attendance_regularizations (employee_id, date, check_in, check_out, reason, status)
       VALUES ($1, $2::date, $3, $4, $5, 'pending') RETURNING id`,
      [emp.id, date, checkIn, checkOut, REASON]);
    const res = await fetch(`${base}/api/regularizations/${r.rows[0].id}/action`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approved' }),
    });
    return res.status;
  };

  const readDay = async (date) => {
    const d = (await pool.query(
      `SELECT status, working_hours::float AS hours,
              TO_CHAR(check_in  AT TIME ZONE 'UTC' AT TIME ZONE '${TZ}', 'HH24:MI') AS cin,
              TO_CHAR(check_out AT TIME ZONE 'UTC' AT TIME ZONE '${TZ}', 'HH24:MI') AS cout
         FROM attendance WHERE employee_id=$1 AND date=$2::date`, [emp.id, date])).rows[0];
    const s = (await pool.query(
      `SELECT count(*)::int AS n, COALESCE(SUM(session_hours), 0)::float AS sum
         FROM attendance_sessions WHERE employee_id=$1 AND date=$2::date`, [emp.id, date])).rows[0];
    return { ...d, stints: s.n, stintHours: s.sum };
  };
  const near = (a, b) => a !== null && a !== undefined && Math.abs(a - b) < 0.02;

  // ── the live case ─────────────────────────────────────────────────────────
  console.log('  Checked in 10:29, forgot to check out. Two requests, the second correcting the first.\n');
  await day('2026-07-14', '10:29:00', null, 0);
  const s1 = await regularize('2026-07-14', '10:29:00', '19:15:00');
  const after1 = await readDay('2026-07-14');
  check('the first request approves', s1 === 200, s1);
  check('the day is 10:29 to 19:15', after1.cin === '10:29' && after1.cout === '19:15', after1);
  check('worth 8.77 hours', near(after1.hours, 8.7667), after1);

  const s2 = await regularize('2026-07-14', '10:29:00', '19:25:00');
  const after2 = await readDay('2026-07-14');
  check('the second request approves', s2 === 200, s2);
  check('the hours are the corrected 8.93, NOT 17.7', near(after2.hours, 8.9333), after2);
  check('the day ends at the corrected 19:25', after2.cout === '19:25', after2);
  check('the day was not counted as two stints', after2.stints <= 1, after2);

  // ── correcting downwards ──────────────────────────────────────────────────
  console.log('\n  A correction that makes the day shorter\n');
  const s3 = await regularize('2026-07-14', '10:29:00', '18:00:00');
  const after3 = await readDay('2026-07-14');
  check('it approves', s3 === 200, s3);
  check('the day now ends at 18:00, not the older 19:25', after3.cout === '18:00', after3);
  check('and is worth 7.52 hours', near(after3.hours, 7.5167), after3);

  // ── a genuine second stint ────────────────────────────────────────────────
  console.log('\n  A second stint that does not overlap the first\n');
  await day('2026-07-15', '09:00:00', '13:00:00', 4);
  const s4 = await regularize('2026-07-15', '18:00:00', '21:00:00');
  const after4 = await readDay('2026-07-15');
  check('it approves', s4 === 200, s4);
  check('the hours are both stints added up: 7', near(after4.hours, 7), after4);
  check('the day spans 09:00 to 21:00', after4.cin === '09:00' && after4.cout === '21:00', after4);

  console.log('\n  Correcting the evening stint leaves the morning one alone\n');
  const s5 = await regularize('2026-07-15', '18:00:00', '20:00:00');
  const after5 = await readDay('2026-07-15');
  check('it approves', s5 === 200, s5);
  check('the day is 4 + 2 = 6 hours, not 9', near(after5.hours, 6), after5);

  // ── one-sided, the case the older test pins down ───────────────────────────
  console.log('\n  "Forgot to check out" still completes the day\n');
  await day('2026-07-16', '09:30:00', null, 0);
  const s6 = await regularize('2026-07-16', null, '18:00:00');
  const after6 = await readDay('2026-07-16');
  check('it approves', s6 === 200, s6);
  check('the day runs 09:30 to 18:00 at 8.5 hours',
    after6.cin === '09:30' && after6.cout === '18:00' && near(after6.hours, 8.5), after6);

  server.close();

  // ── clean up ──────────────────────────────────────────────────────────────
  await pool.query('DELETE FROM attendance_regularizations WHERE reason = $1', [REASON]);
  for (const date of made.days) {
    const rows = (await pool.query(
      'SELECT id FROM attendance WHERE employee_id=$1 AND date=$2::date', [emp.id, date])).rows;
    for (const r of rows) await pool.query('DELETE FROM attendance_sessions WHERE attendance_id=$1', [r.id]);
    await pool.query('DELETE FROM attendance WHERE employee_id=$1 AND date=$2::date', [emp.id, date]);
  }
  const left = (await pool.query(
    `SELECT count(*)::int AS n FROM attendance_regularizations WHERE reason = $1`, [REASON])).rows[0].n;
  check('everything this test created was removed', left === 0, { left });

  console.log(`\n  ${checks.filter(Boolean).length}/${checks.length} passed\n`);
  await pool.end();
})().catch(async (e) => { console.error(e); await pool.end().catch(() => {}); });
