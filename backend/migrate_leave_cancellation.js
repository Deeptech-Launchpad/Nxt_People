/**
 * migrate_leave_cancellation.js
 *
 * Leave cancellation becomes a real permissions matrix instead of a single
 * "reason mandatory" checkbox, and a cancellation finally records why.
 *
 * The defaults deliberately reproduce TODAY'S behaviour rather than copying the
 * reference tenant's ticked boxes: an employee can cancel their own leave, an
 * approver can cancel anyone's, a reporting manager cannot. Applying this
 * changes nothing for anybody until an admin tightens it on the screen.
 * Seeding the reference's own choices would silently take an ability away from
 * 146 people on deploy.
 */
const pool = require('./db');

const ALL_ROWS = { self: true, manager: false, approver: true };

const CANCELLATION_DEFAULT = {
  permissions: {
    past_within_pay_period: { ...ALL_ROWS },
    current_and_upcoming: { ...ALL_ROWS },
    past_within_calendar_year: { ...ALL_ROWS },
  },
  // Which window "past leaves within current pay period" means. 'current' uses
  // the live pay-period cycle; 'custom' is offered but not yet interpreted.
  pastScope: 'current',
  // 'all' applies the row to every leave policy. 'specific' is offered but not
  // yet interpreted.
  requestScope: 'all',
  policies: [],
  allowPartial: false,
};

const migrations = [
  // Cancelling and rejecting are different acts with different audiences, so
  // the reason for one does not go in the other's column.
  `ALTER TABLE leaves ADD COLUMN IF NOT EXISTS cancellation_reason TEXT`,
  `ALTER TABLE leaves ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES employees(id)`,
  `ALTER TABLE leaves ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP`,

  // Merged into the existing blob rather than replacing it, so the extension
  // matrix and the future-dates limit already stored there survive.
  [`UPDATE settings
       SET leave_request_config =
             COALESCE(leave_request_config, '{}'::jsonb) || jsonb_build_object('cancellation', $1::jsonb)
     WHERE leave_request_config IS NULL
        OR NOT (leave_request_config ? 'cancellation')`,
   [JSON.stringify(CANCELLATION_DEFAULT)]],
];

(async () => {
  let ok = 0;
  for (const entry of migrations) {
    const [sql, params] = Array.isArray(entry) ? entry : [entry, []];
    try { await pool.query(sql, params); ok++; }
    catch (err) {
      if (err.code === '42710' || err.code === '42P07') { ok++; continue; }
      console.error('FAILED:', sql.split('\n')[0].trim(), '\n  ', err.message);
    }
  }
  console.log(`leave cancellation migration: ${ok}/${migrations.length} statements applied`);
  const r = await pool.query(`SELECT leave_request_config->'cancellation' AS cancellation FROM settings LIMIT 1`);
  console.log(JSON.stringify(r.rows[0]?.cancellation, null, 2));
  await pool.end();
})();
