/**
 * utils/regularizationReminders.js
 *
 * Chases people about unmarked absences before the window closes on them.
 *
 * Two messages, both at 10:00 local, both to the employee alone, each with an
 * in-app notification beside the email:
 *
 *   warning   on the last working day of the week the absence fell in — Friday
 *             in a week whose Saturday is a weekend, Saturday otherwise. Read
 *             from the calendar, never assumed from the weekday.
 *   deadline  on that employee's own deadline day, which is the Monday after
 *             the absence moved for holidays and for anything that kept them
 *             from acting. Skipped entirely if they have already regularized —
 *             a "last chance" mail about a day already fixed is noise that
 *             teaches people to ignore the next one.
 *
 * Off by default. Switching this on writes to every employee with an open
 * absence, so it is not something a deploy should start doing on its own.
 *
 * An unmarked absence here is a past working day with no approved leave and no
 * on-duty, where the person either never punched at all OR punched in and never
 * out. The second half is the wider definition: elsewhere a check-in alone has
 * always counted as present.
 */
const pool = require('../db');
const logger = require('../logger');
const { sendMail } = require('./mailer');
const { createNotification } = require('../routes/notifications');
const {
  deadlineFor, effectiveFrom, lastWorkingDayOfWeek, ymd, addDays, todayYmd, TZ,
} = require('./regularizationWindow');
const { isNonWorkingDay } = require('./workingDays');

const SEND_AT = '10:00';

async function config() {
  try {
    const r = await pool.query(`SELECT regularization_config AS c FROM settings LIMIT 1`);
    return r.rows[0]?.c || {};
  } catch (_) { return {}; }
}

/**
 * Open unmarked absences for one employee, from `from` to yesterday.
 * "Open" means still regularizable: no request raised, and the day is on or
 * after the date the rule came into force.
 */
async function openAbsences(employeeId, from, to) {
  const r = await pool.query(
    `WITH days AS (
       SELECT d::date AS day
         FROM generate_series($2::date, $3::date, '1 day') d
     )
     SELECT to_char(days.day, 'YYYY-MM-DD') AS day
       FROM days
       LEFT JOIN attendance a
         ON a.employee_id = $1 AND a.date = days.day
       LEFT JOIN leaves l
         ON l.employee_id = $1 AND l.status = 'approved'
        AND l.start_date <= days.day AND l.end_date >= days.day
       LEFT JOIN on_duty_requests o
         ON o.employee_id = $1 AND o.status = 'approved'
        AND o.start_date <= days.day AND COALESCE(o.end_date, o.start_date) >= days.day
       LEFT JOIN attendance_regularizations g
         ON g.employee_id = $1 AND g.date = days.day
        AND g.status IN ('pending', 'approved')
      WHERE l.employee_id IS NULL
        AND o.employee_id IS NULL
        AND g.employee_id IS NULL
        -- Never punched, or punched in and never out. The second case is the
        -- widening: a check-in on its own used to read as a full day present.
        AND (a.employee_id IS NULL OR a.check_in IS NULL OR a.check_out IS NULL)
        AND COALESCE(a.status, '') <> 'on_duty'
      ORDER BY days.day`,
    [employeeId, from, to]
  ).catch(err => {
    logger.warn({ err: err.message, employeeId }, '[regularizationReminders] absence lookup failed');
    return { rows: [] };
  });
  // A Sunday is not an absence, and neither is a holiday. The generate_series
  // above cannot know that — weekend rules live in weekend_rules and are
  // evaluated in JS — so the calendar is applied here rather than in SQL.
  const out = [];
  for (const row of r.rows) {
    if (!(await isNonWorkingDay(new Date(`${row.day}T00:00:00`)))) out.push(row.day);
  }
  return out;
}

const fmt = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN',
  { day: 'numeric', month: 'short', year: 'numeric' });

