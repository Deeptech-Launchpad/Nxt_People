/* Move every profile photo from uploads/photos/ into the employee's own folder.
 *
 *   uploads/photos/d5e12621-…-b65846d7bac70f5c.jpg
 *     → uploads/employees/ANXT220004_Rajkumar_Duraipandi_R/ANXT220004_Profile-Photo.jpg
 *
 * DRY RUN BY DEFAULT. It lists who would move and touches nothing.
 *
 * With --apply, for each person: copy the file into their folder, re-read the
 * copy and compare its SHA-256 with the original, and only then point
 * photo_url at the new file. The UPDATE also requires photo_url to still be
 * the value that was read, so a photo somebody uploads while this runs is
 * never overwritten. ORIGINALS ARE NOT DELETED — uploads/photos/ stays as it
 * is until the move has been checked on screen.
 *
 *     cd ~/Nxt_People && docker compose exec -T backend node < backend/migrate_photos_to_employee_folders.js
 *     cd ~/Nxt_People && docker compose exec -T -e APPLY=1 backend node < backend/migrate_photos_to_employee_folders.js
 */
require('dotenv').config();
process.env.LOG_LEVEL = 'silent';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = require('./db');
const store = require('./utils/documentStore');
const { photoNameFor, extensionFor } = require('./utils/profilePhoto');

const APPLY = process.env.APPLY === '1' || process.argv.includes('--apply');
const PHOTOS = path.resolve(path.join(store.ROOT, 'photos'));
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

(async () => {
  console.log(`\n  PROFILE PHOTOS → EMPLOYEE FOLDERS  [move-photos v1]  ${APPLY ? '*** APPLYING ***' : '(dry run — nothing will change)'}\n`);

  const rows = (await pool.query(
    `SELECT id, employee_id, first_name, last_name, photo_url, document_folder,
            deleted_at IS NOT NULL AS deleted
       FROM employees
      WHERE photo_url IS NOT NULL AND photo_url <> ''
      ORDER BY employee_id NULLS LAST`)).rows;

  const out = { moved: [], same: [], missing: [], noId: [], notImage: [], conflict: [], elsewhere: 0, already: 0 };

  for (const r of rows) {
    const url = r.photo_url;
    const label = `${String(r.employee_id || '—').padEnd(13)} ${`${r.first_name || ''} ${r.last_name || ''}`.trim()}${r.deleted ? '  (ex-employee)' : ''}`;

    if (url.startsWith('/uploads/employees/')) { out.already++; continue; }
    if (!url.startsWith('/uploads/photos/')) { out.elsewhere++; continue; }
    if (!String(r.employee_id || '').trim()) { out.noId.push(label); continue; }

    const src = path.resolve(path.join(store.ROOT, url.split('?')[0].slice('/uploads/'.length)));
    if (!src.startsWith(PHOTOS + path.sep) || !fs.existsSync(src)) { out.missing.push(`${label}  ${url}`); continue; }

    const buf = fs.readFileSync(src);
    const ext = extensionFor(buf);
    if (!ext) { out.notImage.push(`${label}  ${url}`); continue; }

    const folder = r.document_folder || store.folderNameFor(r);
    const name = photoNameFor(r.employee_id, ext);
    const target = path.join(store.EMPLOYEE_ROOT, folder, name);
    const newUrl = `/uploads/employees/${folder}/${name}?v=${Math.round(fs.statSync(src).mtimeMs)}`;

    let identical = false;
    if (fs.existsSync(target)) {
      if (sha(fs.readFileSync(target)) !== sha(buf)) { out.conflict.push(`${label}  ${folder}/${name} already exists with different content`); continue; }
      identical = true;
    }

    if (APPLY) {
      const { dir } = store.ensureFolder(r, r.document_folder);
      if (!identical) {
        const tmp = path.join(dir, `.${name}.${process.pid}.tmp`);
        fs.writeFileSync(tmp, buf);
        if (sha(fs.readFileSync(tmp)) !== sha(buf)) {
          fs.unlinkSync(tmp);
          out.conflict.push(`${label}  copy did not verify — left as it was`);
          continue;
        }
        fs.renameSync(tmp, target);
      }
      const upd = await pool.query(
        `UPDATE employees
            SET photo_url = $1, document_folder = COALESCE(document_folder, $2), updated_at = NOW()
          WHERE id = $3 AND photo_url = $4`,
        [newUrl, folder, r.id, url]);
      if (!upd.rowCount) { out.conflict.push(`${label}  photo changed while this ran — skipped`); continue; }
    }
    (identical ? out.same : out.moved).push(`${label}  →  ${folder}/${name}`);
  }

  const section = (title, list) => {
    if (!list.length) return;
    console.log(`  ${title} (${list.length})`);
    list.forEach(l => console.log(`    ${l}`));
    console.log('');
  };
  section(APPLY ? 'MOVED' : 'WOULD MOVE', out.moved);
  section(APPLY ? 'ALREADY COPIED, LINK UPDATED' : 'ALREADY COPIED, LINK WOULD UPDATE', out.same);
  section('FILE MISSING — left as it was, this person needs to re-upload', out.missing);
  section('NO EMPLOYEE ID — left as it was', out.noId);
  section('NOT AN IMAGE — left as it was', out.notImage);
  section('CONFLICT — left as it was', out.conflict);

  console.log('  ' + '-'.repeat(70));
  console.log(`  people with a photo           ${rows.length}`);
  console.log(`  already in employee folder    ${out.already}`);
  console.log(`  ${APPLY ? 'moved' : 'to move'}                       ${out.moved.length + out.same.length}`);
  console.log(`  left as it was                ${out.missing.length + out.noId.length + out.notImage.length + out.conflict.length}`);
  console.log(`  link outside uploads (as is)  ${out.elsewhere}`);
  console.log(APPLY
    ? '\n  Originals in uploads/photos/ were kept. Check the photos on screen before removing them.\n'
    : '\n  Dry run. Nothing was copied and no row was changed.\n');
  await pool.end();
})().catch(async (e) => { console.error(`\n  Fatal: ${e.message}\n`); process.exitCode = 1; await pool.end().catch(() => {}); });
