/* Where a punch happened, and what that makes the day.
 *
 * This decides how somebody's attendance is recorded, so the cases that must
 * hold are the ones where a wrong answer is invisible:
 *
 *   1. OFF MEANS OFF. Until an administrator switches classification on, no
 *      punch carries a mode at all. A feature that quietly stamps every row
 *      while "disabled" is not disabled.
 *   2. A PUNCH WE CANNOT PLACE IS NOT WFH. No fix, a refused permission, or a
 *      fix vaguer than the fence it is measured against are all "we do not
 *      know". Turning that into working-from-home writes a guess into a
 *      record that may carry different pay.
 *   3. THE RADIUS IS PER LOCATION. An org sets a default; a location may
 *      override it; changing the default moves every location that never did.
 *   4. Nobody is classified by what their browser claims. The mode is
 *      computed from the coordinates server-side, so a client asserting
 *      "office" gets whatever the distance says.
 *   5. A remote employee stays remote even standing in the office car park.
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
const { distanceMeters, classifyPunch } = require('./utils/geofence');

const checks = [];
const check = (l, ok, x) => { checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '\n          ' + JSON.stringify(x).slice(0, 280)}`); };

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

/* The real office, and points a measured distance from it. Saibaba Colony,
 * Coimbatore — the location this organisation actually uses. */
const OFFICE = { lat: 11.0168, lng: 76.9558 };
/* 0.00090 degrees of latitude is very close to 100 m anywhere on Earth. */
const northOf = (metres) => ({ lat: OFFICE.lat + (metres / 111320), lng: OFFICE.lng });

const TAG = 'GF' + Date.now().toString().slice(-6);
let LOC = null, LOC2 = null, EMP = null, REMOTE = null, savedCfg = null;

const cleanup = async () => {
  for (const id of [EMP, REMOTE]) {
    if (!id) continue;
    await pool.query(`DELETE FROM attendance WHERE employee_id=$1`, [id]).catch(() => {});
    await pool.query(`DELETE FROM employees WHERE id=$1`, [id]).catch(() => {});
  }
  for (const id of [LOC, LOC2]) {
    if (id) await pool.query(`DELETE FROM work_locations WHERE id=$1`, [id]).catch(() => {});
  }
  if (savedCfg !== null) {
    await pool.query(`UPDATE settings SET geofence_config = $1::jsonb`, [JSON.stringify(savedCfg)]).catch(() => {});
  }
};

const setCfg = (patch) => pool.query(
  `UPDATE settings SET geofence_config = COALESCE(geofence_config, '{}'::jsonb) || $1::jsonb`,
  [JSON.stringify(patch)]);

