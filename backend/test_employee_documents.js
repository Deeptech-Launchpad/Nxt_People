/* Employee documents: where they live, who can reach them, and whether the
 * bytes survive the round trip.
 *
 * The cases that matter here are all ones where a failure is silent:
 *
 *   1. A COLLEAGUE MUST NOT BE ABLE TO READ SOMEBODY'S PAPERS. The old
 *      /uploads/<random>.pdf checked only that the caller held some valid
 *      token, so any signed-in employee could fetch another's Aadhaar given
 *      the filename. The filename was the only secret.
 *   2. ENCRYPTED MEANS UNREADABLE ON DISK, AND IDENTICAL COMING BACK. An
 *      encryption that corrupts a certificate is worse than none: nobody
 *      notices until the day somebody needs the document.
 *   3. THE FOLDER CANNOT BE ESCAPED. A crafted or corrupted folder value must
 *      not read files outside the document tree.
 *   4. A MISSING FILE ANSWERS AS A MISSING FILE, not as a JSON error saved to
 *      the admin's disk under the document's own name — which is what live
 *      was doing.
 */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'silent';
process.env.DOCUMENT_ENCRYPTION_KEY = process.env.DOCUMENT_ENCRYPTION_KEY
  || 'test-key-for-the-suite-only-not-a-real-one';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('this test does not send mail'); },
  verify: async () => { throw new Error('this test does not send mail'); },
});

const fs = require('fs');
const path = require('path');
const http = require('http');
const jwt = require('jsonwebtoken');
const app = require('./app');
const pool = require('./db');
const store = require('./utils/documentStore');

