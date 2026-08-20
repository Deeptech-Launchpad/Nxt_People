/**
 * routes/attendance-config.js
 * The Attendance service's Configuration sections, in the same shape as
 * routes/leave-config.js: one JSONB blob per section on the settings row,
 * read and written whole, validated on the way in.
 *
 * The policy section is the exception. Its expected-hours fields live in the
 * settings columns expected_hours_mode / expected_hours_per_day /
 * expected_half_day_hours, which every report already reads. They are edited
 * here but not copied into JSONB — two answers to "how long is a full day" is
 * exactly what produced the 8h00-vs-8h30 discrepancy.
 *
 * Readable by any signed-in user, because the check-in screen and the on-duty
 * and regularization forms each read their own rules before they can render.
 * Only full-access roles can change them.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { diffConfig, summarise } = require('../utils/configDiff');
const { invalidate } = require('../utils/attendanceConfig');

router.use(protect);

const bool = v => !!v;

// Reads "HH:mm" and returns it, or throws. Blank is allowed and means unset —
// which is not the same as 00:00, a real duration of zero.
const hhmm = (v, label, { allowBlank = true } = {}) => {
  if (v === null || v === undefined || v === '') {
    if (allowBlank) return '';
    throw new Error(`${label} is required`);
  }
  const m = /^(\d{1,2}):([0-5]\d)$/.exec(String(v).trim());
  if (!m) throw new Error(`${label} must be in HH:mm form`);
  const h = Number(m[1]);
  if (h > 23) throw new Error(`${label} must be in HH:mm form`);
  return `${String(h).padStart(2, '0')}:${m[2]}`;
};

const hours = (v, label, { min = 0, max = 24 } = {}) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`${label} must be between ${min} and ${max} hours`);
  }
  return Math.round(n * 100) / 100;
};

const intIn = (v, label, min, max) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${label} must be a whole number between ${min} and ${max}`);
  }
  return n;
};

// A list the admin types into. Trimmed, de-duplicated, blanks dropped — an
// empty-string option would render as a selectable blank row on the form.
const labelList = (v, label, max = 20) => {
  const list = Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean) : [];
  const unique = [...new Set(list)];
  if (unique.length > max) throw new Error(`No more than ${max} ${label} can be added`);
  if (unique.some(x => x.length > 60)) throw new Error(`Each ${label} entry must be 60 characters or fewer`);
  return unique;
};

const showMandatory = src => {
  const f = src || {};
  const show = bool(f.show);
  // Mandatory only means something while the field is shown. Keeping it true
  // under a hidden field would silently start blocking submissions the day
  // someone turns the field back on.
  return { show, mandatory: show && bool(f.mandatory) };
};

const ymd = (v, label) => {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`${label} must be a date`);
  if (Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw new Error(`${label} is not a real date`);
  return s;
};

const CALC_MODES = ['every', 'first_last'];
// Kept in step with utils/attendanceRule.js, which is what actually enforces
// them. Rejecting an unknown mode here means the engine never has to guess.
const { MODES: RULE_MODES } = require('../utils/attendanceRule');
const { reprocess } = require('../utils/attendanceReprocess');
const { DEFAULT_TZ } = require('../utils/timezone');
const PERIODS = ['week', 'month', 'year'];
const ENTRY_MODES = ['create', 'replace'];

const SECTIONS = {
  methods: {
    column: 'attendance_methods_config',
    clean: b => ({
      regularization: bool(b.regularization),
      onDuty: bool(b.onDuty),
      hourlyPermission: bool(b.hourlyPermission),
    }),
  },

  policy: {
    column: 'attendance_policy_config',
    clean(b) {
      if (!CALC_MODES.includes(b.calculateHoursFrom)) throw new Error('Working-hours calculation mode is not valid');
      const max = b.maxHours || {};
      const pay = b.payDays || {};
      const night = b.lateNightHours || {};

      const maxEnabled = bool(max.enabled);
      const maxFull = maxEnabled ? hours(max.fullDay, 'Maximum full day') : 8.5;
      const maxHalf = maxEnabled ? hours(max.halfDay, 'Maximum half day') : 4;
      if (maxEnabled && maxHalf > maxFull) throw new Error('Maximum half day cannot exceed maximum full day');

      const nightEnabled = bool(night.enabled);

      // Strict and Lenient are Zoho's two modes; Custom is the same engine with
      // its decisions exposed. strictMode is kept in step with the mode so
      // anything still reading the older boolean keeps working.
      const mode = RULE_MODES.includes(b.mode)
        ? b.mode
        : (b.strictMode === false ? 'lenient' : 'strict');

      return {
        calculateHoursFrom: b.calculateHoursFrom,
        mode,
        strictMode: mode !== 'lenient',
        // Only meaningful under Custom, but stored in every mode: switching to
        // Custom and back should not silently discard what was configured.
        shortDayBecomes: b.shortDayBecomes === 'half_day' ? 'half_day' : 'absent',
        toleranceMinutes: intIn(b.toleranceMinutes ?? 0, 'Tolerance', 0, 240),
        leaveReducesExpected: b.leaveReducesExpected !== false,
        permissionReducesExpected: b.permissionReducesExpected !== false,
        halfDayLeaveOtherHalf: b.halfDayLeaveOtherHalf === 'absent' ? 'absent' : 'leave',
        exemptOnDuty: bool(b.exemptOnDuty),
        // Blank means the rule has always applied. A date means days before it
        // keep whatever rule was in force when they were worked, so changing a
        // threshold cannot rewrite a month that has already been reported on.
        ruleEffectiveFrom: ymd(b.ruleEffectiveFrom, 'Rule effective date'),
        allowOvertimeAndDeviation: bool(b.allowOvertimeAndDeviation),
        maxHours: { enabled: maxEnabled, fullDay: maxFull, halfDay: maxHalf },
        roundOff: bool(b.roundOff),
        // The reference ships round-off as a bare switch in the screenshots we
        // have, with no granularity. A switch alone cannot be implemented —
        // "rounded" has to say rounded to what — so the interval and direction
        // are asked for here. Fifteen minutes to the nearest boundary is the
        // common payroll default and what an unset config falls back to.
        roundOffMinutes: [5, 10, 15, 30].includes(Number(b.roundOffMinutes)) ? Number(b.roundOffMinutes) : 15,
        roundOffMode: ['nearest', 'up', 'down'].includes(b.roundOffMode) ? b.roundOffMode : 'nearest',
        payDays: { weekends: bool(pay.weekends), holidays: bool(pay.holidays), leave: bool(pay.leave) },
        lateNightHours: {
          enabled: nightEnabled,
          from: nightEnabled ? hhmm(night.from, 'Late-night start', { allowBlank: false }) : '22:00',
          to: nightEnabled ? hhmm(night.to, 'Late-night end', { allowBlank: false }) : '06:00',
        },
        absentEffectiveFrom: ymd(b.absentEffectiveFrom, 'Effective date'),
      };
    },
    // Expected hours are columns, not JSONB. Returned alongside the blob so the
    // screen edits one object, and written back to their own columns on save.
    async extra(client) {
      const r = await client.query(
        `SELECT expected_hours_mode AS "expectedMode",
                expected_hours_per_day AS "expectedFullDay",
                expected_half_day_hours AS "expectedHalfDay",
                full_day_hours AS "presentAtLeastHours",
                half_day_hours AS "halfDayAtLeastHours",
                late_after_minutes AS "lateAfterMinutes"
           FROM settings LIMIT 1`
      );
      const s = r.rows[0] || {};
      return {
        expectedMode: s.expectedMode || 'manual',
        expectedFullDay: Number(s.expectedFullDay ?? 8),
        expectedHalfDay: Number(s.expectedHalfDay ?? 4),
        // A different question from expected hours, and a different column:
        // these decide what a finished day is called at check-out, while
        // expected hours drive the payable and expected figures. Merging the
        // two is what produced the 8h00-vs-8h30 discrepancy.
        presentAtLeastHours: Number(s.presentAtLeastHours ?? 7.5),
        halfDayAtLeastHours: Number(s.halfDayAtLeastHours ?? 4),
        lateAfterMinutes: Number(s.lateAfterMinutes ?? 570),
      };
    },
    async saveExtra(client, b) {
      // Saved in both expected-hours modes: what a day is *called* does not
      // depend on where its expected length comes from.
      const present = hours(b.presentAtLeastHours, 'Full day at least', { min: 0.5 });
      const halfDay = hours(b.halfDayAtLeastHours, 'Half day at least', { min: 0.25 });
      if (halfDay > present) throw new Error('Half day threshold cannot exceed the full day threshold');
      const lateAfter = intIn(b.lateAfterMinutes, 'Late mark after', 0, 1439);
      await client.query(
        `UPDATE settings SET full_day_hours = $1, half_day_hours = $2, late_after_minutes = $3`,
        [present, halfDay, lateAfter]
      );

      const mode = b.expectedMode === 'shift' ? 'shift' : 'manual';
      // In shift mode the figures come from the employee's own shift, so the
      // manual numbers are left untouched rather than validated or zeroed.
      if (mode === 'shift') {
        await client.query(`UPDATE settings SET expected_hours_mode = 'shift'`);
        return;
      }
      const full = hours(b.expectedFullDay, 'Expected full day', { min: 0.5 });
      const half = hours(b.expectedHalfDay, 'Expected half day', { min: 0.5 });
      if (half > full) throw new Error('Expected half day cannot exceed expected full day');
      await client.query(
        `UPDATE settings SET expected_hours_mode = 'manual',
                             expected_hours_per_day = $1,
                             expected_half_day_hours = $2`,
        [full, half]
      );
    },
  },

  checkin: {
    column: 'attendance_checkin_config',
    clean(b) {
      const n = b.notifyOnReporteeEdit || {};
      const rem = b.reminders || {};
      const ci = rem.checkIn || {};
      const co = rem.checkOut || {};
      const dev = b.deviationAlerts || {};
      const missed = dev.missedCheckIn || {};
      const insuf = dev.insufficientHours || {};

      const notifyEnabled = bool(n.enabled);
      const email = String(n.email || '').trim();
      if (notifyEnabled && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error('Enter a valid email address to notify');
      }

      const allowViewReportee = bool(b.allowViewReporteeEntries);
      // Editing a reportee's entry without being able to see it is not a state
      // the UI can express, and the report screens would 403 halfway through.
      const allowEditReportee = allowViewReportee && bool(b.allowEditReporteeEntries);

      return {
        webCheckInEnabled: bool(b.webCheckInEnabled),
        locationMandatory: bool(b.locationMandatory),
        trackLocation: bool(b.trackLocation),
        showAllEntries: bool(b.showAllEntries),
        restrictOnApprovedLeave: bool(b.restrictOnApprovedLeave),
        showCurrentStatus: bool(b.showCurrentStatus),
        showEarlyLateInfo: bool(b.showEarlyLateInfo),
        allowEditOwnEntries: bool(b.allowEditOwnEntries),
        allowViewReporteeEntries: allowViewReportee,
        allowEditReporteeEntries: allowEditReportee,
        notifyOnReporteeEdit: { enabled: allowEditReportee && notifyEnabled, email: notifyEnabled ? email : '' },
        reminders: {
          checkIn: {
            enabled: bool(ci.enabled),
            beforeShift: hhmm(ci.beforeShift, 'Check-in reminder before shift'),
            afterShift: hhmm(ci.afterShift, 'Check-in reminder after shift'),
          },
          checkOut: {
            enabled: bool(co.enabled),
            beforeShift: hhmm(co.beforeShift, 'Check-out reminder before shift'),
            afterShift: hhmm(co.afterShift, 'Check-out reminder after shift'),
          },
        },
        deviationAlerts: {
          lateCheckIn: bool(dev.lateCheckIn),
          earlyCheckOut: bool(dev.earlyCheckOut),
          missedCheckIn: {
            enabled: bool(missed.enabled),
            hoursAfterShiftStart: hhmm(missed.hoursAfterShiftStart, 'Missed check-in window'),
          },
          insufficientHours: {
            enabled: bool(insuf.enabled),
            hours: hhmm(insuf.hours, 'Insufficient working hours threshold'),
            notifyManager: bool(insuf.notifyManager),
            notifyEmployee: bool(insuf.notifyEmployee),
          },
        },
      };
    },
  },

  regularization: {
    column: 'regularization_config',
    clean(b) {
      if (!ENTRY_MODES.includes(b.entryMode)) throw new Error('Regularization entry mode is not valid');
      const f = b.fields || {};
      const r = b.restrictions || {};
      const per = r.perPeriod || {};

      const reasons = labelList(b.reasons, 'reason');
      const reasonMandatory = bool(b.reasonMandatory);
      // A mandatory reason with nothing to pick from is an unsubmittable form.
      if (reasonMandatory && !reasons.length) {
        throw new Error('Add at least one reason before making the reason mandatory');
      }

      const perEnabled = bool(per.enabled);
      if (perEnabled && !PERIODS.includes(per.period)) throw new Error('Regularization limit period is not valid');

      return {
        entryMode: b.entryMode,
        reasons,
        reasonMandatory,
        fields: { description: showMandatory(f.description), document: showMandatory(f.document) },
        restrictions: {
          // "Within N days" is gone. How long somebody has is now the weekly
          // rule in utils/regularizationWindow.js — every unmarked absence in a
          // week is due by the Monday after it — and two windows that could
          // disagree about the same day is one too many.
          perPeriod: {
            enabled: perEnabled,
            count: perEnabled ? intIn(per.count, 'Regularization limit', 1, 100) : 1,
            period: perEnabled ? per.period : 'month',
          },
          allowFutureDates: bool(r.allowFutureDates),
        },
        // On-duty normally pushes a regularization deadline, because the
        // person may be at a client site with no system. These types are the
        // exception: they are working, just elsewhere, so their deadline
        // stands. Matched case-insensitively against on_duty_requests.request_type.
        // Chases people about unmarked absences before the window shuts. Off
        // by default: switching it on writes to every employee with an open
        // absence, which is not something a deploy should start doing by
        // itself.
        deadlineReminders: {
          enabled: bool(b.deadlineReminders?.enabled),
          sendAt: /^([01]?\d|2[0-3]):[0-5]\d$/.test(String(b.deadlineReminders?.sendAt || ''))
            ? String(b.deadlineReminders.sendAt)
            : '10:00',
        },
        deadlineIgnoresOnDutyTypes: Array.isArray(b.deadlineIgnoresOnDutyTypes)
          ? [...new Set(b.deadlineIgnoresOnDutyTypes.map(s => String(s).trim()).filter(Boolean))]
          : ['Work from home'],
        // Absences before this date are exempt: the rule did not exist and
        // nobody was warned. Set once, when the feature goes live.
        deadlineEffectiveFrom: /^\d{4}-\d{2}-\d{2}$/.test(String(b.deadlineEffectiveFrom || ""))
          ? String(b.deadlineEffectiveFrom)
          : null,
      };
    },
  },

  onduty: {
    column: 'on_duty_config',
    clean(b) {
      const d = b.durations || {};
      const f = b.fields || {};
      // Only the two durations an on-duty request can actually be raised for
      // here. The reference also offers half day and quarter day; on_duty_requests
      // stores a whole-day span or an hour range, with no fraction-of-a-day in
      // between, so those two are left out rather than stored and ignored.
      const durations = { fullDay: bool(d.fullDay), hourly: bool(d.hourly) };
      if (!Object.values(durations).some(Boolean)) {
        throw new Error('At least one on-duty duration must be allowed');
      }
      const typesEnabled = bool(b.typesEnabled);
      const types = labelList(b.types, 'on-duty type');
      if (typesEnabled && !types.length) throw new Error('Add at least one on-duty type, or turn types off');
      return {
        durations,
        typesEnabled,
        types,
        restrictFutureDates: bool(b.restrictFutureDates),
        fields: { description: showMandatory(f.description), attachment: showMandatory(f.attachment) },
      };
    },
  },

  reports: {
    column: 'attendance_reports_config',
    clean(b) {
      const e = b.expectedVsWorked || {};
      const v = e.view || {};
      const ed = e.edit || {};
      const p = b.viewPreferences || {};
      // Edit without view is not a permission the screens can honour.
      const viewManager = bool(v.manager);
      const viewEmployee = bool(v.employee);
      return {
        managerAccess: bool(b.managerAccess),
        expectedVsWorked: {
          view: { manager: viewManager, employee: viewEmployee },
          edit: { manager: viewManager && bool(ed.manager), employee: viewEmployee && bool(ed.employee) },
        },
        carryForwardBalanceHours: bool(b.carryForwardBalanceHours),
        viewPreferences: {
          payableHours: bool(p.payableHours),
          paidBreak: bool(p.paidBreak),
          unpaidBreak: bool(p.unpaidBreak),
        },
      };
    },
  },

  additional: {
    column: 'attendance_additional_config',
    clean: b => ({
      passwordProtectExport: bool(b.passwordProtectExport),
      scaleViewInDayTimeline: bool(b.scaleViewInDayTimeline),
    }),
  },
};

// "Update older attendance entries" on the policy screen.
//
// A day's status is written at check-out under the policy in force that
// afternoon, so changing the policy leaves older days saying what the old rule
// said. This re-applies the current one — but only when asked, only from the
// effective date, and only to `status`. The punches and the hours are the
// record of what happened; the policy decides what to call it.
//
// Reports before it writes: the default is a dry run, and applying is a second
// deliberate call. Declared above the section routes so '/policy/reprocess' is
// not swallowed by '/:section'.
router.post('/policy/reprocess', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  const apply = req.body?.apply === true;
  const client = await pool.connect();
  try {
    const r = await client.query(
      `SELECT expected_hours_mode AS "expectedMode",
              expected_hours_per_day AS "expectedFullDay",
              expected_half_day_hours AS "expectedHalfDay",
              COALESCE(timezone, $1) AS tz,
              attendance_policy_config AS policy
         FROM settings LIMIT 1`, [DEFAULT_TZ]);
    const s = r.rows[0] || {};
    const policy = s.policy || {};
    const cfg = {
      ...policy,
      expectedMode: s.expectedMode || 'manual',
      expectedFullDay: Number(s.expectedFullDay ?? 8),
      expectedHalfDay: Number(s.expectedHalfDay ?? 4),
    };

    // No effective date means the policy has always applied, so there is no
    // earlier month to protect. '1970-01-01' rather than null keeps the query
    // to one shape.
    const from = policy.ruleEffectiveFrom || policy.absentEffectiveFrom || '1970-01-01';

    const result = await reprocess(client, { cfg, from, tz: s.tz, apply });

    if (apply && result.written) {
      await logAudit(req, {
        action: 'UPDATE',
        resource: 'Attendance configuration',
        resourceId: 'policy',
        changes: {
          section: 'policy',
          summary: `re-applied the policy to ${result.written} older day(s) from ${from}`,
          fields: result.transitions.map(t => ({ field: t.label, from: null, to: t.count })),
        },
      });
    }

    res.json({ success: true, data: { ...result, from, applied: apply } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  } finally { client.release(); }
});

router.get('/:section', async (req, res) => {
  const section = SECTIONS[req.params.section];
  if (!section) return res.status(404).json({ success: false, message: 'Unknown configuration section' });
  const client = await pool.connect();
  try {
    const r = await client.query(`SELECT ${section.column} AS config FROM settings LIMIT 1`);
    const config = r.rows[0]?.config || {};
    const extra = section.extra ? await section.extra(client) : {};
    res.json({ success: true, data: { ...config, ...extra } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  } finally { client.release(); }
});

router.patch('/:section', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  const section = SECTIONS[req.params.section];
  if (!section) return res.status(404).json({ success: false, message: 'Unknown configuration section' });

  const body = req.body || {};
  let config;
  try { config = section.clean(body); }
  catch (err) { return res.status(400).json({ success: false, message: err.message }); }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Read the section as it stands before overwriting it. Without this the
    // audit entry can say a save happened but not what it changed, which is
    // the only part anyone ever needs.
    const prior = await client.query(`SELECT ${section.column} AS config FROM settings LIMIT 1`);
    const before = { ...(prior.rows[0]?.config || {}),
      ...(section.extra ? await section.extra(client) : {}) };
    // The blob and the expected-hours columns move together or not at all —
    // a half-applied policy is one of the states that reads wrong everywhere.
    if (section.saveExtra) await section.saveExtra(client, body);
    const r = await client.query(
      `UPDATE settings SET ${section.column} = $1::jsonb, updated_at = NOW()
        WHERE id = (SELECT id FROM settings LIMIT 1)
        RETURNING ${section.column} AS config`,
      [JSON.stringify(config)]
    );
    if (!r.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Settings row not found' });
    }
    const extra = section.extra ? await section.extra(client) : {};
    await client.query('COMMIT');
    // After the commit on purpose: a failed audit write must not undo a
    // saved policy. A save that changed nothing writes no entry, or people
    // pressing the button twice would bury the real changes.
    const changes = diffConfig(before, { ...r.rows[0].config, ...extra });
    if (changes.length) {
      await logAudit(req, {
        action: 'UPDATE',
        resource: 'Attendance configuration',
        resourceId: req.params.section,
        changes: { section: req.params.section, summary: summarise(changes), fields: changes },
      });
    }
    // Drop the cached copy the enforcing routes read, so the change applies to
    // the next request rather than after the TTL.
    invalidate();
    res.json({ success: true, data: { ...r.rows[0].config, ...extra } });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    const known = /must be|cannot exceed|is required|is not valid|at least one/i.test(err.message || '');
    res.status(known ? 400 : 500).json({
      success: false,
      message: known ? err.message : 'An internal server error occurred',
    });
  } finally { client.release(); }
});

module.exports = router;
