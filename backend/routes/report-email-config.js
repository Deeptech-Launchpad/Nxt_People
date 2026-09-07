/**
 * routes/report-email-config.js
 *
 * Settings -> Attendance -> Automation -> Scheduled Reports reads and writes
 * through here. GET always returns all eight keys — the DB may hold none, a
 * few, or all of them, and DEFAULT_CONFIG fills the rest so the screen never
 * has to guess a shape. PATCH merges only the keys it is given, same as every
 * other settings screen in this app (org-details.js's own policy PATCH is
 * the model): flipping one report's toggle must not blank another's
 * recipients.
 */
const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { serverError } = require('../utils/serverError');
const { getConfig, saveConfig, DEFAULT_CONFIG } = require('../utils/reportEmailSender');
const { APPROVERS } = require('../utils/roles');

router.use(protect);

const WRITE = ['admin', 'director', 'hr_admin'];
const KNOWN_KEYS = Object.keys(DEFAULT_CONFIG);

router.get('/', async (req, res) => {
  try {
    res.json({ success: true, data: await getConfig(), approverRoles: APPROVERS });
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
        // regularizationReminder carries no recipients/roles field at all —
        // who gets it is structural, not a free choice of addresses.
        ...(key === 'regularizationReminder' ? {} : {
          recipients: Array.isArray(incoming.recipients)
            ? incoming.recipients.map(String).map(s => s.trim()).filter(Boolean)
            : cur.recipients,
          roles: Array.isArray(incoming.roles)
            ? incoming.roles.map(String).filter(r => APPROVERS.includes(r) || r === 'team_member')
            : cur.roles,
        }),
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
