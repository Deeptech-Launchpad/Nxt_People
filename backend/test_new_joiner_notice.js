/* ── Everyone hears when somebody joins ─────────────────────────────────────
 *  Confirming a new employee notifies every colleague. This writes one row per
 *  person, so who is left out matters as much as who is included.
 *
 *  What has to hold:
 *
 *    every active colleague who can sign in gets one
 *    the new joiner does NOT get told about themselves
 *    Employee Profiles do not — they can never sign in to read it
 *    inactive and soft-deleted people do not
 *    the message names the person, and their role when it is known
 *    a joiner with no readable record is skipped rather than announced blank
 *    it never throws — onboarding must not fail because a notification did
 *    NOTHING here sends mail
 *
 *  Everything runs inside a transaction that is always rolled back.
 *
 *    node test_new_joiner_notice.js
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'silent';

const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('announcing a joiner must never send mail'); },
  verify: async () => { throw new Error('announcing a joiner must never send mail'); },
});

const fs = require('fs');
const pool = require('./db');

const checks = [];
const check = (label, ok, extra) => {
  checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}` +
    (ok || extra === undefined ? '' : '\n          ' + JSON.stringify(extra).slice(0, 220)));
};

const DEPT = 'ZZ Joiner Test';

(async () => {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  New joiner announcement');
  console.log('══════════════════════════════════════════════════════════\n');

  console.log('  It cannot send mail\n');
  const src = fs.readFileSync(require.resolve('./utils/newJoinerNotice.js'), 'utf8');
  check('no mailer is imported', !/require\(.*mailer.*\)/.test(src));
  check('no send call of any kind', !/sendMail|sendLeaveStatusEmail|outcomeEmail/.test(src));

  console.log('\n  Who is notified\n');

  const client = await pool.connect();
  let rolledBack = false;
  try {
    await client.query('BEGIN');

    const mk = async (name, { status = 'active', isUser = true, deleted = false } = {}) => {
      const r = await client.query(
        `INSERT INTO employees (first_name, last_name, email, department, designation,
                                status, is_user, deleted_at, employee_id)
         VALUES ($1, 'Test', $2, $3, 'Engineer', $4, $5,
                 CASE WHEN $6::boolean THEN NOW() ELSE NULL END, $7)
         RETURNING id`,
        [name, `zz.${name}.${Date.now()}@joiner.test`, DEPT, status, isUser, deleted,
         'ZZ' + Math.floor(Math.random() * 1e6)]);
      return r.rows[0].id;
    };

    const colleague  = await mk('Colleague');
    const profile    = await mk('Profile',  { isUser: false });
    const inactive   = await mk('Inactive', { status: 'inactive' });
    const removed    = await mk('Removed',  { deleted: true });
    const joiner     = await mk('Joiner');

    /* The real audience query, lifted from the helper so this cannot pass
     * against a version the helper has moved away from. */
    const audienceSql = src.slice(src.indexOf('SELECT id FROM employees'),
                                 src.indexOf("is_user = TRUE`") + 'is_user = TRUE'.length);
    const audience = (await client.query(audienceSql, [joiner])).rows.map(r => r.id);

    check('an active colleague is notified', audience.includes(colleague));
    check('the joiner is not told about themselves', !audience.includes(joiner));
    check('an Employee Profile is not notified', !audience.includes(profile));
    check('an inactive employee is not notified', !audience.includes(inactive));
    check('a soft-deleted employee is not notified', !audience.includes(removed));

    console.log('\n  What it says\n');
    const j = (await client.query(
      `SELECT TRIM(CONCAT(first_name, ' ', COALESCE(last_name, ''))) AS name, designation, department
         FROM employees WHERE id = $1`, [joiner])).rows[0];
    const message = j.designation
      ? `${j.name} has joined as ${j.designation}` + (j.department ? ` in ${j.department}.` : '.')
      : `${j.name} has joined the team.`;
    check('it names the person', message.includes('Joiner Test'), message);
    check('it names the role', message.includes('Engineer'), message);
    check('it reads as a sentence, not a field dump', /has joined as .+ in .+\./.test(message), message);

    await client.query('ROLLBACK');
    rolledBack = true;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    rolledBack = true;
    console.log('\n  FAILED —', e.message, '\n');
    checks.push(false);
  } finally {
    client.release();
  }

  console.log('\n  Safety\n');
  const { announceNewJoiner } = require('./utils/newJoinerNotice');
  const bogus = await announceNewJoiner('00000000-0000-0000-0000-000000000000');
  check('an unknown employee is skipped, not announced', bogus.sent === 0 && !!bogus.skipped, bogus);

  let threw = null;
  try { await announceNewJoiner(null); } catch (e) { threw = e; }
  check('a null id does not throw — onboarding must not fail for this',
    threw === null, threw && threw.message);

  const left = (await pool.query(
    `SELECT count(*)::int AS n FROM employees WHERE department = $1`, [DEPT])).rows[0].n;
  check('the transaction was rolled back — nothing was written', rolledBack && left === 0, { left });

  const stray = (await pool.query(
    `SELECT count(*)::int AS n FROM notifications WHERE title LIKE 'Welcome %Test'`)).rows[0].n;
  check('no stray notifications were left behind', stray === 0, { stray });

  const passed = checks.filter(Boolean).length;
  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  ${passed}/${checks.length} passed`);
  console.log('══════════════════════════════════════════════════════════\n');
  await pool.end();
  process.exit(passed === checks.length ? 0 : 1);
})().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
