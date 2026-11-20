/* ── Monthly approval reminder — one digest email per eligible approver ────
 *  Runs on the 27th of every month (see server.js), covering every pending
 *  Casual Leave / LOP / Permission / Attendance Regularization request at
 *  whatever stage it is currently awaiting action.
 *
 *  One row per (recipient, month) actually sent. The UNIQUE key is what
 *  stops two overlapping cron fires -- or two backend instances running the
 *  same schedule -- from sending the same person two digests for the same
 *  month: the second INSERT loses the ON CONFLICT race and the sweep moves
 *  on without sending anything. Same pattern as approval_followups.
 *
 *  Idempotent. Safe to re-run.
 *      node migrate_monthly_approval_reminder.js
 * ───────────────────────────────────────────────────────────────────────── */

const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS monthly_approval_reminders (
        id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        recipient_id   UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        period         VARCHAR(7) NOT NULL,          -- 'YYYY-MM', in the cron's own timezone
        pending_count  INT NOT NULL DEFAULT 0,
        status         VARCHAR(12) NOT NULL DEFAULT 'success',
        message        TEXT,
        sent_at        TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (recipient_id, period)
      )`);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_monthly_approval_reminders_period ON monthly_approval_reminders (period)`);

    await client.query('COMMIT');

    const r = await pool.query(`SELECT COUNT(*)::int AS rows FROM monthly_approval_reminders`);
    console.log('✅ Monthly approval reminder table ready.');
    console.log(`   ${r.rows[0].rows} reminder(s) recorded so far.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Monthly approval reminder migration failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit(process.exitCode || 0);
  }
}

migrate();
