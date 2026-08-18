const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { serverError } = require('../utils/serverError');

router.use(protect);

// ── GET tasks (with filters) ──────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { projectId, status, priority, assigneeId, page = 1, limit = 30 } = req.query;
    let where = 'WHERE 1=1';
    const params = [];
    let i = 1;

    if (projectId)  { where += ` AND t.project_id = $${i++}`;   params.push(projectId); }
    if (status)     { where += ` AND t.status = $${i++}`;        params.push(status); }
    if (priority)   { where += ` AND t.priority = $${i++}`;      params.push(priority); }
    if (assigneeId) { where += ` AND t.assignee_id = $${i++}`;   params.push(assigneeId); }

    const limitN  = parseInt(limit);
    const offsetN = (parseInt(page) - 1) * limitN;

    const r = await pool.query(
      `SELECT t.id as "_id", t.title, t.description, t.status, t.priority,
       t.due_date as "dueDate", t.completed_at as "completedAt",
       t.created_at as "createdAt", t.updated_at as "updatedAt",
       json_build_object('_id', p.id, 'name', p.name) as project,
       json_build_object('_id', a.id, 'firstName', a.first_name, 'lastName', a.last_name) as assignee,
       json_build_object('_id', c.id, 'firstName', c.first_name, 'lastName', c.last_name) as "createdBy"
       FROM tasks t
       LEFT JOIN projects p ON t.project_id = p.id
       LEFT JOIN employees a ON t.assignee_id = a.id
       LEFT JOIN employees c ON t.created_by = c.id
       ${where}
       ORDER BY
         CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
         t.due_date ASC NULLS LAST, t.created_at DESC
       LIMIT $${i++} OFFSET $${i++}`,
      [...params, limitN, offsetN]
    );

    res.json({ success: true, data: r.rows, total: r.rows.length });
  } catch (err) { serverError(res, err); }
});

// ── GET single task ───────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT t.id as "_id", t.title, t.description, t.status, t.priority,
       t.due_date as "dueDate", t.completed_at as "completedAt",
       t.created_at as "createdAt", t.updated_at as "updatedAt",
       json_build_object('_id', p.id, 'name', p.name) as project,
       json_build_object('_id', a.id, 'firstName', a.first_name, 'lastName', a.last_name, 'email', a.email) as assignee,
       json_build_object('_id', c.id, 'firstName', c.first_name, 'lastName', c.last_name) as "createdBy"
       FROM tasks t
       LEFT JOIN projects p ON t.project_id = p.id
       LEFT JOIN employees a ON t.assignee_id = a.id
       LEFT JOIN employees c ON t.created_by = c.id
       WHERE t.id = $1`, [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Task not found' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { serverError(res, err); }
});

// ── POST create task ──────────────────────────────────────────────────────────
router.post('/', audit('CREATE', 'task'), async (req, res) => {
  try {
    const { title, description, projectId, status = 'todo', priority = 'medium', assigneeId, dueDate } = req.body;
    if (!title) return res.status(400).json({ success: false, message: 'Task title is required' });

    const r = await pool.query(
      `INSERT INTO tasks (title, description, project_id, status, priority, assignee_id, created_by, due_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id as "_id", title, description, status, priority,
                 due_date as "dueDate", created_at as "createdAt"`,
      [title, description || null, projectId || null, status, priority,
       assigneeId || null, req.user._id, dueDate || null]
    );
    res.status(201).json({ success: true, data: r.rows[0], message: 'Task created' });
  } catch (err) { serverError(res, err); }
});

// ── PUT update task ───────────────────────────────────────────────────────────
router.put('/:id', audit('UPDATE', 'task'), async (req, res) => {
  try {
    const { title, description, status, priority, assigneeId, dueDate, projectId } = req.body;

    // Auto-set completedAt when status changes to 'done'
    const completedAt = status === 'done' ? new Date() : null;
    const clearCompleted = status && status !== 'done';

    const r = await pool.query(
      `UPDATE tasks
       SET title       = COALESCE($1, title),
           description = COALESCE($2, description),
           status      = COALESCE($3, status),
           priority    = COALESCE($4, priority),
           assignee_id = COALESCE($5, assignee_id),
           due_date    = COALESCE($6, due_date),
           project_id  = COALESCE($7, project_id),
           completed_at = CASE
             WHEN $3 = 'done' THEN NOW()
             WHEN $3 IS NOT NULL AND $3 != 'done' THEN NULL
             ELSE completed_at
           END,
           updated_at = NOW()
       WHERE id = $8
       RETURNING id as "_id", title, status, priority, due_date as "dueDate",
                 completed_at as "completedAt", updated_at as "updatedAt"`,
      [title || null, description || null, status || null, priority || null,
       assigneeId || null, dueDate || null, projectId || null, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Task not found' });
    res.json({ success: true, data: r.rows[0], message: 'Task updated' });
  } catch (err) { serverError(res, err); }
});

// ── DELETE task ───────────────────────────────────────────────────────────────
router.delete('/:id', audit('DELETE', 'task'), async (req, res) => {
  try {
    await pool.query('DELETE FROM tasks WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Task deleted' });
  } catch (err) { serverError(res, err); }
});

module.exports = router;
