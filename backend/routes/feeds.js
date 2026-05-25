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

// GET /api/feeds?type=all|status|announcement|approval  — employee's feed
router.get('/', async (req, res) => {
  try {
    const { type, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let where = 'WHERE f.employee_id = $1';
    const params = [req.user._id];
    if (type && type !== 'all') { where += ` AND f.type = $2`; params.push(type); }

    const r = await pool.query(
      `SELECT f.id as "_id", f.type, f.title, f.body, f.icon, f.created_at as "createdAt"
       FROM feeds f
       ${where}
       ORDER BY f.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, parseInt(limit), offset]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
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
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST /api/feeds — create a feed entry (internal / system use)
router.post('/', async (req, res) => {
  try {
    const { employeeId, type, title, body, icon } = req.body;
    const empId = employeeId || req.user._id;
    const r = await pool.query(
      `INSERT INTO feeds (employee_id, type, title, body, icon)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id as "_id", type, title, body, icon, created_at as "createdAt"`,
      [empId, type || 'info', title || '', body || null, icon || '📌']
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
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
