/**
 * migrate_work_calendar.js
 *
 * Work Calendar and the Pay Period cycle model.
 *
 * Work calendars gather what was previously scattered: the weekend pattern
 * lived in weekend_rules with nothing owning it, the work week lived in the
 * general settings blob, and the calendar year was never modelled at all.
 * A calendar owns all three, scoped to a location, matching the reference
 * product. weekend_rules gains a calendar_id so existing rules keep working —
 * a rule with no calendar is global, which is exactly what they are today.
 *
 * Pay periods change shape more substantially. They were a fixed date range,
 * which cannot express "1st of current month to last day of current month,
 * every month". The cycle columns describe the recurrence; start_date and
 * end_date stay on the table as the *current* cycle, refreshed on read, so the
 * pay-period chip and the reports that consume it keep working unchanged.
 */
const pool = require('./db');

const migrations = [
  `CREATE TABLE IF NOT EXISTS work_calendars (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- NULL location = the Default calendar, used wherever no location matches.
    location            VARCHAR(160),
    -- 0 = Sunday .. 6 = Saturday, matching JS getDay() so no mapping is needed.
    week_starts_on      SMALLINT NOT NULL DEFAULT 0 CHECK (week_starts_on BETWEEN 0 AND 6),
    work_week_start     SMALLINT NOT NULL DEFAULT 1 CHECK (work_week_start BETWEEN 0 AND 6),
    work_week_end       SMALLINT NOT NULL DEFAULT 6 CHECK (work_week_end BETWEEN 0 AND 6),
    half_day_weekend    BOOLEAN NOT NULL DEFAULT FALSE,
    -- 'current' = January to December. 'custom' = the two dates below.
    year_mode           VARCHAR(10) NOT NULL DEFAULT 'current' CHECK (year_mode IN ('current','custom')),
    year_start          DATE,
    year_end            DATE,
    statutory_weekends  BOOLEAN NOT NULL DEFAULT FALSE,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_by          UUID REFERENCES employees(id),
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
  )`,
  // One calendar per location. The Default calendar is the single NULL row,
  // which a plain UNIQUE would not constrain since NULLs never collide.
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_work_calendar_location
     ON work_calendars (location) WHERE location IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_work_calendar_default
     ON work_calendars ((TRUE)) WHERE location IS NULL`,
  `ALTER TABLE work_calendars ADD CONSTRAINT chk_work_calendar_custom_year
     CHECK (year_mode <> 'custom' OR (year_start IS NOT NULL AND year_end IS NOT NULL AND year_end >= year_start))`,

  // Existing weekend rules stay global until a calendar claims them.
  `ALTER TABLE weekend_rules ADD COLUMN IF NOT EXISTS calendar_id UUID REFERENCES work_calendars(id) ON DELETE CASCADE`,
  `CREATE INDEX IF NOT EXISTS idx_weekend_rules_calendar ON weekend_rules(calendar_id)`,

  // The Default calendar. Mon-Sat work week is what this organisation actually
  // runs; the settings blob claims Mon-Fri, which is the wrong fallback.
  `INSERT INTO work_calendars (location, week_starts_on, work_week_start, work_week_end, year_mode)
     SELECT NULL, 0, 1, 6, 'current'
     WHERE NOT EXISTS (SELECT 1 FROM work_calendars WHERE location IS NULL)`,

  // ── Pay period cycle model ────────────────────────────────────────────────
  `ALTER TABLE pay_periods ADD COLUMN IF NOT EXISTS cycle VARCHAR(20) NOT NULL DEFAULT 'monthly'`,
  `ALTER TABLE pay_periods ADD CONSTRAINT chk_pay_period_cycle
     CHECK (cycle IN ('monthly','semi_monthly','fortnightly','weekly'))`,
  // Day-of-month, or 32 for "Last day" — a sentinel keeps the column numeric
  // and orderable rather than splitting into a mode column plus a number.
  `ALTER TABLE pay_periods ADD COLUMN IF NOT EXISTS start_day SMALLINT NOT NULL DEFAULT 1
     CHECK (start_day BETWEEN 1 AND 32)`,
  `ALTER TABLE pay_periods ADD COLUMN IF NOT EXISTS end_day SMALLINT NOT NULL DEFAULT 32
     CHECK (end_day BETWEEN 1 AND 32)`,
  `ALTER TABLE pay_periods ADD COLUMN IF NOT EXISTS processing_day SMALLINT NOT NULL DEFAULT 32
     CHECK (processing_day BETWEEN 1 AND 32)`,
  `ALTER TABLE pay_periods ADD COLUMN IF NOT EXISTS report_day SMALLINT NOT NULL DEFAULT 1
     CHECK (report_day BETWEEN 1 AND 32)`,
  `ALTER TABLE pay_periods ADD COLUMN IF NOT EXISTS pending_action VARCHAR(20)
     CHECK (pending_action IS NULL OR pending_action IN ('auto_reject','auto_approve'))`,
  `ALTER TABLE pay_periods ADD COLUMN IF NOT EXISTS convert_absences BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE pay_periods ADD COLUMN IF NOT EXISTS lock_after_processing BOOLEAN NOT NULL DEFAULT FALSE`,
  // {field: 'location'|'department'|'employee_type', values: [...]}. An empty
  // object means the period applies to everyone.
  `ALTER TABLE pay_periods ADD COLUMN IF NOT EXISTS applicable_to JSONB NOT NULL DEFAULT '{}'`,

  // start_date/end_date predate the cycle model and are still read by the
  // pay-period chip. They become a cache of the current cycle, so they must
  // stay nullable-free but no longer need to be hand-entered.
  `UPDATE pay_periods SET start_day = 1, end_day = 32, processing_day = 32, report_day = 1
     WHERE cycle = 'monthly' AND start_day = 1 AND end_day = 32`,
];

(async () => {
  let ok = 0;
  for (const sql of migrations) {
    try { await pool.query(sql); ok++; }
    catch (err) {
      // A re-run hits "constraint already exists"; that is success, not failure.
      if (err.code === '42710' || err.code === '42P07') { ok++; continue; }
      console.error('FAILED:', sql.split('\n')[0].trim(), '\n  ', err.message);
    }
  }
  console.log(`work calendar migration: ${ok}/${migrations.length} statements applied`);
  console.table((await pool.query(
    `SELECT location, week_starts_on, work_week_start, work_week_end, year_mode FROM work_calendars`
  )).rows);
  console.table((await pool.query(
    `SELECT name, cycle, start_day, end_day, processing_day, report_day FROM pay_periods`
  )).rows);
  await pool.end();
})();
