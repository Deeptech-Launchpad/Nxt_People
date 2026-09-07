/**
 * utils/reportEmailSender.js
 *
 * Orchestrates the scheduled report emails: reads settings.report_email_config,
 * asks reportEmailSchedule.js whether today is the day for each report, and
 * if so and the report is switched on, builds it (reportEmailContent.js) and
 * hands it to mailer.js's sendMail — which is where EMAIL_DISABLED /
 * EMAIL_ALLOWLIST already live, unchanged. Nothing here bypasses them.
 *
 * Two families of report:
 *
 *   FIXED_META / CUTOFF_REPORTS   the original seven — Daily/Weekly/Monthly
 *     Attendance, Onboarding Data, Muster Roll, Payroll Feed, LOP Data.
 *     Their cadence is baked into what they ARE (Payroll Feed is always tied
 *     to the payroll cutoff), so it isn't a setting. Daily and the three
 *     weekly ones DO carry one override each — includeNonWorkingDays, for a
 *     company that wants them even on a weekend or holiday.
 *
 *   CHOOSABLE_KEYS   the widened catalog — Headcount, Addition Trend,
 *     Attrition Trend, Experience & Exit. These reuse reports that already
 *     exist in the app, so their cadence (daily/weekly/monthly) is a setting
 *     an admin picks, not something the report identity dictates.
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
const schedule = require('./reportEmailSchedule');
const content = require('./reportEmailContent');

const FIXED_META = {
  dailyAttendance:  { cadence: 'daily' },
  weeklyAttendance: { cadence: 'weekly' },
  onboardingData:   { cadence: 'weekly' },
  musterRoll:       { cadence: 'weekly' },
};
const CUTOFF_REPORTS = ['monthlyAttendance', 'payrollFeed', 'lopData'];
const CHOOSABLE_KEYS = ['headcount', 'additionTrend', 'attritionTrend', 'experienceExit'];
const CADENCE_OPTIONS = ['daily', 'weekly', 'monthly'];

// range -> the exact args each content builder expects. Kept here rather
// than in reportEmailContent.js so that file stays pure "given a range,
// here is the data" — the mapping from a cadence's range shape to a
// specific function signature is a scheduling concern, not a content one.
const BUILDERS = {
  dailyAttendance:   (range, custom) => content.dailyAttendanceEmail(range.end, custom),
  weeklyAttendance:  async (range, custom) => content.weeklyAttendanceEmail(
    range.start, range.end, await schedule.holidaysInRange(range.start, range.end), custom),
  onboardingData:    (range, custom) => content.onboardingEmail(range.start, range.end, custom),
  musterRoll:        (range, custom) => content.musterRollEmail(range.start, range.end, custom),
  monthlyAttendance: (range, custom) => content.monthlyAttendanceEmail(range.start, range.end, custom),
  payrollFeed:       (range, custom) => content.payrollFeedEmail(range.start, range.end, custom),
  lopData:           (range, custom) => content.lopDataEmail(range.start, range.end, custom),
  headcount:         (range, custom) => content.headcountEmail(range.start, range.end, custom),
  additionTrend:     (range, custom) => content.additionTrendEmail(range.start, range.end, custom),
  attritionTrend:    (range, custom) => content.attritionTrendEmail(range.start, range.end, custom),
  experienceExit:    (range, custom) => content.experienceExitEmail(range.start, range.end, custom),
};

const BASE_RECIPIENT_FIELDS = { recipients: [], roles: [], employeeIds: [] };
const BASE_CUSTOM_FIELDS = { customSubject: '', customBody: '' };

const DEFAULT_CONFIG = {
  dailyAttendance:        { enabled: false, ...BASE_RECIPIENT_FIELDS, includeNonWorkingDays: false, ...BASE_CUSTOM_FIELDS },
  weeklyAttendance:       { enabled: false, ...BASE_RECIPIENT_FIELDS, includeNonWorkingDays: false, ...BASE_CUSTOM_FIELDS },
  onboardingData:         { enabled: false, ...BASE_RECIPIENT_FIELDS, includeNonWorkingDays: false, ...BASE_CUSTOM_FIELDS },
  musterRoll:             { enabled: false, ...BASE_RECIPIENT_FIELDS, includeNonWorkingDays: false, ...BASE_CUSTOM_FIELDS },
  monthlyAttendance:      { enabled: false, ...BASE_RECIPIENT_FIELDS, ...BASE_CUSTOM_FIELDS },
  payrollFeed:            { enabled: false, ...BASE_RECIPIENT_FIELDS, ...BASE_CUSTOM_FIELDS },
  lopData:                { enabled: false, ...BASE_RECIPIENT_FIELDS, ...BASE_CUSTOM_FIELDS },
  // No recipients/roles/employeeIds — who gets this one is structural (their
  // own hierarchy-scoped pending list), not a free choice of addresses.
  regularizationReminder: { enabled: false, ...BASE_CUSTOM_FIELDS },
  headcount:              { enabled: false, ...BASE_RECIPIENT_FIELDS, cadence: 'weekly', includeNonWorkingDays: false, ...BASE_CUSTOM_FIELDS },
  additionTrend:          { enabled: false, ...BASE_RECIPIENT_FIELDS, cadence: 'weekly', includeNonWorkingDays: false, ...BASE_CUSTOM_FIELDS },
  attritionTrend:         { enabled: false, ...BASE_RECIPIENT_FIELDS, cadence: 'weekly', includeNonWorkingDays: false, ...BASE_CUSTOM_FIELDS },
  experienceExit:         { enabled: false, ...BASE_RECIPIENT_FIELDS, cadence: 'weekly', includeNonWorkingDays: false, ...BASE_CUSTOM_FIELDS },
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
  let employeeEmails = [];
  if ((reportCfg.employeeIds || []).length) {
    // id cast to text on both sides — works whether the underlying column is
    // an integer sequence or a uuid, without needing to know which.
    const r = await pool.query(
      `SELECT email FROM employees
        WHERE id::text = ANY($1::text[]) AND status='active' AND deleted_at IS NULL AND email IS NOT NULL`,
      [reportCfg.employeeIds.map(String)]);
    employeeEmails = r.rows.map(x => x.email);
  }
  return [...new Set([...explicit, ...roleEmails, ...employeeEmails].filter(Boolean))];
}

const customFor = (reportCfg) => ({ subject: reportCfg.customSubject, body: reportCfg.customBody });

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
 * One pass. Safe to call from a daily cron — every report's send attempt is
 * its own try/catch so one report's failure (a bad query, a missing table on
 * an old deploy) can never block the others from going out.
 *
 * @param opts.dateYmd  'YYYY-MM-DD' to treat as today (tests only).
 */
