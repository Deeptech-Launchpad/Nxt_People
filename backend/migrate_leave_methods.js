/**
 * migrate_leave_methods.js
 *
 * Methods, and the leave policy's policy type.
 *
 * "Policy type" is how a policy decides its *amount* — a flat number, a number
 * that varies with length of service, a one-off grant, or something credited
 * from attendance. That is orthogonal to accrual_mode, which is how often the
 * amount lands. Both are needed: a fixed-entitlement policy can accrue monthly.
 *
 * Existing rows are backfilled to 'fixed', which is what they all are today —
 * a flat accrual_amount with no service-based variation. Types that grant
 * nothing (Absent, LWP) and Compensatory Off get NULL, matching the reference
 * product, which leaves that column blank for exactly those rows.
 */
const pool = require('./db');

const migrations = [
  `ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS policy_type VARCHAR(20)`,
  `ALTER TABLE leave_types ADD CONSTRAINT chk_leave_policy_type
     CHECK (policy_type IS NULL OR policy_type IN ('fixed','experience','grant','attendance'))`,

  // Comp-off is derived from worked days, not granted, and a type with no
  // entitlement has no amount to describe — the reference product leaves the
  // column blank for both rather than inventing a policy type. These rows are
  // excluded from the backfills below rather than nulled first, so re-running
  // the migration cannot reclassify them.
  `UPDATE leave_types SET policy_type = 'fixed'
     WHERE policy_type IS NULL
       AND accrual_mode IN ('annual','monthly')
       AND pay_type <> 'comp_off'`,
  `UPDATE leave_types SET policy_type = 'attendance'
     WHERE policy_type IS NULL
       AND accrual_mode = 'earned'
       AND pay_type <> 'comp_off'`,
  `UPDATE leave_types SET policy_type = NULL
     WHERE pay_type = 'comp_off' OR accrual_mode = 'none'`,

  // Methods. Comp-off is already built, so the toggle starts on rather than
  // silently switching off a feature people are using.
  `ALTER TABLE settings ADD COLUMN IF NOT EXISTS comp_off_enabled BOOLEAN NOT NULL DEFAULT TRUE`,
];

(async () => {
  let ok = 0;
  for (const sql of migrations) {
    try { await pool.query(sql); ok++; }
    catch (err) {
      if (err.code === '42710' || err.code === '42P07') { ok++; continue; }
      console.error('FAILED:', sql.split('\n')[0].trim(), '\n  ', err.message);
    }
  }
  console.log(`leave methods migration: ${ok}/${migrations.length} statements applied`);
  console.table((await pool.query(
    `SELECT name, code, pay_type, unit, accrual_mode, policy_type, is_active
       FROM leave_types ORDER BY sort_order, name`
  )).rows);
  await pool.end();
})();
