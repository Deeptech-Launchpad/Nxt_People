/* ── HR filing a comp-off for somebody else ─────────────────────────────────
 *  Zoho reaches one form through two doors: My Data files for you and has no
 *  employee field, Operations puts a selector on top and files for anybody.
 *  This system only ever had the first door — POST /comp-off read req.user._id
 *  for the worked-day check, the duplicate check and the insert, so there was
 *  no way to express "this day belongs to her".
 *
 *  What has to hold now:
 *
 *    a team member cannot file for anybody but themselves, whatever they post
 *    an id that is not a UUID is refused as a bad employee, not a 500
 *    the rules are checked against the SUBJECT, never against the filer
 *    the approval chain is built for the subject's reporting line
 *    applied_by records who typed it, and is NULL when you file your own
 *
 *  Every case runs the real resolveSubject lifted out of the route, and the
 *  database work is done in a transaction that is always rolled back.
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'silent';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('this test does not send mail'); },
  verify: async () => { throw new Error('this test does not send mail'); },
});

const fs = require('fs');
const pool = require('./db');
const { isFullAccess } = require('./utils/roles');

const checks = [];
const check = (l, ok, x) => { checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '\n          ' + JSON.stringify(x).slice(0, 300)}`); };

// Lifted from the route by reading it, so this cannot pass against a copy the
// original has since moved away from.
const src = fs.readFileSync(require.resolve('./routes/comp-off.js'), 'utf8');
const lift = (what, start, end) => {
  const from = src.indexOf(start);
  if (from < 0) throw new Error(`${what} not found in routes/comp-off.js`);
  return src.slice(from, src.indexOf(end, from) + end.length);
};
const resolveSubject = new Function('isFullAccess', `
  ${lift('UUID', 'const UUID = /^[0-9a-fA-F]', '\n')}
  ${lift('resolveSubject', 'async function resolveSubject(', '\n}')}
  return resolveSubject;
`)(isFullAccess);

(async () => {
  const people = (await pool.query(
    `SELECT id, TRIM(CONCAT(first_name,' ',last_name)) AS name
       FROM employees WHERE deleted_at IS NULL ORDER BY employee_id LIMIT 2`)).rows;
  if (people.length < 2) { console.log('\n  Need two employees to test with.\n'); process.exit(1); }
  const [me, other] = people;

  const admin = { _id: me.id, role: 'admin' };
  const member = { _id: me.id, role: 'team_member' };
  const manager = { _id: me.id, role: 'manager' };

  console.log('\n════ Who may file for whom ════\n');

  const own = await resolveSubject(pool, member, undefined);
  check('no employeeId means yourself', own.id === me.id && own.onBehalf === false, own);

  const ownExplicit = await resolveSubject(pool, member, me.id);
  check('naming yourself is still yourself, not an on-behalf act',
    ownExplicit.id === me.id && ownExplicit.onBehalf === false, ownExplicit);

  const refused = await resolveSubject(pool, member, other.id);
  check('a team member cannot file for somebody else', refused.error === 403, refused);

  // A team lead approves their reports; granting a paid day off is a different
  // thing, and this is the line between the two.
  const lead = await resolveSubject(pool, manager, other.id);
  check('nor can a team lead — approving is not the same as granting',
    lead.error === 403, lead);

  const allowed = await resolveSubject(pool, admin, other.id);
  check('an admin can', allowed.id === other.id && allowed.onBehalf === true, allowed);
  check('and the subject is named, so the refusals can say who',
    allowed.name === other.name, allowed);

  console.log('\n════ Bad input answers honestly ════\n');

  const junk = await resolveSubject(pool, admin, 'not-a-uuid');
  check('a non-UUID is a bad employee, not a 500', junk.error === 400, junk);

  const gone = await resolveSubject(pool, admin, '00000000-0000-4000-8000-000000000000');
  check('an id nobody has is a 404', gone.error === 404, gone);

  console.log('\n════ What lands in the row ════\n');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const subject = await resolveSubject(client, admin, other.id);
    const ins = await client.query(
      `INSERT INTO comp_offs (employee_id, worked_date, comp_off_date, reason, days_earned, expires_at, applied_by)
       VALUES ($1,'2099-01-03','2099-01-05','test',1,'2099-04-03',$2)
       RETURNING employee_id, applied_by`,
      [subject.id, subject.onBehalf ? admin._id : null]);
    const row = ins.rows[0];

    check('the credit belongs to the employee', String(row.employee_id) === String(other.id), row);
    check('and applied_by records who filed it', String(row.applied_by) === String(admin._id), row);
    check('the two are different people — that is the whole point',
      String(row.employee_id) !== String(row.applied_by));

    const mine = await resolveSubject(client, admin, undefined);
    const ins2 = await client.query(
      `INSERT INTO comp_offs (employee_id, worked_date, comp_off_date, reason, days_earned, expires_at, applied_by)
       VALUES ($1,'2099-01-10','2099-01-12','test',1,'2099-04-10',$2)
       RETURNING employee_id, applied_by`,
      [mine.id, mine.onBehalf ? admin._id : null]);
    check('filing your own leaves applied_by null, as every existing row is',
      ins2.rows[0].applied_by === null, ins2.rows[0]);

    await client.query('ROLLBACK');
    const left = await pool.query(
      `SELECT count(*)::int AS n FROM comp_offs WHERE worked_date IN ('2099-01-03','2099-01-10')`);
    check('and the test wrote nothing that survived', left.rows[0].n === 0, left.rows[0]);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }

  console.log('\n════ The route reads the subject, not the caller ════\n');

  // The bug was structural: three separate reads of req.user._id inside the
  // create handler. If any comes back, HR silently files against themselves.
  const handler = lift('POST /', "router.post('/', audit('CREATE', 'comp_off')", '\n});');
  const strays = (handler.match(/req\.user\._id/g) || []).length;
  check('only the applied_by line may still mention the caller',
    strays === 1, { 'req.user._id occurrences': strays });
  check('the worked-day check uses the subject',
    /workedOn\(client, subject\.id/.test(handler));
  check('the duplicate check uses the subject',
    /\[subject\.id, workedDate\]/.test(handler));
  check('the approval chain is built for the subject',
    /createLevels\(client, 'comp_off', created\._id, subject\.id\)/.test(handler));

  const failed = checks.filter(c => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed\n`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