const checks = [];
const check = (l, ok, x) => { checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '\n          ' + JSON.stringify(x).slice(0, 260)}`); };

let PORT = 0;
const call = (method, p, token, body, raw = false) => new Promise(resolve => {
  const data = body === undefined ? null : JSON.stringify(body);
  const req = http.request({ host: '127.0.0.1', port: PORT, path: '/api' + p, method,
    headers: { Authorization: 'Bearer ' + token,
      ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) } },
    res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let j = null; if (!raw) { try { j = JSON.parse(buf.toString()); } catch {} }
        resolve({ s: res.statusCode, j, buf, headers: res.headers });
      });
    });
  req.on('error', e => resolve({ s: 0, j: null, err: e.message }));
  if (data) req.write(data); req.end();
});

/* multipart by hand — the suite has no form-data dependency and this is the
 * only place that needs one. */
const uploadFile = (employeeId, token, { filename, content, name, type }) => new Promise(resolve => {
  const B = '----nxtdoctest' + Date.now();
  const parts = [];
  const field = (k, v) => parts.push(Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  field('name', name); field('type', type);
  parts.push(Buffer.from(
    `--${B}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: application/pdf\r\n\r\n`));
  parts.push(content);
  parts.push(Buffer.from(`\r\n--${B}--\r\n`));
  const body = Buffer.concat(parts);

  const req = http.request({ host: '127.0.0.1', port: PORT, path: `/api/documents/${employeeId}`, method: 'POST',
    headers: { Authorization: 'Bearer ' + token,
      'Content-Type': `multipart/form-data; boundary=${B}`, 'Content-Length': body.length } },
    res => { let d = ''; res.on('data', c => d += c);
      res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch {} resolve({ s: res.statusCode, j }); }); });
  req.on('error', e => resolve({ s: 0, j: null, err: e.message }));
  req.write(body); req.end();
});

const TAG = 'DOC' + Date.now().toString().slice(-6);
let OWNER = null, COLLEAGUE = null, docId = null, written = null;

const cleanup = async () => {
  for (const id of [OWNER, COLLEAGUE]) {
    if (!id) continue;
    const docs = await pool.query(
      `SELECT folder, stored_name AS "storedName" FROM employee_documents WHERE employee_id=$1`, [id]).catch(() => ({ rows: [] }));
    docs.rows.forEach(d => store.deleteDocument(d));
    await pool.query(`DELETE FROM employee_documents WHERE employee_id=$1`, [id]).catch(() => {});
    await pool.query(`DELETE FROM employees WHERE id=$1`, [id]).catch(() => {});
  }
  if (written?.folder) {
    try { fs.rmSync(path.join(store.EMPLOYEE_ROOT, written.folder), { recursive: true, force: true }); } catch {}
  }
};

(async () => {
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  PORT = server.address().port;

  OWNER = (await pool.query(
    `INSERT INTO employees (employee_id, first_name, last_name, email, role, status, is_user, login_enabled)
     VALUES ($1,'Doc','Owner',$2,'team_member','active',TRUE,TRUE) RETURNING id`,
    [TAG + '-OWN', `${TAG.toLowerCase()}o@example.invalid`])).rows[0].id;
  COLLEAGUE = (await pool.query(
    `INSERT INTO employees (employee_id, first_name, last_name, email, role, status, is_user, login_enabled)
     VALUES ($1,'Doc','Colleague',$2,'team_member','active',TRUE,TRUE) RETURNING id`,
    [TAG + '-COL', `${TAG.toLowerCase()}c@example.invalid`])).rows[0].id;

  const ownerToken = jwt.sign({ id: OWNER }, process.env.JWT_SECRET, { expiresIn: '10m' });
  const colleagueToken = jwt.sign({ id: COLLEAGUE }, process.env.JWT_SECRET, { expiresIn: '10m' });

  console.log('\nEmployee documents\n');

  /* 0 — the naming rules, before anything touches a disk. */
  {
    const folder = store.folderNameFor({ employeeId: 'ANXT2600149', firstName: 'Balaji', lastName: 'D' });
    check('the folder is ID then name', folder === 'ANXT2600149_Balaji_D', folder);

    const noLast = store.folderNameFor({ employeeId: 'ANXT220016', firstName: 'Balaji' });
    check('  ...and copes with no last name', noLast === 'ANXT220016_Balaji', noLast);

    const stored = store.storedNameFor({
      employeeId: 'ANXT2600149', originalName: '10th Certificate.pdf', label: '10th Certificate',
      dir: null, when: new Date('2026-09-03T10:00:00'),
    });
    check('the filename is ID, upload date, then the document',
      stored === 'ANXT2600149_2026-09-03_10th-Certificate.pdf', stored);
    check('  ...and carries no date of birth', !/19\d\d|20[01]\d-\d\d-\d\d.*19/.test(stored), stored);

    const nasty = store.safeName('../../../etc/passwd');
    check('a traversal in the name is flattened', !nasty.includes('..') && !nasty.includes('/'), nasty);
  }

  /* 1 — encryption is real, and reversible. */
  {
    const secret = Buffer.from('%PDF-1.4 this is the certificate body');
    const { data, encrypted } = store.encryptBuffer(secret);
    check('a file is encrypted when a key is set', encrypted === true);
    check('  ...and the plaintext is NOT in the stored bytes',
      !data.includes('this is the certificate body'), data.subarray(0, 24).toString('hex'));
    check('  ...and comes back byte for byte', store.decryptBuffer(data).equals(secret));

    const tampered = Buffer.from(data);
    tampered[tampered.length - 1] ^= 0xff;
    let threw = false;
    try { store.decryptBuffer(tampered); } catch { threw = true; }
    check('  ...and a tampered file refuses to open rather than returning rubbish', threw);
  }

  /* 2 — upload lands in the owner's folder under the right name. */
  {
    const body = Buffer.from('%PDF-1.4 owner certificate ' + TAG);
    const r = await uploadFile(OWNER, ownerToken, {
      filename: '10th Certificate.pdf', content: body, name: '10th Certificate', type: 'educational',
    });
    check('an employee can upload their own document', r.s === 201, { s: r.s, m: r.j?.message });
    docId = r.j?.data?._id;
    written = r.j?.data;

    check('  ...into a folder named for them',
      written?.folder === `${TAG}-OWN_Doc_Owner`, written?.folder);
    check('  ...under ID_date_name', /^DOC\d+-OWN_\d{4}-\d{2}-\d{2}_10th-Certificate\.pdf$/.test(written?.storedName || ''),
      written?.storedName);
    check('  ...and is recorded as encrypted', written?.isEncrypted === true, written?.isEncrypted);

    const onDisk = fs.readFileSync(path.join(store.EMPLOYEE_ROOT, written.folder, written.storedName));
    check('  ...and the plaintext is not readable on disk',
      !onDisk.includes('owner certificate'), onDisk.subarray(0, 16).toString('hex'));
  }

  /* 3 — THE ONE THAT MATTERS: a colleague cannot read it. */
  {
    const r = await call('GET', `/documents/${OWNER}/${docId}/file`, colleagueToken, undefined, true);
    check("a colleague cannot fetch somebody else's document", r.s === 403, r.s);

    const list = await call('GET', `/documents/${OWNER}`, colleagueToken);
    check('  ...nor even list what they have', list.s === 403, list.s);
  }

  /* 4 — the owner gets their file back, exactly. */
  {
    const r = await call('GET', `/documents/${OWNER}/${docId}/file`, ownerToken, undefined, true);
    check('the owner can download it', r.s === 200, r.s);
    check('  ...and it is the file they uploaded',
      r.buf.toString().includes('owner certificate ' + TAG), r.buf.subarray(0, 40).toString());
    check('  ...served as a PDF, not as JSON', r.headers['content-type'] === 'application/pdf', r.headers['content-type']);
    check('  ...as an attachment by default', /attachment/.test(r.headers['content-disposition'] || ''),
      r.headers['content-disposition']);

    const inline = await call('GET', `/documents/${OWNER}/${docId}/file?disposition=inline`, ownerToken, undefined, true);
    check('  ...and inline when previewing', /inline/.test(inline.headers['content-disposition'] || ''),
      inline.headers['content-disposition']);
  }

  /* 5 — a row whose file is gone says so. */
  {
    store.deleteDocument({ folder: written.folder, storedName: written.storedName });
    const r = await call('GET', `/documents/${OWNER}/${docId}/file`, ownerToken, undefined, true);
    check('a missing file answers 404', r.s === 404, r.s);
    let j = null; try { j = JSON.parse(r.buf.toString()); } catch {}
    check('  ...saying the record exists but the file does not',
      /missing from the server/i.test(j?.message || ''), j?.message);

    const flagged = await pool.query(
      `SELECT file_missing AS "m" FROM employee_documents WHERE id=$1`, [docId]);
    check('  ...and the row is marked so the list can warn before anyone clicks',
      flagged.rows[0]?.m === true, flagged.rows[0]);
  }

  /* 6 — the folder cannot be escaped. */
  {
    let threw = false;
    try { store.readDocument({ folder: '../../..', storedName: 'etc/passwd', encrypted: false }); }
    catch { threw = true; }
    check('a folder pointing outside the document tree is refused', threw);
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
