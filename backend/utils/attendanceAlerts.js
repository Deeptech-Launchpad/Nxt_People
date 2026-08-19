/**
 * utils/attendanceAlerts.js
 *
 * Attendance deviation alerts — Attendance > Configuration > Check-in/Check-out.
 *
 * Four switches that were stored and read by nothing:
 *   lateCheckIn        fires at check-in, when the punch is after the shift start
 *   earlyCheckOut      fires at check-out, when the punch is before the shift end
 *   missedCheckIn      swept, N hours after shift start with no punch
 *   insufficientHours  swept, after the shift ends, when worked < threshold
 *
 * Every one defaults to false, so nothing sends until an admin turns it on.
 * That is deliberate: wiring these was safe to do precisely because switching
 * them on is a separate, visible act.
 *
 * Like the workflow engine, an alert can never fail the thing that triggered
 * it. A check-in must succeed even if the mail server is down.
 */
const pool = require('../db');
const logger = require('../logger');
const attendanceConfig = require('./attendanceConfig');

const hhmmToMinutes = (t) => {
  if (!t) return null;
  const [h, m] = String(t).split(':').map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : null;
};

async function alertConfig() {
  const cfg = await attendanceConfig.section('checkin').catch(() => null);
  return cfg?.deviationAlerts || null;
}

/** The employee, and their reporting manager's address. */
async function peopleFor(employeeId) {
  const r = await pool.query(
    `SELECT TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS name, e.email,
            m.email AS "managerEmail",
            TRIM(CONCAT(m.first_name, ' ', m.last_name)) AS "managerName"
       FROM employees e
       LEFT JOIN employees m
         ON m.id = e.reporting_manager_id AND m.deleted_at IS NULL AND m.status = 'active'
      WHERE e.id = $1`,
    [employeeId]
  ).catch(() => ({ rows: [] }));
  return r.rows[0] || null;
}

async function send({ to, subject, lines }) {
  const recipients = [...new Set((to || []).filter(Boolean))];
  if (!recipients.length) return { sent: 0 };
  const { sendMail, renderTemplateEmail } = require('./mailer');
  await sendMail({
    to: recipients,
    subject,
    html: renderTemplateEmail({ title: subject, bodyText: lines.join('\n\n') }),
  });
  return { sent: recipients.length };
}

/**
 * Fire-and-forget. Returns nothing and throws nothing — the caller is a
 * check-in or check-out that has already been committed.
 */
function fire(kind, ctx) {
  Promise.resolve()
    .then(() => run(kind, ctx))
    .catch(err => logger.error({ err: err.message, kind }, 'attendance alert failed'));
}

async function run(kind, ctx) {
  const alerts = await alertConfig();
  if (!alerts) return;

  if (kind === 'late_check_in') {
    if (!alerts.lateCheckIn) return;
    const late = Number(ctx.lateMinutes) || 0;
    if (late <= 0) return;
    const p = await peopleFor(ctx.employeeId);
    if (!p) return;
    await send({
      to: [p.managerEmail],
      subject: `Late check-in: ${p.name}`,
      lines: [
        `Hi ${p.managerName || 'there'},`,
        `${p.name} checked in ${late} minute(s) after their shift started on ${ctx.date}.`,
      ],
    });
  }

  if (kind === 'early_check_out') {
    if (!alerts.earlyCheckOut) return;
    const shift = await pool.query(
      `SELECT s.end_time AS "endTime" FROM employees e
         LEFT JOIN attendance a ON a.employee_id = e.id AND a.date = $2::date
         LEFT JOIN shifts s ON s.id = COALESCE(a.shift_id, e.shift_id)
        WHERE e.id = $1`,
      [ctx.employeeId, ctx.date]
    ).catch(() => ({ rows: [] }));
    const endMin = hhmmToMinutes(shift.rows[0]?.endTime);
    if (endMin === null) return;
    const out = ctx.checkOutAt instanceof Date ? ctx.checkOutAt : new Date();
    const early = endMin - (out.getHours() * 60 + out.getMinutes());
    if (early <= 0) return;
    const p = await peopleFor(ctx.employeeId);
    if (!p) return;
    await send({
      to: [p.managerEmail],
      subject: `Early check-out: ${p.name}`,
      lines: [
        `Hi ${p.managerName || 'there'},`,
        `${p.name} checked out ${early} minute(s) before their shift ended on ${ctx.date}.`,
      ],
    });
  }
}

