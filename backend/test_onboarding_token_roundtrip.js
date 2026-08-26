/* ── The invite link a candidate is sent must open ──────────────────────────
 *  The candidate receives a raw token in their link; the table stores only its
 *  SHA-256 hash, so a leaked row is not a usable invite. Both readers —
 *  validate-token and submit — hash the token out of the URL before looking it
 *  up. That only works if every WRITER hashes too.
 *
 *  One did not. /employees/send-onboarding, the Send Preboarding button HR
 *  actually uses, stored the RAW token. The lookup searched for a hash, found
 *  nothing, and returned "Invalid token." Every invite sent from that button
 *  was dead on arrival, and it had never once worked. The Registrations page
 *  hashes correctly, which is why nobody caught it.
 *
 *  Two writers and two readers agreeing is not something to hold in your head,
 *  so this asserts it: the round trip, the exact failure, and a structural
 *  check that no future INSERT can quietly store a raw token again.
 *
 *  Runs inside a transaction that is always rolled back. Sends no mail.
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'silent';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('this test does not send mail'); },
  verify: async () => { throw new Error('this test does not send mail'); },
});

const crypto = require('crypto');
const fs = require('fs');
const pool = require('./db');

const checks = [];
const check = (l, ok, x) => { checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '\n          ' + JSON.stringify(x).slice(0, 300)}`); };

// Exactly what both readers do with the token out of the URL.
const hashOf = (token) => crypto.createHash('sha256').update(token).digest('hex');

// Exactly what validate-token asks the database.
const lookup = (db, tokenFromLink) => db.query(
  'SELECT email, expires_at, used FROM onboarding_tokens WHERE token = $1',
  [hashOf(tokenFromLink)]);

(async () => {
  const hr = (await pool.query(
    `SELECT id FROM employees WHERE deleted_at IS NULL LIMIT 1`)).rows[0];
  if (!hr) { console.log('\n  Need an employee to attribute the invite to.\n'); process.exit(1); }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const expires = new Date(Date.now() + 7 * 86400000);
    const store = (value, email) => client.query(
      'INSERT INTO onboarding_tokens (token, email, created_by, expires_at) VALUES ($1,$2,$3,$4)',
      [value, email, hr.id, expires]);

    console.log('\n════ The round trip ════\n');

    // What the fixed route now does: email the raw token, store its hash.
    const good = crypto.randomBytes(32).toString('hex');
    await store(hashOf(good), 'roundtrip-ok@example.invalid');
    const found = await lookup(client, good);
    check('a token stored as its hash is found by the link that carries it',
      found.rows.length === 1, found.rows);
    check('and the invite comes back with the right address',
      found.rows[0]?.email === 'roundtrip-ok@example.invalid', found.rows[0]);
    check('it is neither used nor expired, so validate-token would let it in',
      found.rows[0]?.used === false && new Date(found.rows[0]?.expires_at) > new Date(),
      found.rows[0]);

    console.log('\n════ The bug, stated as a fact ════\n');

    // What the route did before: store the raw token. The reader hashes, so
    // it searches for a value that is not in the table.
    const bad = crypto.randomBytes(32).toString('hex');
    await store(bad, 'roundtrip-raw@example.invalid');
    const missed = await lookup(client, bad);
    check('a token stored RAW cannot be found — this is "Invalid token."',
      missed.rows.length === 0, missed.rows);

    // And it is not that the row is absent; it is there under the wrong value.
    const present = await client.query(
      'SELECT 1 FROM onboarding_tokens WHERE token = $1', [bad]);
    check('the row exists, it is just filed under a value nobody looks up',
      present.rows.length === 1);

    check('the hash and the raw token are different strings — the whole cause',
      hashOf(bad) !== bad);

    await client.query('ROLLBACK');
    const left = await pool.query(
      `SELECT count(*)::int AS n FROM onboarding_tokens WHERE email LIKE 'roundtrip-%@example.invalid'`);
    check('and the test left nothing behind', left.rows[0].n === 0, left.rows[0]);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }

  console.log('\n════ Every writer hashes ════\n');

  /* The structural half. Three routes write this table and two read it; the
   * agreement between them is invisible at any single call site, which is how
   * one of them drifted. Anything storing a value not named as a hash is the
   * bug coming back. */
  const FILES = ['./routes/employees.js', './routes/registrations.js'];
  let writers = 0;
  for (const f of FILES) {
    const src = fs.readFileSync(require.resolve(f), 'utf8');
    let at = src.indexOf('INSERT INTO onboarding_tokens');
    while (at >= 0) {
      writers++;
      const params = src.slice(at, at + 400);
      const line = String(src.slice(0, at).split('\n').length);
      const hashed = /\[\s*tokenHash\s*,/.test(params);
      check(`${f.replace('./routes/', '')}:${line} stores the hash, not the token`,
        hashed, params.split('\n').slice(0, 3).join(' ').trim().slice(0, 160));
      at = src.indexOf('INSERT INTO onboarding_tokens', at + 1);
    }
  }
  check('all three writers were examined', writers === 3, { writers });

  let readers = 0;
  for (const f of FILES) {
    const src = fs.readFileSync(require.resolve(f), 'utf8');
    let at = src.indexOf('FROM onboarding_tokens WHERE token');
    while (at >= 0) {
      readers++;
      const params = src.slice(at, at + 300);
      const line = String(src.slice(0, at).split('\n').length);
      check(`${f.replace('./routes/', '')}:${line} looks up by the hash`,
        /\[\s*tokenHash\s*\]|\[\s*tokenHash\s*,/.test(params),
        params.split('\n').slice(0, 3).join(' ').trim().slice(0, 160));
      at = src.indexOf('FROM onboarding_tokens WHERE token', at + 1);
    }
  }
  check('both readers were examined', readers === 2, { readers });

  const failed = checks.filter(c => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed\n`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
