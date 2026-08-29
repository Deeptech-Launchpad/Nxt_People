/**
 * routes/leave-config.js
 * The remaining Leave Tracker configuration sections: Reports, Leave Request
 * and Additional Options.
 *
 * Each section is one JSONB blob on the settings row, read and written whole.
 * Validation is deliberate rather than trusting the blob: several of these
 * values gate who can see leave data, and an unchecked enum written straight
 * to JSONB would fail at read time in a report rather than on save here.
 *
 * Readable by any signed-in user — the leave request form reads its own rules
 * before it can render — but only full-access roles can change them.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { diffConfig, summarise } = require('../utils/configDiff');
const { serverError } = require('../utils/serverError');

router.use(protect);

const RESOURCE_ACCESS = ['administrators', 'department_heads', 'employees_own_department', 'all_employees'];
const UNPAID_LEAVE = ['lop', 'carry_over'];
const EXTENSION_ROWS = ['past_within_pay_period', 'current_and_upcoming', 'past_within_calendar_year'];
const EXTENSION_ACTORS = ['self', 'manager', 'approver'];
const PAYROLL_RUN_ACTIONS = ['block', 'flag', 'allow'];
const PAST_SCOPES = ['current', 'custom'];
const REQUEST_SCOPES = ['all', 'specific'];

// A permissions matrix is stored dense — every row, every actor, explicitly
// true or false. A sparse one would leave "not set" and "not permitted"
// indistinguishable at read time, and the difference decides whether somebody
// can cancel a leave.
const matrix = src => EXTENSION_ROWS.reduce((rows, row) => {
  const r = (src || {})[row] || {};
  rows[row] = EXTENSION_ACTORS.reduce((o, a) => ({ ...o, [a]: !!r[a] }), {});
  return rows;
}, {});
const CALENDAR_PARTS = ['employee_id', 'employee_name', 'leave_policy_name', 'leave_type', 'none'];

// A section is (column, validator). The validator returns a clean object, or
// throws an Error whose message is safe to show the user.
const SECTIONS = {
  reports: {
    column: 'leave_reports_config',
    clean(b) {
      if (!RESOURCE_ACCESS.includes(b.resourceAccess)) throw new Error('Access permission is not valid');
      const p = b.payrollReport || {};
      const l = b.lossOfPay || {};
      if (!UNPAID_LEAVE.includes(l.unpaidLeave)) throw new Error('Unpaid leave handling is not valid');
      // Blank means no cap, which is different from a cap of zero — zero would
      // forbid every LOP day rather than leaving the limit unset.
      let maxPerPeriod = null;
      if (l.maxPerPeriod !== null && l.maxPerPeriod !== undefined && l.maxPerPeriod !== '') {
        const n = Number(l.maxPerPeriod);
        if (!Number.isFinite(n) || n < 0 || n > 366) throw new Error('Maximum LOP per pay period must be between 0 and 366');
        maxPerPeriod = n;
      }
      return {
        resourceAccess: b.resourceAccess,
        showLeaveTypes: !!b.showLeaveTypes,
        payrollReport: {
          enabled: !!p.enabled,
          includeWeekendsAsPayable: !!p.includeWeekendsAsPayable,
          includeHolidaysAsPayable: !!p.includeHolidaysAsPayable,
        },
        lossOfPay: {
          unpaidLeave: l.unpaidLeave,
          maxPerPeriod,
          reversal: !!l.reversal,
          // Only meaningful while unpaidLeave is 'carry_over', but stored
          // either way: switching to LOP and back should not discard how the
          // carry was configured.
          //
          // 'one_period' by default. A debt that follows somebody indefinitely
          // is the more surprising of the two, so it has to be chosen.
          carryExpiry: l.carryExpiry === 'never' ? 'never' : 'one_period',
          carryVisibleToEmployee: !!l.carryVisibleToEmployee,
        },
      };
    },
  },

  request: {
    column: 'leave_request_config',
    clean(b) {
      const e = b.extension || {};
      const years = Number(b.futureRequestYears);
      if (!Number.isInteger(years) || years < 1 || years > 3) throw new Error('Future request limit must be 1, 2 or 3 years');
      const policies = Array.isArray(e.policies)
        ? [...new Set(e.policies.map(String).filter(Boolean))]
        : [];

      const c = b.cancellation || {};
      if (c.pastScope !== undefined && !PAST_SCOPES.includes(c.pastScope)) {
        throw new Error('Pay period scope for past leave cancellation is not valid');
      }
      if (c.requestScope !== undefined && !REQUEST_SCOPES.includes(c.requestScope)) {
        throw new Error('Request scope for leave cancellation is not valid');
      }
      const cancelPolicies = Array.isArray(c.policies)
        ? [...new Set(c.policies.map(String).filter(Boolean))]
        : [];
      // Scoping to specific requests with nothing selected would silently mean
      // "none", which reads on screen as a working restriction and behaves as a
      // total block. Refuse it rather than storing an unusable rule.
      if (c.requestScope === 'specific' && !cancelPolicies.length) {
        throw new Error('Select at least one leave policy, or scope cancellation to all requests');
      }
      // A custom window has to say how far back it reaches, or "custom" means
      // nothing and the rule silently falls back to the pay period.
      let customDays = 30;
      if (c.customDays !== null && c.customDays !== undefined && c.customDays !== '') {
        const n = Number(c.customDays);
        if (!Number.isInteger(n) || n < 1 || n > 366) {
          throw new Error('The custom cancellation window must be between 1 and 366 days');
        }
        customDays = n;
      }
      if (c.payrollRun !== undefined && !PAYROLL_RUN_ACTIONS.includes(c.payrollRun)) {
        throw new Error('The rule for leave already paid is not valid');
      }

      return {
        cancellationReasonMandatory: !!b.cancellationReasonMandatory,
        cancellation: {
          permissions: matrix(c.permissions),
          pastScope: c.pastScope || 'current',
          requestScope: c.requestScope || 'all',
          policies: cancelPolicies,
          // Stored whatever the scope says, so switching to the pay period and
          // back does not discard the window somebody configured.
          customDays,
          // What happens when a payslip already exists for the month the leave
          // falls in. 'block' is the default: a cancellation that silently
          // disagrees with a payslip already issued is the worst of the three.
          payrollRun: PAYROLL_RUN_ACTIONS.includes(c.payrollRun) ? c.payrollRun : 'block',
          allowPartial: !!c.allowPartial,
        },
        extension: { policies, permissions: matrix(e.permissions), reasonMandatory: !!e.reasonMandatory },
        futureRequestYears: years,
      };
    },
  },

  additional: {
    column: 'leave_additional_config',
    clean(b) {
      const s = b.sandwichLeave || {};
      const c = b.calendarSync || {};
      const format = Array.isArray(c.format) ? c.format.filter(x => CALENDAR_PARTS.includes(x)) : [];
      if (!format.length) throw new Error('The calendar display format needs at least one part');
      return {
        // Auto-reverse only means anything while the policy is on; storing it
        // as true with the policy off would resurface silently if re-enabled.
        //
        // The rest are stored whatever the switch says: turning the policy off
        // to check something and back on should not quietly discard how it was
        // configured.
        sandwichLeave: {
          enabled: !!s.enabled,
          autoReverse: !!s.enabled && !!s.autoReverse,
          // 0 bridges a single long weekend as readily as a fortnight, which is
          // rarely what an organization means by this policy.
          minDays: Number.isFinite(Number(s.minDays)) && Number(s.minDays) >= 0
            ? Math.min(30, Math.floor(Number(s.minDays))) : 0,
          // True: a bridged day needs leave on both sides. False: leave on one
          // side is enough, so a Friday off pulls in the weekend after it.
          requireBothSides: s.requireBothSides !== false,
          // Applying this to earned leave spends a balance somebody accrued;
          // applying it only to unpaid leave costs pay instead.
          appliesTo: s.appliesTo === 'unpaid' ? 'unpaid' : 'all',
        },
        passwordProtectExports: !!b.passwordProtectExports,
        calendarSync: { format, updateEventStatusByType: !!c.updateEventStatusByType },
      };
    },
  },
};

router.get('/:section', async (req, res) => {
  const section = SECTIONS[req.params.section];
  if (!section) return res.status(404).json({ success: false, message: 'Unknown configuration section' });
  try {
    const r = await pool.query(`SELECT ${section.column} AS config FROM settings LIMIT 1`);
    res.json({ success: true, data: r.rows[0]?.config || {} });
  } catch (err) { serverError(res, err); }
});

router.patch('/:section', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  const section = SECTIONS[req.params.section];
  if (!section) return res.status(404).json({ success: false, message: 'Unknown configuration section' });

  let config;
  try { config = section.clean(req.body || {}); }
  catch (err) { return res.status(400).json({ success: false, message: err.message }); }

  try {
    // Read the section before overwriting it. Without this the audit entry can
    // say a save happened but not what it changed, which is the only part
    // anyone ever needs afterwards.
    const prior = await pool.query(`SELECT ${section.column} AS config FROM settings LIMIT 1`);
    const before = prior.rows[0]?.config || {};

    const r = await pool.query(
      `UPDATE settings SET ${section.column} = $1::jsonb, updated_at = NOW()
        WHERE id = (SELECT id FROM settings LIMIT 1)
        RETURNING ${section.column} AS config`,
      [JSON.stringify(config)]
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Settings row not found' });

    // A save that changed nothing writes no entry — people press the button
    // twice, and those would bury the real changes.
    const changes = diffConfig(before, r.rows[0].config);
    if (changes.length) {
      await logAudit(req, {
        action: 'UPDATE',
        resource: 'Leave configuration',
        resourceId: req.params.section,
        changes: { section: req.params.section, summary: summarise(changes), fields: changes },
      });
    }
    res.json({ success: true, data: r.rows[0].config });
  } catch (err) { serverError(res, err); }
});

module.exports = router;
