/**
 * routes/jobs.js
 * Job management within projects
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

// GET /api/jobs?projectId=&status=&assigneeId=
router.get('/', async (req, res) => {
  try {
    const { projectId, status, assigneeId } = req.query;
    let where = 'WHERE 1=1';
    const params = [];
    let i = 1;
    if (projectId)  { where += ` AND j.project_id = $${i++}`;  params.push(projectId); }
    if (status)     { where += ` AND j.status = $${i++}`;       params.push(status); }
    if (assigneeId) { where += ` AND j.assignee_id = $${i++}`;  params.push(assigneeId); }

    const r = await pool.query(
      `SELECT j.id as "_id", j.name, j.description, j.status, j.estimated_hours as "estimatedHours",
       j.billable, j.due_date as "dueDate", j.created_at as "createdAt",
       json_build_object('_id', p.id, 'name', p.name) as project,
       json_build_object('_id', a.id, 'firstName', a.first_name, 'lastName', a.last_name) as assignee,
       COALESCE(SUM(tl.hours),0) as "loggedHours"
       FROM jobs j
       LEFT JOIN projects p ON j.project_id = p.id
       LEFT JOIN employees a ON j.assignee_id = a.id
       LEFT JOIN time_logs tl ON tl.job_id = j.id
       ${where}
       GROUP BY j.id, j.name, j.description, j.status, j.estimated_hours, j.billable,
                j.due_date, j.created_at, p.id, p.name, a.id, a.first_name, a.last_name
       ORDER BY j.created_at DESC`,
      params
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET /api/jobs/:id
router.get('/:id', async (req, res) => {
  try {
    const [jobRes, logsRes] = await Promise.all([
      pool.query(
        `SELECT j.*, p.name as project_name,
         a.first_name as assignee_first, a.last_name as assignee_last
         FROM jobs j
         LEFT JOIN projects p ON j.project_id = p.id
         LEFT JOIN employees a ON j.assignee_id = a.id
         WHERE j.id = $1`, [req.params.id]
      ),
      pool.query(
        `SELECT SUM(hours) as total_hours,
         SUM(CASE WHEN billable THEN hours ELSE 0 END) as billable_hours
         FROM time_logs WHERE job_id = $1`, [req.params.id]
      )
    ]);
    if (!jobRes.rows[0]) return res.status(404).json({ success: false, message: 'Job not found' });
    const j = jobRes.rows[0];
    const stats = logsRes.rows[0];
    res.json({
      success: true,
      data: {
        _id: j.id, name: j.name, description: j.description, status: j.status,
        estimatedHours: j.estimated_hours, billable: j.billable, dueDate: j.due_date,
        project: { _id: j.project_id, name: j.project_name },
        assignee: j.assignee_id ? { firstName: j.assignee_first, lastName: j.assignee_last } : null,
        loggedHours: parseFloat(stats.total_hours) || 0,
        billableHours: parseFloat(stats.billable_hours) || 0,
      }
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST /api/jobs (admin/manager)
router.post('/', authorize('admin', 'director', 'manager'), async (req, res) => {
  try {
    const { projectId, name, description, estimatedHours, billable = true, assigneeId, dueDate } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Job name required' });
    const r = await pool.query(
      `INSERT INTO jobs (project_id, name, description, estimated_hours, billable, assignee_id, due_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id as "_id", name, status, estimated_hours as "estimatedHours"`,
      [projectId||null, name, description||null, estimatedHours||null, billable, assigneeId||null, dueDate||null]
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// PUT /api/jobs/:id
router.put('/:id', authorize('admin', 'director', 'manager'), async (req, res) => {
  try {
    const { name, description, status, estimatedHours, billable, assigneeId, dueDate } = req.body;
    const r = await pool.query(
      `UPDATE jobs SET
       name=COALESCE($1,name), description=COALESCE($2,description), status=COALESCE($3,status),
       estimated_hours=COALESCE($4,estimated_hours), billable=COALESCE($5,billable),
       assignee_id=COALESCE($6,assignee_id), due_date=COALESCE($7,due_date), updated_at=NOW()
       WHERE id=$8
       RETURNING id as "_id", name, status, estimated_hours as "estimatedHours"`,
      [name||null, description||null, status||null, estimatedHours||null,
       billable!=null?billable:null, assigneeId||null, dueDate||null, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// DELETE /api/jobs/:id (admin)
router.delete('/:id', authorize('admin', 'director'), async (req, res) => {
  try {
    await pool.query('DELETE FROM jobs WHERE id=$1', [req.params.id]);
    res.json({ success: true, message: 'Job deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
