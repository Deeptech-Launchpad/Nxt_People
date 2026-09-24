/* ── "No of day(s) before... the reminder email is to be sent" ──────────────
 *  Zoho's Holiday popup carries a reminder-lead-time field; this is what
 *  actually acts on it. Runs once a day, finds every holiday whose date is
 *  exactly reminder_days away and hasn't been reminded yet, and mails
 *  everyone the holiday's scope reaches. reminder_sent_at stops a restart
 *  mid-day from sending the same reminder twice, and is cleared on every
 *  edit (routes/holidays.js) so a moved date gets its own fresh window.
 * ────────────────────────────────────────────────────────────────────────── */
const pool = require('../db');
const logger = require('../logger');
const { sendMail } = require('./mailer');
const { scopedActiveEmployees } = require('./holidayActions');

async function sweepHolidayReminders() {
  const due = await pool.query(
    `SELECT h.id as "_id", h.name, h.date::text as date, h.type, h.mail_body as "mailBody",
            COALESCE((SELECT ARRAY_AGG(sc.ref_id::text) FROM holiday_scopes sc
                       WHERE sc.holiday_id = h.id AND sc.kind = 'location'), '{}') AS "locationIds",
            COALESCE((SELECT ARRAY_AGG(sc.ref_id::text) FROM holiday_scopes sc
                       WHERE sc.holiday_id = h.id AND sc.kind = 'shift'), '{}') AS "shiftIds"
       FROM holidays h
      WHERE h.reminder_days > 0
        AND h.reminder_sent_at IS NULL
        AND h.date = CURRENT_DATE + h.reminder_days`
  );

  let sent = 0;
  for (const holiday of due.rows) {
    try {
      const emps = await scopedActiveEmployees(pool, holiday);
      const active = await pool.query(
        `SELECT id, first_name AS "firstName", email FROM employees
          WHERE id = ANY($1::uuid[]) AND email IS NOT NULL AND email <> ''`,
        [emps.map(e => e.id)]
      );
      const dateLabel = new Date(`${holiday.date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
      const subject = `Reminder: ${holiday.name} on ${dateLabel}`;
      const body = holiday.mailBody?.trim()
        ? holiday.mailBody
        : `This is a reminder that ${holiday.name} falls on ${dateLabel}.`;
      await Promise.allSettled(active.rows.map(emp => sendMail({
        to: emp.email,
        subject,
        text: `Hi ${emp.firstName},\n\n${body}\n\nDate: ${dateLabel}\n\nRegards,\nHR Team`,
      })));
      await pool.query('UPDATE holidays SET reminder_sent_at = NOW() WHERE id = $1', [holiday._id]);
      sent++;
    } catch (err) {
      logger.error({ err: err.message, holiday: holiday.name }, '[holidayReminders] reminder send failed');
    }
  }
  return { checked: due.rows.length, sent };
}

module.exports = { sweepHolidayReminders };
