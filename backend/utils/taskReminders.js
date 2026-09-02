/* Task reminder delivery.
 *
 * The Add Task form carries a reminder time. Storing one and never acting on
 * it is worse than not offering the field, so this delivers them — as an
 * IN-APP NOTIFICATION, not an email.
 *
 * That is a deliberate choice, not a shortcut. On the live server there is no
 * allowlist between a send and a real inbox, and nothing in this module may
 * email anybody without being asked. A notification reaches the same person on
 * the same screen, and adding mail on top later is one line in the caller.
 *
 * Delivery is at-most-once: `reminder_sent_at` is stamped in the same UPDATE
 * that claims the row, so two workers — or a restart inside the same minute —
 * cannot both send it. Claiming by UPDATE ... RETURNING rather than SELECT
 * then UPDATE is the whole point; the read-then-write version races.
 */
const pool = require('./../db');
const logger = require('./../logger');
const { createNotification } = require('./../routes/notifications');

/* Reminders that came due while nothing was running still fire, but only
 * within this window. A task reminder from three weeks ago is noise, and
 * firing a backlog of them on the first boot after a long outage is worse than
 * missing them. */
const CATCH_UP_HOURS = 24;

async function deliverDueTaskReminders(now = new Date()) {
  let claimed;
  try {
    claimed = await pool.query(
      `UPDATE tasks SET reminder_sent_at = NOW()
        WHERE reminder_at IS NOT NULL
          AND reminder_sent_at IS NULL
          AND reminder_at <= $1
          AND reminder_at > $1::timestamptz - ($2 || ' hours')::interval
          AND status <> 'completed'
        RETURNING id, title, due_date, COALESCE(assignee_id, assigned_to) AS owner_id`,
      [now.toISOString(), String(CATCH_UP_HOURS)]);
  } catch (err) {
    logger.error({ err: err.message }, '[taskReminders] could not claim due reminders');
    return { delivered: 0, skipped: 0 };
  }

  let delivered = 0, skipped = 0;
  for (const t of claimed.rows) {
    if (!t.owner_id) { skipped++; continue; }   // nobody to tell
    try {
      const due = t.due_date
        ? new Date(t.due_date).toLocaleDateString('en-GB')
        : null;
      await createNotification(
        t.owner_id, 'task_reminder', 'Task reminder',
        due ? `${t.title} — due ${due}` : t.title,
        '/tasks');
      delivered++;
    } catch (err) {
      // The row stays claimed. Un-claiming on failure would retry every minute
      // for a notification that is failing for a reason retrying will not fix.
      logger.warn({ err: err.message, task: t.id }, '[taskReminders] notification failed');
      skipped++;
    }
  }
  if (delivered || skipped) {
    logger.info({ delivered, skipped }, '[taskReminders] reminders delivered');
  }
  return { delivered, skipped };
}

module.exports = { deliverDueTaskReminders, CATCH_UP_HOURS };
