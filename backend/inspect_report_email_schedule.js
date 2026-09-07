#!/usr/bin/env node
/* Would today be a send day for any scheduled report, and what date range
 * would it cover? Answers WITHOUT sending anything and regardless of
 * whether any report is switched on in Settings — pure schedule logic,
 * checked against the real holiday/weekend calendar and each report's own
 * saved settings (includeNonWorkingDays, and — for the widened catalog —
 * its chosen cadence).
 *
 * READ ONLY. Nothing here writes or sends mail.
 *
 *   node inspect_report_email_schedule.js            today
 *   node inspect_report_email_schedule.js 2026-09-26 a specific date
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('this script does not send mail'); },
  verify: async () => { throw new Error('this script does not send mail'); },
});

const pool = require('./db');
const schedule = require('./utils/reportEmailSchedule');
const { getConfig, recipientsFor, FIXED_META, CUTOFF_REPORTS, CHOOSABLE_KEYS } = require('./utils/reportEmailSender');

const DATE = process.argv[2] || schedule.todayYmd();

(async () => {
  console.log(`\n=== Scheduled report emails — schedule check for ${DATE} ===\n`);

  const isWorking = await schedule.isWorkingDay(DATE);
  console.log(`${DATE} is a ${isWorking ? 'WORKING' : 'NON-WORKING (weekend/holiday)'} day.\n`);

  const cfg = await getConfig();

  console.log('── Daily / weekly-cadence reports (own includeNonWorkingDays override) ──\n');
  for (const [key, meta] of Object.entries(FIXED_META)) {
    const reportCfg = cfg[key];
    const due = await schedule.isDueForCadence(meta.cadence, DATE, { includeNonWorkingDays: reportCfg.includeNonWorkingDays });
    const range = await schedule.rangeForCadence(meta.cadence, DATE);
    const to = reportCfg.enabled ? await recipientsFor(reportCfg) : [];
    console.log(`  ${key.padEnd(18)} enabled=${String(reportCfg.enabled).padEnd(5)} includeNonWorkingDays=${String(!!reportCfg.includeNonWorkingDays).padEnd(5)}`
      + ` due=${due}${due ? `  range=${range.start}..${range.end}` : ''}${reportCfg.enabled ? `  recipients=${to.length}` : ''}`);
  }

  console.log('\n── Monthly payroll-cutoff group (fixed timing, no override) ──\n');
  const monthlyCutoff = await schedule.monthlyCutoffDate(DATE);
  const cutoffDue = await schedule.isMonthlyCutoffDue(DATE);
  const cutoffRange = schedule.monthToCutoffRange(DATE);
  console.log(`  Cutoff for this month resolves to: ${monthlyCutoff}`);
  console.log(`  Due today: ${cutoffDue}${cutoffDue ? `  range=${cutoffRange.start}..${cutoffRange.end}` : ''}`);
  for (const key of CUTOFF_REPORTS) {
    const reportCfg = cfg[key];
    const to = reportCfg.enabled ? await recipientsFor(reportCfg) : [];
    console.log(`    ${key.padEnd(18)} enabled=${String(reportCfg.enabled).padEnd(5)}${reportCfg.enabled ? `  recipients=${to.length}` : ''}`);
  }
  console.log(`    regularizationReminder enabled=${cfg.regularizationReminder.enabled} (recipients are structural — each pending approver)`);

  console.log('\n── Widened catalog (admin-chosen cadence) ──\n');
  for (const key of CHOOSABLE_KEYS) {
    const reportCfg = cfg[key];
    const cadence = ['daily', 'weekly', 'monthly'].includes(reportCfg.cadence) ? reportCfg.cadence : 'weekly';
    const due = await schedule.isDueForCadence(cadence, DATE, { includeNonWorkingDays: reportCfg.includeNonWorkingDays });
    const range = await schedule.rangeForCadence(cadence, DATE);
    const to = reportCfg.enabled ? await recipientsFor(reportCfg) : [];
    console.log(`  ${key.padEnd(18)} enabled=${String(reportCfg.enabled).padEnd(5)} cadence=${cadence.padEnd(8)} includeNonWorkingDays=${String(!!reportCfg.includeNonWorkingDays).padEnd(5)}`
      + ` due=${due}${due ? `  range=${range.start}..${range.end}` : ''}${reportCfg.enabled ? `  recipients=${to.length}` : ''}`);
  }

  console.log('\nNothing above sends anything — this script never calls sendMail.\n');
  await pool.end();
})().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
