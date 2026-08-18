/* ── Manage Accounts → Automation ──────────────────────────────────────────
 *  Workflows: a trigger, optional criteria, and the actions that follow.
 *
 *  The reference builds all of this on its Forms engine — every workflow
 *  targets a form, and roughly half the forms in its dropdown (Appraisees List,
 *  Goals, Jobs, Asset, Address Proof) are modules we do not have. A faithful
 *  copy would open a form picker mostly full of things that do not exist here,
 *  so "form" maps to the record types this application actually has and can
 *  hook.
 *
 *  Reused rather than duplicated:
 *    email_templates   already exists, scoped by service. Gains a record_type
 *                      so a workflow template can name what it is about.
 *    email_alerts      already exists as the fixed per-service reminders.
 *                      Gains the fields a workflow alert needs, and `event`
 *                      becomes nullable: a row with an event is a scheduled
 *                      reminder, a row without one is a workflow action.
 *                      Two tables meaning nearly the same thing is how they
 *                      drift, and this project has paid that bill twice.
 *
 *  Nothing fires until somebody creates a workflow. There are none here.
 *
 *  Idempotent. Safe to re-run.
 *      docker compose exec backend node migrate_workflows.js
 * ───────────────────────────────────────────────────────────────────────── */

const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS workflows (
        id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        record_type  VARCHAR(40)  NOT NULL,
        name         VARCHAR(150) NOT NULL,
        description  VARCHAR(500),
        is_active    BOOLEAN NOT NULL DEFAULT TRUE,

        -- 'action' fires from something a person did; 'date' fires from a date
        -- on the record, evaluated by the daily sweep.
        trigger_kind  VARCHAR(10) NOT NULL DEFAULT 'action',
        trigger_event VARCHAR(40),
        -- Only for the "specific field is updated" event.
        trigger_field VARCHAR(60),

        date_field       VARCHAR(60),
        date_direction   VARCHAR(10) DEFAULT 'on',
        date_months      INT NOT NULL DEFAULT 0,
        date_days        INT NOT NULL DEFAULT 0,
        execute_at       VARCHAR(5) NOT NULL DEFAULT '09:00',
        occurrence       VARCHAR(15) NOT NULL DEFAULT 'one_time',
        -- India-only deployment, as everywhere else in this application. Stored
        -- so the screen can show what is being assumed rather than imply a
        -- choice the schedulers would ignore.
        timezone         VARCHAR(60) NOT NULL DEFAULT 'Asia/Kolkata',

        criteria     JSONB NOT NULL DEFAULT '[]'::jsonb,
        sort_order   INT NOT NULL DEFAULT 0,
        created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMP NOT NULL DEFAULT NOW(),

        CONSTRAINT workflows_trigger_kind_check CHECK (trigger_kind IN ('action', 'date')),
        CONSTRAINT workflows_direction_check CHECK (date_direction IN ('on', 'before', 'after'))
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS workflow_field_updates (
        id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        record_type  VARCHAR(40)  NOT NULL,
        name         VARCHAR(150) NOT NULL,
        description  VARCHAR(500),
        -- Whitelisted in utils/workflowCatalog.js. A field update that could
        -- name any column would be an arbitrary write to any table.
        target_field VARCHAR(60) NOT NULL,
        target_value VARCHAR(255),
        created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
      )`);

    // Actions are separate rows rather than a JSON array on the workflow so an
    // alert can be reused by several workflows, which is what the reference's
    // Actions screens are for.
    await client.query(`
      CREATE TABLE IF NOT EXISTS workflow_actions (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
        kind        VARCHAR(20) NOT NULL,
        ref_id      UUID NOT NULL,
        sort_order  INT NOT NULL DEFAULT 0,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (workflow_id, kind, ref_id),
        CONSTRAINT workflow_actions_kind_check CHECK (kind IN ('email_alert', 'field_update'))
      )`);

    // A workflow you cannot see having run is a workflow nobody trusts. Every
    // attempt lands here, including the ones that were skipped because the
    // criteria did not match — "it did not fire" and "it fired and failed" look
    // identical from the outside otherwise.
    await client.query(`
      CREATE TABLE IF NOT EXISTS workflow_logs (
        id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        workflow_id  UUID REFERENCES workflows(id) ON DELETE SET NULL,
        workflow_name VARCHAR(150) NOT NULL,
        record_type  VARCHAR(40) NOT NULL,
        record_id    UUID,
        subject_name VARCHAR(150),
        trigger_kind VARCHAR(10),
        trigger_event VARCHAR(40),
        action_kind  VARCHAR(20),
        action_name  VARCHAR(150),
        status       VARCHAR(12) NOT NULL,
        message      TEXT,
        executed_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT workflow_logs_status_check CHECK (status IN ('success', 'failed', 'skipped'))
      )`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS scheduler_logs (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        job_key     VARCHAR(60)  NOT NULL,
        name        VARCHAR(150) NOT NULL,
        kind        VARCHAR(40)  NOT NULL DEFAULT 'Email Scheduler',
        status      VARCHAR(12)  NOT NULL,
        message     TEXT,
        duration_ms INT,
        executed_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT scheduler_logs_status_check CHECK (status IN ('success', 'failed', 'skipped'))
      )`);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_workflows_lookup ON workflows (record_type, trigger_kind, is_active)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_workflow_actions_wf ON workflow_actions (workflow_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_workflow_logs_at ON workflow_logs (executed_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_scheduler_logs_at ON scheduler_logs (executed_at DESC)`);

    // ── Extend what already exists ─────────────────────────────────────────
    await client.query(`ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS record_type VARCHAR(40)`);

    for (const [col, type] of [
      ['record_type', 'VARCHAR(40)'],
      ['from_kind', `VARCHAR(30) NOT NULL DEFAULT 'actor'`],
      ['to_recipients', `JSONB NOT NULL DEFAULT '{}'::jsonb`],
      ['cc', `JSONB NOT NULL DEFAULT '[]'::jsonb`],
      ['bcc', `JSONB NOT NULL DEFAULT '[]'::jsonb`],
      ['reply_to', 'VARCHAR(255)'],
      ['subject', 'VARCHAR(255)'],
      ['body', 'TEXT'],
    ]) {
      await client.query(`ALTER TABLE email_alerts ADD COLUMN IF NOT EXISTS ${col} ${type}`);
    }

    // An alert with an event is one of the scheduled reminders; one without is
    // a workflow action. The column has to allow both.
    await client.query(`ALTER TABLE email_alerts ALTER COLUMN event DROP NOT NULL`);

    await client.query('COMMIT');

    const counts = await pool.query(`
      SELECT (SELECT COUNT(*)::int FROM workflows) AS workflows,
             (SELECT COUNT(*)::int FROM email_alerts WHERE event IS NOT NULL) AS reminders,
             (SELECT COUNT(*)::int FROM email_alerts WHERE event IS NULL) AS "workflowAlerts",
             (SELECT COUNT(*)::int FROM email_templates) AS templates,
             (SELECT COUNT(*)::int FROM workflow_field_updates) AS "fieldUpdates"`);
    const c = counts.rows[0];

    console.log('✅ Automation ready.');
    console.log(`   ${c.workflows} workflow(s), ${c.fieldUpdates} field update(s)`);
    console.log(`   ${c.reminders} scheduled reminder(s) kept as they were, ${c.workflowAlerts} workflow email alert(s)`);
    console.log(`   ${c.templates} email template(s)`);
    console.log('\n   Nothing fires until a workflow is created, and there are none.');
    console.log('   A workflow can never fail the action that triggered it — see utils/workflowEngine.js.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Automation migration failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit(process.exitCode || 0);
  }
}

migrate();
