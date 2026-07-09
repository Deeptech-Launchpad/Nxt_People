/**
 * routes/feeds.js
 * Event-driven activity feed for each employee
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect } = require('../middleware/auth');
const logger = require('../logger');

router.use(protect);

// GET /api/feeds?type=all|announcements|approvals|shifts  — employee's feed
//
// The feed mirrors the employee's NOTIFICATIONS (the same events shown in the
// bell), categorised into tabs so Feeds and Notifications stay in sync:
//   • announcements — management announcements        (type 'announcement')
//   • approvals     — leave/approval updates          (type 'approval' | 'leave')
//   • shifts        — shift reminders ONLY            (type 'attendance':
//                     Check-in / Check-out reminders) — NOT check-in/out timings
//   • other         — everything else (late arrival, chat, system…)
// 'all' returns every item. Each row carries a `tab` so the UI can filter
// client-side without an extra round-trip.
const FEED_TAB_SQL = `CASE
        WHEN type = 'announcement'        THEN 'announcements'
        WHEN type IN ('approval','leave') THEN 'approvals'
        WHEN type = 'attendance'          THEN 'shifts'
        ELSE 'other'
      END`;
const FEED_ICON_SQL = `CASE
        WHEN type = 'announcement'        THEN '📢'
        WHEN type IN ('approval','leave') THEN '✅'
        WHEN type = 'attendance'          THEN '⏰'
        WHEN type = 'late_arrival'        THEN '🟠'
        WHEN type = 'chat'                THEN '💬'
        ELSE '🔔'
      END`;

router.get('/', async (req, res) => {
  try {
    const { type, page = 1 } = req.query;
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (parseInt(page) - 1) * limit;

    // Map the requested tab to the underlying notification types.
    const TAB_FILTER = {
      announcements: ` AND type = 'announcement'`,
      approvals:     ` AND type IN ('approval','leave')`,
      shifts:        ` AND type = 'attendance'`,
    };
    const filter = (type && type !== 'all' && TAB_FILTER[type]) ? TAB_FILTER[type] : '';

    const r = await pool.query(
      `SELECT id as "_id", type, title, message as body, link,
              is_read as "isRead", created_at as "createdAt",
              ${FEED_TAB_SQL} as tab,
              ${FEED_ICON_SQL} as icon
       FROM notifications
       WHERE employee_id = $1${filter}
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user._id, parseInt(limit), offset]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// GET /api/feeds/company — company-wide feed (announcements + approvals visible to all)
router.get('/company', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT a.id as "_id", 'announcement' as type, a.title, a.content as body, '📢' as icon,
       a.created_at as "createdAt",
       json_build_object('firstName', e.first_name, 'lastName', e.last_name) as "postedBy"
       FROM announcements a
       LEFT JOIN employees e ON a.created_by = e.id
       WHERE a.is_active = true
       ORDER BY a.created_at DESC LIMIT 10`
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// POST /api/feeds — create a feed entry (internal / system use)
router.post('/', async (req, res) => {
  try {
    const { employeeId, type, title, body, icon } = req.body;
    const { isFullAccess } = require('../utils/roles');
    const empId = (employeeId && isFullAccess(req.user.role)) ? employeeId : req.user._id;
    const r = await pool.query(
      `INSERT INTO feeds (employee_id, type, title, body, icon)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id as "_id", type, title, body, icon, created_at as "createdAt"`,
      [empId, type || 'info', title || '', body || null, icon || '📌']
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

/**
 * Exported helper used by other routes to post feed entries.
 * Usage: await createFeedEntry(employeeId, type, title, body, icon)
 */
async function createFeedEntry(employeeId, type, title, body, icon = '📌') {
  try {
    await pool.query(
      `INSERT INTO feeds (employee_id, type, title, body, icon) VALUES ($1,$2,$3,$4,$5)`,
      [employeeId, type, title, body || null, icon]
    );
  } catch (err) {
    logger.error({ err: err.message }, 'Feed entry failed');
  }
}

module.exports = router;
module.exports.createFeedEntry = createFeedEntry;
