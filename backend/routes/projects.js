const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { audit } = require('../middleware/audit');

router.use(protect);

// ── GET all projects (with member count & task count) ─────────────────────────
router.get('/', async (req, res) => {
  try {
    const { status, priority, search, page = 1, limit = 20 } = req.query;
    let where = 'WHERE 1=1';
    const params = [];
    let i = 1;

    if (status)   { where += ` AND p.status = $${i++}`;                     params.push(status); }
    if (priority) { where += ` AND p.priority = $${i++}`;                   params.push(priority); }
    if (search)   { where += ` AND p.name ILIKE $${i++}`;                   params.push(`%${search}%`); }

    const limitN  = parseInt(limit);
    const offsetN = (parseInt(page) - 1) * limitN;

    const r = await pool.query(
      `SELECT p.id as "_id", p.name, p.description, p.status, p.priority,
       p.start_date as "startDate", p.due_date as "dueDate",
       p.created_at as "createdAt", p.updated_at as "updatedAt",
       json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name) as "createdBy",
       (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) as "memberCount",
       (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) as "taskCount",
       (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') as "doneCount"
       FROM projects p
       LEFT JOIN employees e ON p.created_by = e.id
       ${where}
       ORDER BY p.created_at DESC
       LIMIT $${i++} OFFSET $${i++}`,
      [...params, limitN, offsetN]
    );

    const cnt = await pool.query(
      `SELECT COUNT(*) FROM projects p ${where}`, params
    );

    res.json({ success: true, data: r.rows, total: parseInt(cnt.rows[0].count), page: parseInt(page) });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── GET single project with members + tasks ───────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const [projRes, membersRes, tasksRes] = await Promise.all([
      pool.query(
        `SELECT p.id as "_id", p.name, p.description, p.status, p.priority,
         p.start_date as "startDate", p.due_date as "dueDate",
         p.created_at as "createdAt", p.updated_at as "updatedAt",
         json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name) as "createdBy"
         FROM projects p LEFT JOIN employees e ON p.created_by = e.id
         WHERE p.id = $1`, [req.params.id]
      ),
      pool.query(
        `SELECT pm.id, pm.role, e.id as "_id", e.first_name as "firstName",
         e.last_name as "lastName", e.department, e.designation, e.photo_url as "photoUrl"
         FROM project_members pm JOIN employees e ON pm.employee_id = e.id
         WHERE pm.project_id = $1`, [req.params.id]
      ),
      pool.query(
        `SELECT t.id as "_id", t.title, t.status, t.priority, t.due_date as "dueDate",
         t.completed_at as "completedAt", t.created_at as "createdAt",
         json_build_object('_id', a.id, 'firstName', a.first_name, 'lastName', a.last_name) as "assignee"
         FROM tasks t LEFT JOIN employees a ON t.assignee_id = a.id
         WHERE t.project_id = $1 ORDER BY t.created_at DESC`, [req.params.id]
      ),
    ]);

    if (!projRes.rows[0]) return res.status(404).json({ success: false, message: 'Project not found' });
    res.json({ success: true, data: { ...projRes.rows[0], members: membersRes.rows, tasks: tasksRes.rows } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── POST create project ───────────────────────────────────────────────────────
router.post('/', authorize('admin', 'director', 'hr_admin', 'manager'), audit('CREATE', 'project'), async (req, res) => {
  try {
    const { name, description, status = 'active', priority = 'medium', startDate, dueDate, memberIds = [] } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Project name is required' });

    const r = await pool.query(
      `INSERT INTO projects (name, description, status, priority, start_date, due_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id as "_id", name, description, status, priority,
                 start_date as "startDate", due_date as "dueDate", created_at as "createdAt"`,
      [name, description || null, status, priority, startDate || null, dueDate || null, req.user._id]
    );
    const project = r.rows[0];

    // Add creator as lead
    await pool.query(
      `INSERT INTO project_members (project_id, employee_id, role) VALUES ($1,$2,'lead') ON CONFLICT DO NOTHING`,
      [project._id, req.user._id]
    );
    // Add additional members
    for (const empId of memberIds) {
      await pool.query(
        `INSERT INTO project_members (project_id, employee_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [project._id, empId]
      );
    }

    res.status(201).json({ success: true, data: project, message: 'Project created' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── PUT update project ────────────────────────────────────────────────────────
router.put('/:id', authorize('admin', 'director', 'hr_admin', 'manager'), audit('UPDATE', 'project'), async (req, res) => {
  try {
    const { name, description, status, priority, startDate, dueDate } = req.body;
    const r = await pool.query(
      `UPDATE projects
       SET name = COALESCE($1, name), description = COALESCE($2, description),
           status = COALESCE($3, status), priority = COALESCE($4, priority),
           start_date = COALESCE($5, start_date), due_date = COALESCE($6, due_date),
           updated_at = NOW()
       WHERE id = $7
       RETURNING id as "_id", name, description, status, priority,
                 start_date as "startDate", due_date as "dueDate", updated_at as "updatedAt"`,
      [name || null, description || null, status || null, priority || null,
       startDate || null, dueDate || null, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Project not found' });
    res.json({ success: true, data: r.rows[0], message: 'Project updated' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── POST add member ───────────────────────────────────────────────────────────
router.post('/:id/members', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const { employeeId, role = 'member' } = req.body;
    await pool.query(
      `INSERT INTO project_members (project_id, employee_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [req.params.id, employeeId, role]
    );
    res.json({ success: true, message: 'Member added' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── DELETE remove member ──────────────────────────────────────────────────────
router.delete('/:id/members/:empId', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM project_members WHERE project_id = $1 AND employee_id = $2`,
      [req.params.id, req.params.empId]
    );
    res.json({ success: true, message: 'Member removed' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── DELETE project ────────────────────────────────────────────────────────────
router.delete('/:id', authorize('admin', 'director', 'hr_admin'), audit('DELETE', 'project'), async (req, res) => {
  try {
    await pool.query('DELETE FROM projects WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Project deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
