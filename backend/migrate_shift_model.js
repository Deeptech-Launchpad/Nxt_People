/* ── Settings → Shifts ─────────────────────────────────────────────────────
 *  Three things this adds, and one it fixes.
 *
 *  ADDS, from the reference's Add Shift form:
 *    Shift Margin        the boundary within which payable hours count. A
 *                        09:00 shift with a 30-minute margin does not pay
 *                        someone for arriving at 07:00.
 *    Core Working Hours  the window an employee on this shift must be present
 *                        for, which is a different question from the shift's
 *                        own start and end.
 *    Weekends are based on Location or Shift, and eligibility criteria.
 *
 *  FIXES: shifts.working_days has been written by the shift form since it was
 *  built and read by NOTHING — weekends come from work_calendars and
 *  weekend_rules, which is the rule this organization actually runs on. So the
 *  form has been offering a working-days picker that decides nothing.
 *
 *  weekend_source makes that explicit and gives the picker a job: 'location'
 *  (the default, and what every existing shift gets) keeps weekend_rules in
 *  charge; 'shift' hands it to working_days. The reference's own note says
 *  shift-based weekends override location-based ones, and this is that.
 *
 *  Every existing shift becomes weekend_source='location', so nothing about
 *  the current weekend calculation changes.
 *
 *  Idempotent. Safe to re-run.
 *      docker compose exec backend node migrate_shift_model.js
 * ───────────────────────────────────────────────────────────────────────── */

const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const [col, type] of [
      ['margin_enabled', 'BOOLEAN NOT NULL DEFAULT FALSE'],
      ['margin_before', "VARCHAR(5)"],
      ['margin_after', "VARCHAR(5)"],
      ['core_enabled', 'BOOLEAN NOT NULL DEFAULT FALSE'],
      ['core_start', "VARCHAR(5)"],
      ['core_end', "VARCHAR(5)"],
      // 'location' keeps weekend_rules in charge, which is what every existing
      // shift has effectively been doing.
      ['weekend_source', "VARCHAR(10) NOT NULL DEFAULT 'location'"],
      ['allowance_enabled', 'BOOLEAN NOT NULL DEFAULT FALSE'],
      ['eligibility', "JSONB NOT NULL DEFAULT '[]'::jsonb"],
      ['sort_order', 'INT NOT NULL DEFAULT 100'],
    ]) {
      await client.query(`ALTER TABLE shifts ADD COLUMN IF NOT EXISTS ${col} ${type}`);
    }

    await client.query(`
      ALTER TABLE shifts DROP CONSTRAINT IF EXISTS shifts_weekend_source_check`);
    await client.query(`
      ALTER TABLE shifts ADD CONSTRAINT shifts_weekend_source_check
        CHECK (weekend_source IN ('location', 'shift'))`);

    // ── Shift patterns ─────────────────────────────────────────────────────
    // The rotation itself. shift_roster already exists and is what a pattern
    // generates into, so a pattern is a recipe rather than a second schedule.
    await client.query(`
      CREATE TABLE IF NOT EXISTS shift_patterns (
        id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name         VARCHAR(150) NOT NULL UNIQUE,
        pattern_type VARCHAR(10) NOT NULL DEFAULT 'weekly',
        -- Weekly: repeat every N weeks, or follow calendar weeks 1-6 of a month.
        cycle_mode   VARCHAR(20) NOT NULL DEFAULT 'every',
        cycle_weeks  INT NOT NULL DEFAULT 1,
        -- [{ week: 1, days: { sun: <shiftId|null>, mon: ... } }]
        weeks        JSONB NOT NULL DEFAULT '[]'::jsonb,
        is_active    BOOLEAN NOT NULL DEFAULT TRUE,
        created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT shift_patterns_type_check CHECK (pattern_type IN ('weekly', 'monthly', 'custom')),
        CONSTRAINT shift_patterns_cycle_check CHECK (cycle_mode IN ('every', 'calendar_weeks'))
      )`);

    // Who follows a pattern, and from when. The generator reads this.
    await client.query(`
      CREATE TABLE IF NOT EXISTS shift_pattern_assignments (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        pattern_id  UUID NOT NULL REFERENCES shift_patterns(id) ON DELETE CASCADE,
        employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        start_date  DATE NOT NULL,
        end_date    DATE,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (pattern_id, employee_id, start_date)
      )`);

    // shift_roster gains the pattern that produced a row, so regenerating a
    // pattern can replace only its own rows and never a hand-made assignment.
    await client.query(`ALTER TABLE shift_roster ADD COLUMN IF NOT EXISTS pattern_id UUID REFERENCES shift_patterns(id) ON DELETE SET NULL`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_shift_roster_lookup ON shift_roster (employee_id, date)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_shift_pattern_assign_emp ON shift_pattern_assignments (employee_id)`);

    await client.query('COMMIT');

    const r = await pool.query(`
      SELECT (SELECT COUNT(*)::int FROM shifts) AS shifts,
             (SELECT COUNT(*)::int FROM shifts WHERE weekend_source = 'location') AS "byLocation",
             (SELECT COUNT(*)::int FROM shift_roster) AS roster,
             (SELECT COUNT(*)::int FROM shift_patterns) AS patterns`);
    const c = r.rows[0];
    console.log('✅ Shift model ready.');
    console.log(`   ${c.shifts} shift(s), all ${c.byLocation} taking weekends from the location calendar`);
    console.log(`   ${c.roster} rostered day(s), ${c.patterns} pattern(s)`);
    console.log('\n   Nothing about the current weekend calculation changed:');
    console.log('   weekend_rules stays in charge until a shift is switched to shift-based.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Shift model migration failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit(process.exitCode || 0);
  }
}

migrate();
