/**
 * migrate_leave_config_rest.js
 *
 * The remaining Leave Tracker configuration sections: Reports, Leave Request
 * and Additional Options.
 *
 * Each is a JSONB blob on the single settings row, for the same reason as
 * comp_off_config: these screens save as a whole, and the settings PUT is a
 * 23-parameter positional query that renumbers whenever a column is added.
 *
 * Defaults are chosen to preserve today's behaviour exactly. Anything whose
 * feature does not exist yet defaults to off, so applying this migration
 * changes nothing until both the setting and the feature behind it are ready.
 */
const pool = require('./db');

const REPORTS_DEFAULT = {
  // Matches the role checks the reports currently apply.
  resourceAccess: 'department_heads',
  showLeaveTypes: true,
  payrollReport: {
    enabled: true,
    includeWeekendsAsPayable: true,
    includeHolidaysAsPayable: true,
  },
  lossOfPay: {
    unpaidLeave: 'lop',
    maxPerPeriod: null,
    reversal: false,
  },
};

const REQUEST_DEFAULT = {
  cancellationReasonMandatory: true,
  extension: {
    policies: [],
    // Approvers can always extend; self and managers are opt-in, which is the
    // narrower default and matches what the app allows today.
    permissions: {
      past_within_pay_period: { self: false, manager: false, approver: true },
      current_and_upcoming: { self: true, manager: false, approver: true },
      past_within_calendar_year: { self: false, manager: false, approver: true },
    },
    reasonMandatory: false,
  },
  futureRequestYears: 1,
};

const ADDITIONAL_DEFAULT = {
  sandwichLeave: { enabled: false, autoReverse: false },
  passwordProtectExports: false,
  calendarSync: {
    format: ['employee_id', 'employee_name', 'leave_policy_name'],
    updateEventStatusByType: false,
  },
};

const migrations = [
  `ALTER TABLE settings ADD COLUMN IF NOT EXISTS leave_reports_config JSONB`,
  `ALTER TABLE settings ADD COLUMN IF NOT EXISTS leave_request_config JSONB`,
  `ALTER TABLE settings ADD COLUMN IF NOT EXISTS leave_additional_config JSONB`,

  // Seed only where unset, so a re-run never overwrites a real configuration.
  [`UPDATE settings SET leave_reports_config = $1::jsonb WHERE leave_reports_config IS NULL`,
   [JSON.stringify(REPORTS_DEFAULT)]],
  [`UPDATE settings SET leave_request_config = $1::jsonb WHERE leave_request_config IS NULL`,
   [JSON.stringify(REQUEST_DEFAULT)]],
  [`UPDATE settings SET leave_additional_config = $1::jsonb WHERE leave_additional_config IS NULL`,
   [JSON.stringify(ADDITIONAL_DEFAULT)]],
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
  console.log(`leave config migration: ${ok}/${migrations.length} statements applied`);
  const r = await pool.query(
    'SELECT leave_reports_config, leave_request_config, leave_additional_config FROM settings LIMIT 1'
  );
  console.log(JSON.stringify(r.rows[0], null, 2));
  await pool.end();
})();
