/**
 * routes/report-favorites.js
 * Toggle star favorites for reports, persisted per employee
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect } = require('../middleware/auth');

router.use(protect);

// GET /api/report-favorites — get all starred report keys for current user
router.get('/', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT report_key as "reportKey" FROM report_favorites WHERE employee_id=$1`,
      [req.user._id]
    );
    res.json({ success: true, data: r.rows.map(x => x.reportKey) });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST /api/report-favorites/:key — toggle (add if missing, remove if exists)
router.post('/:key', async (req, res) => {
  try {
    const key = req.params.key;
    const exists = await pool.query(
      `SELECT 1 FROM report_favorites WHERE employee_id=$1 AND report_key=$2`,
      [req.user._id, key]
    );
    if (exists.rows.length > 0) {
      await pool.query(
        `DELETE FROM report_favorites WHERE employee_id=$1 AND report_key=$2`,
        [req.user._id, key]
      );
      res.json({ success: true, starred: false, message: 'Removed from favorites' });
    } else {
      await pool.query(
        `INSERT INTO report_favorites (employee_id, report_key) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [req.user._id, key]
      );
      res.json({ success: true, starred: true, message: 'Added to favorites' });
    }
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
