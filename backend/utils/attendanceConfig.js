/**
 * utils/attendanceConfig.js
 * One reader for the Attendance configuration sections, shared by every route
 * that has to obey them.
 *
 * These blobs are read on nearly every attendance write — a check-in, an
 * on-duty request, a regularization — so they are cached briefly rather than
 * fetched each time. The window is short enough that a setting change takes
 * effect while the admin is still looking at the screen.
 *
 * Every getter falls back to a permissive default. A missing column (an
 * install that has not run migrate_attendance_config.js yet) must not lock
 * people out of checking in.
 */
const pool = require('../db');

const TTL_MS = 30_000;
const cache = new Map(); // column -> { value, at }

const COLUMNS = {
  methods: 'attendance_methods_config',
  policy: 'attendance_policy_config',
  checkin: 'attendance_checkin_config',
  regularization: 'regularization_config',
  onduty: 'on_duty_config',
  reports: 'attendance_reports_config',
  additional: 'attendance_additional_config',
};

const FALLBACKS = {
  methods: { regularization: true, onDuty: true, hourlyPermission: true },
  policy: {
    calculateHoursFrom: 'every', strictMode: true, allowOvertimeAndDeviation: false,
    maxHours: { enabled: false, fullDay: 8.5, halfDay: 4 },
    roundOff: false, roundOffMinutes: 15, roundOffMode: 'nearest',
    payDays: { weekends: true, holidays: true, leave: true },
    lateNightHours: { enabled: false, from: '22:00', to: '06:00' },
    absentEffectiveFrom: null,
  },
  checkin: {
    webCheckInEnabled: true, locationMandatory: false, trackLocation: true,
    showAllEntries: true, restrictOnApprovedLeave: false, showCurrentStatus: true,
    showEarlyLateInfo: true, allowEditOwnEntries: false,
    allowViewReporteeEntries: true, allowEditReporteeEntries: true,
    notifyOnReporteeEdit: { enabled: false, email: '' },
  },
  regularization: {
    entryMode: 'create', reasons: [], reasonMandatory: false,
    deadlineIgnoresOnDutyTypes: ['Work from home'], deadlineEffectiveFrom: null,
    fields: { description: { show: true, mandatory: false }, document: { show: true, mandatory: false } },
    restrictions: {

      perPeriod: { enabled: false, count: 1, period: 'month' },
      allowFutureDates: false,
    },
  },
  onduty: {
    durations: { fullDay: true, hourly: true },
    typesEnabled: true, types: ['Client visit', 'Work from home'],
    restrictFutureDates: false,
    fields: { description: { show: true, mandatory: false }, attachment: { show: true, mandatory: false } },
  },
  reports: {
    managerAccess: true,
    expectedVsWorked: { view: { manager: false, employee: false }, edit: { manager: false, employee: false } },
    carryForwardBalanceHours: true,
    viewPreferences: { payableHours: true, paidBreak: true, unpaidBreak: true },
  },
  additional: { passwordProtectExport: false, scaleViewInDayTimeline: true },
};

async function section(name) {
  const column = COLUMNS[name];
  if (!column) throw new Error(`Unknown attendance config section: ${name}`);

  const hit = cache.get(column);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  let value = FALLBACKS[name];
  try {
    const r = await pool.query(`SELECT ${column} AS config FROM settings LIMIT 1`);
    // A merge, not a replace: a blob written before a later migration added a
    // key would otherwise read that key as undefined at the call site.
    if (r.rows[0]?.config) value = { ...FALLBACKS[name], ...r.rows[0].config };
  } catch (_) {
    // Column missing or DB briefly unavailable — the fallback stands.
  }
  cache.set(column, { value, at: Date.now() });
  return value;
}

// Bumped on every save. Other modules keep their own caches of settings that
// this configuration writes — reports.js caches the timezone and expected hours
// alongside the policy — and they compare generations rather than each running
// its own timer. Without it, saving a policy left the reports showing the old
// figures for up to a minute, which reads as "the setting did nothing".
let generation = 0;
const currentGeneration = () => generation;

// Called after a save so the next read sees the new value rather than waiting
// out the TTL.
const invalidate = () => { cache.clear(); generation += 1; };

// Convenience for the common "is this feature switched on" question.
const methodEnabled = async key => {
  const m = await section('methods');
  return m[key] !== false;
};

module.exports = { section, invalidate, methodEnabled, currentGeneration };
