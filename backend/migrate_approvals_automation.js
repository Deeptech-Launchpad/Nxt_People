/* ── Attendance → Approvals and Automation ────────────────────────────────
 *  Two things that already work, but only in ways nobody can change.
 *
 *  APPROVALS. utils/leaveApproval.js derives the chain from a rule written in
 *  code: level 1 is the reporting manager, level 2 their manager, level 3 the
 *  first HR admin — unless level 1 is a Business Unit Head, in which case there
 *  is no level 3. That is exactly the reference's "2 Level(s) of Reporting To →
 *  HR", but an admin cannot see it, let alone change it. approval_rules makes it
 *  a record. The seeded rule reproduces today's behaviour exactly, so nothing
 *  moves until someone edits it.
 *
 *  AUTOMATION. The check-in and check-out reminder emails are real — two cron
 *  jobs pinned to 09:00 and 18:00, sent to every active employee. What is
 *  missing is any way to change the time, the wording, or who gets them.
 *  email_templates and email_alerts turn all three into records.
 *
 *  Idempotent. Safe to re-run.
 *      docker compose exec backend node migrate_approvals_automation.js
 * ───────────────────────────────────────────────────────────────────────── */

const pool = require('./db');

// Every request type the shared approval engine serves.
const REQUEST_TYPES = [
  ['leave', 'Leave request'],
  ['regularization', 'Attendance regularization request'],
  ['on_duty', 'On duty request'],
  ['comp_off', 'Compensatory off request'],
  ['wfh', 'Work from home request'],
  ['timesheet', 'Timesheet approval'],
];

// The chain the code derives today, written down. Two levels up the reporting
// line, then HR — with the Business Unit Head exception the engine already
// applies, kept as a flag rather than lost.
const DEFAULT_LEVELS = [
  { kind: 'reporting_to', count: 2 },
  { kind: 'role', role: 'hr_admin', skipWhenManagerIsBuHead: true },
];

const TEMPLATES = [
  {
    service: 'attendance', name: 'Check-in reminder',
    subject: 'Reminder to check in for the day',
    body: 'Hi ${employeeName},\n\nThis is a reminder to check in for the day via the attendance section.\n\nHave a productive day at work.',
  },
  {
    service: 'attendance', name: 'Check-out reminder',
    subject: 'Reminder to check out',
    body: 'Hi ${employeeName},\n\nYour shift has ended. Please remember to check out before you leave.\n\nThank you.',
  },
  {
    service: 'attendance', name: 'New approval request',
    subject: 'A request is waiting for your approval',
    body: 'Hi ${approverName},\n\n${employeeName}\'s ${requestType} is waiting for your approval.\n\nPlease review it in the approvals section.',
  },
  {
    service: 'attendance', name: 'Your request has been approved',
    subject: 'Your request has been approved',
    body: 'Hi ${employeeName},\n\nYour ${requestType} has been approved by ${approverName}.',
  },
  {
    service: 'attendance', name: 'Your request has been rejected',
    subject: 'Your request has been rejected',
    body: 'Hi ${employeeName},\n\nYour ${requestType} has been rejected by ${approverName}.\n\nReason: ${reason}',
  },
];

// The two reminders the crons already send. Seeded switched on, at the times
// they already fire, to every active employee — so the migration changes the
// mechanism without changing who receives what.
const ALERTS = [
  { service: 'attendance', event: 'check_in_reminder', name: 'Check-in reminder', sendAt: '09:00', template: 'Check-in reminder' },
  { service: 'attendance', event: 'check_out_reminder', name: 'Check-out reminder', sendAt: '18:00', template: 'Check-out reminder' },
];

const AUTOMATION_DEFAULTS = {
  absentScheduler: {
    enabled: false,
    // Late enough that anyone who forgot has had the whole day to notice.
    runAt: '21:00',
    // A day with no check-in at all. Leave, holidays, weekends and on-duty are
    // never touched — the classifier already decides those.
    markAbsentWhenNoCheckIn: true,
  },
};

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS approval_rules (
        id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        request_type VARCHAR(40) NOT NULL UNIQUE,
        name         VARCHAR(150) NOT NULL,
        is_active    BOOLEAN NOT NULL DEFAULT TRUE,
        levels       JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS email_templates (
        id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        service    VARCHAR(40) NOT NULL DEFAULT 'attendance',
        name       VARCHAR(150) NOT NULL,
        subject    VARCHAR(300) NOT NULL,
        body       TEXT NOT NULL,
        is_system  BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (service, name)
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS email_alerts (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        service     VARCHAR(40) NOT NULL DEFAULT 'attendance',
        event       VARCHAR(60) NOT NULL,
        name        VARCHAR(150) NOT NULL,
        description TEXT,
        is_active   BOOLEAN NOT NULL DEFAULT TRUE,
        send_at     VARCHAR(5),
        recipients  JSONB NOT NULL DEFAULT '{"allEmployees":true,"departmentIds":[],"locationIds":[]}'::jsonb,
        template_id UUID REFERENCES email_templates(id) ON DELETE SET NULL,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (service, event)
      )`);

    await client.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS attendance_automation_config JSONB`);
    await client.query(
      `UPDATE settings SET attendance_automation_config = $1::jsonb WHERE attendance_automation_config IS NULL`,
      [JSON.stringify(AUTOMATION_DEFAULTS)]
    );

    // ── Seed ──────────────────────────────────────────────────────────────
    for (const [type, name] of REQUEST_TYPES) {
      await client.query(
        `INSERT INTO approval_rules (request_type, name, levels)
         VALUES ($1, $2, $3::jsonb) ON CONFLICT (request_type) DO NOTHING`,
        [type, name, JSON.stringify(DEFAULT_LEVELS)]
      );
    }

    for (const t of TEMPLATES) {
      await client.query(
        `INSERT INTO email_templates (service, name, subject, body, is_system)
         VALUES ($1, $2, $3, $4, TRUE) ON CONFLICT (service, name) DO NOTHING`,
        [t.service, t.name, t.subject, t.body]
      );
    }

    for (const a of ALERTS) {
      // The service is passed twice rather than reusing $1: the column is
      // VARCHAR and the sub-select compares against TEXT, and Postgres refuses
      // to deduce one type for both.
      await client.query(
        `INSERT INTO email_alerts (service, event, name, send_at, template_id)
         VALUES ($1, $2, $3, $4, (SELECT id FROM email_templates WHERE service = $5 AND name = $6))
         ON CONFLICT (service, event) DO NOTHING`,
        [a.service, a.event, a.name, a.sendAt, a.service, a.template]
      );
    }

    await client.query('COMMIT');

    const r = await pool.query(`
      SELECT (SELECT COUNT(*) FROM approval_rules)   AS rules,
             (SELECT COUNT(*) FROM email_templates)  AS templates,
             (SELECT COUNT(*) FROM email_alerts)     AS alerts`);
    const c = r.rows[0];
    console.log('✅ Approvals and automation ready.');
    console.log(`   ${c.rules} approval rules, ${c.templates} email templates, ${c.alerts} email alerts`);
    console.log('   Seeded rules reproduce the chain the code already derives — nothing changes until edited.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Approvals/automation migration failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit(process.exitCode || 0);
  }
}

migrate();
