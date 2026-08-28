/* ── Attendance for staff who have no login ────────────────────────────────
 *  Housekeeping work a three-to-four hour shift, have no device and no
 *  account, and turn up on Saturdays and public holidays when everybody else
 *  is off. Nobody can punch for them, so HR marks the day instead.
 *
 *  Four things this adds.
 *
 *  1. Manual shifts. A flag on the existing shifts table rather than a second
 *     shift model — the span is the same question. The flag keeps them out of
 *     rotation, patterns, auto-assignment and every shift picker, because
 *     three cleaners' shifts should not appear in a dropdown for 155 people.
 *
 *     Saturdays are handled by machinery that already exists: shifts carries
 *     working_days and weekend_source, and weekend_source 'shift' hands the
 *     weekend decision to that shift's own days. A manual shift is one with
 *     weekend_source = 'shift', so weekend_rules never has to learn about it.
 *     Holidays are the same idea, via observes_holidays.
 *
 *  2. Assignments. Who works which shift, with no unique key on the employee
 *     alone — one person can hold two shifts a day, which is the whole point.
 *     shift_roster could not express this: it is UNIQUE (employee_id, date).
 *
 *  3. Marks. What HR actually asserted, in three states rather than two:
 *     present, absent, or NO ROW AT ALL. That third state is the important
 *     one. Absence is only ever recorded because somebody clicked absent; an
 *     unmarked day is not an absence, it is a day nobody has looked at.
 *
 *     Reports then treat an unmarked scheduled day as present, and say how
 *     many of the presented days were presumed rather than confirmed. The
 *     presumption is applied on READ and never stored, so the table always
 *     says what really happened and the policy can change without a migration.
 *
 *  4. attendance.source. Marked days are written to attendance so they reach
 *     the ordinary exports, and this column is how anything reading that table
 *     can tell a marked day from a punched one. Every repair script this month
 *     worked by reasoning about real punches; a marked day that looked like a
 *     punch would corrupt all of them.
 *
 *  PAYROLL IS DELIBERATELY NOT WIRED. Whether a presumed-present day is a paid
 *  day is a decision that has not been made. When payroll work starts, search
 *  for PAYROLL-DECISION in this repository — this migration, the summary
 *  endpoint and the page all carry that marker at the exact points where the
 *  answer changes behaviour.
 *
 *  Idempotent. Safe to re-run.
 *      docker compose exec backend node migrate_manual_attendance.js
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';

const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── 1. manual shifts ─────────────────────────────────────────────────────
    await client.query(`ALTER TABLE shifts ADD COLUMN IF NOT EXISTS is_manual BOOLEAN NOT NULL DEFAULT FALSE`);

    /* fixed  — marking present credits the whole shift span, and hours are not
     *          asked for. This is housekeeping: a shift is a shift.
     * actual — the marking row gains an hours field HR types into.
     * Set per shift because the shift is where the span already lives. */
    await client.query(`ALTER TABLE shifts ADD COLUMN IF NOT EXISTS pay_mode VARCHAR(10) NOT NULL DEFAULT 'fixed'`);

    /* Which days a manual shift runs is NOT a new column.
     *
     * shifts already carries working_days and weekend_source, and
     * migrate_shift_model.js already gave them exactly this meaning:
     * weekend_source 'location' leaves weekend_rules in charge, 'shift' hands
     * the decision to that shift's own working_days. A manual shift is simply
     * one with weekend_source = 'shift', which is how housekeeping work
     * Saturday without weekend_rules needing any scoping.
     *
     * This first added a days_of_week column before noticing, which would have
     * left two lists of working days on the same table for the same question.
     * It is dropped here rather than left behind for somebody to find and
     * wonder which one wins. Nothing ever read it: the column and the feature
     * shipped together.
     *
     * Both are ensured rather than assumed, because migrate_shift_model.js is
     * one of the forty migrations npm run migrate does not run. */
    await client.query(
      `ALTER TABLE shifts ADD COLUMN IF NOT EXISTS working_days JSONB NOT NULL
         DEFAULT '["Mon","Tue","Wed","Thu","Fri"]'::jsonb`);
    await client.query(
      `ALTER TABLE shifts ADD COLUMN IF NOT EXISTS weekend_source VARCHAR(10) NOT NULL DEFAULT 'location'`);
    await client.query(`ALTER TABLE shifts DROP COLUMN IF EXISTS days_of_week`);

    /* FALSE means the shift runs on company holidays. Housekeeping do.
     * Ordinary shifts are unaffected: this is read only for manual ones. */
    await client.query(`ALTER TABLE shifts ADD COLUMN IF NOT EXISTS observes_holidays BOOLEAN NOT NULL DEFAULT TRUE`);

    await client.query(`
      ALTER TABLE shifts DROP CONSTRAINT IF EXISTS shifts_pay_mode_check`);
    await client.query(`
      ALTER TABLE shifts ADD CONSTRAINT shifts_pay_mode_check CHECK (pay_mode IN ('fixed','actual'))`);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_shifts_manual ON shifts (is_manual) WHERE is_manual`);

    // ── 2. who works which shift ─────────────────────────────────────────────
    /* No unique key on employee_id alone — a cleaner with a morning and an
     * evening shift needs two rows, and shift_roster's UNIQUE (employee_id,
     * date) is exactly what made it unusable here. */
    await client.query(`
      CREATE TABLE IF NOT EXISTS manual_attendance_assignments (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        shift_id    UUID NOT NULL REFERENCES shifts(id)    ON DELETE CASCADE,
        created_by  UUID REFERENCES employees(id) ON DELETE SET NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (employee_id, shift_id)
      )`);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_maa_employee ON manual_attendance_assignments (employee_id)`);

    // ── 3. what HR asserted ──────────────────────────────────────────────────
    /* One row per person per shift per day. A row means somebody decided; no
     * row means nobody has looked yet, and those are different facts. */
    await client.query(`
      CREATE TABLE IF NOT EXISTS manual_attendance_marks (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        shift_id    UUID NOT NULL REFERENCES shifts(id)    ON DELETE CASCADE,
        date        DATE NOT NULL,
        state       VARCHAR(10) NOT NULL,
        -- Only meaningful when the shift's pay_mode is 'actual'. NULL means
        -- "the whole shift", which is what fixed always means.
        hours       NUMERIC(5,2),
        note        VARCHAR(255),
        marked_by   UUID REFERENCES employees(id) ON DELETE SET NULL,
        marked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (employee_id, shift_id, date),
        CONSTRAINT mam_state_check CHECK (state IN ('present','absent'))
      )`);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_mam_date ON manual_attendance_marks (date)`);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_mam_employee_date ON manual_attendance_marks (employee_id, date)`);

    // ── 4. telling a marked day from a punched one ───────────────────────────
    /* 'punch'  — somebody checked in and out, or an admin edited those punches.
     * 'manual' — HR asserted the day; the times shown are the shift's span and
     *            were never observed. Nothing may treat these as evidence of
     *            when a person actually arrived. */
    await client.query(
      `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'punch'`);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_attendance_source ON attendance (source) WHERE source <> 'punch'`);

    await client.query('COMMIT');

    const counts = (await client.query(`
      SELECT (SELECT COUNT(*) FROM shifts WHERE is_manual)                AS manual_shifts,
             (SELECT COUNT(*) FROM manual_attendance_assignments)         AS assignments,
             (SELECT COUNT(*) FROM manual_attendance_marks)               AS marks,
             (SELECT COUNT(*) FROM attendance WHERE source = 'manual')    AS manual_days`)).rows[0];

    console.log('\n  ok   shifts: is_manual, pay_mode, days_of_week, observes_holidays');
    console.log('  ok   manual_attendance_assignments');
    console.log('  ok   manual_attendance_marks');
    console.log('  ok   attendance.source');
    console.log(`\n  ${counts.manual_shifts} manual shift(s), ${counts.assignments} assignment(s), ` +
                `${counts.marks} mark(s), ${counts.manual_days} marked attendance day(s)\n`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\n  failed —', err.message, '\n');
    client.release();
    await pool.end();
    process.exit(1);
  }
  client.release();
  await pool.end();
}

migrate();
