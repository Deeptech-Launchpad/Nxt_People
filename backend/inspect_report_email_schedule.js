#!/usr/bin/env node
/* Would today be a send day for any scheduled report, and what date range
 * would it cover? Answers WITHOUT sending anything and regardless of
 * whether any report is switched on in Settings — pure schedule logic,
 * checked against the real holiday/weekend calendar.
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
const { addDays } = require('./utils/regularizationWindow');
const { getConfig } = require('./utils/reportEmailSender');

const DATE = process.argv[2] || schedule.todayYmd();

(async () => {
  console.log(`\n=== Scheduled report emails — schedule check for ${DATE} ===\n`);

  const isWorking = await schedule.isWorkingDay(DATE);
  console.log(`${DATE} is a ${isWorking ? 'WORKING' : 'NON-WORKING (weekend/holiday)'} day.\n`);

  const daily = await schedule.isDailyDue(DATE);
  console.log(`Daily Attendance due today: ${daily}`
    + (daily ? ` — would cover ${addDays(DATE, -1)}` : ''));

  const weekly = await schedule.isWeeklyDue(DATE);
  const week = schedule.weekJustClosedRange(DATE);
  console.log(`Weekly cadence due today (Weekly Attendance, Onboarding Data, Muster Roll): ${weekly}`
    + (weekly ? ` — would cover ${week.start} to ${week.end}` : ` (week just closed would be ${week.start} to ${week.end})`));
  if (weekly) {
    const hols = await schedule.holidaysInRange(week.start, week.end);
    console.log(hols.length
      ? `  Holiday(s) in that week: ${hols.map(h => `${h.name} (${h.date})`).join(', ')}`
      : '  No holidays in that week.');
  }

  const monthlyCutoff = await schedule.monthlyCutoffDate(DATE);
  const monthly = await schedule.isMonthlyCutoffDue(DATE);
  const range = schedule.monthToCutoffRange(DATE);
  console.log(`Monthly cutoff for this month resolves to: ${monthlyCutoff}`);
  console.log(`Monthly cadence due today (Monthly Attendance, Payroll Feed, LOP Data, Regularization Reminder): ${monthly}`
    + (monthly ? ` — would cover ${range.start} to ${range.end}` : ''));

  console.log('\n── Current config (nothing sends unless a report shows enabled=true below) ──\n');
  const cfg = await getConfig();
  for (const [key, val] of Object.entries(cfg)) {
    console.log(`  ${key.padEnd(22)} enabled=${val.enabled}`
      + (val.recipients ? `  recipients=${val.recipients.length}` : '')
      + (val.roles ? `  roles=${(val.roles || []).join(',') || '-'}` : ''));
  }

  await pool.end();
})().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
