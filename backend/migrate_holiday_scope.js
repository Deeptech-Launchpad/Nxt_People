/* ── A holiday can belong to some people and not others ─────────────────────
 *  Until now a holidays row was company-wide by construction: `date` was
 *  UNIQUE, so the calendar could hold one entry per day and everybody got it.
 *  The org says otherwise — some holidays apply to the office and not to WFH.
 *
 *  Two changes, and the second is the one that matters:
 *
 *    the UNIQUE on `date` goes, because two rows can now share a day: the
 *    office closes for one thing while WFH closes for another, or not at all.
 *
 *    holiday_scopes says who a holiday is for. NO ROWS MEANS EVERYONE. Every
 *    holiday that exists today has no rows, so every one of them keeps
 *    applying to the whole company and nothing about the attendance already
 *    recorded changes. Scoping is opt-in, per holiday, from the moment
 *    somebody chooses it — which is the only safe way to introduce this into a
 *    calendar four years of attendance has already been judged against.
 *
 *    docker compose exec backend node migrate_holiday_scope.js
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('this migration does not send mail'); },
  verify: async () => { throw new Error('this migration does not send mail'); },
});

const pool = require('./db');

(async () => {
  console.log('');

  /* The constraint's name depends on how the table was created, so find it
   * rather than guessing at holidays_date_key and failing on a rename. */
  const uniq = (await pool.query(
    `SELECT conname FROM pg_constraint
      WHERE conrelid = 'holidays'::regclass AND contype = 'u'`)).rows;

  for (const c of uniq) {
    await pool.query(`ALTER TABLE holidays DROP CONSTRAINT ${c.conname}`);
    console.log(`  ok   dropped ${c.conname} — a date may now carry more than one holiday`);
  }
  if (!uniq.length) console.log('  ok   no unique constraint on holidays to drop');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS holiday_scopes (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      holiday_id UUID NOT NULL REFERENCES holidays(id) ON DELETE CASCADE,
      -- 'location' or 'shift'. Two kinds in one table because they are the
      -- same question — who is this for — and a scoped holiday narrows by
      -- either or both.
      kind       VARCHAR(10) NOT NULL,
      ref_id     UUID NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (holiday_id, kind, ref_id)
    )`);
  console.log('  ok   holiday_scopes created');

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_holiday_scopes_holiday ON holiday_scopes(holiday_id)`);
  console.log('  ok   indexed by holiday');

  const counts = (await pool.query(
    `SELECT (SELECT count(*)::int FROM holidays) AS holidays,
            (SELECT count(*)::int FROM holiday_scopes) AS scopes`)).rows[0];

  console.log('');
  console.log(`  ${counts.holidays} holiday(s), ${counts.scopes} scope row(s).`);
  console.log('  Every holiday with no scope rows still applies to everybody,');
  console.log('  so nothing already recorded is judged differently.');
  console.log('');

  await pool.end();
})().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
