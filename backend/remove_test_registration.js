/* ── Remove a preboarding record created while testing ──────────────────────
 *  Testing the onboarding form end to end creates a real employee row. This
 *  takes it back out again — and refuses to take out anything else.
 *
 *  A DELETE on employees is not a small thing: employee_education,
 *  employee_documents and a dozen other tables cascade off it. So this will
 *  only touch a row that is unmistakably a test registration:
 *
 *    it has no working life behind it      no attendance, leave, comp-off,
 *                                          payslip or regularisation
 *    nobody has signed in as it            no refresh token
 *
 *  Those never bend. A real employee cannot satisfy them, which is the point:
 *  the guard is what makes this safe to hand to somebody in a hurry.
 *
 *  Being still pending and unaccepted is checked too, but a test run gets
 *  confirmed like anything else — so that one is asked for in as many words
 *  with --confirmed, and reported when it is used.
 *
 *  Dry run by default. Sends no mail.
 *
 *    docker compose exec backend node remove_test_registration.js you@example.com
 *    docker compose exec backend node remove_test_registration.js you@example.com --apply
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'silent';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('this script does not send mail'); },
  verify: async () => { throw new Error('this script does not send mail'); },
});

const pool = require('./db');
const EMAIL = process.argv[2];
const APPLY = process.argv.includes('--apply');
/* A record that has been confirmed is one step closer to being a real
 * person, so removing one has to be asked for in as many words. The checks
 * that actually protect somebody — no attendance, no leave, no pay, never
 * signed in — are not relaxed by this and never can be. */
const CONFIRMED = process.argv.includes('--confirmed');
const pad = (s, n) => String(s ?? '').padEnd(n);

/* Every table that would tell us this is a real person with a history. If any
 * of them has a row, this is not a test record and the script stops. */
const HISTORY = [
  ['attendance',        'attendance day(s)'],
  ['leaves',            'leave record(s)'],
  ['comp_offs',         'comp-off record(s)'],
  ['regularizations',   'regularisation(s)'],
  ['payslips',          'payslip(s)'],
  /* There is no last_login column on employees — I assumed one and the script
   * died on `column "last_login" does not exist`, which is the same mistake
   * this whole session has been about. A refresh token is the real evidence
   * that somebody has signed in as this account, and every entry here is
   * checked with to_regclass first, so a table this installation lacks is
   * skipped rather than fatal. */
  ['refresh_tokens',    'sign-in session(s)'],
];

