/* ── Shift Change Request ──────────────────────────────────────────────────
 *  The form the reference's Shifts → Approvals hangs off, and the reason that
 *  tab was skipped: an approval rule for a form nobody can submit is a dead
 *  entry point. This is the form.
 *
 *  An employee asks to move from one shift to another. It routes through the
 *  approval chain that already exists, and on approval the shift actually
 *  changes — which is the part that makes it more than a record.
 *
 *  Two kinds of change, because they are genuinely different questions:
 *
 *    temporary  a date range. Writes shift_roster rows, which attendance now
 *               resolves against, so the change applies to exactly those days
 *               and the standing shift is untouched.
 *    permanent  from a date onwards. Writes employees.shift_id, the same thing
 *               assigning a shift by hand does.
 *
 *  Idempotent. Safe to re-run.
 *      docker compose exec backend node migrate_shift_change_requests.js
 * ───────────────────────────────────────────────────────────────────────── */

const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS shift_change_requests (
        id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        employee_id   UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,

        -- The shift held when the request was raised. Stored rather than read
        -- back later: the whole point is that the shift changes, so reading it
        -- at approval time would show the answer instead of the question.
        from_shift_id UUID REFERENCES shifts(id) ON DELETE SET NULL,
        to_shift_id   UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,

        change_type   VARCHAR(10) NOT NULL DEFAULT 'temporary',
        start_date    DATE NOT NULL,
        -- Required for a temporary change, meaningless for a permanent one.
        end_date      DATE,

        reason        TEXT,
        status        VARCHAR(20) NOT NULL DEFAULT 'pending',
        approved_by   UUID REFERENCES employees(id) ON DELETE SET NULL,
        approved_at   TIMESTAMP,
        rejection_reason TEXT,
        -- What the approval actually did, so "approved" and "applied" are not
        -- assumed to be the same thing.
        applied_at    TIMESTAMP,
        applied_note  TEXT,

        created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMP NOT NULL DEFAULT NOW(),

        CONSTRAINT scr_change_type_check CHECK (change_type IN ('temporary', 'permanent')),
        CONSTRAINT scr_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
        -- A temporary change with no end date would run forever, which is a
        -- permanent one wearing the wrong name.
        CONSTRAINT scr_range_check CHECK (change_type = 'permanent' OR end_date IS NOT NULL),
        CONSTRAINT scr_order_check CHECK (end_date IS NULL OR end_date >= start_date)
      )`);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_scr_employee ON shift_change_requests (employee_id, start_date)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_scr_status ON shift_change_requests (status)`);

    // shift_roster gains the request that produced a row, so cancelling an
    // approved change can remove exactly its own days and nothing else.
    await client.query(`ALTER TABLE shift_roster ADD COLUMN IF NOT EXISTS request_id UUID REFERENCES shift_change_requests(id) ON DELETE SET NULL`);

    // A seeded approval so the form routes from the moment it exists. No
    // criteria, so it is the catch-all for this form — the same shape as the
    // six that were seeded for the other request types.
    const existing = await client.query(
      `SELECT 1 FROM approval_rules WHERE request_type = 'shift_change' LIMIT 1`);
    if (!existing.rows.length) {
      await client.query(
        `INSERT INTO approval_rules
           (request_type, name, description, is_active, levels, criteria, criteria_match,
            decision, follow_up, messages, sort_order)
         VALUES ('shift_change', 'Shift change request',
                 'Routes a shift change the same way every other request is routed.',
                 TRUE,
                 $1::jsonb, '[]'::jsonb, 'AND', 'chain',
                 $2::jsonb, $3::jsonb, 100)`,
        [
          JSON.stringify([{ kind: 'reporting_to', count: 1 }]),
          JSON.stringify({ enabled: false, mode: 'one_time', days: 1, time: '10:00' }),
          JSON.stringify({
            from: 'default_address', to: ['current_approver'], cc: [],
            subject: 'New shift change request',
            templateName: null,
            onApproved: { enabled: true, templateName: null },
            onRejected: { enabled: true, templateName: null },
          }),
        ]
      );
    }

    await client.query('COMMIT');

    const r = await pool.query(`
      SELECT (SELECT COUNT(*)::int FROM shift_change_requests) AS requests,
             (SELECT COUNT(*)::int FROM approval_rules WHERE request_type = 'shift_change') AS rules,
             (SELECT COUNT(*)::int FROM shifts) AS shifts`);
    const c = r.rows[0];
    console.log('✅ Shift change requests ready.');
    console.log(`   ${c.requests} request(s), ${c.rules} approval rule, ${c.shifts} shift(s) to move between`);
    console.log('\n   The approval routes to the reporting manager by default, and can be');
    console.log('   changed under Manage Accounts → Approvals like every other form.');
    if (c.shifts < 2) {
      console.log('\n   Only one shift exists, so there is nowhere to request a change to yet.');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Shift change request migration failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit(process.exitCode || 0);
  }
}

migrate();
