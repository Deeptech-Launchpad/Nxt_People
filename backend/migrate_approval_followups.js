/* ── Manage Accounts → Approvals: follow-up reminders ──────────────────────
 *  approval_rules.follow_up has been a boolean since the Approvals screen
 *  shipped. It was saved and nothing ever read it — the reference's shape is
 *  "one-time or repeat, after N days from the approval trigger date, sent at
 *  HH:MM", which a boolean cannot hold.
 *
 *  It becomes JSONB, and a log table records what has been sent so a sweep
 *  that overlaps its predecessor cannot chase the same approver twice.
 *
 *  Idempotent. Safe to re-run.
 *      docker compose exec backend node migrate_approval_followups.js
 * ───────────────────────────────────────────────────────────────────────── */

const pool = require('./db');

const DEFAULT = { enabled: false, mode: 'one_time', days: 1, time: '10:00' };

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const type = (await client.query(
      `SELECT data_type FROM information_schema.columns
        WHERE table_name = 'approval_rules' AND column_name = 'follow_up'`
    )).rows[0]?.data_type;

    if (type === 'boolean') {
      // The old boolean carried no schedule, so an enabled one becomes the
      // reference's default: one-time, after a day, at 10:00.
      await client.query(
        `ALTER TABLE approval_rules
           ALTER COLUMN follow_up DROP DEFAULT,
           ALTER COLUMN follow_up TYPE JSONB
           USING CASE WHEN follow_up
                      THEN jsonb_build_object('enabled', true,  'mode', 'one_time', 'days', 1, 'time', '10:00')
                      ELSE jsonb_build_object('enabled', false, 'mode', 'one_time', 'days', 1, 'time', '10:00')
                 END`
      );
      await client.query(`ALTER TABLE approval_rules ALTER COLUMN follow_up SET DEFAULT '${JSON.stringify(DEFAULT)}'::jsonb`);
    }

    await client.query(
      `UPDATE approval_rules SET follow_up = $1::jsonb WHERE follow_up IS NULL`,
      [JSON.stringify(DEFAULT)]
    );

    // One row per reminder actually sent. The unique key is what stops a sweep
    // overlapping its predecessor from chasing the same approver twice.
    await client.query(`
      CREATE TABLE IF NOT EXISTS approval_followups (
        id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        rule_id      UUID REFERENCES approval_rules(id) ON DELETE CASCADE,
        request_type VARCHAR(40) NOT NULL,
        request_id   UUID NOT NULL,
        level        INT NOT NULL,
        sequence     INT NOT NULL DEFAULT 1,
        approver_id  UUID REFERENCES employees(id) ON DELETE SET NULL,
        status       VARCHAR(12) NOT NULL DEFAULT 'success',
        message      TEXT,
        sent_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (request_type, request_id, level, sequence)
      )`);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_approval_followups_at ON approval_followups (sent_at DESC)`);

    await client.query('COMMIT');

    const r = await pool.query(`
      SELECT COUNT(*)::int AS rules,
             COUNT(*) FILTER (WHERE (follow_up->>'enabled')::boolean)::int AS "withFollowUp"
        FROM approval_rules`);
    console.log('✅ Approval follow-ups ready.');
    console.log(`   ${r.rows[0].rules} approval rule(s), ${r.rows[0].withFollowUp} with follow-up enabled`);
    console.log('\n   follow_up is a schedule now, not a boolean nothing read.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Approval follow-up migration failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit(process.exitCode || 0);
  }
}

migrate();
