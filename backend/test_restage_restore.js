// Backing up, deleting, and putting it back.
//
// This is the only test where a green run is the point rather than a formality:
// zoho_restage.js deletes eight months of a real person's history on live, and
// the only reason that is acceptable is that restore_import_backup.js can put
// it back exactly. So this seeds rows, destroys them the way the restage does,
// restores, and compares the rows byte for byte as JSON — not row counts, which
// would pass while every timestamp was five and a half hours out.
//
// It works in a far-future date range so it cannot collide with anything real,
// and removes what it made whether it passes or fails.
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({ sendMail: async () => ({ ok: true }), verify: async () => true });

const pool = require('./db');
const { execFileSync } = require('child_process');

const checks = [];
const check = (l, ok, x) => { checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '\n          ' + JSON.stringify(x).slice(0, 400)}`); };

const START = '2099-03-01';
const END = '2099-03-31';
const BATCH = 'test-restage-roundtrip';

const snapshot = async (table, col, empId) => (await pool.query(
  `SELECT to_jsonb(t) AS r FROM ${table} t
    WHERE employee_id = $1 AND ${col} BETWEEN $2::date AND $3::date
    ORDER BY ${col}, id`, [empId, START, END])).rows.map(x => x.r);

let EMP = null;

const cleanup = async () => {
  if (!EMP) return;
  await pool.query(`DELETE FROM attendance WHERE employee_id=$1 AND date BETWEEN $2::date AND $3::date`,
    [EMP.id, START, END]).catch(() => {});
  await pool.query(`DELETE FROM leaves WHERE employee_id=$1 AND start_date BETWEEN $2::date AND $3::date`,
    [EMP.id, START, END]).catch(() => {});
  await pool.query(`DELETE FROM import_backups WHERE batch=$1`, [BATCH]).catch(() => {});
};

(async () => {
  EMP = (await pool.query(
    `SELECT id, TRIM(CONCAT(first_name,' ',last_name)) AS name
       FROM employees WHERE status='active' AND deleted_at IS NULL LIMIT 1`)).rows[0];
  if (!EMP) { console.log('\n  No employee to test with.\n'); process.exit(1); }
  await cleanup();

  console.log(`\n════ Seeding history for ${EMP.name} in ${START}..${END} ════\n`);

  // Deliberately varied: a half day, a null check-out, odd minute values. A
  // round trip that only ever sees tidy rows proves less than nothing.
  for (const [d, ci, co, h, st] of [
    ['2099-03-02', '2099-03-02 03:41:07', '2099-03-02 12:58:33', 9.29, 'present'],
    ['2099-03-03', '2099-03-03 04:11:00', null, 0, 'half-day'],
    ['2099-03-04', '2099-03-04 03:30:22', '2099-03-04 07:31:45', 4.02, 'half-day'],
  ]) {
    await pool.query(
      `INSERT INTO attendance (employee_id, date, check_in, check_out, working_hours, status)
       VALUES ($1,$2::date,$3::timestamp,$4::timestamp,$5,$6)`, [EMP.id, d, ci, co, h, st]);
  }
  await pool.query(
    `INSERT INTO leaves (employee_id, leave_type, start_date, end_date, total_days, reason, status)
     VALUES ($1,'casual','2099-03-10'::date,'2099-03-11'::date,2,'seeded by test','approved')`, [EMP.id]);

  const beforeAtt = await snapshot('attendance', 'date', EMP.id);
  const beforeLeave = await snapshot('leaves', 'start_date', EMP.id);
  check('3 attendance rows seeded', beforeAtt.length === 3, beforeAtt.length);
  check('1 leave record seeded', beforeLeave.length === 1, beforeLeave.length);

  console.log('\n════ Backing up and destroying, the way the restage does ════\n');

  await pool.query(
    `INSERT INTO import_backups (batch, table_name, employee_id, row_data)
     VALUES ($1,'_manifest',$2,$3::jsonb)`,
    [BATCH, EMP.id, JSON.stringify({
      code: 'TEST', name: EMP.name, start: START, end: END, tables: ['leaves', 'attendance'] })]);

  for (const [table, col] of [['leaves', 'start_date'], ['attendance', 'date']]) {
    await pool.query(
      `INSERT INTO import_backups (batch, table_name, employee_id, row_data)
       SELECT $1, $2, $3, to_jsonb(t) FROM ${table} t
        WHERE t.employee_id = $3 AND t.${col} BETWEEN $4::date AND $5::date`,
      [BATCH, table, EMP.id, START, END]);
    await pool.query(
      `DELETE FROM ${table} WHERE employee_id=$1 AND ${col} BETWEEN $2::date AND $3::date`,
      [EMP.id, START, END]);
  }

  // And something arrives in its place, as an import would leave it.
  await pool.query(
    `INSERT INTO leaves (employee_id, leave_type, start_date, end_date, total_days, reason, status)
     VALUES ($1,'sick','2099-03-20'::date,'2099-03-20'::date,1,'Imported from Zoho','approved')`, [EMP.id]);

  check('the seeded attendance is gone', (await snapshot('attendance', 'date', EMP.id)).length === 0);
  check('the imported leave is in place of the old',
    (await snapshot('leaves', 'start_date', EMP.id)).length === 1);
  check('4 rows are held in the backup',
    (await pool.query(`SELECT COUNT(*)::int n FROM import_backups
       WHERE batch=$1 AND table_name<>'_manifest'`, [BATCH])).rows[0].n === 4);

  console.log('\n════ Restoring ════\n');

  const out = execFileSync('node', ['restore_import_backup.js', BATCH, '--apply'],
    { encoding: 'utf8', cwd: __dirname });
  check('the restore ran', /Restored\./.test(out), out.slice(-400));

  const afterAtt = await snapshot('attendance', 'date', EMP.id);
  const afterLeave = await snapshot('leaves', 'start_date', EMP.id);

  // Row counts would pass with every timestamp shifted. Compare the rows.
  check('every attendance row is back, identical',
    JSON.stringify(afterAtt) === JSON.stringify(beforeAtt),
    { before: beforeAtt[0], after: afterAtt[0] });
  check('every leave record is back, identical',
    JSON.stringify(afterLeave) === JSON.stringify(beforeLeave),
    { before: beforeLeave[0], after: afterLeave[0] });
  check('the imported leave is gone again',
    !afterLeave.some(l => l.reason === 'Imported from Zoho'), afterLeave.map(l => l.reason));
  check('the ids are the original ones, so nothing pointing at them is orphaned',
    afterAtt.every((r, i) => r.id === beforeAtt[i].id));

  console.log('\n════ It refuses to run twice ════\n');

  let second = '';
  try { second = execFileSync('node', ['restore_import_backup.js', BATCH, '--apply'],
    { encoding: 'utf8', cwd: __dirname }); }
  catch (e) { second = String(e.stdout || ''); }
  check('a batch already restored is refused', /already been restored/.test(second), second.slice(-300));

  console.log('\n════ An unknown batch changes nothing ════\n');

  let unknown = '';
  try { unknown = execFileSync('node', ['restore_import_backup.js', 'no-such-batch', '--apply'],
    { encoding: 'utf8', cwd: __dirname }); }
  catch (e) { unknown = String(e.stdout || ''); }
  check('an unknown batch stops', /No such batch/.test(unknown), unknown.slice(-300));

  await cleanup();
  const failed = checks.filter(c => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed\n`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch(async e => { console.error(e); await cleanup().catch(() => {}); process.exit(1); });
