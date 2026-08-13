/**
 * Pay Period — Leave Tracker Configuration, item 6.
 *
 * The reference puts a `Pay Period : ANXT Payroll` chip on Loss of pay, Leave
 * encashment and Leave data for payroll, in place of a date-range navigator,
 * and gates the encashment report behind a "Process leave encashment" flag on
 * the period. The spec deferred this until the payroll module existed; that
 * decision has since been reversed, so the entity is built here.
 *
 *   name                what the period is called on the chip
 *   start_date/end_date the range the three reports cover when it is picked
 *   process_encashment  whether leave encashment is processed in this period.
 *                       The encashment report shows its empty state, and a
 *                       route back here, when the selected period has it off.
 *   is_active           a period that has been retired stays on old reports
 *                       but is not offered for new selections
 *
 * No period is seeded. The three reports keep their date navigator and behave
 * exactly as before until someone creates one and picks it — nothing changes
 * on its own. Safe to re-run.
 */

const pool = require('./db');

const migrations = [
  `CREATE TABLE IF NOT EXISTS pay_periods (
     id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
     name               VARCHAR(120) NOT NULL,
     start_date         DATE NOT NULL,
     end_date           DATE NOT NULL,
     process_encashment BOOLEAN NOT NULL DEFAULT FALSE,
     is_active          BOOLEAN NOT NULL DEFAULT TRUE,
     created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `ALTER TABLE pay_periods DROP CONSTRAINT IF EXISTS pay_periods_range_chk`,
  `ALTER TABLE pay_periods ADD CONSTRAINT pay_periods_range_chk
     CHECK (end_date >= start_date)`,
  // Two periods with the same name on a searchable dropdown are unpickable.
  `CREATE UNIQUE INDEX IF NOT EXISTS pay_periods_name_uniq ON pay_periods (lower(name))`,
  `CREATE INDEX IF NOT EXISTS pay_periods_start_idx ON pay_periods (start_date DESC)`,
];

(async () => {
  let ok = 0;
  for (const sql of migrations) {
    try { await pool.query(sql); ok++; }
    catch (err) { console.error('FAILED:', sql.split('\n')[0].trim(), '\n  ', err.message); }
  }
  console.log(`pay periods migration: ${ok}/${migrations.length} statements applied`);
  const r = await pool.query('SELECT COUNT(*)::int AS periods FROM pay_periods');
  console.table(r.rows);
  await pool.end();
})();
