/* ── Approval follow-up reminders ──────────────────────────────────────────
 *  "One-time follow-up after 1 day(s) from the approval trigger date, sent at
 *  10:00" — the reference's wording, and now something that actually sends.
 *
 *  A request qualifies when it is still pending, its rule has follow-up
 *  enabled, and the configured number of days has passed since it was raised.
 *  Repeat mode chases again every N days; one-time chases once.
 *
 *  Every send is recorded in approval_followups with a unique key on
 *  (request, level, sequence), so a sweep overlapping its predecessor cannot
 *  chase the same approver twice — the insert loses the race rather than the
 *  approver getting two emails.
 * ───────────────────────────────────────────────────────────────────────── */

const pool = require('../db');
const logger = require('../logger');

// The tables a pending request lives in, and the date it was raised from.
const SOURCES = {
  leave: { table: 'leaves', raised: 'created_at' },
  on_duty: { table: 'on_duty_requests', raised: 'created_at' },
  comp_off: { table: 'comp_off_requests', raised: 'created_at' },
  wfh: { table: 'wfh_requests', raised: 'created_at' },
  regularization: { table: 'attendance_regularizations', raised: 'created_at' },
};

const LABELS = {
  leave: 'leave request', on_duty: 'on duty request', comp_off: 'comp off request',
  wfh: 'work from home request', regularization: 'attendance regularization',
};

/**
 * @param windowMinutes how far back to look for a rule's send time. Should
 *        match the interval this is called on, or a sweep running a minute
 *        late would skip the day entirely.
 */
async function sweepApprovalFollowups({ now = new Date(), windowMinutes = 60 } = {}) {
  const summary = { considered: 0, sent: 0, skipped: 0, failed: 0 };

  const rules = await pool.query(
    `SELECT id, request_type, name, follow_up
       FROM approval_rules
      WHERE is_active = TRUE AND (follow_up->>'enabled')::boolean IS TRUE`
  );
  if (!rules.rows.length) return summary;

  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const { sendMail } = require('./mailer');

  for (const rule of rules.rows) {
    const src = SOURCES[rule.request_type];
    if (!src) continue;

    const cfg = rule.follow_up || {};
    const [h, m] = String(cfg.time || '10:00').split(':').map(Number);
    const due = h * 60 + m;
    if (!(due <= minutesNow && due > minutesNow - windowMinutes)) continue;

    const days = Math.max(1, Number(cfg.days) || 1);
    const repeat = cfg.mode === 'repeat';

    // Still pending, raised at least `days` ago, and with a level nobody has
    // acted on. The approver is read live rather than from a stored copy.
    const pending = await pool.query(
      `SELECT r.id AS request_id, al.level, al.approver_id,
              FLOOR(EXTRACT(EPOCH FROM (NOW() - r.${src.raised})) / 86400)::int AS age_days,
              TRIM(CONCAT(a.first_name, ' ', a.last_name)) AS approver_name, a.email AS approver_email,
              TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS employee_name
         FROM ${src.table} r
         JOIN approval_levels al
           ON al.request_type = $1 AND al.request_id = r.id AND al.status = 'pending'
         JOIN employees a ON a.id = al.approver_id AND a.deleted_at IS NULL AND a.status = 'active'
         JOIN employees e ON e.id = r.employee_id
        WHERE r.status = 'pending'
          AND r.${src.raised} <= NOW() - ($2 || ' days')::interval
          AND a.email IS NOT NULL AND a.email <> ''`,
      [rule.request_type, String(days)]
    );

    for (const row of pending.rows) {
      summary.considered++;
      // One-time is sequence 1. Repeat advances a sequence per elapsed period,
      // so the unique key differs each time round and the same key is never
      // reused within a period.
      const sequence = repeat ? Math.max(1, Math.floor(row.age_days / days)) : 1;

      try {
        // Claim first, send second. Claiming after sending would mean a crash
        // between the two sends the reminder again on the next sweep.
        const claim = await pool.query(
          `INSERT INTO approval_followups (rule_id, request_type, request_id, level, sequence, approver_id, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'success')
           ON CONFLICT (request_type, request_id, level, sequence) DO NOTHING
           RETURNING id`,
          [rule.id, rule.request_type, row.request_id, row.level, sequence, row.approver_id]
        );
        if (!claim.rows.length) { summary.skipped++; continue; }

        await sendMail({
          to: [row.approver_email],
          subject: `Reminder: ${row.employee_name}'s ${LABELS[rule.request_type] || 'request'} is waiting for your approval`,
          html: `<p>Hi ${row.approver_name},</p>
                 <p>${row.employee_name}'s ${LABELS[rule.request_type] || 'request'} has been waiting for your
                 approval for ${row.age_days} day(s).</p>`,
        });
        summary.sent++;
      } catch (err) {
        summary.failed++;
        // The claim stands so a broken mail server is not retried every sweep,
        // but the row records why nothing arrived.
        await pool.query(
          `UPDATE approval_followups SET status = 'failed', message = $1
            WHERE request_type = $2 AND request_id = $3 AND level = $4 AND sequence = $5`,
          [err.message, rule.request_type, row.request_id, row.level, sequence]
        ).catch(() => {});
        logger.error({ err: err.message, rule: rule.name }, 'Approval follow-up failed to send');
      }
    }
  }
  return summary;
}

module.exports = { sweepApprovalFollowups, SOURCES };
