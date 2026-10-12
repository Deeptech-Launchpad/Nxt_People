const fs = require('fs');
const path = require('path');
const { EMPLOYEE_ROOT, ROOT, ensureFolder, safeName } = require('./documentStore');

/* Profile photos live in the employee's own folder, beside their documents:
 *
 *   uploads/employees/ANXT220004_Rajkumar_Duraipandi_R/ANXT220004_Profile-Photo.jpg
 *
 * One fixed name per person, so a re-upload replaces the file instead of
 * leaving the old one behind. Unlike the documents next to it, the photo is
 * NOT encrypted: an <img> cannot send a token, so it is served publicly by
 * servePublicPhoto below — and that route answers for this one filename shape
 * only, never for anything else in the folder. The URL carries ?v= so a
 * browser holding the previous picture fetches the new one. */

const STEM = 'Profile-Photo';

const idPart = (employeeId) => safeName(employeeId || 'unknown', 'unknown').replace(/\.+$/, '');
const photoNameFor = (employeeId, ext) => `${idPart(employeeId)}_${STEM}${ext}`;

const isPhotoName = (name) => /^[A-Za-z0-9-]+_Profile-Photo\.(jpg|jpeg|png|webp|gif)$/.test(name);

/* The bytes decide, not the filename: a page of HTML renamed to .jpg must not
 * become somebody's face, or replace the photo they already have. */
function extensionFor(buffer) {
  const b = buffer || Buffer.alloc(0);
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return '.jpg';
  if (b.slice(0, 4).toString('hex') === '89504e47') return '.png';
  if (b.slice(0, 3).toString() === 'GIF') return '.gif';
  if (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') return '.webp';
  return null;
}

function removeOtherPhotos(dir, keep, employeeId) {
  const prefix = `${idPart(employeeId)}_${STEM}.`;
  for (const f of fs.readdirSync(dir)) {
    if (f !== keep && f.startsWith(prefix) && isPhotoName(f)) {
      try { fs.unlinkSync(path.join(dir, f)); } catch { /* already gone */ }
    }
  }
}

/* Files from before photos moved into the folders. Only ever under
 * uploads/photos/, so a crafted photo_url cannot point this at anything else. */
function removeLegacyPhoto(url) {
  const clean = String(url || '').split('?')[0];
  if (!clean.startsWith('/uploads/photos/')) return;
  const resolved = path.resolve(path.join(ROOT, clean.slice('/uploads/'.length)));
  if (!resolved.startsWith(path.resolve(path.join(ROOT, 'photos')) + path.sep)) return;
  fs.unlink(resolved, () => {});
}

async function loadEmployee(db, id) {
  const r = await db.query(
    `SELECT id, employee_id, first_name, last_name, photo_url, document_folder
       FROM employees WHERE id = $1`, [id]);
  return r.rows[0] || null;
}

/* Write the photo into the person's folder and point photo_url at it.
 * Returns the new URL. The file is written under a temporary name and
 * renamed, so a half-written image is never what gets served. */
async function saveProfilePhoto(db, employeeUuid, buffer, originalName) {
  const ext = extensionFor(buffer);
  if (!ext) {
    const e = new Error('That file is not an image we can use (JPG, PNG, WEBP or GIF).');
    e.userFacing = true;
    throw e;
  }
  const emp = await loadEmployee(db, employeeUuid);
  if (!emp) throw new Error('Employee not found');
  if (!String(emp.employee_id || '').trim()) {
    const e = new Error('This person has no Employee ID yet, so there is no folder to keep a photo in.');
    e.userFacing = true;
    throw e;
  }

  const { name: folder, dir } = ensureFolder(emp, emp.document_folder);
  const name = photoNameFor(emp.employee_id, ext);
  const tmp = path.join(dir, `.${name}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, buffer);
  fs.renameSync(tmp, path.join(dir, name));
  removeOtherPhotos(dir, name, emp.employee_id);

  const url = `/uploads/employees/${folder}/${name}?v=${Date.now()}`;
  await db.query(
    `UPDATE employees
        SET photo_url = $1, document_folder = COALESCE(document_folder, $2), updated_at = NOW()
      WHERE id = $3`,
    [url, folder, emp.id]);
  removeLegacyPhoto(emp.photo_url);
  return url;
}

async function deleteProfilePhoto(db, employeeUuid) {
  const emp = await loadEmployee(db, employeeUuid);
  if (!emp) return;
  if (emp.document_folder) {
    const dir = path.join(EMPLOYEE_ROOT, emp.document_folder);
    if (fs.existsSync(dir)) removeOtherPhotos(dir, null, emp.employee_id);
  }
  removeLegacyPhoto(emp.photo_url);
  await db.query('UPDATE employees SET photo_url = NULL, updated_at = NOW() WHERE id = $1', [emp.id]);
}

/* GET /uploads/employees/<folder>/<ID>_Profile-Photo.<ext>, without a token.
 *
 * This is the ONLY file this mount ever serves. Anything that is not exactly
 * that shape answers 404 here and now — it used to call next() and fall
 * through to the generic, token-only /uploads handler below, which checks
 * that a caller is signed in but never that they own the file being asked
 * for. That let any authenticated employee read a colleague's documents by
 * guessing the predictable folder/file name (see documentStore.js's naming
 * scheme). Employee documents have exactly one authorized door now:
 * GET /api/documents/:employeeId/:docId/file, which checks ownership.
 *
 * The file's id must also match the folder's id, so one person's folder
 * cannot be used to serve a photo named for somebody else. */
function servePublicPhoto(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(404).end();
  let parts;
  try { parts = decodeURIComponent(req.path).split('/').filter(Boolean); } catch { return res.status(404).end(); }
  if (parts.length !== 2) return res.status(404).end();
  const [folder, file] = parts;
  if (!isPhotoName(file) || folder.startsWith('.')) return res.status(404).end();
  const id = file.slice(0, file.indexOf('_'));
  if (folder !== id && !folder.startsWith(`${id}_`)) return res.status(404).end();

  res.sendFile(`${folder}/${file}`, {
    root: EMPLOYEE_ROOT,
    dotfiles: 'deny',
    headers: { 'Cache-Control': 'public, max-age=86400' },
  }, (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
}

module.exports = {
  photoNameFor, isPhotoName, extensionFor,
  saveProfilePhoto, deleteProfilePhoto, servePublicPhoto,
};
