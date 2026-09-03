const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const pool = require('../db');
const { protect } = require('../middleware/auth');
const { isFullAccess, isManager } = require('../utils/roles');
const { serverError } = require('../utils/serverError');
const { logAudit } = require('../utils/audit');
const store = require('../utils/documentStore');

/* Employee documents.
 *
 * Files are held per employee, named after them and the day they arrived, and
 * encrypted where a key is configured — see utils/documentStore.js for why.
 *
 * THE BYTES ARE NOT SERVED BY A STATIC HANDLER ANY MORE. They used to sit at
 * /uploads/<random>.pdf behind a check that the caller held SOME valid token,
 * which meant any signed-in employee could read a colleague's Aadhaar given
 * the filename. They now come through GET /:employeeId/:docId/file, which
 * asks whether this caller is entitled to THIS employee's papers, and writes
 * down that they looked.
 */
router.use(protect);

/* Into memory, not onto disk: the file has to be encrypted before it is
 * written, and a plaintext copy landing in a temp directory first would
 * defeat the point. 10 MB matches the previous limit. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png', '.xlsx', '.xls'];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
  },
});

const MIME = {
  '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

// Full-access (Super Admin / HR) can act on anyone's documents; a manager only
// on their direct reports'; employees only on their own.
const ownsFolder = (req) => req.user._id === req.params.employeeId;
async function isPrivilegedFor(req, employeeId) {
  if (isFullAccess(req.user.role)) return true;
  if (isManager(req.user.role)) {
    const r = await pool.query(
      `SELECT 1 FROM employees WHERE id = $1 AND (reporting_manager_id = $2 OR approving_authority_id = $2)`,
      [employeeId, req.user._id]
    );
    return r.rows.length > 0;
  }
  return false;
}
const mayReach = async (req) => ownsFolder(req) || await isPrivilegedFor(req, req.params.employeeId);

// GET documents for an employee
router.get('/:employeeId', async (req, res) => {
  try {
    if (!(await mayReach(req))) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    const r = await pool.query(
      `SELECT d.id AS "_id", d.name, d.type, d.file_url AS "fileUrl",
              d.file_size AS "fileSize", d.created_at AS "createdAt",
              d.folder, d.stored_name AS "storedName",
              d.is_encrypted AS "isEncrypted", d.file_missing AS "fileMissing",
              CASE WHEN e.id IS NULL THEN NULL
                ELSE json_build_object('firstName', e.first_name, 'lastName', e.last_name)
              END AS "uploadedBy"
         FROM employee_documents d
         LEFT JOIN employees e ON d.uploaded_by = e.id
        WHERE d.employee_id = $1
        ORDER BY d.created_at DESC NULLS LAST`,
      [req.params.employeeId]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { serverError(res, err); }
});

/* GET the file itself.
 *
 * ?disposition=inline previews in the browser; anything else downloads. Both
 * go through the same entitlement check and both are written to the audit
 * trail — reading somebody's identity document is exactly the action worth
 * being able to account for afterwards.
 *
 * A row whose bytes are gone answers 404 with a sentence saying so, rather
 * than the old behaviour: a JSON error saved to the admin's disk under the
 * document's own name, with nothing on screen to say it had failed.
 */
router.get('/:employeeId/:docId/file', async (req, res) => {
  try {
    if (!(await mayReach(req))) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    const r = await pool.query(
      `SELECT id, name, folder, stored_name AS "storedName", is_encrypted AS "isEncrypted",
              file_missing AS "fileMissing", file_url AS "fileUrl", type
         FROM employee_documents WHERE id = $1 AND employee_id = $2`,
      [req.params.docId, req.params.employeeId]);
    const doc = r.rows[0];
    if (!doc) return res.status(404).json({ success: false, message: 'That document is not on file' });

    if (doc.fileMissing || (!doc.storedName && !doc.fileUrl)) {
      return res.status(404).json({
        success: false,
        message: 'The record for this document exists but the file itself is missing from the server.',
      });
    }

    let buffer = null;
    if (doc.storedName) {
      buffer = store.readDocument({
        folder: doc.folder, storedName: doc.storedName, encrypted: doc.isEncrypted,
      });
    } else {
      /* Not migrated yet: still flat under uploads/ with a random name. Read
       * in place so nothing breaks between deploying this and running the
       * migration. */
      const legacy = path.join(store.ROOT, path.basename(String(doc.fileUrl)));
      const fs = require('fs');
      buffer = fs.existsSync(legacy) ? fs.readFileSync(legacy) : null;
    }

    if (!buffer) {
      await pool.query(`UPDATE employee_documents SET file_missing = TRUE WHERE id = $1`, [doc.id]);
      return res.status(404).json({
        success: false,
        message: 'The record for this document exists but the file itself is missing from the server.',
      });
    }

    /* Who looked at what. Not for a viewer's own documents — an audit entry
     * every time somebody opens their own payslip buries the entries that
     * matter. */
    if (!ownsFolder(req)) {
      await logAudit(req, {
        action: 'VIEW', resource: 'Employee document', resourceId: doc.id,
        changes: { summary: `${req.query.disposition === 'inline' ? 'Previewed' : 'Downloaded'} "${doc.name}"` },
      }).catch(() => {});
    }

    const ext = path.extname(doc.storedName || doc.fileUrl || '').toLowerCase();
    const inline = req.query.disposition === 'inline';
    const filename = doc.storedName || `${doc.name || 'document'}${ext}`;
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename="${filename.replace(/"/g, '')}"`);
    /* Never cached: it is somebody's identity document, and the whole point
     * of routing it through here is that each read is checked and recorded. */
    res.setHeader('Cache-Control', 'no-store');
    res.send(buffer);
  } catch (err) { serverError(res, err); }
});

