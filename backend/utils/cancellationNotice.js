/**
 * utils/cancellationNotice.js
 *
 * Tells the approval chain when a leave they signed off is cancelled.
 *
 * The gap this closes: cancelling already notified the EMPLOYEE, which is what
 * you want when HR cancels on somebody's behalf. Nothing went the other way. An
 * employee could cancel five approved days and the three people who approved
 * them would never hear about it — they would find out from a report, or not at
 * all.
 *
 * Everyone on that leave's chain is written to, plus the reporting manager if
 * the chain did not already include them. Both a mail and an in-app
 * notification, matching what apply and approve already do.
 *
 * Fire-and-forget. The cancellation is committed before this runs, so a mail
 * server that is down must never turn a cancellation that happened into an
 * error saying it did not.
 */
const pool = require('../db');
const logger = require('../logger');
const { sendMail } = require('./mailer');
const { createNotification } = require('../routes/notifications');

const fmtDate = (d) => {
  const x = d instanceof Date ? d : new Date(`${String(d).slice(0, 10)}T00:00:00`);
  return x.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

/** Everyone who should hear that this leave changed. */
async function chainFor(leaveId, employeeId) {
  const rows = (await pool.query(
    `SELECT DISTINCT e.id, e.email, TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS name
       FROM approval_levels al
       JOIN employees e ON e.id = al.approver_id
      WHERE al.request_type = 'leave' AND al.request_id = $1
        AND e.status = 'active' AND e.deleted_at IS NULL`,
    [leaveId]).catch(() => ({ rows: [] }))).rows;

  // The reporting manager may not be on the chain — an auto-approve rule can
  // settle a request without ever naming them — and they are the one person
  // who always wants to know.
  const mgr = (await pool.query(
    `SELECT m.id, m.email, TRIM(CONCAT(m.first_name, ' ', m.last_name)) AS name
       FROM employees e JOIN employees m ON m.id = e.reporting_manager_id
      WHERE e.id = $1 AND m.status = 'active' AND m.deleted_at IS NULL`,
    [employeeId]).catch(() => ({ rows: [] }))).rows[0];

  const byId = new Map(rows.map(r => [String(r.id), r]));
  if (mgr) byId.set(String(mgr.id), mgr);
  // Never write to the person who did the cancelling about their own action.
  return [...byId.values()];
}

/**
 * @param leave    the row as it was BEFORE the change — dates and type
 * @param actor    { _id, firstName, lastName } who cancelled
 * @param kind     'full' | 'partial'
 * @param detail   { from, to, days, remaining } for a partial; ignored for full
 */
async function notifyChainOfCancellation({ leave, actor, kind, detail = {} }) {
  try {
    const employeeId = leave.employee_id || leave.employeeId;
    const recipients = (await chainFor(leave.id, employeeId))
      .filter(r => String(r.id) !== String(actor._id));
    if (!recipients.length) return { sent: 0 };

    const emp = (await pool.query(
      `SELECT TRIM(CONCAT(first_name, ' ', last_name)) AS name FROM employees WHERE id = $1`,
      [employeeId])).rows[0];
    const who = emp?.name || 'An employee';
    const type = String(leave.leave_type || leave.leaveType || 'leave');
    const label = type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, ' ');
    const actorName = `${actor.firstName || ''} ${actor.lastName || ''}`.trim();
    const bySomeoneElse = String(actor._id) !== String(employeeId);

    let subject, body;
    if (kind === 'partial') {
      subject = `${who} cancelled part of their ${label} leave`;
      body = `${who}'s ${label} leave has been partly cancelled`
        + (bySomeoneElse && actorName ? ` by ${actorName}` : '') + `.\n\n`
        + `Cancelled: ${fmtDate(detail.from)} to ${fmtDate(detail.to)} (${detail.days} working day(s))\n`
        + (detail.remaining?.length
            ? `Still booked: ${detail.remaining.map(r => `${fmtDate(r.from)} to ${fmtDate(r.to)}`).join('; ')}\n`
            : '')
        + (detail.shape === 'split'
            ? `\nThe request was split in two, because the cancelled days fell in the middle of the range.\n`
            : '');
    } else {
      subject = `${who} cancelled their ${label} leave`;
      body = `${who}'s ${label} leave from ${fmtDate(leave.start_date)} to ${fmtDate(leave.end_date)} `
        + `(${leave.total_days} day(s)) has been cancelled`
        + (bySomeoneElse && actorName ? ` by ${actorName}` : '') + `.\n`;
    }
    body += `\nYou are receiving this because you are on the approval chain for that request.\n`;

    let sent = 0;
    for (const r of recipients) {
      // Named tab. Without one the Leave Tracker opens User-specific
      // Operations, a search box, which tells an approver nothing about the
      // cancellation they were just told about.
      await createNotification(r.id, 'leave', subject, body.split('\n')[0],
        '/more-services/operations/leave-tracker?tab=requests').catch(() => {});
      if (!r.email) continue;
      await sendMail({
        to: r.email,
        subject,
        text: `Hi ${r.name},\n\n${body}`,
        html: `<p>Hi ${r.name},</p><p>${body.replace(/\n/g, '<br>')}</p>`,
      });
      sent++;
    }
    logger.info({ leaveId: leave.id, kind, sent }, '[cancellationNotice] chain notified');
    return { sent };
  } catch (err) {
    logger.warn({ err: err.message, leaveId: leave?.id },
      '[cancellationNotice] cancellation stood but the chain was not notified');
    return { sent: 0 };
  }
}

module.exports = { notifyChainOfCancellation, chainFor };