(async () => {
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  PORT = server.address().port;

  savedCfg = (await pool.query(`SELECT geofence_config AS c FROM settings LIMIT 1`)).rows[0]?.c || {};

  const admin = (await pool.query(
    `SELECT id FROM employees WHERE role IN ('admin','director','hr_admin')
       AND status='active' AND deleted_at IS NULL LIMIT 1`)).rows[0];
  if (!admin) { console.log('  need a full-access user\n'); await pool.end(); server.close(); process.exit(0); }
  const adminToken = jwt.sign({ id: admin.id }, process.env.JWT_SECRET, { expiresIn: '10m' });

  EMP = (await pool.query(
    `INSERT INTO employees (employee_id, first_name, last_name, email, role, status, is_user, login_enabled)
     VALUES ($1,'Geo','Office',$2,'team_member','active',TRUE,TRUE) RETURNING id`,
    [TAG + '-EMP', `${TAG.toLowerCase()}e@example.invalid`])).rows[0].id;
  REMOTE = (await pool.query(
    `INSERT INTO employees (employee_id, first_name, last_name, email, role, status, is_user, login_enabled, is_remote)
     VALUES ($1,'Geo','Remote',$2,'team_member','active',TRUE,TRUE,TRUE) RETURNING id`,
    [TAG + '-REM', `${TAG.toLowerCase()}r@example.invalid`])).rows[0].id;

  console.log('\nLocation geofencing\n');

  /* 0 — the distance itself. Everything rests on this being right. */
  {
    check('100 m north measures as 100 m',
      Math.abs(distanceMeters(OFFICE.lat, OFFICE.lng, northOf(100).lat, northOf(100).lng) - 100) <= 1,
      distanceMeters(OFFICE.lat, OFFICE.lng, northOf(100).lat, northOf(100).lng));
    check('  ...and 1 km north as 1 km',
      Math.abs(distanceMeters(OFFICE.lat, OFFICE.lng, northOf(1000).lat, northOf(1000).lng) - 1000) <= 3,
      distanceMeters(OFFICE.lat, OFFICE.lng, northOf(1000).lat, northOf(1000).lng));
    check('  ...and the same point is zero away from itself',
      distanceMeters(OFFICE.lat, OFFICE.lng, OFFICE.lat, OFFICE.lng) === 0);
  }

  /* 1 — off means off. */
  {
    await setCfg({ classifyEnabled: false });
    const r = await classifyPunch({ latitude: OFFICE.lat, longitude: OFFICE.lng, accuracy: 10 });
    check('with classification off, no punch carries a mode', r.mode === null, r);
  }

  /* 2 — a location with a point, and the default fence. */
  {
    LOC = (await pool.query(
      `INSERT INTO work_locations (name, latitude, longitude, is_active, geofence_enabled)
       VALUES ($1, $2, $3, TRUE, TRUE) RETURNING id`,
      [TAG + ' Office', OFFICE.lat, OFFICE.lng])).rows[0].id;
    await setCfg({ classifyEnabled: true, defaultRadiusMeters: 300, requireAccuracy: true, unknownCountsAs: 'unknown' });

    const inside = await classifyPunch({ latitude: northOf(100).lat, longitude: northOf(100).lng, accuracy: 10 });
    check('100 m from the office is office', inside.mode === 'office', inside);
    check('  ...and names which location', inside.locationId === LOC, inside.locationName);

    const outside = await classifyPunch({ latitude: northOf(900).lat, longitude: northOf(900).lng, accuracy: 10 });
    check('900 m away is working from home', outside.mode === 'wfh', outside);
    check('  ...and says how far', outside.distance > 850 && outside.distance < 950, outside.distance);
  }

  /* 3 — the radius is configurable, per location and org-wide. */
  {
    await pool.query(`UPDATE work_locations SET radius_meters = 1000 WHERE id=$1`, [LOC]);
    const r = await classifyPunch({ latitude: northOf(900).lat, longitude: northOf(900).lng, accuracy: 10 });
    check('widening THIS location to 1 km makes the same punch office', r.mode === 'office', r);

    await pool.query(`UPDATE work_locations SET radius_meters = NULL WHERE id=$1`, [LOC]);
    await setCfg({ defaultRadiusMeters: 1000 });
    const r2 = await classifyPunch({ latitude: northOf(900).lat, longitude: northOf(900).lng, accuracy: 10 });
    check('  ...and so does raising the organisation default', r2.mode === 'office', r2);

    await setCfg({ defaultRadiusMeters: 300 });
    const r3 = await classifyPunch({ latitude: northOf(900).lat, longitude: northOf(900).lng, accuracy: 10 });
    check('  ...and lowering it back makes it home again', r3.mode === 'wfh', r3);
  }

  /* 4 — THE ONE THAT MATTERS: we do not guess. */
  {
    const noFix = await classifyPunch({ latitude: null, longitude: null, accuracy: null });
    check('a punch with no location is unknown, NOT working from home',
      noFix.mode === 'unknown' && noFix.unknown === true, noFix);

    const vague = await classifyPunch({ latitude: northOf(100).lat, longitude: northOf(100).lng, accuracy: 800 });
    check('a fix vaguer than the fence is unknown, not office',
      vague.mode === 'unknown', vague);
    check('  ...and says why in words a person can act on',
      /accurate to 800 m/.test(vague.reason || ''), vague.reason);

    const precise = await classifyPunch({ latitude: northOf(100).lat, longitude: northOf(100).lng, accuracy: 20 });
    check('  ...while a good fix at the same spot is office', precise.mode === 'office', precise);
  }

  /* 5 — a remote employee is not measured against a building. */
  {
    const r = await classifyPunch({
      latitude: OFFICE.lat, longitude: OFFICE.lng, accuracy: 5,
      employee: { isRemote: true },
    });
    check('a remote employee standing AT the office is still remote', r.mode === 'wfh', r);
  }

  /* 6 — two offices: the nearer one wins and is named. */
  {
    const far = northOf(5000);
    LOC2 = (await pool.query(
      `INSERT INTO work_locations (name, latitude, longitude, is_active, geofence_enabled, radius_meters)
       VALUES ($1, $2, $3, TRUE, TRUE, 300) RETURNING id`,
      [TAG + ' Second', far.lat, far.lng])).rows[0].id;

    const atSecond = await classifyPunch({ latitude: far.lat, longitude: far.lng, accuracy: 10 });
    check('a punch at the second office is office there', atSecond.locationId === LOC2, atSecond);

    const atFirst = await classifyPunch({ latitude: OFFICE.lat, longitude: OFFICE.lng, accuracy: 10 });
    check('  ...and one at the first is still the first', atFirst.locationId === LOC, atFirst);
  }

  /* 7 — the admin's "test from where I am" agrees with the real thing. */
  {
    const t = await call('POST', '/org-setup/geofence/test', adminToken,
      { latitude: northOf(100).lat, longitude: northOf(100).lng, accuracy: 10 });
    check('the pin test reports inside', t.j?.data?.verdict === 'inside', t.j?.data?.message);

    const t2 = await call('POST', '/org-setup/geofence/test', adminToken,
      { latitude: northOf(900).lat, longitude: northOf(900).lng, accuracy: 10 });
    check('  ...and outside, in words', t2.j?.data?.verdict === 'outside', t2.j?.data?.message);

    const t3 = await call('POST', '/org-setup/geofence/test', adminToken,
      { latitude: northOf(100).lat, longitude: northOf(100).lng, accuracy: 900 });
    check('  ...and refuses to answer on a vague fix, like the punch would',
      t3.j?.data?.verdict === 'too-vague', t3.j?.data?.message);
  }

  /* 8 — a real check-in stores the answer, and cannot be told what to store. */
  {
    await pool.query(`DELETE FROM attendance WHERE employee_id=$1`, [EMP]);
    const empToken = jwt.sign({ id: EMP }, process.env.JWT_SECRET, { expiresIn: '10m' });
    const r = await call('POST', '/attendance/checkin', empToken, {
      latitude: northOf(900).lat, longitude: northOf(900).lng, accuracy: 10,
      /* The client insisting it is at the office. It is not. */
      workMode: 'office', location: undefined,
    });
    check('a check-in outside the fence is allowed', r.s === 200 || r.s === 201, { s: r.s, m: r.j?.message });

    const row = (await pool.query(
      `SELECT work_mode AS mode, location_distance_meters AS distance, work_location_resolved_id AS loc
         FROM attendance WHERE employee_id=$1`, [EMP])).rows[0];
    check('  ...and is recorded as working from home', row?.mode === 'wfh', row);
    check('  ...whatever the client claimed', row?.loc === null, row);
    check('  ...with the distance kept', Number(row?.distance) > 850, row?.distance);
  }

  /* 9 — switching it on with nowhere placed is refused. */
  {
    await pool.query(`UPDATE work_locations SET latitude=NULL, longitude=NULL WHERE id IN ($1,$2)`, [LOC, LOC2]);
    await setCfg({ classifyEnabled: false });
    const r = await call('PUT', '/org-setup/geofence/config', adminToken, { classifyEnabled: true });
    check('switching classification on with no location placed is refused',
      r.s === 400, r.j?.message);
    check('  ...explaining that every punch would be unknown',
      /unknown/i.test(r.j?.message || ''), r.j?.message);
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
