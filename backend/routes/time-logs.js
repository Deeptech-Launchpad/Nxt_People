/**
 * routes/time-logs.js
 * Live timer support: POST /start, POST /stop/:id, GET /, POST manual
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect } = require('../middleware/auth');
const { serverError } = require('../utils/serverError');

router.use(protect);

// GET all time logs for current user (filterable by date range / week)
router.get('/', async (req, res) => {
  try {
    const { from, to, projectId } = req.query;
    const now = new Date();
    const fromDate = from || new Date(now.getFullYear(), now.getMonth(), 1).toLocaleDateString('en-CA');
    const toDate   = to   || now.toLocaleDateString('en-CA');

    let where = 'WHERE tl.employee_id = $1 AND tl.date >= $2::date AND tl.date <= $3::date';
    const params = [req.user._id, fromDate, toDate];
    if (projectId) { where += ' AND tl.project_id = $4'; params.push(projectId); }

    const r = await pool.query(
      `SELECT tl.id as "_id", tl.date, tl.description, tl.hours, tl.billable,
       tl.start_time as "startTime", tl.end_time as "endTime",
       json_build_object('_id', p.id, 'name', p.name) as project,
       json_build_object('_id', j.id, 'name', j.name) as job
       FROM time_logs tl
       LEFT JOIN projects p ON tl.project_id = p.id
       LEFT JOIN jobs j ON tl.job_id = j.id
       ${where}
       ORDER BY tl.date DESC, tl.start_time DESC`,
      params
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { serverError(res, err); }
});

// GET daily summary (total hours per day for the last 7 days)
router.get('/daily-summary', async (req, res) => {
  try {
    const { from, to } = req.query;
    const now = new Date();
    const fromDate = from || new Date(now - 6 * 86400000).toLocaleDateString('en-CA');
    const toDate   = to   || now.toLocaleDateString('en-CA');

    const r = await pool.query(
      `SELECT date::text, SUM(hours) as total_hours,
       COUNT(*) as log_count,
       SUM(CASE WHEN billable THEN hours ELSE 0 END) as billable_hours
       FROM time_logs
       WHERE employee_id = $1 AND date >= $2::date AND date <= $3::date
       GROUP BY date ORDER BY date ASC`,
      [req.user._id, fromDate, toDate]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { serverError(res, err); }
});

// POST start a timer entry
router.post('/start', async (req, res) => {
  try {
    const { projectId, jobId, description, billable = true } = req.body;
    const now = new Date();
    const today = now.toLocaleDateString('en-CA');

    // Check if a timer is already running
    const running = await pool.query(
      `SELECT id FROM time_logs WHERE employee_id = $1 AND end_time IS NULL AND start_time IS NOT NULL`,
      [req.user._id]
    );
    if (running.rows.length > 0) {
      return res.status(400).json({ success: false, message: 'A timer is already running. Stop it first.' });
    }

    const r = await pool.query(
      `INSERT INTO time_logs (employee_id, project_id, job_id, description, start_time, billable, date)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id as "_id", start_time as "startTime", description, billable`,
      [req.user._id, projectId || null, jobId || null, description || null, now, billable, today]
    );
    res.status(201).json({ success: true, data: r.rows[0], message: 'Timer started' });
  } catch (err) { serverError(res, err); }
});

// POST stop a running timer
router.post('/stop/:id', async (req, res) => {
  try {
    const now = new Date();
    const logRes = await pool.query(
      `SELECT * FROM time_logs WHERE id = $1 AND employee_id = $2`,
      [req.params.id, req.user._id]
    );
    const log = logRes.rows[0];
    if (!log) return res.status(404).json({ success: false, message: 'Timer not found' });
    if (log.end_time) return res.status(400).json({ success: false, message: 'Timer already stopped' });

    const hours = parseFloat(((now - new Date(log.start_time)) / 3600000).toFixed(4));
    const r = await pool.query(
      `UPDATE time_logs SET end_time = $1, hours = $2 WHERE id = $3
       RETURNING id as "_id", start_time as "startTime", end_time as "endTime", hours, description, billable`,
      [now, hours, req.params.id]
    );
    res.json({ success: true, data: r.rows[0], message: 'Timer stopped' });
  } catch (err) { serverError(res, err); }
});

// GET running timer for current user
router.get('/running', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT tl.id as "_id", tl.start_time as "startTime", tl.description, tl.billable,
       json_build_object('_id', p.id, 'name', p.name) as project,
       json_build_object('_id', j.id, 'name', j.name) as job
       FROM time_logs tl
       LEFT JOIN projects p ON tl.project_id = p.id
       LEFT JOIN jobs j ON tl.job_id = j.id
       WHERE tl.employee_id = $1 AND tl.end_time IS NULL AND tl.start_time IS NOT NULL
       ORDER BY tl.start_time DESC LIMIT 1`,
      [req.user._id]
    );
    res.json({ success: true, data: r.rows[0] || null });
  } catch (err) { serverError(res, err); }
});

// POST add a manual time log entry (no start/stop)
router.post('/', async (req, res) => {
  try {
    const { projectId, jobId, description, hours, billable = true, date } = req.body;
    if (!hours || isNaN(parseFloat(hours))) {
      return res.status(400).json({ success: false, message: 'hours is required' });
    }
    const today = date || new Date().toLocaleDateString('en-CA');
    const r = await pool.query(
      `INSERT INTO time_logs (employee_id, project_id, job_id, description, hours, billable, date)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id as "_id", date, hours, description, billable`,
      [req.user._id, projectId || null, jobId || null, description || null,
       parseFloat(hours), billable, today]
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) { serverError(res, err); }
});

// DELETE a time log
router.delete('/:id', async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM time_logs WHERE id = $1 AND employee_id = $2`,
      [req.params.id, req.user._id]
    );
    res.json({ success: true, message: 'Time log deleted' });
  } catch (err) { serverError(res, err); }
});

module.exports = router;
