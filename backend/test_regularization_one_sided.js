/* ── "I forgot to check out" ────────────────────────────────────────────────
 *  Approving a regularization that supplies only ONE of the two times threw
 *  500 for everybody, every time:
 *
 *      null value in column "check_in" of relation "attendance_sessions"
 *      violates not-null constraint
 *
 *  The handler took the "add a second stint to this day" branch, which inserts
 *  a session row — and a session with no check-in is not a thing that table
 *  will hold. A one-sided request is not a second stint; it is completing the
 *  entry already there.
 *
 *  Fixing only the crash would not have been enough: hours were measured from
 *  the time on the REQUEST, which is null here, so the day would have been
 *  stamped with a check-out and still shown zero worked. It measures from the
 *  check-in already recorded instead, which is what the request means.
 *
 *  What has to hold:
 *
 *    a check-out-only request approves, and does not throw
 *    the day runs from the recorded check-in to the supplied check-out
 *    its hours are computed across that span, not left at zero
 *    a check-in-only request approves too
 *    a request supplying BOTH still takes the add-a-session path
 *    no session row is ever written with a null check-in
 *
 *  Every case builds a real day, runs the real route over HTTP, checks the
 *  attendance row, and removes everything it made. Sends no mail.
 *
 *    node test_regularization_one_sided.js
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
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
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}` +
    (ok || extra === undefined ? '' : '\n          ' + JSON.stringify(extra).slice(0, 200)));
};

const TZ = 'Asia/Kolkata';
const made = { regs: [], days: [] };

(async () => {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  Regularizations that supply only one time');
  console.log('══════════════════════════════════════════════════════════\n');

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

  /** A day with the given punches, then a regularization over it. */
  const scenario = async (date, existingIn, existingOut, regIn, regOut) => {
    await pool.query('DELETE FROM attendance WHERE employee_id=$1 AND date=$2::date', [emp.id, date]);
    made.days.push(date);
    if (existingIn) {
      await pool.query(
        `INSERT INTO attendance (employee_id, date, check_in, check_out, status, working_hours)
         VALUES ($1, $2::date,
                 (($2::date + $3::time) AT TIME ZONE '${TZ}' AT TIME ZONE 'UTC'),
                 CASE WHEN $4::time IS NULL THEN NULL
                      ELSE (($2::date + $4::time) AT TIME ZONE '${TZ}' AT TIME ZONE 'UTC') END,
                 'absent', 0)`,
        [emp.id, date, existingIn, existingOut]);
    }
    const r = await pool.query(
      `INSERT INTO attendance_regularizations (employee_id, date, check_in, check_out, reason, status)
       VALUES ($1, $2::date, $3, $4, 'one-sided test', 'pending') RETURNING id`,
      [emp.id, date, regIn, regOut]);
    made.regs.push(r.rows[0].id);

    const res = await fetch(`${base}/api/regularizations/${r.rows[0].id}/action`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approved' }),
    });
    const day = (await pool.query(
      `SELECT status, working_hours::float AS hours,
              TO_CHAR(check_in  AT TIME ZONE 'UTC' AT TIME ZONE '${TZ}', 'HH24:MI') AS cin,
              TO_CHAR(check_out AT TIME ZONE 'UTC' AT TIME ZONE '${TZ}', 'HH24:MI') AS cout
         FROM attendance WHERE employee_id=$1 AND date=$2::date`, [emp.id, date])).rows[0];
    const sessions = (await pool.query(
      `SELECT count(*)::int AS n, count(*) FILTER (WHERE check_in IS NULL)::int AS nulls,
              max(session_hours)::float AS max_hours
         FROM attendance_sessions WHERE employee_id=$1 AND date=$2::date`, [emp.id, date])).rows[0];
    return { status: res.status, day, sessions, sessionHours: sessions.max_hours };
  };

  console.log('  Forgot to check out — checked in 09:30, request supplies 18:00\n');
  const a = await scenario('2026-07-21', '09:30:00', null, null, '18:00:00');
  check('it approves instead of throwing 500', a.status === 200, a.status);
  check('the day keeps its recorded check-in', a.day?.cin === '09:30', a.day);
  check('and gains the supplied check-out', a.day?.cout === '18:00', a.day);
  check('hours are measured across the span, not left at zero',
    a.day?.hours === 8.5, a.day);
  check('no session row was written with a null check-in', a.sessions.nulls === 0, a.sessions);

  console.log('\n  Forgot to check in — request supplies 09:00, day already has 17:30\n');
  const b = await scenario('2026-07-22', '10:00:00', '17:30:00', '09:00:00', null);
  check('it approves', b.status === 200, b.status);
  check('the corrected check-in is applied', b.day?.cin === '09:00', b.day);
  check('the existing check-out is kept', b.day?.cout === '17:30', b.day);
  check('no null-check-in session', b.sessions.nulls === 0, b.sessions);

  console.log('\n  Both times supplied — still a second stint\n');
  /* Deliberately NOT round. 10:14 to 18:50 is 8.6 hours, and passing that into
   * COALESCE($n, 0) made Postgres type the parameter from the bare 0 as an
   * INTEGER and reject it outright. The first version of this test used
   * 14:00–18:00 — exactly 4 hours — which parses fine as an integer and hid the
   * bug completely. Real punches are never that tidy. */
  const c = await scenario('2026-07-23', '09:00:00', '09:45:00', '10:14:00', '18:50:00');
  check('it approves with fractional hours', c.status === 200, c.status);
  check('a session row is written for the second stint', c.sessions.n >= 1, c.sessions);
  check('and it has a check-in', c.sessions.nulls === 0, c.sessions);
  check('the fractional span is stored, not truncated or rejected',
    c.sessionHours !== null && Math.abs(c.sessionHours - 8.6) < 0.02, c.sessionHours);

  console.log('\n  No attendance row at all\n');
  const d = await scenario('2026-07-24', null, null, '09:30:00', '18:00:00');
  check('a day is created from the request', d.status === 200 && d.day?.cin === '09:30', d);

  server.close();

  // ── clean up everything this made ─────────────────────────────────────────
  await pool.query('DELETE FROM attendance_regularizations WHERE id = ANY($1::uuid[])', [made.regs]);
  for (const date of made.days) {
    const rows = (await pool.query(
      'SELECT id FROM attendance WHERE employee_id=$1 AND date=$2::date', [emp.id, date])).rows;
    for (const r of rows) await pool.query('DELETE FROM attendance_sessions WHERE attendance_id=$1', [r.id]);
    await pool.query('DELETE FROM attendance WHERE employee_id=$1 AND date=$2::date', [emp.id, date]);
  }
  const leftovers = (await pool.query(
    `SELECT count(*)::int AS n FROM attendance_regularizations WHERE reason = 'one-sided test'`)).rows[0].n;
  check('everything this test created was removed', leftovers === 0, { leftovers });

  const passed = checks.filter(Boolean).length;
  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  ${passed}/${checks.length} passed`);
  console.log('══════════════════════════════════════════════════════════\n');
  await pool.end();
  process.exit(passed === checks.length ? 0 : 1);
})().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
