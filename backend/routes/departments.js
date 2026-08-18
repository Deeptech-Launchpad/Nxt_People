/**
 * routes/departments.js
 * Hierarchical department tree + employee counts
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { serverError } = require('../utils/serverError');

router.use(protect);

// GET /api/departments  — flat list with parent + employee count
router.get('/', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT d.id as "_id", d.name, d.parent_id as "parentId",
       json_build_object('_id', h.id, 'firstName', h.first_name, 'lastName', h.last_name) as head,
       COUNT(e.id) as "employeeCount"
       FROM departments d
       LEFT JOIN employees h ON d.head_id = h.id
       LEFT JOIN employees e ON e.department_id = d.id AND e.status = 'active'
       GROUP BY d.id, d.name, d.parent_id, h.id, h.first_name, h.last_name
       ORDER BY d.name`
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { serverError(res, err); }
});

// GET /api/departments/tree — hierarchical nested structure
router.get('/tree', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT d.id, d.name, d.parent_id, COUNT(e.id) as employee_count
       FROM departments d
       LEFT JOIN employees e ON e.department_id = d.id AND e.status = 'active'
       GROUP BY d.id, d.name, d.parent_id ORDER BY d.name`
    );
    const depts = r.rows;
    const map = {};
    depts.forEach(d => { map[d.id] = { ...d, children: [] }; });
    const roots = [];
    depts.forEach(d => {
      if (d.parent_id && map[d.parent_id]) {
        map[d.parent_id].children.push(map[d.id]);
      } else {
        roots.push(map[d.id]);
      }
    });
    res.json({ success: true, data: roots });
  } catch (err) { serverError(res, err); }
});

// GET /api/departments/:id/employees
router.get('/:id/employees', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT e.id as "_id", e.first_name as "firstName", e.last_name as "lastName",
       e.email, e.designation, e.employee_id as "employeeId", e.status, e.photo_url as "photoUrl",
       e.phone, e.date_of_birth as "dateOfBirth", e.joining_date as "joiningDate"
       FROM employees e
       WHERE e.department_id = $1 AND e.status = 'active'
       ORDER BY e.first_name`,
      [req.params.id]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { serverError(res, err); }
});

// POST /api/departments — create (admin)
router.post('/', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  try {
    const { name, parentId, headId } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Name required' });
    const r = await pool.query(
      `INSERT INTO departments (name, parent_id, head_id) VALUES ($1,$2,$3)
       RETURNING id as "_id", name, parent_id as "parentId"`,
      [name, parentId || null, headId || null]
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) { serverError(res, err); }
});

// PUT /api/departments/:id (admin)
router.put('/:id', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  try {
    const { name, parentId, headId } = req.body;
    const r = await pool.query(
      `UPDATE departments SET name=COALESCE($1,name), parent_id=COALESCE($2,parent_id),
       head_id=COALESCE($3,head_id), updated_at=NOW() WHERE id=$4
       RETURNING id as "_id", name, parent_id as "parentId"`,
      [name||null, parentId||null, headId||null, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { serverError(res, err); }
});

// DELETE /api/departments/:id (admin)
router.delete('/:id', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM departments WHERE id=$1', [req.params.id]);
    res.json({ success: true, message: 'Department deleted' });
  } catch (err) { serverError(res, err); }
});

module.exports = router;
