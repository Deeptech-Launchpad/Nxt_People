/* ── Attendance → Configuration ───────────────────────────────────────────
 *  The Attendance service gets the same Configuration rail the Leave Tracker
 *  already has: one screen, a persistent left nav, one section per screen.
 *
 *  Each section is a JSONB blob on the settings row, read and written whole,
 *  exactly as leave_reports_config / leave_request_config already are. The
 *  defaults below are the reference org's own current values, so a fresh
 *  install starts where they are rather than at some invented neutral.
 *
 *  Three columns already exist and are NOT re-created here — expected_hours_mode,
 *  expected_hours_per_day and expected_half_day_hours, from migrate_expected_hours.js.
 *  The policy screen edits those same columns rather than shadowing them in
 *  JSONB, because every report already reads them and two copies of "how long
 *  is a full day" is how the 8h00-vs-8h30 bug happened in the first place.
 *
 *  Idempotent. Safe to re-run.
 *      docker compose exec backend node migrate_attendance_config.js
 * ───────────────────────────────────────────────────────────────────────── */

const pool = require('./db');

// Reference org's live values, read off its own configuration screens.
const DEFAULTS = {
  attendance_methods_config: {
    regularization: true,
    onDuty: true,
    hourlyPermission: true,
  },

  attendance_policy_config: {
    // 'every' sums each check-in/check-out pair; 'first_last' measures the
    // first check-in to the last check-out and ignores the gaps between.
    calculateHoursFrom: 'every',
    strictMode: true,
    allowOvertimeAndDeviation: false,
    maxHours: { enabled: true, fullDay: 8.5, halfDay: 4 },
    roundOff: false,
    payDays: { weekends: true, holidays: true, leave: true },
    lateNightHours: { enabled: false, from: '22:00', to: '06:00' },
    absentEffectiveFrom: null,
  },

  attendance_checkin_config: {
    webCheckInEnabled: true,
    locationMandatory: true,
    trackLocation: true,
    showAllEntries: true,
    restrictOnApprovedLeave: false,
    showCurrentStatus: true,
    showEarlyLateInfo: true,
    allowEditOwnEntries: false,
    allowViewReporteeEntries: true,
    allowEditReporteeEntries: true,
    notifyOnReporteeEdit: { enabled: false, email: '' },
    reminders: {
      checkIn: { enabled: false, beforeShift: '00:10', afterShift: '' },
      checkOut: { enabled: false, beforeShift: '', afterShift: '00:00' },
    },
    deviationAlerts: {
      lateCheckIn: false,
      earlyCheckOut: false,
      missedCheckIn: { enabled: false, hoursAfterShiftStart: '02:00' },
      insufficientHours: { enabled: false, hours: '08:30', notifyManager: true, notifyEmployee: false },
    },
  },

  regularization_config: {
    // 'create' adds another pair for the day; 'replace' overwrites the first
    // check-in / last check-out already on the record.
    entryMode: 'create',
    reasons: ['Forgot to check-in', 'Forgot to check-out', 'System Error'],
    reasonMandatory: true,
    fields: {
      description: { show: true, mandatory: false },
      document: { show: true, mandatory: false },
    },
    restrictions: {
      withinDays: { enabled: true, days: 5 },
      perPeriod: { enabled: true, count: 1, period: 'month' },
      allowFutureDates: false,
    },
  },

  on_duty_config: {
    durations: { fullDay: true, hourly: true },
    typesEnabled: true,
    types: ['Client visit', 'Work from home'],
    restrictFutureDates: false,
    fields: {
      description: { show: true, mandatory: true },
      attachment: { show: true, mandatory: false },
    },
  },

  attendance_reports_config: {
    managerAccess: true,
    expectedVsWorked: {
      view: { manager: false, employee: false },
      edit: { manager: false, employee: false },
    },
    carryForwardBalanceHours: true,
    viewPreferences: { payableHours: true, paidBreak: true, unpaidBreak: true },
  },

  attendance_additional_config: {
    passwordProtectExport: false,
    scaleViewInDayTimeline: true,
  },
};

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    /* settings.full_day_hours is read by the attendance policy screen, the
     * entry editor and the regularization engine, and WRITTEN by the policy
     * screen's save — but nothing ever created it. schema.sql declares
     * half_day_hours and not its partner, and no migration adds it, so a
     * database built from scratch had reads quietly falling back to 7.5 and
     * the save throwing `column "full_day_hours" does not exist`.
     *
     * Both are NUMERIC(4,2) here because that is what a working installation
     * actually holds — schema.sql still says INT, which cannot express the 7.5
     * the code falls back to, nor a 4.5-hour half day. Widening an INT column
     * is safe and keeps existing values. */
    await client.query(
      `ALTER TABLE settings ADD COLUMN IF NOT EXISTS full_day_hours NUMERIC(4,2) DEFAULT 7.5`);
    await client.query(
      `ALTER TABLE settings ALTER COLUMN full_day_hours TYPE NUMERIC(4,2)`);
    await client.query(
      `ALTER TABLE settings ALTER COLUMN half_day_hours TYPE NUMERIC(4,2)`);
    await client.query(
      `UPDATE settings SET full_day_hours = 7.5 WHERE full_day_hours IS NULL`);

    for (const [column, value] of Object.entries(DEFAULTS)) {
      await client.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS ${column} JSONB`);
      // Only fill a row that has never been configured. Re-running must not
      // wipe a value an admin has since changed.
      await client.query(
        `UPDATE settings SET ${column} = $1::jsonb WHERE ${column} IS NULL`,
        [JSON.stringify(value)]
      );
    }

    // On Duty already stores an attachment path it never had a way to fill.
    // The configuration screen turns that column on, so make sure it is there.
    await client.query(
      `ALTER TABLE on_duty_requests ADD COLUMN IF NOT EXISTS attachment_path VARCHAR(500)`
    );
    await client.query(
      `ALTER TABLE on_duty_requests ADD COLUMN IF NOT EXISTS attachment_name VARCHAR(255)`
    );

    // Regularization counts requests per period against a configured cap, which
    // is a per-employee scan of a growing table on every submission.
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_regularizations_emp_created
         ON attendance_regularizations (employee_id, created_at)`
    );

    await client.query('COMMIT');

    const r = await client.query(
      `SELECT attendance_methods_config->>'regularization' AS reg,
              attendance_policy_config->>'calculateHoursFrom' AS calc,
              on_duty_config->'types' AS od_types
         FROM settings LIMIT 1`
    );
    const s = r.rows[0] || {};
    console.log('✅ Attendance configuration ready.');
    console.log(`   ${Object.keys(DEFAULTS).length} section columns present`);
    console.log(`   regularization=${s.reg}  hours from=${s.calc}  on-duty types=${JSON.stringify(s.od_types)}`);
    console.log('   on_duty_requests.attachment_path / attachment_name present');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Attendance configuration migration failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    process.exit(process.exitCode || 0);
  }
}

migrate();
