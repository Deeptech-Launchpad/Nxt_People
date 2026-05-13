const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect } = require('../middleware/auth');
router.use(protect);

// GET /api/notifications — get current user's notifications
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id as "_id", type, title, message, is_read as "isRead", link, created_at as "createdAt"
       FROM notifications
       WHERE employee_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [req.user._id]
    );
    const unreadCount = result.rows.filter(n => !n.isRead).length;
    res.json({ success: true, data: result.rows, unreadCount });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/notifications/read-all — mark all as read
router.put('/read-all', async (req, res) => {
  try {
    await pool.query(
      'UPDATE notifications SET is_read = true WHERE employee_id = $1',
      [req.user._id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/notifications/:id/read — mark single as read
router.put('/:id/read', async (req, res) => {
  try {
    await pool.query(
      'UPDATE notifications SET is_read = true WHERE id = $1 AND employee_id = $2',
      [req.params.id, req.user._id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;

// Helper to create a notification (call from other routes)
module.exports.createNotification = async (employeeId, type, title, message, link = null) => {
  try {
    await pool.query(
      'INSERT INTO notifications (employee_id, type, title, message, link) VALUES ($1, $2, $3, $4, $5)',
      [employeeId, type, title, message, link]
    );
  } catch (err) {
    console.error('Notification error:', err.message);
  }
};