(async () => {
  if (!EMAIL) {
    console.log('\n  usage: node remove_test_registration.js <email> [--apply]\n');
    await pool.end();
    process.exit(1);
  }

  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  Test registration for ${EMAIL}`);
  console.log(`  ${APPLY ? 'APPLYING' : 'DRY RUN, nothing will be deleted'}`);
  console.log('══════════════════════════════════════════════════════════\n');

  const emp = (await pool.query(
    `SELECT id, employee_id AS code, TRIM(CONCAT(first_name,' ',last_name)) AS name,
            email, status, registration_status AS reg, has_accepted AS accepted,
            created_at
       FROM employees WHERE LOWER(email) = LOWER($1)`, [EMAIL])).rows[0];

  if (!emp) {
    console.log('  No employee has that email address. Nothing to remove.\n');
    await pool.end();
    return;
  }

  console.log(`  ${pad('name', 22)}${emp.name || '(no name)'}`);
  console.log(`  ${pad('employee code', 22)}${emp.code || '(none)'}`);
  console.log(`  ${pad('status', 22)}${emp.status}`);
  console.log(`  ${pad('registration', 22)}${emp.reg}`);
  console.log(`  ${pad('accepted', 22)}${emp.accepted}`);
  console.log(`  ${pad('created', 22)}${emp.created_at?.toISOString?.() || emp.created_at}`);
  console.log('');

  // ── The guard ─────────────────────────────────────────────────────────────
  const refusals = [];
  const softened = [];

  /* Being confirmed is not evidence of being real — a test run gets confirmed
   * like anything else. It is evidence that somebody meant it, so it needs
   * --confirmed rather than being waved through. */
  if (emp.reg !== 'pending' || emp.accepted) {
    const what = `it has been confirmed (status "${emp.reg}"${emp.accepted ? ', accepted' : ''})`;
    if (CONFIRMED) softened.push(what);
    else refusals.push(`${what} — pass --confirmed if that is expected`);
  }

  for (const [table, label] of HISTORY) {
    const exists = (await pool.query(`SELECT to_regclass($1) AS t`, [table])).rows[0].t;
    if (!exists) continue;
    const n = (await pool.query(
      `SELECT count(*)::int AS n FROM ${table} WHERE employee_id = $1`, [emp.id])).rows[0].n;
    if (n) refusals.push(`it has ${n} ${label}`);
  }

  if (softened.length) {
    console.log('  Allowed by --confirmed:\n');
    for (const w of softened) console.log(`    · ${w}`);
    console.log('');
  }

  if (refusals.length) {
    console.log('  REFUSING — this does not look like a test registration:\n');
    for (const r of refusals) console.log(`    · ${r}`);
    console.log('\n  Nothing was deleted. If this really is a test record, say so and');
    console.log('  it can be removed by hand with the reason written down.\n');
    await pool.end();
    process.exit(1);
  }

  // ── What goes ─────────────────────────────────────────────────────────────
  const counts = {};
  for (const t of ['employee_education', 'employee_documents']) {
    const exists = (await pool.query(`SELECT to_regclass($1) AS t`, [t])).rows[0].t;
    counts[t] = exists
      ? (await pool.query(`SELECT count(*)::int AS n FROM ${t} WHERE employee_id = $1`, [emp.id])).rows[0].n
      : 0;
  }
  const tokens = (await pool.query(
    `SELECT count(*)::int AS n FROM onboarding_tokens WHERE LOWER(email) = LOWER($1)`, [EMAIL])).rows[0].n;

  console.log('  Would remove:\n');
  console.log(`    ${pad(1, 6)}employee row${emp.code ? `  (frees the code ${emp.code})` : ''}`);
  console.log(`    ${pad(counts.employee_education, 6)}education record(s)`);
  console.log(`    ${pad(counts.employee_documents, 6)}uploaded document row(s)`);
  console.log(`    ${pad(tokens, 6)}onboarding invite(s) for this address`);
  console.log('');
  console.log('  Education and documents go with the employee row, which cascades.');
  console.log('  Files already written to disk are not deleted — only the rows.\n');

  if (!APPLY) {
    console.log('══════════════════════════════════════════════════════════');
    console.log('  Nothing was deleted. Re-run with --apply.');
    console.log('══════════════════════════════════════════════════════════\n');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM onboarding_tokens WHERE LOWER(email) = LOWER($1)', [EMAIL]);
    await client.query('DELETE FROM employees WHERE id = $1', [emp.id]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.log(`\n  Nothing was deleted — ${e.message}\n`);
    client.release();
    await pool.end();
    process.exit(1);
  }
  client.release();

  const left = (await pool.query(
    'SELECT count(*)::int AS n FROM employees WHERE LOWER(email) = LOWER($1)', [EMAIL])).rows[0].n;

  console.log('══════════════════════════════════════════════════════════');
  console.log(`  Removed. ${left} employee(s) now hold that address.`);
  if (emp.code && /^ANXT/.test(emp.code)) {
    /* The next id is MAX(sequence) + 1 over the rows matching the company's
     * format, so removing the highest one hands it straight back. Printed
     * because freeing the code is usually the reason for doing this. */
    const next = (await pool.query(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(employee_id FROM 7) AS INTEGER)), 0) + 1 AS n
         FROM employees WHERE employee_id ~ ('^ANXT' || $1 || '[0-9]{5}$')`,
      [emp.code.slice(4, 6)])).rows[0].n;
    console.log(`  The next AltiusNxt employee will be ANXT${emp.code.slice(4, 6)}${String(next).padStart(5, '0')}.`);
  }
  console.log('  The address is free to use again.');
  console.log('══════════════════════════════════════════════════════════\n');

  await pool.end();
})().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
