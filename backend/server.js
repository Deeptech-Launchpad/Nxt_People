/**
 * server.js — Entry point.
 * Imports the Express app factory from app.js (single source of truth for
 * routes and middleware) then starts the HTTP server and cron jobs.
 */
const cron = require('node-cron');
require('dotenv').config();

const app    = require('./app');   // ← single source of truth for all routes
const pool   = require('./db');
const logger = require('./logger');
const { isNonWorkingDay } = require('./utils/workingDays');

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
          logger.warn({ email, currentRole: row.role }, 'ADMIN_EMAIL exists with non-admin role — not auto-elevating. Promote manually if intended.');
        } else {
          logger.info({ email }, 'Bootstrap admin already present');
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
app.listen(PORT, () => logger.info({ port: PORT }, 'Server listening'));


// ================= CRON JOBS =================
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
});

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
});

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
  } catch (err) {
    logger.error({ err }, 'Error sending 9 AM reminders');
  }
});

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
  } catch (err) {
    logger.error({ err }, 'Error sending 6 PM reminders');
  }
});

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
});

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
});

module.exports = app;

