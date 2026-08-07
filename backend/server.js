/**
 * server.js — Entry point.
 * Imports the Express app factory from app.js (single source of truth for
 * routes and middleware) then starts the HTTP server and cron jobs.
 */
const http  = require('http');
const cron  = require('node-cron');
require('dotenv').config();

const app     = require('./app');   // ← single source of truth for all routes
const pool    = require('./db');
const logger  = require('./logger');
const chatWs  = require('./ws-chat');
const { isNonWorkingDay } = require('./utils/workingDays');
const { sendCheckInReminderEmail, sendCheckOutReminderEmail } = require('./utils/mailer');
const { DEFAULT_TZ } = require('./utils/timezone');

// Process-level safety nets. Without these, an unhandled promise rejection
// just prints a deprecation warning (then crashes silently in future Node
// versions), and an uncaught exception kills the process with no log.
process.on('unhandledRejection', (reason) => {
  logger.error({ reason: reason?.message || reason, stack: reason?.stack }, 'Unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
  logger.error({ err: err?.message, stack: err?.stack }, 'Uncaught exception — exiting');
  // Don't try to keep running after an uncaught exception; the process
  // state is unpredictable. The Docker restart policy will bring us back.
  setTimeout(() => process.exit(1), 100);
});

// Check DB Connection + bootstrap the configured admin user.
pool.query('SELECT NOW()', async (err) => {
  if (err) { logger.error({ err }, 'PostgreSQL connection failed'); return; }
  logger.info('PostgreSQL connected');
  await ensureAdminUser();
});

/**
 * Idempotent bootstrap: for every email listed in ADMIN_EMAIL (comma-separated
 * if you want more than one), if no row exists for that email, insert a
 * placeholder admin with no password. They sign in by visiting /login,
 * entering their email, clicking "Forgot password", and following the reset
 * link they receive in their inbox.
 *
 * If a row already exists (regardless of its current role) we leave it
 * alone — no privilege elevation, no overwrites. Promotion of an existing
 * employee to admin is a deliberate manual step in Employee Master.
 *
 * Examples of valid values for ADMIN_EMAIL:
 *   balaji@altiusnxt.com
 *   balaji@altiusnxt.com, manikandan@altiusnxt.com
 *   balaji@altiusnxt.com; ops@altiusnxt.com   (semicolons also accepted)
 */
async function ensureAdminUser() {
  const raw = process.env.ADMIN_EMAIL || '';
  const emails = raw
    .split(/[,;\s]+/)
    .map(e => e.trim().toLowerCase())
    .filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));

  if (emails.length === 0) return;

  for (const email of emails) {
    try {
      const existing = await pool.query('SELECT id, role FROM employees WHERE LOWER(email) = $1', [email]);
      if (existing.rows.length > 0) {
        const row = existing.rows[0];
        if (row.role !== 'admin') {
          logger.warn({ email, currentRole: row.role }, 'ADMIN_EMAIL exists with non-super_admin role — not auto-elevating. Promote manually if intended.');
        } else {
          logger.info({ email }, 'Bootstrap super admin already present');
        }
        continue;
      }
      await pool.query(
        `INSERT INTO employees
           (first_name, last_name, email, role, status,
            registration_status, has_accepted, accepted_at, employee_id)
         VALUES ('Admin', '', $1, 'admin', 'active', 'active', TRUE, NOW(),
                 'ADMIN-' || SUBSTRING(MD5(RANDOM()::text) FROM 1 FOR 6))`,
        [email]
      );
      logger.info({ email }, 'Bootstrap admin created — log in via "Forgot password" to set a password');
    } catch (e) {
      logger.error({ err: e, email }, 'Failed to bootstrap admin user');
    }
  }
}

const PORT = process.env.PORT || 5000;
// Wrap Express in an http.Server so the chat WebSocket server can share
// the same port (handles `upgrade` events on /ws/chat). The HTTP routes
// continue to work exactly as before via the Express request listener.
const server = http.createServer(app);
chatWs.attach(server);
server.listen(PORT, () => logger.info({ port: PORT }, 'Server listening (HTTP + WebSocket)'));