async function sweepReportEmails(opts = {}) {
  const today = opts.dateYmd || schedule.todayYmd();
  const summary = [];
  const cfg = await getConfig();

  // Daily Attendance + the three weekly-cadence reports, each on its own
  // includeNonWorkingDays override.
  for (const [key, meta] of Object.entries(FIXED_META)) {
    try {
      const reportCfg = cfg[key];
      const due = await schedule.isDueForCadence(meta.cadence, today, { includeNonWorkingDays: reportCfg.includeNonWorkingDays });
      if (!due) continue;
      const range = await schedule.rangeForCadence(meta.cadence, today);
      summary.push(await sendIfConfigured(key, cfg, () => BUILDERS[key](range, customFor(reportCfg))));
    } catch (err) {
      logger.error({ err: err.message, key }, '[reportEmails] fixed-cadence report failed');
      summary.push({ key, sent: false, reason: err.message });
    }
  }

  // Payroll-cutoff group — fixed timing, no per-report override, plus the
  // regularization reminder that shares its day.
  try {
    if (await schedule.isMonthlyCutoffDue(today)) {
      const range = schedule.monthToCutoffRange(today);
      for (const key of CUTOFF_REPORTS) {
        summary.push(await sendIfConfigured(key, cfg, () => BUILDERS[key](range, customFor(cfg[key]))));
      }

      if (cfg.regularizationReminder.enabled) {
        const staff = (await pool.query(
          `SELECT id, email, role FROM employees
            WHERE role = ANY($1::text[]) AND status='active' AND deleted_at IS NULL AND email IS NOT NULL`,
          [APPROVERS])).rows;
        let sentCount = 0;
        for (const person of staff) {
          try {
            const built = await content.regularizationReminderEmail(
              person.id, isFullAccess(person.role), customFor(cfg.regularizationReminder));
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
    logger.error({ err: err.message }, '[reportEmails] monthly cutoff group failed');
    summary.push({ key: 'monthlyCutoff', sent: false, reason: err.message });
  }

  // Widened catalog — cadence is an admin choice per report.
  for (const key of CHOOSABLE_KEYS) {
    try {
      const reportCfg = cfg[key];
      const cadence = CADENCE_OPTIONS.includes(reportCfg.cadence) ? reportCfg.cadence : 'weekly';
      const due = await schedule.isDueForCadence(cadence, today, { includeNonWorkingDays: reportCfg.includeNonWorkingDays });
      if (!due) continue;
      const range = await schedule.rangeForCadence(cadence, today);
      summary.push(await sendIfConfigured(key, cfg, () => BUILDERS[key](range, customFor(reportCfg))));
    } catch (err) {
      logger.error({ err: err.message, key }, '[reportEmails] widened-catalog report failed');
      summary.push({ key, sent: false, reason: err.message });
    }
  }

  return summary;
}

module.exports = {
  sweepReportEmails, getConfig, saveConfig, recipientsFor, DEFAULT_CONFIG,
  FIXED_META, CUTOFF_REPORTS, CHOOSABLE_KEYS, CADENCE_OPTIONS,
};
