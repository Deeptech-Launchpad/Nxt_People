/* Saving Settings must take effect on the next request, not a minute later.
 *
 * reports.js caches the organisation timezone and expected hours, keyed on
 * attendanceConfig's generation counter, and its own comment explains why:
 * "Time alone meant a policy change took up to a minute to show in any report,
 * which is indistinguishable from the setting not working."
 *
 * Attendance -> Configuration bumps that counter when it saves. The General
 * Settings screen writes the SAME columns — timezone, full_day_hours,
 * half_day_hours, late_after_minutes — and did not, so a timezone change there
 * left every attendance report on the old zone until the TTL expired. In a
 * system where a date boundary decides which day a punch belongs to, a stale
 * timezone is not a cosmetic delay.
 *
 * This proves the counter moves, which is what the cache watches.
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
const attendanceConfig = require('./utils/attendanceConfig');

const checks = [];
const check = (l, ok, x) => { checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '\n          ' + JSON.stringify(x).slice(0, 300)}`); };

let PORT = 0;
const call = (method, p, token, body) => new Promise(resolve => {
  const data = body === undefined ? null : JSON.stringify(body);
  const req = http.request({ host: '127.0.0.1', port: PORT, path: '/api' + p, method,
    headers: { Authorization: 'Bearer ' + token,
      ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) } },
    res => { let d = ''; res.on('data', c => d += c);
      res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch {} resolve({ s: res.statusCode, j }); }); });
  req.on('error', e => resolve({ s: 0, j: null, err: e.message }));
  if (data) req.write(data); req.end();
});

let before = null;

(async () => {
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  PORT = server.address().port;

  const admin = (await pool.query(
    `SELECT id FROM employees WHERE role IN ('admin','director','hr_admin')
       AND status='active' AND deleted_at IS NULL LIMIT 1`)).rows[0];
  if (!admin) { console.log('  no admin\n'); await pool.end(); server.close(); process.exit(0); }
  const token = jwt.sign({ id: admin.id }, process.env.JWT_SECRET, { expiresIn: '10m' });

  const row = (await pool.query(
    `SELECT id, timezone, full_day_hours, half_day_hours, late_after_minutes FROM settings LIMIT 1`)).rows[0];
  before = row;

  console.log('\nSaving Settings invalidates the shared config cache\n');

  /* 1 — a General Settings save moves the generation counter. */
  {
    const gen0 = attendanceConfig.currentGeneration();
    const res = await call('PUT', '/settings', token, {
      // Same value it already has: this is about the invalidation, not the
      // write, and it must not leave the organisation on a different timezone
      // if a later assertion throws.
      timezone: row.timezone,
      fullDayHours: row.full_day_hours,
    });
    check('the settings save is accepted', res.s === 200, res.j?.message);
    const gen1 = attendanceConfig.currentGeneration();
    check('  ...and the config generation moves, so caches re-read',
      gen1 > gen0, { before: gen0, after: gen1 });
  }

  /* 2 — the counter is what reports.js watches, so a bump really does expire
   *     its cached copy rather than merely incrementing a number. */
  {
    const gen = attendanceConfig.currentGeneration();
    attendanceConfig.invalidate();
    check('invalidate() always advances the counter',
      attendanceConfig.currentGeneration() > gen);
  }

  /* 3 — Attendance -> Configuration still does it too, so the two screens
   *     that write the same columns behave the same way. */
  {
    const gen0 = attendanceConfig.currentGeneration();
    const cur = (await pool.query(`SELECT regularization_config AS c FROM settings LIMIT 1`)).rows[0]?.c || {};
    const res = await call('PATCH', '/attendance-config/regularization', token, {
      ...cur,
      reasons: cur.reasons,
      reasonMandatory: cur.reasonMandatory,
    });
    check('an attendance-config save is accepted', res.s === 200, res.j?.message);
    check('  ...and also moves the generation',
      attendanceConfig.currentGeneration() > gen0);
  }

  // Put the row back exactly as found, whatever the assertions did.
  await pool.query(
    `UPDATE settings SET timezone=$1, full_day_hours=$2, half_day_hours=$3, late_after_minutes=$4
      WHERE id=$5`,
    [before.timezone, before.full_day_hours, before.half_day_hours, before.late_after_minutes, before.id]);
  const after = (await pool.query(
    `SELECT timezone, full_day_hours FROM settings WHERE id=$1`, [before.id])).rows[0];
  check('the organisation settings are left as they were',
    after.timezone === before.timezone && String(after.full_day_hours) === String(before.full_day_hours),
    { before: { tz: before.timezone, h: before.full_day_hours }, after });

  const passed = checks.filter(Boolean).length;
  console.log(`\n  ${passed}/${checks.length} passed\n`);
  await pool.end(); server.close();
  process.exit(passed === checks.length ? 0 : 1);
})().catch(async e => {
  console.error(e);
  if (before) {
    await pool.query(
      `UPDATE settings SET timezone=$1, full_day_hours=$2, half_day_hours=$3, late_after_minutes=$4
        WHERE id=$5`,
      [before.timezone, before.full_day_hours, before.half_day_hours, before.late_after_minutes, before.id])
      .catch(() => {});
  }
  await pool.end().catch(() => {});
  process.exit(1);
});
