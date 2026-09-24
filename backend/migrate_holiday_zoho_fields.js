/* ── Holiday popup, closer to Zoho's own fields ──────────────────────────────
 *  Three additions requested straight off Zoho's Add/Edit Holiday screenshots:
 *
 *    day_type          'full' | 'half' — a Half Day holiday only shuts the
 *                      office for part of the day. Every existing row defaults
 *                      to 'full', so nothing already on the calendar changes
 *                      meaning. Wired into countWorkingDays() (a half-day
 *                      holiday counts as 0.5 working day, not 0 or 1) — but
 *                      deliberately NOT wired into attendance's expected-hours
 *                      math (classifyDay/expectedFor) or the absent-marking
 *                      cron, since that decides pay-affecting outcomes and
 *                      needs its own explicit decision, not a side effect of
 *                      a popup redesign.
 *    reminder_days     days before the holiday to auto-email everyone in
 *                      scope, same idea as Zoho's "No of day(s) before...".
 *    reminder_sent_at  stops the reminder firing twice; cleared on every edit
 *                      so a moved date gets a fresh reminder window.
 *
 *    docker compose exec backend node migrate_holiday_zoho_fields.js
 * ────────────────────────────────────────────────────────────────────────── */
const pool = require('./db');

(async () => {
  await pool.query(`ALTER TABLE holidays ADD COLUMN IF NOT EXISTS day_type VARCHAR(10) DEFAULT 'full'`);
  await pool.query(`ALTER TABLE holidays ADD COLUMN IF NOT EXISTS reminder_days INTEGER DEFAULT 0`);
  await pool.query(`ALTER TABLE holidays ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ`);
  console.log('  ok   holidays.day_type / reminder_days / reminder_sent_at');
  await pool.end();
})().catch(async (e) => {
  console.error(e);
  try { await pool.end(); } catch {}
  process.exit(1);
});
