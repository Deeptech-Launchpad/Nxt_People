/* ── On Duty requests ─────────────────────────────────────────────────────
 *  On Duty is time spent working away from the usual place of work — a client
 *  visit, or a day worked from home — which the company pays for in full. It
 *  is not leave: the employee is working, so the day is payable and counts
 *  towards worked days rather than against a balance.
 *
 *  Every attendance report already carries an On Duty column and every one of
 *  them has been hardcoded to zero, because nothing in this system could ever
 *  produce the status. This table is what makes those columns real.
 *
 *  Approval reuses the shared hierarchy engine (approval_levels with
 *  request_type='on_duty'), exactly as leave and regularization do — there is
 *  no second approval implementation.
 *
 *  Idempotent. Safe to re-run.
 *      docker compose exec backend node migrate_on_duty.js
 * ───────────────────────────────────────────────────────────────────────── */

const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS on_duty_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        -- 'days' spans whole days; 'hours' is a part-day window on start_date.
        unit VARCHAR(10) NOT NULL DEFAULT 'days',
        start_time TIME,
        end_time TIME,
        hours NUMERIC(4,2),
        -- 'client_visit' | 'work_from_home'
        request_type VARCHAR(30) NOT NULL DEFAULT 'client_visit',
        reason TEXT,
        attachment_path TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        approved_by UUID REFERENCES employees(id),
        approved_at TIMESTAMPTZ,
        rejection_reason TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // The reports resolve a day for one employee at a time, so the lookup is
    // always employee + date range against approved rows.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_on_duty_employee_range
        ON on_duty_requests (employee_id, start_date, end_date)
     WHERE status = 'approved'
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_on_duty_status ON on_duty_requests (status)`);

    await client.query('COMMIT');
    console.log('✅ on_duty_requests table ready (+ indexes).');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ On Duty migration failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit(process.exitCode || 0);
  }
}

migrate();
