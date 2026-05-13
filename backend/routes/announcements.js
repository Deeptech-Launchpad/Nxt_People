const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
router.use(protect);

// Shared projection — every read endpoint returns the same shape.
// Note: `isPinned` is `is_pinned`, NOT `is_active`. They used to be conflated;
// HR can now unpin an announcement (loses badge) without deactivating it
// (still visible in the feed).
const SELECT_FIELDS = `
  a.id              AS "_id",
  a.title           AS title,
  a.content         AS body,
  a.priority        AS type,
  a.is_pinned       AS "isPinned",
  a.pinned_until    AS "pinnedUntil",
  a.expires_at      AS "expiresAt",
  a.created_at      AS "createdAt",
  json_build_object(
    'firstName', e.first_name,
    'lastName',  e.last_name,
    'role',      e.role
  ) AS "postedBy"
`;

// GET /api/announcements/active — announcements that are still live for the
// current user. Returns at most 5 rows, prioritising urgent → unread → recent.
// Each row carries an `isRead` flag so the UI can highlight new items.
router.get('/active', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ${SELECT_FIELDS},
              (ar.employee_id IS NOT NULL) AS "isRead"
       FROM announcements a
       JOIN employees e ON a.created_by = e.id
       LEFT JOIN announcement_reads ar
         ON ar.announcement_id = a.id AND ar.employee_id = $1
       WHERE a.is_active = true
         AND a.is_pinned  = true
         AND (a.expires_at IS NULL OR a.expires_at > NOW())
       ORDER BY (a.priority = 'urgent') DESC,
                (ar.employee_id IS NULL) DESC,
                a.created_at DESC
       LIMIT 5`,
      [req.user._id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/announcements/:id/read — mark an announcement as seen by the caller.
router.post('/:id/read', async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO announcement_reads (employee_id, announcement_id)
       VALUES ($1, $2)
       ON CONFLICT (employee_id, announcement_id) DO NOTHING`,
      [req.user._id, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/announcements — all active announcements (pinned first).
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ${SELECT_FIELDS}
       FROM announcements a
       JOIN employees e ON a.created_by = e.id
       WHERE a.is_active = true
       ORDER BY a.is_pinned DESC, a.created_at DESC
       LIMIT 30`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/announcements — create announcement (admin only)
router.post('/', authorize('admin'), async (req, res) => {
  try {
    const { title, body, type = 'general', isPinned = true, pinnedUntil, expiresAt } = req.body;
    if (!title || !body) return res.status(400).json({ success: false, message: 'Title and body are required' });

    // pinnedUntil only makes sense when the announcement is actually pinned.
    const pinExpiry = isPinned ? (pinnedUntil || null) : null;

    const result = await pool.query(
      `INSERT INTO announcements
         (title, content, body, priority, type, is_active, is_pinned, pinned_until, expires_at, created_by, posted_by)
       VALUES ($1, $2, $2, $3, $3, TRUE, $4, $5, $6, $7, $7)
       RETURNING id AS "_id", title, content AS body, priority AS type,
                 is_pinned AS "isPinned", pinned_until AS "pinnedUntil",
                 expires_at AS "expiresAt", created_at AS "createdAt"`,
      [title, body, type, isPinned, pinExpiry, expiresAt || null, req.user._id]
    );

    // Notify every other active employee.
    const { createNotification } = require('./notifications');
    const empRes = await pool.query("SELECT id FROM employees WHERE status='active' AND id != $1", [req.user._id]);
    for (const emp of empRes.rows) {
      await createNotification(emp.id, 'announcement', 'New Announcement', title, '/');
    }

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/announcements/:id — update an announcement (admin only).
// Each of title/body/type/isActive/isPinned/pinnedUntil/expiresAt is optional;
// omitted fields keep their current value (COALESCE).
router.put('/:id', authorize('admin'), async (req, res) => {
  try {
    const { title, body, type, isActive, isPinned, pinnedUntil, expiresAt } = req.body;
    const result = await pool.query(
      `UPDATE announcements
         SET title        = COALESCE($1, title),
             content      = COALESCE($2, content),
             body         = COALESCE($2, body),
             priority     = COALESCE($3, priority),
             type         = COALESCE($3, type),
             is_active    = COALESCE($4, is_active),
             is_pinned    = COALESCE($5, is_pinned),
             pinned_until = COALESCE($6, pinned_until),
             expires_at   = COALESCE($7, expires_at),
             updated_at   = NOW()
       WHERE id = $8
       RETURNING id AS "_id", title, content AS body, priority AS type,
                 is_active AS "isActive", is_pinned AS "isPinned",
                 pinned_until AS "pinnedUntil", expires_at AS "expiresAt",
                 created_at AS "createdAt"`,
      [
        title  || null,
        body   || null,
        type   || null,
        isActive ?? null,
        isPinned ?? null,
        pinnedUntil ?? null,
        expiresAt || null,
        req.params.id,
      ]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Announcement not found' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/announcements/:id — delete (admin only)
router.delete('/:id', authorize('admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM announcements WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
