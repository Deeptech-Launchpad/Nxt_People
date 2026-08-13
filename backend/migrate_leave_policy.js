/**
 * Leave Policy configuration — Leave Tracker Configuration, item 1.
 *
 * `leave_types` already carried name/code/colour/icon/max_days_per_year and an
 * is_active toggle, which is most of the reference's Leave Policy table. What
 * was missing is what the reports actually need to stop hardcoding:
 *
 *   pay_type      Paid / Unpaid / Compensatory Off — the grouping the
 *                 Leave-booked-and-balance report bands its columns under.
 *   unit          days / hours — decides which types appear in Day mode
 *                 versus Hour mode, currently hardcoded as "permission is the
 *                 hour-based one".
 *   accrual_mode  annual / monthly / earned — the balance endpoints hardcode
 *                 "casual is granted once in January, permission accrues 4 a
 *                 month, comp-off accrues as earned". With this they can read
 *                 the policy instead.
 *   accrual_amount  how much per grant, replacing employees.casual_leave as
 *                 the source for anything other than casual.
 *   sort_order    so the reports and this screen agree on ordering.
 *
 * Backfilled from the behaviour the reports already implement, so nothing
 * changes until someone edits a policy. Safe to re-run.
 */

const pool = require('./db');

const migrations = [
  `ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS pay_type VARCHAR(20) NOT NULL DEFAULT 'paid'`,
  `ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS unit VARCHAR(10) NOT NULL DEFAULT 'days'`,
  `ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS accrual_mode VARCHAR(20) NOT NULL DEFAULT 'annual'`,
  `ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS accrual_amount NUMERIC(8,2) NOT NULL DEFAULT 0`,
  `ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,

  // Only ever narrows to the values the app actually writes; the defaults above
  // mean existing rows already satisfy these.
  `ALTER TABLE leave_types DROP CONSTRAINT IF EXISTS leave_types_pay_type_chk`,
  `ALTER TABLE leave_types ADD CONSTRAINT leave_types_pay_type_chk
     CHECK (pay_type IN ('paid','unpaid','comp_off'))`,
  `ALTER TABLE leave_types DROP CONSTRAINT IF EXISTS leave_types_unit_chk`,
  `ALTER TABLE leave_types ADD CONSTRAINT leave_types_unit_chk
     CHECK (unit IN ('days','hours'))`,
  `ALTER TABLE leave_types DROP CONSTRAINT IF EXISTS leave_types_accrual_mode_chk`,
  `ALTER TABLE leave_types ADD CONSTRAINT leave_types_accrual_mode_chk
     CHECK (accrual_mode IN ('annual','monthly','earned','none'))`,

  // ── Backfill to match what the balance endpoints already do ──────────────
  `UPDATE leave_types SET pay_type='unpaid'   WHERE code IN ('unpaid','absent') AND pay_type='paid'`,
  `UPDATE leave_types SET pay_type='comp_off' WHERE code IN ('compoff','comp_off') AND pay_type='paid'`,

  // Permission is the hour-based type accruing 4 a month.
  `UPDATE leave_types SET unit='hours', accrual_mode='monthly', accrual_amount=4
     WHERE code='permission' AND accrual_amount=0`,
  // Comp-off is credited as it's earned, not granted on a schedule.
  `UPDATE leave_types SET accrual_mode='earned'
     WHERE code IN ('compoff','comp_off') AND accrual_mode='annual'`,
  // Unpaid and absent have no entitlement at all — that's why their balance
  // columns stay blank rather than reading zero.
  `UPDATE leave_types SET accrual_mode='none', accrual_amount=0
     WHERE code IN ('unpaid','absent')`,
  // Everything else keeps its annual allocation from max_days_per_year.
  `UPDATE leave_types SET accrual_amount = COALESCE(max_days_per_year,0)
     WHERE accrual_mode='annual' AND accrual_amount=0`,

  `UPDATE leave_types SET sort_order = CASE code
      WHEN 'casual' THEN 1 WHEN 'permission' THEN 2 WHEN 'compoff' THEN 3
      WHEN 'comp_off' THEN 3 WHEN 'unpaid' THEN 4 WHEN 'absent' THEN 5 ELSE 9 END
    WHERE sort_order = 0`,
];

(async () => {
  let ok = 0;
  for (const sql of migrations) {
    try { await pool.query(sql); ok++; }
    catch (err) { console.error('FAILED:', sql.split('\n')[0].trim(), '\n  ', err.message); }
  }
  console.log(`leave policy migration: ${ok}/${migrations.length} statements applied`);
  const r = await pool.query(
    `SELECT name, code, pay_type, unit, accrual_mode, accrual_amount, is_active
       FROM leave_types ORDER BY sort_order, name`
  );
  console.table(r.rows);
  await pool.end();
})();
