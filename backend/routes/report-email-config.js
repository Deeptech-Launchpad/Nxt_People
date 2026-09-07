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
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { serverError } = require('../utils/serverError');
const {
  getConfig, saveConfig, DEFAULT_CONFIG, CHOOSABLE_KEYS, CADENCE_OPTIONS,
  recipientsFor, buildForKey,
} = require('../utils/reportEmailSender');
const { todayYmd } = require('../utils/reportEmailSchedule');
const contentBuilders = require('../utils/reportEmailContent');
const { APPROVERS, isFullAccess } = require('../utils/roles');

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

// Who this report actually resolves to right now — not the settings (roles,
// addresses, picked employees) but the real, current email list those
// settings produce. regularizationReminder has no such flat list: it is
// built per-recipient, only for whoever actually has something pending, so
// this instead names who is ELIGIBLE and says so plainly.
router.get('/:key/recipients', async (req, res) => {
  try {
    const { key } = req.params;
    if (!KNOWN_KEYS.includes(key)) return res.status(404).json({ success: false, message: 'Unknown report' });
    const cfg = await getConfig();
    if (key === 'regularizationReminder') {
      const staff = (await pool.query(
        `SELECT email FROM employees
          WHERE role = ANY($1::text[]) AND status='active' AND deleted_at IS NULL AND email IS NOT NULL
          ORDER BY email`,
        [APPROVERS])).rows;
      return res.json({
        success: true,
        data: {
          structural: true,
          note: 'Sent individually, only to whoever actually has something pending — not everyone below gets mail every time.',
          emails: staff.map(s => s.email),
        },
      });
    }
    const emails = await recipientsFor(cfg[key]);
    res.json({ success: true, data: { structural: false, emails } });
  } catch (err) { serverError(res, err); }
});

// A live preview of exactly what would be sent today — same builder, same
// data, same wording, as the real cron would use. Never calls sendMail.
router.get('/:key/preview', async (req, res) => {
  try {
    const { key } = req.params;
    if (!KNOWN_KEYS.includes(key)) return res.status(404).json({ success: false, message: 'Unknown report' });
    const cfg = await getConfig();
    const today = todayYmd();
    let built;
    if (key === 'regularizationReminder') {
      const custom = { subject: cfg.regularizationReminder.customSubject, body: cfg.regularizationReminder.customBody };
      built = await contentBuilders.regularizationReminderEmail(req.user._id, isFullAccess(req.user.role), custom);
      if (!built) {
        built = {
          subject: (custom.subject || '').trim() || 'Regularization Requests Pending Your Approval',
          text: 'Nothing is pending for you right now, so there is nothing to preview — this report only ever mails a recipient who actually has something waiting.',
          html: '<p style="font-family:sans-serif;font-size:14px;color:#334155;">Nothing is pending for you right now, so there is nothing to preview — this report only ever mails a recipient who actually has something waiting.</p>',
        };
      }
    } else {
      built = await buildForKey(key, cfg, today);
    }
    res.json({ success: true, data: built });
  } catch (err) { serverError(res, err); }
});

module.exports = router;
