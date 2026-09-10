/* ── Team Email ID on a leave request ─────────────────────────────────────
 *  The reference's Apply Leave carries a "Team Email ID" — an address kept
 *  with the request so a team distribution list can be told somebody is away,
 *  separately from the approval chain.
 *
 *  It was left out of our form on the grounds that a field nothing reads is
 *  worse than no field. That was the right call while it had nowhere to go and
 *  the wrong one now: the column is the cheap half, and without it the field
 *  cannot exist at all.
 *
 *  This adds the column and nothing else. NOTHING SENDS TO IT YET — wiring it
 *  into the notification mail is a separate, deliberate change, because mail
 *  from this system goes out under a standing rule about who may receive it.
 *  Until then the address is stored and displayed, which is what the request
 *  detail needs in order to show it back.
 *
 *  Idempotent — safe to run more than once.
 *    node migrate_leave_team_email.js
 * ───────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
const pool = require('./db');

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`ALTER TABLE leaves ADD COLUMN IF NOT EXISTS team_email VARCHAR(255)`);

    const col = await client.query(
      `SELECT data_type, character_maximum_length AS len
         FROM information_schema.columns
        WHERE table_name = 'leaves' AND column_name = 'team_email'`
    );

    await client.query('COMMIT');

    if (col.rows.length) {
      console.log(`\n  leaves.team_email  ${col.rows[0].data_type}(${col.rows[0].len})  ready\n`);
    } else {
      console.log('\n  leaves.team_email could not be confirmed — check the table.\n');
      process.exitCode = 1;
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