/**
 * The two alerts that have no event to hang off — nothing happens when
 * somebody fails to check in, so they are swept instead.
 *
 * Called once a minute beside the reminder cron. `now` is injectable so the
 * sweep can be tested without waiting for a wall clock.
 */
async function sweepAttendanceAlerts({ now = new Date(), tz = 'Asia/Kolkata' } = {}) {
  const summary = { missedCheckIn: 0, insufficientHours: 0, skipped: 0 };
  const alerts = await alertConfig();
  if (!alerts) return summary;

  const missed = alerts.missedCheckIn || {};
  const insuf = alerts.insufficientHours || {};
  if (!missed.enabled && !insuf.enabled) return summary;

  const today = now.toLocaleDateString('en-CA', { timeZone: tz });
  const nowMin = (() => {
    const t = now.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    return hhmmToMinutes(t);
  })();

  // Everyone on rolls, with their shift and today's row if there is one.
  const rows = await pool.query(
    `SELECT e.id, TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS name, e.email,
            m.email AS "managerEmail", TRIM(CONCAT(m.first_name, ' ', m.last_name)) AS "managerName",
            s.start_time AS "shiftStart", s.end_time AS "shiftEnd",
            a.check_in AS "checkIn", a.working_hours AS "workingHours"
       FROM employees e
       LEFT JOIN shifts s ON s.id = e.shift_id
       LEFT JOIN employees m ON m.id = e.reporting_manager_id AND m.deleted_at IS NULL AND m.status = 'active'
       LEFT JOIN attendance a ON a.employee_id = e.id AND a.date = $1::date
      WHERE e.deleted_at IS NULL AND e.status = 'active' AND e.exit_date IS NULL`,
    [today]
  ).catch(() => ({ rows: [] }));

  for (const r of rows.rows) {
    const startMin = hhmmToMinutes(r.shiftStart);
    const endMin = hhmmToMinutes(r.shiftEnd);

    if (missed.enabled && startMin !== null && !r.checkIn) {
      const window = hhmmToMinutes(missed.hoursAfterShiftStart) || 0;
      // Exactly on the minute it becomes due — the sweep runs every minute, so
      // a range would re-send for the rest of the day.
      if (nowMin === startMin + window) {
        await send({
          to: [r.managerEmail],
          subject: `Missed check-in: ${r.name}`,
          lines: [`Hi ${r.managerName || 'there'},`,
                  `${r.name} has not checked in today, ${today}.`],
        }).then(x => { summary.missedCheckIn += x.sent ? 1 : 0; })
          .catch(err => logger.warn({ err: err.message }, 'missed check-in alert failed'));
      }
    }

    if (insuf.enabled && endMin !== null && nowMin === endMin) {
      const threshold = (hhmmToMinutes(insuf.hours) || 0) / 60;
      const worked = parseFloat(r.workingHours) || 0;
      if (threshold > 0 && worked < threshold) {
        const to = [];
        if (insuf.notifyManager) to.push(r.managerEmail);
        if (insuf.notifyEmployee) to.push(r.email);
        await send({
          to,
          subject: `Short hours: ${r.name}`,
          lines: [`${r.name} recorded ${worked.toFixed(2)} hour(s) on ${today}, ` +
                  `below the ${threshold.toFixed(2)} hour threshold.`],
        }).then(x => { summary.insufficientHours += x.sent ? 1 : 0; })
          .catch(err => logger.warn({ err: err.message }, 'insufficient hours alert failed'));
      }
    }
  }
  return summary;
}

module.exports = { fire, sweepAttendanceAlerts, hhmmToMinutes };
