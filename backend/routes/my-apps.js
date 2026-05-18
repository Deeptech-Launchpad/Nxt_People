/**
 * GET /api/my-apps — apps the current employee has access to.
 *
 * Drives the "My Apps" launcher. Returns only api_connections that:
 *   • are marked is_user_app = TRUE
 *   • are active
 *   • the current employee has an unrevoked grant on
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect } = require('../middleware/auth');

router.use(protect);

router.get('/', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT a.id, a.name, a.description,
             a.website_url AS "websiteUrl",
             a.app_icon    AS "icon",
             a.app_color   AS "color",
             ac.granted_at AS "grantedAt"
        FROM api_connections a
        JOIN application_access ac ON ac.api_connection_id = a.id
       WHERE ac.employee_id = $1
         AND ac.revoked_at IS NULL
         AND a.is_active = TRUE
         AND a.is_user_app = TRUE
       ORDER BY a.name ASC
    `, [req.user._id]);
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