// ── Graceful shutdown ─────────────────────────────────────────────────────────
// Docker sends SIGTERM and waits up to `stop_grace_period` (10s default)
// before SIGKILL. Without this handler, in-flight HTTP requests are
// dropped mid-response and the PG pool is yanked away without releasing
// active clients. Order matters:
//   1. Stop accepting new connections (server.close)
//   2. Let in-flight requests drain
//   3. Close the DB pool so Node can exit cleanly
let shuttingDown = false;
async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutdown signal received — draining');

  // Hard ceiling: if shutdown hangs, force-exit before Docker sends SIGKILL.
  const forceTimer = setTimeout(() => {
    logger.warn('Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 8000);
  forceTimer.unref();

  server.close((err) => {
    if (err) logger.warn({ err: err.message }, 'HTTP server close error');
    pool.end()
      .then(() => { logger.info('DB pool drained — exiting cleanly'); process.exit(0); })
      .catch((e) => { logger.error({ err: e.message }, 'DB pool drain failed'); process.exit(1); });
  });
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));


// ================= CRON JOBS =================
// Every cron below must explicitly pin its timezone. node-cron defaults
// to the container's system clock, which is UTC in Docker — so a `0 9
// * * 1-6` schedule was firing at 14:30 IST instead of 09:00 IST, and
// the 9 AM check-in reminder never landed when employees expected it.
// Configurable via CRON_TZ env var so non-Indian deployments can flip
// to America/New_York etc. without a code change.
const CRON_TZ = process.env.CRON_TZ || DEFAULT_TZ;
const cronOpts = { timezone: CRON_TZ };
logger.info({ CRON_TZ }, 'Cron jobs configured to run in this timezone');

// 1. Monthly Leave Accrual (Runs on the 1st of every month at midnight)
cron.schedule('0 0 1 * *', async () => {
  try {
    logger.info('Running monthly leave accrual cron');
    const settingsRes = await pool.query('SELECT * FROM settings LIMIT 1');
    const s = settingsRes.rows[0];
    if (!s?.leave_accrual_enabled) {
      logger.info('Leave accrual disabled in settings — skipping');
      return;
    }
    // Batch accrual: one UPDATE + one bulk INSERT per leave type. Avoids the
    // per-employee N+1 (was 6 round-trips × N employees). Matches the
    // payroll.js implementation so behaviour is identical between the cron
    // path and the admin-triggered POST /api/payroll/accrue path.
    const empRes = await pool.query("SELECT id FROM employees WHERE status='active'");
    const empIds = empRes.rows.map(r => r.id);
    const credited = empIds.length;

    const accrue = async (column, code, days) => {
      if (!days || days <= 0 || empIds.length === 0) return;
      await pool.query(
        `UPDATE employees SET ${column} = COALESCE(${column},0) + $1 WHERE id = ANY($2::uuid[])`,
        [days, empIds]
      );
      await pool.query(
        `INSERT INTO leave_accrual_log (employee_id, leave_type, days_added, reason)
         SELECT unnest($1::uuid[]), $2, $3, 'Auto Monthly Accrual'`,
        [empIds, code, days]
      );
    };

    await accrue('casual_leave', 'casual', s.casual_accrual_per_month);
    await accrue('sick_leave',   'sick',   s.sick_accrual_per_month);
    await accrue('earned_leave', 'earned', s.earned_accrual_per_month);

    logger.info({ credited }, 'Monthly leave accrual complete');
  } catch (err) {
    logger.error({ err }, 'Leave accrual cron failed');
  }
}, cronOpts);

// 2. Yearly Leave Carry Forward / Lapse (Runs on Jan 1st at 00:05)
cron.schedule('5 0 1 1 *', async () => {
  try {
    logger.info('Running yearly leave carry forward / lapse cron');
    // Single set-based UPDATE replaces the per-employee loop. We snapshot
    // the OLD earned_leave in a CTE first because RETURNING returns
    // post-UPDATE values, which would make the logged delta always 0.
    // TODO: read the cap from settings.leave_policy when that schema is finalised.
    const maxEarned = 15;
    const r = await pool.query(
      `WITH old_vals AS (
         SELECT id, COALESCE(earned_leave, 0)::numeric AS old_earned
           FROM employees
          WHERE status = 'active'
       ),
       ups AS (
         UPDATE employees e
            SET casual_leave = 0,
                sick_leave   = 0,
                earned_leave = LEAST(o.old_earned, $1)
           FROM old_vals o
          WHERE e.id = o.id
          RETURNING e.id, (LEAST(o.old_earned, $1) - o.old_earned) AS delta
       )
       INSERT INTO leave_accrual_log (employee_id, leave_type, days_added, reason)
       SELECT id, 'earned', delta, 'Yearly Lapse & Carry Forward' FROM ups`,
      [maxEarned]
    );
    logger.info({ affected: r.rowCount }, 'Yearly leave carry forward complete');
  } catch (err) {
    logger.error({ err }, 'Yearly carry forward cron failed');
  }
}, cronOpts);

// 3. Daily Check-in Reminder (Runs Mon-Sat at 9:00 AM)
//    Skips weekends + holidays via the centralised rule evaluator.
//    Single INSERT...SELECT replaces per-employee N+1 (was N round-trips at 150 employees).
cron.schedule('0 9 * * 1-6', async () => {
  try {
    if (await isNonWorkingDay()) return;
    logger.info('Sending daily 9 AM Check-in reminders');
    const r = await pool.query(
      `INSERT INTO notifications (employee_id, type, title, message, link)
       SELECT id, 'attendance', 'Check-in Reminder', $1, '/attendance/my'
         FROM employees WHERE status='active'`,
      ["Don't forget to check in for the day!"]
    );
    logger.info({ sent: r.rowCount }, '9 AM Check-in reminders sent');
    // Working-day guard before sending reminder emails.
    // Skips on Sundays, company holidays, 1st/3rd Saturdays, or any
    // non-working day declared in the holidays / weekend_rules tables.
    if (await isNonWorkingDay()) {
      logger.info('Non-working day — check-in reminder emails skipped');
      return;
    }
    const empEmails = await pool.query(
      `SELECT email, COALESCE(first_name || ' ' || last_name, email) AS name FROM employees WHERE status='active' AND email IS NOT NULL AND email != '' AND LOWER(email) != 'vellayan@altiusnxt.com'`
    );
    // Send sequentially — firing all SMTP connections at once trips Gmail rate limits,
    // causing only some employees to receive the email. Sequential sending with one
    // connection at a time keeps the rate within Gmail's tolerance.
    for (const emp of empEmails.rows) {
      await sendCheckInReminderEmail({ to: emp.email, employeeName: emp.name })
        .catch(err => logger.warn({ err: err.message, email: emp.email }, '9 AM check-in email failed'));
    }
    logger.info({ emails: empEmails.rowCount }, '9 AM Check-in reminder emails sent');
  } catch (err) {
    logger.error({ err }, 'Error sending 9 AM reminders');
  }
}, cronOpts);

// 4. Daily Check-out Reminder (Runs Mon-Sat at 6:00 PM)
cron.schedule('0 18 * * 1-6', async () => {
  try {
    if (await isNonWorkingDay()) return;
    logger.info('Sending daily 6 PM Check-out reminders');
    const r = await pool.query(
      `INSERT INTO notifications (employee_id, type, title, message, link)
       SELECT id, 'attendance', 'Check-out Reminder', $1, '/attendance/my'
         FROM employees WHERE status='active'`,
      ["It's 6 PM! Don't forget to check out before you leave."]
    );
    logger.info({ sent: r.rowCount }, '6 PM Check-out reminders sent');
    // Working-day guard before sending reminder emails.
    // Skips on Sundays, company holidays, 1st/3rd Saturdays, or any
    // non-working day declared in the holidays / weekend_rules tables.
    if (await isNonWorkingDay()) {
      logger.info('Non-working day — check-out reminder emails skipped');
      return;
    }
    const empEmails = await pool.query(
      `SELECT email, COALESCE(first_name || ' ' || last_name, email) AS name FROM employees WHERE status='active' AND email IS NOT NULL AND email != '' AND LOWER(email) != 'vellayan@altiusnxt.com'`
    );
    // Send sequentially — same reason as the check-in cron above.
    for (const emp of empEmails.rows) {
      await sendCheckOutReminderEmail({ to: emp.email, employeeName: emp.name })
        .catch(err => logger.warn({ err: err.message, email: emp.email }, '6 PM check-out email failed'));
    }
    logger.info({ emails: empEmails.rowCount }, '6 PM Check-out reminder emails sent');
  } catch (err) {
    logger.error({ err }, 'Error sending 6 PM reminders');
  }
}, cronOpts);

// 5. Auto-flip Notice Period employees past their end date → Resigned.
//    Runs daily at 00:30. This is the access-revocation trigger: once an
//    employee's status is no longer 'active', the login route rejects them.
cron.schedule('30 0 * * *', async () => {
  try {
    const r = await pool.query(
      `UPDATE employees
          SET status            = 'resigned',
              exit_date         = COALESCE(exit_date, notice_period_end_date),
              status_applied_at = NOW(),
              updated_at        = NOW()
        WHERE status = 'notice_period'
          AND notice_period_end_date IS NOT NULL
          AND notice_period_end_date < CURRENT_DATE
        RETURNING email`
    );
    if (r.rowCount > 0) {
      logger.info({ resigned: r.rowCount, emails: r.rows.map(x => x.email) }, 'Auto-flipped Notice Period → Resigned');
    }
  } catch (err) {
    logger.error({ err }, 'Notice Period auto-flip cron failed');
  }
}, cronOpts);

// 6. Auto-unpin expired announcements (Runs daily at 00:15).
//    HR sets pinned_until when posting; this flips is_pinned to FALSE once
//    that date passes. The announcement stays visible (is_active stays TRUE) —
//    it just loses the pin badge, matching Slack/Zoho behaviour.
cron.schedule('15 0 * * *', async () => {
  try {
    const r = await pool.query(
      `UPDATE announcements
          SET is_pinned = FALSE, updated_at = NOW()
        WHERE is_pinned = TRUE
          AND pinned_until IS NOT NULL
          AND pinned_until <= NOW()
        RETURNING id`
    );
    if (r.rowCount > 0) {
      logger.info({ unpinned: r.rowCount }, 'Auto-unpinned expired announcements');
    }
  } catch (err) {
    logger.error({ err }, 'Auto-unpin cron failed');
  }
}, cronOpts);

// 7. Auto-draft payroll on the 1st of each month at 00:30 — generates
//    draft payslips for the *previous* month. Admins still need to lock
//    each slip manually (so a final review step exists before employees
//    see them), but the heavy lifting is automated. Idempotent: re-running
//    skips existing drafts unless force=true is passed manually.
cron.schedule('30 0 1 * *', async () => {
  try {
    logger.info('Running monthly auto-draft payroll cron');
    const today = new Date();
    const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const month = prev.getMonth() + 1;
    const year = prev.getFullYear();
    // Calls the SAME function POST /api/payroll/admin/run-month calls — this
    // used to be an inlined, simplified duplicate of that logic (no LOP
    // proration, no reimbursements/adjustments/loans/TDS, no arrears) that
    // had drifted from the real thing. One implementation now, actorId=null
    // marks these payslips as system-generated rather than admin-triggered.
    const { runMonthlyPayroll } = require('./routes/payroll');
    const results = await runMonthlyPayroll({ month, year, force: false, actorId: null });
    logger.info({ month, year, ...results }, 'Auto-draft payroll cron complete');
  } catch (err) {
    logger.error({ err }, 'Auto-draft payroll cron failed');
  }
}, cronOpts);

// 8. Nightly Zoho People sync (runs daily at 02:30 — quiet hours).
//    Re-uses the same runEmployeeSync() function the admin's manual
//    "Sync Now" button calls, so behaviour is identical. Disabled if
//    ZOHO_REFRESH_TOKEN isn't set (org doesn't have Zoho integration).
cron.schedule('30 2 * * *', async () => {
  if (!process.env.ZOHO_REFRESH_TOKEN) return;
  try {
    const { runEmployeeSync } = require('./routes/admin-zoho');
    if (typeof runEmployeeSync !== 'function') return;
    logger.info('Running nightly Zoho employee sync');
    const stats = await runEmployeeSync('cron');
    logger.info({ stats }, 'Nightly Zoho sync complete');

    // Surface partial failures to admins. Previously these only landed in
    // stdout — silent in production. If any record failed, raise a
    // notification on each admin so HR can fix the Zoho records.
    if (stats?.errors?.length > 0) {
      try {
        const { createNotification } = require('./routes/notifications');
        const admins = await pool.query(`SELECT id FROM employees WHERE role IN ('admin','director') AND status='active'`);
        const sample = stats.errors.slice(0, 3).map(e => `${e.email}: ${e.message}`).join('; ');
        const body =
          `${stats.errors.length} record(s) failed during last night's Zoho sync. ` +
          `First few: ${sample}${stats.errors.length > 3 ? ` …and ${stats.errors.length - 3} more.` : ''}`;
        for (const a of admins.rows) {
          await createNotification(a.id, 'system', 'Zoho Sync — Partial Failure', body, '/admin/zoho');
        }
      } catch (e) { logger.error({ err: e.message }, 'Failed to notify admins about Zoho sync errors'); }
    }
  } catch (err) {
    logger.error({ err }, 'Nightly Zoho sync failed');
    // Whole-sync failure (auth, network, etc.) — also notify admins.
    try {
      const { createNotification } = require('./routes/notifications');
      const admins = await pool.query(`SELECT id FROM employees WHERE role IN ('admin','director') AND status='active'`);
      for (const a of admins.rows) {
        await createNotification(a.id, 'system', 'Zoho Sync Failed',
          `Last night's Zoho sync did not complete: ${err.message}`,
          '/admin/zoho');
      }
    } catch (_) {}
  }
}, cronOpts);

module.exports = app;

