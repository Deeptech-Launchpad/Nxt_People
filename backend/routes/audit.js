const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');

router.use(protect, authorize('admin', 'director'));

// GET /api/audit — paginated audit log with filters
router.get('/', async (req, res) => {
  try {
    const { actor, action, resource, from, to, page = 1, limit = 50 } = req.query;
    let where = 'WHERE 1=1';
    const params = [];
    let i = 1;

    if (actor)    { where += ` AND al.actor_id = $${i++}`;                  params.push(actor); }
    if (action)   { where += ` AND al.action ILIKE $${i++}`;                params.push(`%${action}%`); }
    if (resource) { where += ` AND al.resource = $${i++}`;                  params.push(resource); }
    if (from)     { where += ` AND al.created_at >= $${i++}::timestamptz`;  params.push(from); }
    if (to)       { where += ` AND al.created_at <= $${i++}::timestamptz`;  params.push(to); }

    const limitN  = Math.min(parseInt(limit) || 50, 200);
    const offsetN = (parseInt(page) - 1) * limitN;

    const [rows, cnt] = await Promise.all([
      pool.query(
        `SELECT al.id as "_id", al.action, al.resource, al.resource_id as "resourceId",
         al.changes, al.ip_address as "ipAddress", al.created_at as "createdAt",
         json_build_object(
           '_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name,
           'email', al.actor_email, 'role', al.actor_role
         ) as actor
         FROM audit_log al
         LEFT JOIN employees e ON al.actor_id = e.id
         ${where}
         ORDER BY al.created_at DESC
         LIMIT $${i++} OFFSET $${i++}`,
        [...params, limitN, offsetN]
      ),
      pool.query(`SELECT COUNT(*) FROM audit_log al ${where}`, params),
    ]);

    res.json({
      success: true,
      data: rows.rows,
      total: parseInt(cnt.rows[0].count),
      page: parseInt(page),
      limit: limitN,
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET /api/audit/summary — action counts grouped by resource/action
router.get('/summary', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT resource, action, COUNT(*) as count
       FROM audit_log
       WHERE created_at >= NOW() - INTERVAL '30 days'
       GROUP BY resource, action
       ORDER BY count DESC LIMIT 30`
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
