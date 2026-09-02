/* Regularization attachments, and the setting that governs them.
 *
 * Settings -> Attendance -> Regularization has always offered a `document`
 * field. attendance_regularizations had nowhere to put one, so switching it on
 * changed nothing and nobody could tell — the same "saved but not configured"
 * trap as before.
 *
 * What has to hold:
 *
 *   1. A plain JSON request still works. multer sits in front of this route
 *      now, and a body parser that only understands multipart would break
 *      every existing caller.
 *   2. An attached file is stored, and the row points at it.
 *   3. With the document field switched OFF, a file that is sent anyway is
 *      DISCARDED — not quietly kept. A setting that only hides the control
 *      while still collecting documents is worse than no setting.
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
const fs = require('fs');
const path = require('path');
/* The route reads its configuration through a short-lived cache, and only the
 * settings route invalidates it. Writing straight to the table — which this
 * test does, to avoid depending on that route — leaves the server holding the
 * old value, so the change has to be announced. */
const attendanceConfig = require('./utils/attendanceConfig');

const checks = [];
const check = (l, ok, x) => { checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '\n          ' + JSON.stringify(x).slice(0, 300)}`); };

let PORT = 0;
const postJson = (p, token, body) => new Promise(resolve => {
  const data = JSON.stringify(body);
  const req = http.request({ host: '127.0.0.1', port: PORT, path: '/api' + p, method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data) } },
    res => { let d = ''; res.on('data', c => d += c);
      res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch {} resolve({ s: res.statusCode, j }); }); });
  req.on('error', e => resolve({ s: 0, j: null, err: e.message }));
  req.write(data); req.end();
});

// multipart by hand — no form-data dependency in this project.
const postFile = (p, token, fields, filename, contents) => new Promise(resolve => {
  const B = '----nxt' + Date.now();
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(Buffer.from(
    `--${B}\r\nContent-Disposition: form-data; name="attachment"; filename="${filename}"\r\n` +
    `Content-Type: application/pdf\r\n\r\n`));
  parts.push(Buffer.from(contents), Buffer.from(`\r\n--${B}--\r\n`));
  const payload = Buffer.concat(parts);
  const req = http.request({ host: '127.0.0.1', port: PORT, path: '/api' + p, method: 'POST',
    headers: { Authorization: 'Bearer ' + token,
      'Content-Type': `multipart/form-data; boundary=${B}`, 'Content-Length': payload.length } },
    res => { let d = ''; res.on('data', c => d += c);
      res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch {} resolve({ s: res.statusCode, j }); }); });
  req.on('error', e => resolve({ s: 0, j: null, err: e.message }));
  req.write(payload); req.end();
});

const made = [];
let restoreTo = null;   // the config as found, for the crash path
const uploadsDir = path.join(__dirname, 'uploads');
const iso = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toLocaleDateString('en-CA'); };

const cleanup = async () => {
  for (const id of made) {
    await pool.query('DELETE FROM approval_levels WHERE request_id=$1', [id]).catch(() => {});
    await pool.query('DELETE FROM attendance_regularizations WHERE id=$1', [id]).catch(() => {});
  }
};

(async () => {
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  PORT = server.address().port;

  const emp = (await pool.query(
    `SELECT id FROM employees WHERE role='team_member' AND status='active' AND deleted_at IS NULL
      ORDER BY created_at DESC LIMIT 1`)).rows[0];
  if (!emp) { console.log('  no employee\n'); await pool.end(); server.close(); process.exit(0); }
  const token = jwt.sign({ id: emp.id }, process.env.JWT_SECRET, { expiresIn: '10m' });

  // The setting is restored at the end whatever happens.
  // The section has its own column; it is not nested inside a wider blob.
  const before = (await pool.query(
    `SELECT regularization_config AS c FROM settings LIMIT 1`)).rows[0]?.c;
  restoreTo = before;

  console.log('\nRegularization attachments\n');

  /* The org allows one regularization a month, which is a real rule and not
   * what this file is testing. It is relaxed for the run and put back with
   * everything else at the end. */
  const withRestrictionsOff = JSON.parse(JSON.stringify(before || {}));
  withRestrictionsOff.restrictions = {
    ...(withRestrictionsOff.restrictions || {}),
    perPeriod: { ...(withRestrictionsOff.restrictions?.perPeriod || {}), enabled: false },
  };
  const applyConfig = async (c) => {
    await pool.query(
      `UPDATE settings SET regularization_config = $1::jsonb WHERE id = (SELECT id FROM settings LIMIT 1)`,
      [JSON.stringify(c)]);
    attendanceConfig.invalidate();
  };
  await applyConfig(withRestrictionsOff);

  /* 1 - a plain JSON request still works with multer in the chain. */
  {
    const r = await postJson('/regularizations', token,
      { date: iso(3), checkIn: '09:30', checkOut: '18:00', reason: 'Forgot to check-in' });
    check('a JSON request still works now multer sits in front', r.s === 201, r.j);
    if (r.j?.data?._id) made.push(r.j.data._id);
  }

  /* 2 - an attached file is stored and pointed at. */
  let storedPath = null;
  {
    const r = await postFile('/regularizations', token,
      { date: iso(4), checkIn: '09:30', checkOut: '18:00', reason: 'System Error' },
      'proof.pdf', '%PDF-1.4 test');
    check('a request with an attachment is accepted', r.s === 201, r.j);
    const id = r.j?.data?._id;
    if (id) made.push(id);

    if (id) {
      const row = (await pool.query(
        `SELECT attachment_path, attachment_name FROM attendance_regularizations WHERE id=$1`, [id])).rows[0];
      storedPath = row?.attachment_path;
      check('  ...the row records the file name it was given',
        row?.attachment_name === 'proof.pdf', row);
      check('  ...and a path under /uploads',
        !!storedPath && storedPath.startsWith('/uploads/'), storedPath);
      check('  ...and the file really is on disk',
        !!storedPath && fs.existsSync(path.join(uploadsDir, path.basename(storedPath))), storedPath);
    }
  }

  /* 3 - THE ONE THAT MATTERS: with the field off, a file is discarded. */
  {
    const next = JSON.parse(JSON.stringify(withRestrictionsOff));
    next.fields = next.fields || {};
    next.fields.document = { show: false, mandatory: false };
    await applyConfig(next);

    const filesBefore = fs.existsSync(uploadsDir)
      ? fs.readdirSync(uploadsDir).filter(f => f.startsWith('regularization-')).length : 0;

    const r = await postFile('/regularizations', token,
      { date: iso(5), checkIn: '09:30', checkOut: '18:00', reason: 'Forgot to check-out' },
      'sneaky.pdf', '%PDF-1.4 should not be kept');
    check('the request is still accepted with the document field off', r.s === 201, r.j);
    const id = r.j?.data?._id;
    if (id) made.push(id);

    if (id) {
      const row = (await pool.query(
        `SELECT attachment_path, attachment_name FROM attendance_regularizations WHERE id=$1`, [id])).rows[0];
      check('  ...but nothing is recorded against the row',
        !row?.attachment_path && !row?.attachment_name, row);

      const filesAfter = fs.existsSync(uploadsDir)
        ? fs.readdirSync(uploadsDir).filter(f => f.startsWith('regularization-')).length : 0;
      check('  ...and the uploaded file is not left on disk',
        filesAfter === filesBefore, { filesBefore, filesAfter });
    }

    // Put the setting back before anything else runs.
    await applyConfig(before || {});
    const restored = (await pool.query(
      `SELECT regularization_config AS c FROM settings LIMIT 1`)).rows[0]?.c;
    check('the document setting is restored',
      JSON.stringify(restored?.fields?.document) === JSON.stringify(before?.fields?.document),
      { was: before?.fields?.document, now: restored?.fields?.document });
  }

  // Remove the file the passing case wrote, so the directory does not grow.
  if (storedPath) fs.unlink(path.join(uploadsDir, path.basename(storedPath)), () => {});
  await cleanup();

  const passed = checks.filter(Boolean).length;
  console.log(`\n  ${passed}/${checks.length} passed\n`);
  await pool.end(); server.close();
  process.exit(passed === checks.length ? 0 : 1);
})().catch(async e => {
  console.error(e);
  await cleanup();
  // A crash must not leave the org's restrictions switched off.
  await pool.query(
    `UPDATE settings SET regularization_config = $1::jsonb WHERE id = (SELECT id FROM settings LIMIT 1)`,
    [JSON.stringify(restoreTo || {})]).catch(() => {});
  await pool.end().catch(() => {});
  process.exit(1);
});
