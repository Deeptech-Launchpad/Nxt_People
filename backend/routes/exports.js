/**
 * routes/exports.js
 *
 * "Password protection for file export", on both Leave Tracker > Configuration
 * > Additional Options and Attendance > Configuration > Additional Options.
 * The screens describe it exactly: once enabled, files with that data are sent
 * to your email, encrypted with a password.
 *
 * Reports are built in the browser — every one of them assembles its own
 * workbook from data it already holds — so duplicating that on the server to
 * deliver it by mail would mean writing every report twice and keeping the two
 * in step forever. Instead the browser hands over the workbook it has already
 * made and this encrypts and posts it.
 *
 * The password is generated here and returned in the response rather than
 * mailed. A password sent in the same channel as the file it protects protects
 * nothing; returning it to the session that asked means the file in the
 * mailbox is useless to anyone who did not run the export.
 */
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const archiver = require('archiver');
const { protect } = require('../middleware/auth');
const pool = require('../db');
const logger = require('../logger');
const { sendMail } = require('../utils/mailer');
const { serverError } = require('../utils/serverError');

archiver.registerFormat('zip-encrypted', require('archiver-zip-encrypted'));

router.use(protect);

// A workbook is small; anything approaching this is not one. The ceiling is
// set against the 10mb JSON body limit in app.js rather than picked freely:
// base64 inflates by a third, so anything over about 7MB is refused by Express
// before this handler runs, and the caller would get a body-size error instead
// of the clear message below.
const MAX_BYTES = 7 * 1024 * 1024;

const SOURCES = {
  attendance: { column: 'attendance_additional_config', key: 'passwordProtectExport', label: 'attendance' },
  leave: { column: 'leave_additional_config', key: 'passwordProtectExports', label: 'leave' },
};

/** Readable, unambiguous, and long enough to be worth having. */
function makePassword() {
  // No O/0 or I/l — this gets read off a screen and typed into a zip prompt.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(16);
  return [...bytes].map(b => alphabet[b % alphabet.length]).join('');
}

/** A filename safe to put in a mail header, and to save from one. */
function sanitiseName(raw) {
  const cleaned = String(raw || '')
    .replace(/[\\/]+/g, '_')       // no path separators
    .replace(/[^\w.\- ]+/g, '_')   // nothing exotic
    .replace(/^[.\s]+/, '')        // no leading dots: no '..', no hidden file
    .replace(/\.{2,}/g, '.')   // no '..' anywhere, separators or not
    .replace(/_{2,}/g, '_')
    .trim()
    .slice(0, 120);
  return cleaned || 'export.xlsx';
}

function encryptedZip(filename, contents, password) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const zip = archiver.create('zip-encrypted', {
      zlib: { level: 9 },
      encryptionMethod: 'aes256',
      password,
    });
    zip.on('data', c => chunks.push(c));
    zip.on('error', reject);
    zip.on('end', () => resolve(Buffer.concat(chunks)));
    zip.append(contents, { name: filename });
    zip.finalize();
  });
}

// POST /api/exports/protected — { kind, filename, contentBase64 }
router.post('/protected', async (req, res) => {
  try {
    const { kind, filename, contentBase64 } = req.body || {};
    const source = SOURCES[kind];
    if (!source) {
      return res.status(400).json({ success: false, message: 'Unknown export kind' });
    }
    if (!contentBase64 || typeof contentBase64 !== 'string') {
      return res.status(400).json({ success: false, message: 'No file was sent' });
    }

    // The setting is checked here as well as in the browser. A client that
    // asks for this while the setting is off would otherwise be able to post
    // arbitrary attachments through the organisation's mail server.
    const cfg = (await pool.query(
      `SELECT ${source.column} AS c FROM settings LIMIT 1`)).rows[0]?.c || {};
    if (!cfg[source.key]) {
      return res.status(400).json({
        success: false,
        message: `Password protection for ${source.label} exports is switched off`,
      });
    }

    const contents = Buffer.from(contentBase64, 'base64');
    if (!contents.length) {
      return res.status(400).json({ success: false, message: 'The file was empty' });
    }
    if (contents.length > MAX_BYTES) {
      return res.status(413).json({ success: false, message: 'That export is too large to email' });
    }

    const me = (await pool.query(
      `SELECT email, TRIM(CONCAT(first_name, ' ', last_name)) AS name FROM employees WHERE id = $1`,
      [req.user._id])).rows[0];
    if (!me?.email) {
      return res.status(400).json({ success: false, message: 'Your account has no email address to send to' });
    }

    // The attachment name is never used as a path here, but it lands in a
    // Content-Disposition that some mail client will turn into a filename, so
    // separators and leading dots are removed rather than merely escaped.
    const safeName = sanitiseName(filename);
    const password = makePassword();
    const zip = await encryptedZip(safeName, contents, password);

    await sendMail({
      to: me.email,
      subject: `Your ${source.label} export`,
      text: `Hi ${me.name},\n\nThe ${source.label} export you asked for is attached, in a password-protected zip.\n\n`
          + `The password is shown in NxtPeople on the screen you started the export from. It is deliberately not in this email — a password sent alongside the file it protects protects nothing.\n`,
      html: `<p>Hi ${me.name},</p>`
          + `<p>The ${source.label} export you asked for is attached, in a password-protected zip.</p>`
          + `<p>The password is shown in NxtPeople on the screen you started the export from. It is deliberately not in this email &mdash; a password sent alongside the file it protects protects nothing.</p>`,
      attachments: [{ filename: `${safeName.replace(/\.[^.]+$/, '')}.zip`, content: zip }],
    });

    logger.info({ kind, bytes: contents.length, to: me.email }, '[exports] protected export mailed');
    res.json({ success: true, password, sentTo: me.email });
  } catch (err) { serverError(res, err, 'protected export'); }
});

module.exports = router;
