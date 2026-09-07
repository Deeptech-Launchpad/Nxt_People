/**
 * utils/reportEmailSender.js
 *
 * Orchestrates the scheduled report emails: reads settings.report_email_config,
 * asks reportEmailSchedule.js whether today is the day for each cadence, and
 * if so and the report is switched on, builds it (reportEmailContent.js) and
 * hands it to mailer.js's sendMail — which is where EMAIL_DISABLED /
 * EMAIL_ALLOWLIST already live, unchanged. Nothing here bypasses them.
 *
 * Every report defaults to { enabled: false }, so a deploy of this file
 * alone sends nothing — an admin has to switch each one on individually in
 * Settings -> Attendance -> Automation -> Scheduled Reports, and name who
 * receives it, before anything goes out.
 */
const pool = require('../db');
const logger = require('../logger');
const { sendMail } = require('./mailer');
const { APPROVERS, isFullAccess } = require('./roles');
const { addDays } = require('./regularizationWindow');
const schedule = require('./reportEmailSchedule');
const content = require('./reportEmailContent');

// recipients: explicit email addresses. roles: role keys whose active users
// also receive it. Both configurable independently — "make this configurable"
// means both by name and by role, not one or the other.
const DEFAULT_CONFIG = {
  dailyAttendance:        { enabled: false, recipients: [], roles: [] },
  weeklyAttendance:       { enabled: false, recipients: [], roles: [] },
  onboardingData:         { enabled: false, recipients: [], roles: [] },
  musterRoll:             { enabled: false, recipients: [], roles: [] },
  monthlyAttendance:      { enabled: false, recipients: [], roles: [] },
  payrollFeed:            { enabled: false, recipients: [], roles: [] },
  lopData:                { enabled: false, recipients: [], roles: [] },
  // No recipients field — who gets this one is structural (their own
  // hierarchy-scoped pending list), not a free choice of addresses.
  regularizationReminder: { enabled: false },
};

async function getConfig() {
  const r = await pool.query(`SELECT report_email_config AS c FROM settings LIMIT 1`).catch(() => ({ rows: [] }));
  const stored = r.rows[0]?.c || {};
  const merged = {};
  for (const key of Object.keys(DEFAULT_CONFIG)) merged[key] = { ...DEFAULT_CONFIG[key], ...(stored[key] || {}) };
  return merged;
}

async function saveConfig(next) {
  const cur = (await pool.query(`SELECT report_email_config AS c FROM settings LIMIT 1`)).rows[0]?.c || {};
  const merged = { ...cur, ...next };
  await pool.query(
    `UPDATE settings SET report_email_config = $1::jsonb, updated_at = NOW()
      WHERE id = (SELECT id FROM settings LIMIT 1)`,
    [JSON.stringify(merged)]);
  return merged;
}

async function recipientsFor(reportCfg) {
  const explicit = (reportCfg.recipients || []).filter(Boolean);
  let roleEmails = [];
  if ((reportCfg.roles || []).length) {
    const r = await pool.query(
      `SELECT email FROM employees
        WHERE role = ANY($1::text[]) AND status='active' AND deleted_at IS NULL AND email IS NOT NULL`,
      [reportCfg.roles]);
    roleEmails = r.rows.map(x => x.email);
  }
  return [...new Set([...explicit, ...roleEmails].filter(Boolean))];
}

async function sendIfConfigured(key, cfg, builder) {
  const reportCfg = cfg[key];
  if (!reportCfg?.enabled) return { key, sent: false, reason: 'disabled' };
  const to = await recipientsFor(reportCfg);
  if (!to.length) return { key, sent: false, reason: 'no recipients configured' };
  const { subject, text, html } = await builder();
  await sendMail({ to, subject, text, html });
  return { key, sent: true, to: to.length };
}

/**
 * One pass. Safe to call from a daily cron — every cadence check is its own
 * try/catch so one report's failure (a bad query, a missing table on an old
 * deploy) can never block the others from going out.
 *
 * @param opts.now      Date to treat as now (tests only).
 * @param opts.dateYmd  'YYYY-MM-DD' to treat as today (tests only) — overrides now.
 */
async function sweepReportEmails(opts = {}) {
  const today = opts.dateYmd || schedule.todayYmd();
  const summary = [];
  const cfg = await getConfig();

  try {
    if (await schedule.isDailyDue(today)) {
      const yesterday = addDays(today, -1);
      summary.push(await sendIfConfigured('dailyAttendance', cfg, () => content.dailyAttendanceEmail(yesterday)));
    }
  } catch (err) {
    logger.error({ err: err.message }, '[reportEmails] daily attendance failed');
    summary.push({ key: 'dailyAttendance', sent: false, reason: err.message });
  }

  try {
    if (await schedule.isWeeklyDue(today)) {
      const { start, end } = schedule.weekJustClosedRange(today);
      const holidays = await schedule.holidaysInRange(start, end);
      summary.push(await sendIfConfigured('weeklyAttendance', cfg, () => content.weeklyAttendanceEmail(start, end, holidays)));
      summary.push(await sendIfConfigured('onboardingData', cfg, () => content.onboardingEmail(start, end)));
      summary.push(await sendIfConfigured('musterRoll', cfg, () => content.musterRollEmail(start, end)));
    }
  } catch (err) {
    logger.error({ err: err.message }, '[reportEmails] weekly cadence failed');
    summary.push({ key: 'weekly', sent: false, reason: err.message });
  }

  try {
    if (await schedule.isMonthlyCutoffDue(today)) {
      const { start, end } = schedule.monthToCutoffRange(today);
      summary.push(await sendIfConfigured('monthlyAttendance', cfg, () => content.monthlyAttendanceEmail(start, end)));
      summary.push(await sendIfConfigured('payrollFeed', cfg, () => content.payrollFeedEmail(start, end)));
      summary.push(await sendIfConfigured('lopData', cfg, () => content.lopDataEmail(start, end)));

      if (cfg.regularizationReminder.enabled) {
        const staff = (await pool.query(
          `SELECT id, email, role FROM employees
            WHERE role = ANY($1::text[]) AND status='active' AND deleted_at IS NULL AND email IS NOT NULL`,
          [APPROVERS])).rows;
        let sentCount = 0;
        for (const person of staff) {
          try {
            const built = await content.regularizationReminderEmail(person.id, isFullAccess(person.role));
            if (!built) continue; // nothing pending for this person — no mail
            await sendMail({ to: person.email, subject: built.subject, text: built.text, html: built.html });
            sentCount++;
          } catch (err) {
            logger.error({ err: err.message, employeeId: person.id },
              '[reportEmails] regularization reminder failed for one recipient');
          }
        }
        summary.push({ key: 'regularizationReminder', sent: sentCount > 0, to: sentCount });
      } else {
        summary.push({ key: 'regularizationReminder', sent: false, reason: 'disabled' });
      }
    }
  } catch (err) {
    logger.error({ err: err.message }, '[reportEmails] monthly cadence failed');
    summary.push({ key: 'monthly', sent: false, reason: err.message });
  }

  return summary;
}

module.exports = { sweepReportEmails, getConfig, saveConfig, recipientsFor, DEFAULT_CONFIG };
