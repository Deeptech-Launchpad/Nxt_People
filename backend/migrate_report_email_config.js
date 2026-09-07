/* ── Scheduled report emails, off until somebody turns them on ────────────
 *  Adds one JSONB column, `settings.report_email_config`, holding whether
 *  each report is enabled and who receives it — the same shape every other
 *  feature's settings use (regularization_config, geofence_config, and so
 *  on). Ships as an empty object: every report reads as disabled until an
 *  admin explicitly switches one on in Settings -> Attendance -> Automation
 *  -> Scheduled Reports, so this migration alone sends nothing.
 *
 *  Idempotent. Safe to re-run.
 *      docker compose exec backend node migrate_report_email_config.js
 * ───────────────────────────────────────────────────────────────────────── */

const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE settings
        ADD COLUMN IF NOT EXISTS report_email_config JSONB NOT NULL DEFAULT '{}'::jsonb`);

    const cols = await client.query(`
      SELECT column_name FROM information_schema.columns
       WHERE table_name = 'settings' AND column_name = 'report_email_config'`);
    if (!cols.rows.length) throw new Error('settings.report_email_config was not created');

    await client.query('COMMIT');
    console.log('\nDone. settings.report_email_config exists — every report defaults to disabled.\n');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

migrate()
  .then(() => pool.end())
  .catch(async (err) => { console.error('\nFAILED:', err.message); try { await pool.end(); } catch {} process.exit(1); });