function warningBody(name, days, deadline) {
  const list = days.map(d => `  • ${fmt(d)}`).join('\n');
  return `Hi ${name},\n\n`
    + `These days are showing as unmarked absence — either no attendance was recorded, or you checked in and never checked out:\n\n${list}\n\n`
    + `Please raise a regularization for them. The last date to do that is ${fmt(deadline)}.\n\n`
    + `After that the days can no longer be regularized and will be reported as unregularized absence.\n`;
}

function deadlineBody(name, days) {
  const list = days.map(d => `  • ${fmt(d)}`).join('\n');
  return `Hi ${name},\n\n`
    + `Today is the last day to regularize these unmarked absences:\n\n${list}\n\n`
    + `If no regularization is raised today, they can no longer be corrected and will be reported as unregularized absence.\n`;
}

async function notify(emp, subject, text, kind) {
  const html = `<p>${text.replace(/\n/g, '<br>')}</p>`;
  await createNotification(emp.id, 'attendance', subject,
    text.split('\n').filter(Boolean)[1] || subject, '/attendance/regularization').catch(() => {});
  if (!emp.email) return false;
  await sendMail({ to: emp.email, subject, text, html });
  logger.info({ employeeId: emp.id, kind }, '[regularizationReminders] sent');
  return true;
}

/**
 * One pass. Called every minute; does nothing unless the clock reads 10:00 and
 * the feature is switched on.
 *
 * @param opts.now   Date to treat as now — the tests pass a fixed one.
 * @param opts.force skip the 10:00 gate (tests only)
 */
async function sweepRegularizationReminders(opts = {}) {
  const now = opts.now || new Date();
  const summary = { warned: 0, deadline: 0, skipped: 0 };

  const cfg = await config();
  if (!cfg.deadlineReminders?.enabled) return summary;

  const clock = now.toLocaleTimeString('en-GB',
    { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  if (!opts.force && clock !== (cfg.deadlineReminders.sendAt || SEND_AT)) return summary;

  const from = await effectiveFrom();
  if (!from) return summary;                    // rule not in force, nothing to chase

  const today = opts.now ? ymd(now) : todayYmd();
  const yesterday = addDays(today, -1);
  if (yesterday < from) return summary;

  const staff = (await pool.query(
    `SELECT id, email, TRIM(CONCAT(first_name, ' ', last_name)) AS name
       FROM employees
      WHERE status = 'active' AND deleted_at IS NULL AND is_user = TRUE`)).rows;

  const warnDay = await lastWorkingDayOfWeek(today);

  for (const emp of staff) {
    // Look back far enough to catch a deadline that slid for a long absence,
    // but never before the rule came into force.
    const windowStart = [from, addDays(today, -45)].sort().pop();
    const days = await openAbsences(emp.id, windowStart, yesterday);
    if (!days.length) continue;

    const dueToday = [];
    const thisWeek = [];
    for (const day of days) {
      const due = await deadlineFor(emp.id, day);
      if (due < today) continue;                 // already closed; nothing to chase
      if (due === today) dueToday.push(day);
      else if ((await lastWorkingDayOfWeek(day)) === warnDay) thisWeek.push(day);
    }

    // The deadline mail wins: a day due today should not also generate a
    // gentler warning in the same run.
    if (dueToday.length) {
      await notify(emp, 'Last day to regularize your attendance',
        deadlineBody(emp.name, dueToday), 'deadline').then(ok => { if (ok) summary.deadline++; })
        .catch(err => logger.warn({ err: err.message, employeeId: emp.id },
          '[regularizationReminders] deadline mail failed'));
    } else if (thisWeek.length && today === warnDay) {
      const due = await deadlineFor(emp.id, thisWeek[0]);
      await notify(emp, 'You have unmarked attendance to regularize',
        warningBody(emp.name, thisWeek, due), 'warning').then(ok => { if (ok) summary.warned++; })
        .catch(err => logger.warn({ err: err.message, employeeId: emp.id },
          '[regularizationReminders] warning mail failed'));
    } else {
      summary.skipped++;
    }
  }

  return summary;
}

module.exports = { sweepRegularizationReminders, openAbsences, SEND_AT };
