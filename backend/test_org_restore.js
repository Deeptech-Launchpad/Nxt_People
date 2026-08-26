// Undoing a departments/designations import.
//
// Reference rows are not keyed to a person and have no manifest, so undoing
// them is a different shape from undoing attendance:
//
//   a row the import CREATED has to be removed
//   a row whose empty fields were FILLED has to be put back as it was
//   a row nobody touched has to be left completely alone
//
// And the order matters. A created department can be another department's
// parent, so the fills have to be undone before the creations are deleted or
// the delete hits a foreign key and the whole restore rolls back.
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'silent';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({ sendMail: async () => ({ ok: true }), verify: async () => true });

const pool = require('./db');
const { execFileSync } = require('child_process');

const checks = [];
const check = (l, ok, x) => { checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '\n          ' + JSON.stringify(x).slice(0, 300)}`); };

const BATCH = 'test-org-roundtrip';
const MADE = 'ZZ Test Created Dept';
const CHILD = 'ZZ Test Child Dept';
const MADE_DESIG = 'ZZ Test Created Designation';

let existing = null, existingBefore = null;

const cleanup = async () => {
  await pool.query(`UPDATE departments SET parent_id = NULL WHERE name = ANY($1)`,
    [[MADE, CHILD]]).catch(() => {});
  if (existing && existingBefore) {
    await pool.query(`UPDATE departments SET mail_alias = $2 WHERE id = $1`,
      [existing.id, existingBefore.mail_alias]).catch(() => {});
  }
  await pool.query(`DELETE FROM departments WHERE name = ANY($1)`, [[MADE, CHILD]]).catch(() => {});
  await pool.query(`DELETE FROM designations WHERE name = $1`, [MADE_DESIG]).catch(() => {});
  await pool.query(`DELETE FROM import_backups WHERE batch = $1`, [BATCH]).catch(() => {});
};

(async () => {
  await cleanup();
  console.log('\n════ An import that creates two rows and fills one ════\n');

  // A department that already exists, with an empty mail alias.
  existing = (await pool.query(
    `SELECT id, name, mail_alias FROM departments WHERE mail_alias IS NULL LIMIT 1`)).rows[0]
    || (await pool.query(`SELECT id, name, mail_alias FROM departments LIMIT 1`)).rows[0];
  if (!existing) { console.log('  No departments to test with.\n'); process.exit(1); }
  existingBefore = { ...existing };

  const made = (await pool.query(
    `INSERT INTO departments (name, is_active) VALUES ($1, TRUE) RETURNING id`, [MADE])).rows[0];
  // A second created row that points at the first, so the delete order matters.
  const child = (await pool.query(
    `INSERT INTO departments (name, is_active, parent_id) VALUES ($1, TRUE, $2) RETURNING id`,
    [CHILD, made.id])).rows[0];
  const desig = (await pool.query(
    `INSERT INTO designations (name, is_active) VALUES ($1, TRUE) RETURNING id`, [MADE_DESIG])).rows[0];

  const remember = (table, id, created, row_data) => pool.query(
    `INSERT INTO import_backups (batch, table_name, target_id, created, row_data)
     VALUES ($1,$2,$3,$4,$5::jsonb)`, [BATCH, table, id, created, JSON.stringify(row_data)]);

  await remember('departments', made.id, true, { fields: [] });
  await remember('departments', child.id, true, { fields: [] });
  await remember('designations', desig.id, true, { fields: [] });

  // The existing row: store it whole, then fill it, exactly as the import does.
  await pool.query(
    `INSERT INTO import_backups (batch, table_name, target_id, created, row_data)
     SELECT $1, 'departments', $2, FALSE, jsonb_build_object('fields', $3::jsonb, 'row', to_jsonb(d))
       FROM departments d WHERE d.id = $2`,
    [BATCH, existing.id, JSON.stringify(['mail_alias'])]);
  await pool.query(`UPDATE departments SET mail_alias = 'filled-by-import' WHERE id = $1`,
    [existing.id]);

  const untouched = (await pool.query(
    `SELECT COUNT(*)::int n FROM departments WHERE id <> ALL($1)`,
    [[made.id, child.id, existing.id]])).rows[0].n;

  check('two departments and a designation were created',
    (await pool.query(`SELECT COUNT(*)::int n FROM departments WHERE name = ANY($1)`,
      [[MADE, CHILD]])).rows[0].n === 2);
  check('the existing row was filled',
    (await pool.query(`SELECT mail_alias FROM departments WHERE id=$1`, [existing.id]))
      .rows[0].mail_alias === 'filled-by-import');

  console.log('\n════ Undoing it ════\n');

  const out = execFileSync('node', ['restore_import_backup.js', BATCH, '--apply'],
    { encoding: 'utf8', cwd: __dirname });
  check('the restore ran', /Removed 3, put back 1\./.test(out), out.slice(-300));

  check('the created department is gone',
    (await pool.query(`SELECT COUNT(*)::int n FROM departments WHERE name=$1`, [MADE])).rows[0].n === 0);
  check('so is the one that pointed at it',
    (await pool.query(`SELECT COUNT(*)::int n FROM departments WHERE name=$1`, [CHILD])).rows[0].n === 0);
  check('and the created designation',
    (await pool.query(`SELECT COUNT(*)::int n FROM designations WHERE name=$1`, [MADE_DESIG])).rows[0].n === 0);

  const back = (await pool.query(
    `SELECT name, mail_alias FROM departments WHERE id=$1`, [existing.id])).rows[0];
  check('the filled row is back as it was',
    back.mail_alias === existingBefore.mail_alias,
    { was: existingBefore.mail_alias, now: back.mail_alias });
  check('and it was NOT deleted — a row people point at survives an undo',
    back.name === existingBefore.name, back);

  check('every department nobody touched is still there',
    (await pool.query(`SELECT COUNT(*)::int n FROM departments WHERE id <> $1`, [existing.id]))
      .rows[0].n === untouched);

  console.log('\n════ It will not run twice ════\n');

  let second = '';
  try {
    second = execFileSync('node', ['restore_import_backup.js', BATCH, '--apply'],
      { encoding: 'utf8', cwd: __dirname });
  } catch (e) { second = String(e.stdout || ''); }
  check('a batch already restored is refused', /already been restored/.test(second), second.slice(-200));

  await cleanup();
  const failed = checks.filter(c => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed\n`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch(async e => { console.error(e); await cleanup().catch(() => {}); process.exit(1); });