// POST upload — HR or a manager for their reports, or the employee themselves.
router.post('/:employeeId', upload.single('file'), async (req, res) => {
  try {
    if (!(await mayReach(req))) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file was accepted. PDF, Word, Excel and image files up to 10 MB.',
      });
    }
    const { name, type = 'other' } = req.body;

    const who = await pool.query(
      `SELECT employee_id AS "employeeId", first_name AS "firstName", last_name AS "lastName",
              document_folder AS "folder"
         FROM employees WHERE id = $1`, [req.params.employeeId]);
    if (!who.rows.length) return res.status(404).json({ success: false, message: 'That employee no longer exists' });
    const employee = who.rows[0];

    const written = store.storeDocument({
      employee, folder: employee.folder, buffer: req.file.buffer,
      originalName: req.file.originalname, label: name,
    });

    /* The file is on disk before the row exists, and if the row fails the
     * file has to go with it.
     *
     * Three copies of one resume were left in a folder while the screen
     * showed a single document, because two earlier attempts wrote their
     * bytes and then died on a missing column. Nothing referenced them and
     * nothing would ever have removed them — an upload that half-succeeds
     * quietly accumulates rubbish, and identity documents are the last thing
     * that should be lying around unreferenced.
     *
     * Written first because the checksum and size come from writing it; the
     * cleanup is what makes that ordering safe. */
    let r;
    try {
      r = await pool.query(
        `INSERT INTO employee_documents
           (employee_id, name, type, file_url, file_size, uploaded_by,
            folder, stored_name, is_encrypted, checksum, original_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING id as "_id", name, type, file_size as "fileSize", created_at as "createdAt",
                   folder, stored_name as "storedName", is_encrypted as "isEncrypted"`,
        [req.params.employeeId, name || req.file.originalname, type,
         `/uploads/${written.relativePath}`, written.size, req.user._id,
         written.folder, written.storedName, written.encrypted, written.checksum, req.file.originalname]);
    } catch (err) {
      store.deleteDocument({ folder: written.folder, storedName: written.storedName });
      throw err;
    }

    /* Recorded on the employee the first time, so the folder is found by ID
     * from then on and correcting their name cannot orphan the papers. */
    await pool.query(
      `UPDATE employees SET document_folder = $1 WHERE id = $2 AND document_folder IS NULL`,
      [written.folder, req.params.employeeId]);

    await logAudit(req, {
      action: 'CREATE', resource: 'Employee document', resourceId: r.rows[0]._id,
      changes: { summary: `Uploaded "${name || req.file.originalname}"${written.encrypted ? ' (encrypted)' : ''}` },
    }).catch(() => {});

    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) {
    /* A message the person can act on, where there is one. serverError hides
     * everything behind "an internal server error occurred", which for a
     * directory-permission problem sends whoever hit it looking at their own
     * file instead of at the server. */
    if (err.userFacing) return res.status(500).json({ success: false, message: err.message });
    serverError(res, err);
  }
});

// DELETE — HR or a manager for their reports, or whoever uploaded it.
router.delete('/:employeeId/:docId', async (req, res) => {
  try {
    const doc = await pool.query(
      `SELECT file_url, uploaded_by, name, folder, stored_name AS "storedName"
         FROM employee_documents WHERE id=$1 AND employee_id=$2`,
      [req.params.docId, req.params.employeeId]
    );
    if (!doc.rows[0]) return res.status(404).json({ success: false, message: 'Not found' });
    const d = doc.rows[0];
    const isUploader = d.uploaded_by && d.uploaded_by === req.user._id;
    if (!isUploader && !(await isPrivilegedFor(req, req.params.employeeId))) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    if (d.storedName) {
      store.deleteDocument({ folder: d.folder, storedName: d.storedName });
    } else if (d.file_url) {
      const fs = require('fs');
      const legacy = path.join(store.ROOT, path.basename(String(d.file_url)));
      if (fs.existsSync(legacy)) fs.unlinkSync(legacy);
    }

    await pool.query('DELETE FROM employee_documents WHERE id=$1', [req.params.docId]);
    await logAudit(req, {
      action: 'DELETE', resource: 'Employee document', resourceId: req.params.docId,
      changes: { summary: `Deleted "${d.name || 'document'}"` },
    }).catch(() => {});
    res.json({ success: true, message: 'Deleted' });
  } catch (err) { serverError(res, err); }
});

module.exports = router;
