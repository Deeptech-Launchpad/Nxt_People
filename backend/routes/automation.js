/**
 * routes/automation.js
 * Settings → <service> → Automation: email templates, email alerts, and the
 * absent scheduler.
 *
 * These are not new features. The check-in and check-out reminder emails have
 * always been sent by two cron jobs pinned to 09:00 and 18:00 and addressed to
 * every active employee. What was missing was any way to change the time, the
 * wording or the recipients without editing server.js. That is all this adds.
 *
 * Deliberately absent, all empty in the reference org and all platform-builder
 * machinery: Workflows, Checklists & Tasks, Webhooks, Custom Functions, E-Sign
 * Flow, Letter Templates, Mail Merge Templates and Present by Default.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { invalidate } = require('../utils/automationConfig');

router.use(protect);

const WRITE_ROLES = ['admin', 'director', 'hr_admin'];

const str = (v, label, { max, required = false } = {}) => {
  const s = String(v ?? '').trim();
  if (!s) {
    if (required) throw new Error(`${label} is required`);
    return null;
  }
  if (max && s.length > max) throw new Error(`${label} must be ${max} characters or fewer`);
  return s;
};

const hhmm = (v, label) => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(v ?? '').trim());
  if (!m) throw new Error(`${label} must be a time in HH:mm form`);
  return `${m[1]}:${m[2]}`;
};

const uuidList = (v, label) => {
  const list = Array.isArray(v) ? v.map(String) : [];
  const bad = list.find(x => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x));
  if (bad) throw new Error(`${label} contains an invalid id`);
  return [...new Set(list)];
};

const known = m => /is required|characters or fewer|HH:mm|invalid id|not valid|at least one/i.test(m || '');
const fail = (res, err) =>
  res.status(known(err.message) ? 400 : 500)
    .json({ success: false, message: known(err.message) ? err.message : 'An internal server error occurred' });

// ── Email templates ────────────────────────────────────────────────────────
// Merge fields are ${name} placeholders substituted at send time. They are not
// validated against a whitelist: an unknown one renders as itself, which is
// visible and harmless, whereas rejecting them would block wording the sender
// legitimately wants.
router.get('/templates', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, service, name, subject, body, is_system AS "isSystem", updated_at AS "updatedAt"
         FROM email_templates
        WHERE ($1::text IS NULL OR service = $1) ORDER BY name`,
      [req.query.service || null]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { fail(res, err); }
});

router.post('/templates', authorize(...WRITE_ROLES), async (req, res) => {
  try {
    const b = req.body || {};
    const r = await pool.query(
      `INSERT INTO email_templates (service, name, subject, body)
       VALUES ($1, $2, $3, $4)
       RETURNING id, service, name, subject, body, is_system AS "isSystem", updated_at AS "updatedAt"`,
      [str(b.service, 'Service', { max: 40 }) || 'attendance',
       str(b.name, 'Template name', { max: 150, required: true }),
       str(b.subject, 'Subject', { max: 300, required: true }),
       str(b.body, 'Body', { required: true })]
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ success: false, message: 'A template with that name already exists' });
    fail(res, err);
  }
});

router.put('/templates/:id', authorize(...WRITE_ROLES), async (req, res) => {
  try {
    const b = req.body || {};
    // A system template's wording can change; its name cannot, because an alert
    // and the approval mailer look it up by name.
    const r = await pool.query(
      `UPDATE email_templates
          SET name = CASE WHEN is_system THEN name ELSE $1 END,
              subject = $2, body = $3, updated_at = NOW()
        WHERE id = $4
       RETURNING id, service, name, subject, body, is_system AS "isSystem", updated_at AS "updatedAt"`,
      [str(b.name, 'Template name', { max: 150, required: true }),
       str(b.subject, 'Subject', { max: 300, required: true }),
       str(b.body, 'Body', { required: true }),
       req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Template not found' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ success: false, message: 'A template with that name already exists' });
    fail(res, err);
  }
});

router.delete('/templates/:id', authorize(...WRITE_ROLES), async (req, res) => {
  try {
    const sys = await pool.query(`SELECT is_system FROM email_templates WHERE id = $1`, [req.params.id]);
    if (!sys.rows.length) return res.status(404).json({ success: false, message: 'Template not found' });
    if (sys.rows[0].is_system) {
      return res.status(400).json({ success: false, message: 'A built-in template cannot be deleted. Edit its wording instead.' });
    }
    const used = await pool.query(`SELECT COUNT(*)::int n FROM email_alerts WHERE template_id = $1`, [req.params.id]);
    if (used.rows[0].n > 0) {
      return res.status(400).json({ success: false, message: 'An alert still uses this template' });
    }
    await pool.query(`DELETE FROM email_templates WHERE id = $1`, [req.params.id]);
    res.json({ success: true, message: 'Template deleted' });
  } catch (err) { fail(res, err); }
});

// ── Email alerts ───────────────────────────────────────────────────────────
// The event is fixed per alert and not editable: each one is wired to a cron
// that knows how to gather its recipients. Adding an event means adding that
// code, so a free-text event field would let an admin create an alert nothing
// would ever fire.
router.get('/alerts', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT a.id, a.service, a.event, a.name, a.description, a.is_active AS "isActive",
              a.send_at AS "sendAt", a.recipients, a.template_id AS "templateId",
              t.name AS "templateName", a.updated_at AS "updatedAt"
         FROM email_alerts a
         LEFT JOIN email_templates t ON t.id = a.template_id
        WHERE ($1::text IS NULL OR a.service = $1) ORDER BY a.name`,
      [req.query.service || null]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { fail(res, err); }
});

router.put('/alerts/:id', authorize(...WRITE_ROLES), async (req, res) => {
  try {
    const b = req.body || {};
    const rec = b.recipients || {};
    const recipients = {
      allEmployees: rec.allEmployees !== false,
      departmentIds: uuidList(rec.departmentIds, 'Departments'),
      locationIds: uuidList(rec.locationIds, 'Locations'),
    };
    // Narrowing to nothing would silently stop the alert while it still reads
    // as switched on.
    if (!recipients.allEmployees && !recipients.departmentIds.length && !recipients.locationIds.length) {
      throw new Error('Choose all employees, or at least one department or location');
    }

    const r = await pool.query(
      `UPDATE email_alerts
          SET name = $1, description = $2, is_active = $3, send_at = $4,
              recipients = $5::jsonb, template_id = $6, updated_at = NOW()
        WHERE id = $7
       RETURNING id, service, event, name, description, is_active AS "isActive",
                 send_at AS "sendAt", recipients, template_id AS "templateId", updated_at AS "updatedAt"`,
      [str(b.name, 'Alert name', { max: 150, required: true }),
       str(b.description, 'Description', { max: 500 }),
       b.isActive !== false,
       hhmm(b.sendAt, 'Send time'),
       JSON.stringify(recipients),
       b.templateId || null,
       req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Alert not found' });
    invalidate();
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { fail(res, err); }
});

// ── Absent scheduler ───────────────────────────────────────────────────────
router.get('/scheduler', async (req, res) => {
  try {
    const r = await pool.query(`SELECT attendance_automation_config AS c FROM settings LIMIT 1`);
    res.json({ success: true, data: r.rows[0]?.c?.absentScheduler || { enabled: false, runAt: '21:00', markAbsentWhenNoCheckIn: true } });
  } catch (err) { fail(res, err); }
});

router.put('/scheduler', authorize(...WRITE_ROLES), async (req, res) => {
  try {
    const b = req.body || {};
    const value = {
      enabled: !!b.enabled,
      runAt: hhmm(b.runAt || '21:00', 'Run time'),
      markAbsentWhenNoCheckIn: b.markAbsentWhenNoCheckIn !== false,
    };
    const r = await pool.query(
      `UPDATE settings
          SET attendance_automation_config =
                COALESCE(attendance_automation_config, '{}'::jsonb) || jsonb_build_object('absentScheduler', $1::jsonb),
              updated_at = NOW()
        WHERE id = (SELECT id FROM settings LIMIT 1)
       RETURNING attendance_automation_config AS c`,
      [JSON.stringify(value)]
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Settings row not found' });
    invalidate();
    res.json({ success: true, data: r.rows[0].c.absentScheduler });
  } catch (err) { fail(res, err); }
});

module.exports = router;
