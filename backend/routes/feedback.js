/**
 * routes/feedback.js
 * Give / receive performance feedback with category filter
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { isFullAccess, isManager } = require('../utils/roles');

router.use(protect);

const VALID_TYPES = ['positive', 'negative', 'training', 'observation', 'reward'];

// GET /api/feedback?direction=received|given&type=positive
router.get('/', async (req, res) => {
  try {
    const { direction = 'received', type, employeeId } = req.query;
    const isAdmin = isFullAccess(req.user.role) || isManager(req.user.role);

    const col = direction === 'given' ? 'from_employee_id' : 'to_employee_id';
    const empId = isAdmin && employeeId ? employeeId : req.user._id;

    let where = `WHERE f.${col} = $1`;
    const params = [empId];
    if (type && VALID_TYPES.includes(type)) { where += ` AND f.type = $2`; params.push(type); }

    const r = await pool.query(
      `SELECT f.id as "_id", f.type, f.content, f.created_at as "createdAt",
       json_build_object('_id', fe.id, 'firstName', fe.first_name, 'lastName', fe.last_name, 'designation', fe.designation) as "fromEmployee",
       json_build_object('_id', te.id, 'firstName', te.first_name, 'lastName', te.last_name, 'designation', te.designation) as "toEmployee"
       FROM feedback f
       JOIN employees fe ON f.from_employee_id = fe.id
       JOIN employees te ON f.to_employee_id = te.id
       ${where}
       ORDER BY f.created_at DESC`,
      params
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET /api/feedback/counts?employeeId=  (category counts for filter bar)
router.get('/counts', async (req, res) => {
  try {
    const { direction = 'received', employeeId } = req.query;
    const col = direction === 'given' ? 'from_employee_id' : 'to_employee_id';
    const empId = employeeId || req.user._id;

    const r = await pool.query(
      `SELECT type, COUNT(*) as count FROM feedback
       WHERE ${col} = $1 GROUP BY type`,
      [empId]
    );
    const counts = { total: 0 };
    r.rows.forEach(row => {
      counts[row.type] = parseInt(row.count, 10);
      counts.total += parseInt(row.count, 10);
    });
    res.json({ success: true, data: counts });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST /api/feedback — give feedback
router.post('/', async (req, res) => {
  try {
    const { toEmployeeId, type, content } = req.body;
    if (!toEmployeeId || !content) {
      return res.status(400).json({ success: false, message: 'toEmployeeId and content required' });
    }
    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({ success: false, message: `type must be one of: ${VALID_TYPES.join(', ')}` });
    }
    const r = await pool.query(
      `INSERT INTO feedback (from_employee_id, to_employee_id, type, content)
       VALUES ($1,$2,$3,$4)
       RETURNING id as "_id", type, content, created_at as "createdAt"`,
      [req.user._id, toEmployeeId, type, content]
    );
    res.status(201).json({ success: true, data: r.rows[0], message: 'Feedback submitted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// DELETE /api/feedback/:id (admin or own)
router.delete('/:id', async (req, res) => {
  try {
    const r = await pool.query('SELECT from_employee_id FROM feedback WHERE id=$1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Not found' });
    if (!isFullAccess(req.user.role) && r.rows[0].from_employee_id !== req.user._id) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    await pool.query('DELETE FROM feedback WHERE id=$1', [req.params.id]);
    res.json({ success: true, message: 'Feedback deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
