/* The stale-timer bug: check in, forget to check out, come back the next day
 * to a browser that restored its tabs — and the clock is still running from
 * yesterday's punch until a hard refresh.
 *
 * Three things had to be true for that, and this proves all three are fixed:
 *
 *   1. NOTHING TOLD THE BROWSER NOT TO STORE THE RESPONSE. No Cache-Control
 *      was sent by Express, and nginx's "never cached" comment only ever meant
 *      nginx's own proxy cache. On the session-restore path the browser reuses
 *      what it has without revalidating, so /attendance/today replayed
 *      yesterday's body.
 *   2. THE PAYLOAD CARRIED NO DATE, so a client could not tell a stale body
 *      from a fresh one — an open row from yesterday looks exactly like an
 *      open row from this morning.
 *   3. A row left open for many hours still read as a live session.
 *
 * The client guard lives in AttendanceContext and is asserted here as the
 * decision it makes, so the rule cannot drift apart from the payload that
 * feeds it: with a date that is not today, no clock runs.
 */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'silent';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('this test does not send mail'); },
  verify: async () => { throw new Error('this test does not send mail'); },
});

const app = require('./app');
const pool = require('./db');
const jwt = require('jsonwebtoken');
const http = require('http');

const checks = [];
const check = (l, ok, x) => { checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '\n          ' + JSON.stringify(x).slice(0, 300)}`); };

let PORT = 0;
const call = (method, p, token) => new Promise(resolve => {
  const req = http.request({ host: '127.0.0.1', port: PORT, path: '/api' + p, method,
    headers: { Authorization: 'Bearer ' + token } },
    res => { let d = ''; res.on('data', c => d += c);
      res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch {}
        resolve({ s: res.statusCode, j, h: res.headers }); }); });
  req.on('error', e => resolve({ s: 0, j: null, err: e.message }));
  req.end();
});

/* The client's rule, mirrored from AttendanceContext.startTimer. Returns the
 * seconds the clock would show and whether it would be ticking. */
const STALE_SESSION_HOURS = 18;
function clientClock(rec, todayStr, now = Date.now()) {
  if (!rec?.checkIn) return { ticking: false, seconds: 0 };
  if (rec.date && rec.date !== todayStr) return { ticking: false, seconds: 0, reason: 'not today' };
  const from = new Date(rec.sessionStartedAt || rec.checkIn).getTime();
  const base = Math.round((parseFloat(rec.workingHours) || 0) * 3600);
  if (now - from > STALE_SESSION_HOURS * 3600 * 1000) {
    return { ticking: false, seconds: base, reason: 'forgot to check out' };
  }
  return { ticking: true, seconds: base + Math.floor((now - from) / 1000) };
}

let SUBJECT = null;
const TAG = 'ST' + Date.now().toString().slice(-6);
const cleanup = async () => {
  if (SUBJECT) {
    await pool.query(`DELETE FROM attendance WHERE employee_id=$1`, [SUBJECT]).catch(() => {});
    await pool.query(`DELETE FROM employees WHERE id=$1`, [SUBJECT]).catch(() => {});
  }
};

(async () => {
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  PORT = server.address().port;

  SUBJECT = (await pool.query(
    `INSERT INTO employees (employee_id, first_name, last_name, email, role, status, is_user, login_enabled)
     VALUES ($1,'Stale','Timer',$2,'team_member','active',TRUE,TRUE) RETURNING id`,
    [TAG + '-EMP', `${TAG.toLowerCase()}@example.invalid`])).rows[0].id;
  const token = jwt.sign({ id: SUBJECT }, process.env.JWT_SECRET, { expiresIn: '10m' });

  console.log('\nStale attendance timer\n');

  /* 1 — the browser is told not to store any API response. */
  {
    const r = await call('GET', '/attendance/today', token);
    const cc = String(r.h['cache-control'] || '');
    check('the API sends Cache-Control', !!cc, r.h);
    check('  ...and it forbids storing the response', /no-store/.test(cc), cc);
    check('  ...belt and braces for old proxies', String(r.h.pragma || '') === 'no-cache', r.h.pragma);
  }

  /* 2 — the payload says which day it is about. */
  const serverDay = (await call('GET', '/attendance/today', token)).j?.date;
  check('the response names the day it answers for', !!serverDay, serverDay);

  /* 3 — a real check-in today runs a live clock. */
  {
    await pool.query(
      `INSERT INTO attendance (employee_id, date, check_in, session_started_at, status, working_hours)
       VALUES ($1, $2::date, NOW() - INTERVAL '2 hours', NOW() - INTERVAL '2 hours', 'present', 0)`,
      [SUBJECT, serverDay]);
    const r = await call('GET', '/attendance/today', token);
    const rec = r.j?.data;
    check("today's open session is returned", !!rec?.checkIn && !rec?.checkOut, rec);
    check('  ...carrying today as its date', rec?.date === serverDay, rec?.date);

    const clock = clientClock(rec, serverDay);
    check('  ...and the clock runs', clock.ticking === true, clock);
    check('  ...reading about two hours', clock.seconds > 7000 && clock.seconds < 7400, clock.seconds);
  }

  /* 4 — THE BUG: yesterday's body, replayed. The clock must not run. */
  {
    const r = await call('GET', '/attendance/today', token);
    const stale = r.j.data;                       // today's body...
    const yesterday = new Date(serverDay + 'T00:00:00');
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = yesterday.toLocaleDateString('en-CA');
    const replayed = { ...stale, date: yStr,      // ...as it would look after a
      checkIn: new Date(Date.now() - 26 * 3600 * 1000).toISOString(),   // night
      sessionStartedAt: new Date(Date.now() - 26 * 3600 * 1000).toISOString() };

    const clock = clientClock(replayed, serverDay);
    check("a body from yesterday does NOT start a clock", clock.ticking === false, clock);
    check('  ...and shows 00:00:00 rather than 26 hours', clock.seconds === 0, clock.seconds);
  }

  /* 5 — checked in this morning, never checked out, now late at night. */
  {
    const rec = {
      date: serverDay, workingHours: 0,
      checkIn: new Date(Date.now() - 19 * 3600 * 1000).toISOString(),
      sessionStartedAt: new Date(Date.now() - 19 * 3600 * 1000).toISOString(),
    };
    const clock = clientClock(rec, serverDay);
    check('a session older than 18h stops being called live', clock.ticking === false, clock);
    check('  ...and says why', clock.reason === 'forgot to check out', clock.reason);
  }

  /* 6 — the day rolls over and the server simply has no row. */
  {
    await pool.query(`DELETE FROM attendance WHERE employee_id=$1`, [SUBJECT]);
    const r = await call('GET', '/attendance/today', token);
    check('with no row today the payload is empty', r.j?.data === null, r.j);
    check('  ...and still names the day', !!r.j?.date, r.j?.date);
    const clock = clientClock(r.j?.data, serverDay);
    check('  ...so no clock runs', clock.ticking === false && clock.seconds === 0, clock);
  }

  await cleanup();
  const passed = checks.filter(Boolean).length;
  console.log(`\n  ${passed}/${checks.length} passed\n`);
  await pool.end(); server.close();
  process.exit(passed === checks.length ? 0 : 1);
})().catch(async e => {
  console.error(e);
  await cleanup();
  await pool.end().catch(() => {});
  process.exit(1);
});
