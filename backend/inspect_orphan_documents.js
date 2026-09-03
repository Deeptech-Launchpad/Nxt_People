/* Files in the employee document folders that no row points at.
 *
 * An upload writes the file, then inserts the row. When the insert failed —
 * as it did on live, twice, on a missing column — the bytes stayed. Three
 * copies of one resume sat in a folder while the screen showed a single
 * document, and nothing would ever have removed the other two.
 *
 * The route cleans up after itself now. This finds what was stranded before
 * that, and anything a future failure leaves behind.
 *
 * DRY RUN BY DEFAULT. It lists what it would delete and touches nothing.
 * These are people's identity documents, so the list is worth reading before
 * anything is removed.
 *
 *     docker compose -f docker-compose.prod.yml exec backend node inspect_orphan_documents.js
 *     docker compose -f docker-compose.prod.yml exec backend node inspect_orphan_documents.js --apply
 */
require('dotenv').config();
process.env.LOG_LEVEL = 'silent';
const fs = require('fs');
const path = require('path');
const pool = require('./db');
const store = require('./utils/documentStore');

const APPLY = process.env.APPLY === '1' || process.argv.includes('--apply');
const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);

(async () => {
  console.log(`\n  UNREFERENCED DOCUMENT FILES  ${APPLY ? '*** DELETING ***' : '(dry run — nothing will be removed)'}\n`);

  if (!fs.existsSync(store.EMPLOYEE_ROOT)) {
    console.log('  No employee document folders yet.\n');
    await pool.end();
    return;
  }

  /* Every file a row claims. Compared by folder + name rather than by path,
   * because that is what the row actually stores. */
  const claimed = new Set((await pool.query(
    `SELECT folder, stored_name AS "storedName" FROM employee_documents
      WHERE folder IS NOT NULL AND stored_name IS NOT NULL`)).rows
    .map(r => `${r.folder}/${r.storedName}`));

  const orphans = [];
  let onDisk = 0;

  for (const folder of fs.readdirSync(store.EMPLOYEE_ROOT)) {
    const dir = path.join(store.EMPLOYEE_ROOT, folder);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir)) {
      onDisk++;
      if (claimed.has(`${folder}/${file}`)) continue;
      const { size, mtime } = fs.statSync(path.join(dir, file));
      orphans.push({ folder, file, size, mtime });
    }
  }

  console.log(`  ${onDisk} file(s) on disk, ${claimed.size} referenced by a row.`);
  console.log('  ' + '-'.repeat(86));

  if (!orphans.length) {
    console.log('  Nothing unreferenced. Every file on disk belongs to a document.\n');
    await pool.end();
    return;
  }

  orphans.forEach(o => console.log(
    `  ${o.folder}/${o.file}\n      ${fmtSize(o.size).padEnd(10)} written ${o.mtime.toLocaleString('en-IN')}`));

  console.log('  ' + '-'.repeat(86));
  console.log(`  ${orphans.length} file(s) no row points at.`);

  if (!APPLY) {
    console.log('\n  Dry run. Nothing was removed.');
    console.log('  Read the list — these are identity documents — then re-run with --apply.\n');
    await pool.end();
    return;
  }

  let removed = 0;
  for (const o of orphans) {
    if (store.deleteDocument({ folder: o.folder, storedName: o.file })) removed++;
  }
  console.log(`\n  ${removed} file(s) removed.\n`);
  await pool.end();
})().catch(async e => { console.error(e.message); await pool.end().catch(() => {}); });
