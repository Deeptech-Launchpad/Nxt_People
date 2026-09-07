/**
 * routes/report-email-config.js
 *
 * Settings -> Attendance -> Automation -> Scheduled Reports reads and writes
 * through here. GET always returns all keys — the DB may hold none, a few,
 * or all of them, and DEFAULT_CONFIG fills the rest so the screen never has
 * to guess a shape. PATCH merges only the keys it is given, same as every
 * other settings screen in this app (org-details.js's own policy PATCH is
 * the model): flipping one report's toggle must not blank another's
 * recipients.
 */
const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { serverError } = require('../utils/serverError');
const { getConfig, saveConfig, DEFAULT_CONFIG, CHOOSABLE_KEYS, CADENCE_OPTIONS } = require('../utils/reportEmailSender');
const { APPROVERS } = require('../utils/roles');

router.use(protect);

const WRITE = ['admin', 'director', 'hr_admin'];
const KNOWN_KEYS = Object.keys(DEFAULT_CONFIG);
// Regularization reminder has no free recipient choice — who gets it is
// structural (their own hierarchy-scoped pending list).
const HAS_RECIPIENTS = KNOWN_KEYS.filter(k => k !== 'regularizationReminder');

router.get('/', async (req, res) => {
  try {
    res.json({
      success: true,
      data: await getConfig(),
      approverRoles: APPROVERS,
      choosableCadenceKeys: CHOOSABLE_KEYS,
      cadenceOptions: CADENCE_OPTIONS,
    });
  } catch (err) { serverError(res, err); }
});

router.patch('/', authorize(...WRITE), async (req, res) => {
  try {
    const before = await getConfig();
    const patch = {};
    for (const key of Object.keys(req.body || {})) {
      if (!KNOWN_KEYS.includes(key)) continue; // an unknown key is ignored, not stored
      const incoming = req.body[key] || {};
      const cur = before[key];
      patch[key] = {
        enabled: incoming.enabled === undefined ? cur.enabled : !!incoming.enabled,
        customSubject: incoming.customSubject === undefined ? cur.customSubject : String(incoming.customSubject).slice(0, 200),
        customBody: incoming.customBody === undefined ? cur.customBody : String(incoming.customBody).slice(0, 4000),
        ...(HAS_RECIPIENTS.includes(key) ? {
          recipients: Array.isArray(incoming.recipients)
            ? incoming.recipients.map(String).map(s => s.trim()).filter(Boolean)
            : cur.recipients,
          roles: Array.isArray(incoming.roles)
            ? incoming.roles.map(String).filter(r => APPROVERS.includes(r) || r === 'team_member')
            : cur.roles,
          employeeIds: Array.isArray(incoming.employeeIds)
            ? incoming.employeeIds.map(String).filter(Boolean)
            : cur.employeeIds,
        } : {}),
        // Off by default for every report that has it. Only daily/weekly
        // cadence reports and the choosable-cadence catalog carry it.
        ...('includeNonWorkingDays' in cur ? {
          includeNonWorkingDays: incoming.includeNonWorkingDays === undefined ? cur.includeNonWorkingDays : !!incoming.includeNonWorkingDays,
        } : {}),
        // Only the widened-catalog reports (Headcount, Addition Trend,
        // Attrition Trend, Experience & Exit) let the admin pick a cadence —
        // the original seven's cadence is fixed by what the report IS.
        ...(CHOOSABLE_KEYS.includes(key) ? {
          cadence: CADENCE_OPTIONS.includes(incoming.cadence) ? incoming.cadence : cur.cadence,
        } : {}),
      };
    }
    if (!Object.keys(patch).length) {
      return res.status(400).json({ success: false, message: 'No recognised report keys in the request body' });
    }
    const saved = await saveConfig(patch);

    const changedKeys = Object.keys(patch).filter(k => JSON.stringify(before[k]) !== JSON.stringify(patch[k]));
    if (changedKeys.length) {
      await logAudit(req, {
        action: 'UPDATE', resource: 'Scheduled report emails', resourceId: 'report-email-config',
        changes: { summary: `${changedKeys.length} report(s) changed`, fields: changedKeys.map(k => ({ field: k, to: patch[k] })) },
      });
    }
    const merged = {};
    for (const key of KNOWN_KEYS) merged[key] = { ...DEFAULT_CONFIG[key], ...(saved[key] || {}) };
    res.json({ success: true, data: merged });
  } catch (err) { serverError(res, err); }
});

module.exports = router;
