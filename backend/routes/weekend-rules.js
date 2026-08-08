const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** Normalise + validate a rule payload coming from the client. */
function normaliseRule(body) {
  const name = String(body.name || '').trim();
  if (!name) throw new Error('Name is required');

  // daysOfWeek: filter down to the seven canonical strings.
  const daysOfWeek = (Array.isArray(body.daysOfWeek) ? body.daysOfWeek : [])
    .map(d => String(d).toLowerCase())
    .filter(d => DAYS.includes(d));
  if (daysOfWeek.length === 0) throw new Error('At least one day of week is required');

  // weeksOfMonth: 1–5 only; empty means "every week".
  const weeksOfMonth = (Array.isArray(body.weeksOfMonth) ? body.weeksOfMonth : [])
    .map(n => parseInt(n, 10))
    .filter(n => Number.isInteger(n) && n >= 1 && n <= 5);

  const intervalWeeks = Math.max(1, parseInt(body.intervalWeeks, 10) || 1);

  // Default to a far-past date so a freshly-created "Sundays" rule covers
  // historical Sundays too. Admins who want a future start date can still
  // pass startDate explicitly via the form.
  const startDate = body.startDate || '2020-01-01';

  const endType = ['never', 'on', 'after'].includes(body.endType) ? body.endType : 'never';
  const endDate  = endType === 'on'    ? (body.endDate  || null) : null;
  const endCount = endType === 'after' ? (parseInt(body.endCount, 10) || null) : null;

  const isActive = body.isActive === undefined ? true : !!body.isActive;
  // Future Compensation flag — when TRUE, the Working Day Exception's
  // "Select Compensated Holiday" dropdown picks this rule up.
  const isCompensatory = !!body.isCompensatory;

  return { name, daysOfWeek, weeksOfMonth, intervalWeeks, startDate, endType, endDate, endCount, isActive, isCompensatory };
}

/* GET — list all rules (any logged-in user, so the client can compute weekends). */
router.get('/', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, name,
              days_of_week    as "daysOfWeek",
              weeks_of_month  as "weeksOfMonth",
              interval_weeks  as "intervalWeeks",
              start_date      as "startDate",
              end_type        as "endType",
              end_date        as "endDate",
              end_count       as "endCount",
              is_active       as "isActive",
              is_compensatory as "isCompensatory",
              created_at      as "createdAt"
       FROM weekend_rules
       ORDER BY created_at ASC`
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* POST — create. Admin only. */
router.post('/', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  try {
    const v = normaliseRule(req.body);
    const r = await pool.query(
      `INSERT INTO weekend_rules
         (name, days_of_week, weeks_of_month, interval_weeks, start_date, end_type, end_date, end_count, is_active, is_compensatory, created_by)
       VALUES ($1, $2::jsonb, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [v.name, JSON.stringify(v.daysOfWeek), JSON.stringify(v.weeksOfMonth), v.intervalWeeks,
       v.startDate, v.endType, v.endDate, v.endCount, v.isActive, v.isCompensatory, req.user._id]
    );
    res.status(201).json({ success: true, data: { id: r.rows[0].id, ...v } });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

/* PUT — update. Admin only. */
router.put('/:id', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  try {
    const v = normaliseRule(req.body);
    const r = await pool.query(
      `UPDATE weekend_rules SET
         name            = $1,
         days_of_week    = $2::jsonb,
         weeks_of_month  = $3::jsonb,
         interval_weeks  = $4,
         start_date      = $5,
         end_type        = $6,
         end_date        = $7,
         end_count       = $8,
         is_active       = $9,
         is_compensatory = $10,
         updated_at      = NOW()
       WHERE id = $11 RETURNING id`,
      [v.name, JSON.stringify(v.daysOfWeek), JSON.stringify(v.weeksOfMonth), v.intervalWeeks,
       v.startDate, v.endType, v.endDate, v.endCount, v.isActive, v.isCompensatory, req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ success: false, message: 'Rule not found' });
    res.json({ success: true, data: { id: r.rows[0].id, ...v } });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

/* DELETE — admin only. */
router.delete('/:id', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM weekend_rules WHERE id = $1 RETURNING id', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ success: false, message: 'Rule not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
