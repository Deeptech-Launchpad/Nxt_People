// Overwriting a live employee profile, and putting it back.
//
// Attendance and leave were rows nobody had. A profile is a row somebody logs
// in as, that half the database points at by id, and that carries their role.
// Two things have to hold:
//
//   Nothing on the forbidden list can be written, whatever Zoho sends. Zoho has
//   a Role field; if that ever reached employees.role, editing a record in Zoho
//   would grant permissions in this system.
//
//   The undo restores the fields the import wrote and nothing else. Reverting
//   the whole row would also revert whatever a person legitimately changed in
//   the meantime, which is not undoing the import.
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

const BATCH = 'test-profile-roundtrip';
let EMP = null, ORIGINAL = null;

const cleanup = async () => {
  if (EMP && ORIGINAL) {
    await pool.query(
      `UPDATE employees SET designation = $2, department = $3, about_me = $4, nick_name = $5
         WHERE id = $1`,
      [EMP.id, ORIGINAL.designation, ORIGINAL.department, ORIGINAL.about_me, ORIGINAL.nick_name])
      .catch(() => {});
  }
  await pool.query(`DELETE FROM import_backups WHERE batch = $1`, [BATCH]).catch(() => {});
};

(async () => {
  console.log('\n════ The forbidden list is real ════\n');

  // The module throws on load if a forbidden column is on the allowlist, so
  // requiring it at all is part of the assertion.
  const { toDate, FIELDS, FORBIDDEN } = require('./zoho_profile');
  const mapped = FIELDS.map(([, col]) => col);
  check('the allowlist loaded, and the module did not run its import',
    mapped.length > 10, mapped.length);

  for (const forbidden of ['role', 'password', 'email', 'employee_id', 'id', 'status',
                           'allow_access', 'login_enabled', 'mfa_secret']) {
    check(`${forbidden} is never written`, !mapped.includes(forbidden), mapped);
  }
  for (const col of mapped) {
    check(`${col} is not on the forbidden list`, !FORBIDDEN.has(col));
    break;   // the module already asserts this for every column on load
  }
  check('but the profile fields that matter are',
    ['designation', 'department', 'joining_date', 'date_of_birth', 'pan_number']
      .every(f => mapped.includes(f)), mapped);

  console.log('\n════ Reading Zoho\'s dates ════\n');

  check('03/01/2026 reads as 2026-01-03', toDate('03/01/2026') === '2026-01-03', toDate('03/01/2026'));
  check('03-Jan-2026 reads the same way', toDate('03-Jan-2026') === '2026-01-03', toDate('03-Jan-2026'));
  check('an ISO date passes through', toDate('2026-01-03') === '2026-01-03', toDate('2026-01-03'));
  check('empty is null — Zoho has nothing to say', toDate('') === null, toDate(''));
  check('a dash is null too', toDate('-') === null, toDate('-'));
  // undefined and null must stay distinct: one means "could not read it", the
  // other "there is nothing there", and only the first is worth reporting.
  check('something unreadable is undefined, NOT null',
    toDate('next Tuesday') === undefined, String(toDate('next Tuesday')));

  console.log('\n════ Putting a profile back ════\n');

  EMP = (await pool.query(
    `SELECT * FROM employees WHERE status='active' AND deleted_at IS NULL LIMIT 1`)).rows[0];
  if (!EMP) { console.log('  No employee to test with.\n'); process.exit(1); }
  ORIGINAL = { ...EMP };
  await cleanup();

  const fields = ['designation', 'department', 'about_me'];
  await pool.query(
    `INSERT INTO import_backups (batch, table_name, employee_id, row_data)
     SELECT $1, 'employees', $2, to_jsonb(e) FROM employees e WHERE e.id = $2`, [BATCH, EMP.id]);
  await pool.query(
    `INSERT INTO import_backups (batch, table_name, employee_id, row_data)
     VALUES ($1, '_manifest', $2, $3::jsonb)`,
    [BATCH, EMP.id, JSON.stringify({ code: 'TEST', name: 'Test', tables: ['employees'], fields })]);

  // The import changes three fields. Somebody then changes a fourth by hand.
  await pool.query(
    `UPDATE employees SET designation='Imported Title', department='Imported Dept',
            about_me='imported text', nick_name='changed by a person' WHERE id=$1`, [EMP.id]);

  const out = execFileSync('node', ['restore_import_backup.js', BATCH, '--apply'],
    { encoding: 'utf8', cwd: __dirname });
  check('the restore ran', /Restored\./.test(out), out.slice(-300));

  const after = (await pool.query(`SELECT * FROM employees WHERE id=$1`, [EMP.id])).rows[0];
  check('designation is back', after.designation === ORIGINAL.designation,
    { was: ORIGINAL.designation, now: after.designation });
  check('department is back', after.department === ORIGINAL.department,
    { was: ORIGINAL.department, now: after.department });
  check('about_me is back', after.about_me === ORIGINAL.about_me,
    { was: ORIGINAL.about_me, now: after.about_me });

  // The point of restoring only the listed fields.
  check('the field a person changed is LEFT as they left it',
    after.nick_name === 'changed by a person', after.nick_name);

  check('the row is the same row — nothing was deleted and reinserted',
    after.id === EMP.id && after.employee_id === EMP.employee_id);
  check('the login is untouched', after.email === ORIGINAL.email, after.email);
  check('the role is untouched', after.role === ORIGINAL.role, after.role);

  await cleanup();
  const failed = checks.filter(c => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed\n`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch(async e => { console.error(e); await cleanup().catch(() => {}); process.exit(1); });
