const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { isFullAccess, isManager } = require('../utils/roles');
router.use(protect);

// GET performance reviews — full-access sees all; a manager sees their direct
// reports' reviews plus any they authored; an employee sees only their own.
router.get('/', async (req, res) => {
  try {
    let where = '';
    let params = [];
    if (!isFullAccess(req.user.role)) {
      if (isManager(req.user.role)) {
        where = 'WHERE (e.reporting_manager_id = $1 OR e.approving_authority_id = $1 OR pr.reviewer_id = $1)';
      } else {
        where = 'WHERE pr.employee_id = $1';
      }
      params = [req.user._id];
    }
    const r = await pool.query(
      `SELECT pr.id as "_id", pr.cycle_name as "cycleName", pr.period_start as "periodStart",
       pr.period_end as "periodEnd", pr.overall_rating as "overallRating", pr.status,
       pr.employee_comments as "employeeComments", pr.reviewer_comments as "reviewerComments",
       pr.created_at as "createdAt", pr.updated_at as "updatedAt",
       json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name, 'department', e.department, 'designation', e.designation) as employee,
       json_build_object('_id', rv.id, 'firstName', rv.first_name, 'lastName', rv.last_name) as reviewer
       FROM performance_reviews pr
       JOIN employees e ON pr.employee_id = e.id
       LEFT JOIN employees rv ON pr.reviewer_id = rv.id
       ${where} ORDER BY pr.created_at DESC`,
      params
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET single review with goals
router.get('/:id', async (req, res) => {
  try {
    const [reviewRes, goalsRes] = await Promise.all([
      pool.query(
        `SELECT pr.*, e.first_name as emp_first, e.last_name as emp_last, e.department, e.designation, e.employee_id as emp_id,
         e.reporting_manager_id, e.approving_authority_id,
         rv.first_name as rev_first, rv.last_name as rev_last
         FROM performance_reviews pr
         JOIN employees e ON pr.employee_id = e.id
         LEFT JOIN employees rv ON pr.reviewer_id = rv.id
         WHERE pr.id = $1`, [req.params.id]
      ),
      pool.query('SELECT * FROM performance_goals WHERE review_id = $1 ORDER BY created_at', [req.params.id])
    ]);
    if (!reviewRes.rows[0]) return res.status(404).json({ success: false, message: 'Review not found' });
    const review = reviewRes.rows[0];

    // Access: full-access any; otherwise the subject employee, the reviewer,
    // or the subject's manager (direct report) may view.
    const isSubject  = String(review.employee_id) === String(req.user._id);
    const isReviewer = String(review.reviewer_id) === String(req.user._id);
    const isMgr      = isManager(req.user.role) && (
      String(review.reporting_manager_id) === String(req.user._id) ||
      String(review.approving_authority_id) === String(req.user._id));
    if (!isFullAccess(req.user.role) && !isSubject && !isReviewer && !isMgr) {
      return res.status(403).json({ success: false, message: 'Not authorized to view this review.' });
    }
    res.json({
      success: true, data: {
        _id: review.id, cycleName: review.cycle_name, periodStart: review.period_start,
        periodEnd: review.period_end, overallRating: review.overall_rating, status: review.status,
        employeeComments: review.employee_comments, reviewerComments: review.reviewer_comments,
        createdAt: review.created_at, updatedAt: review.updated_at,
        employee: { firstName: review.emp_first, lastName: review.emp_last, department: review.department, designation: review.designation, employeeId: review.emp_id },
        reviewer: { firstName: review.rev_first, lastName: review.rev_last },
        goals: goalsRes.rows.map(g => ({ _id: g.id, title: g.title, description: g.description, target: g.target, achievement: g.achievement, rating: g.rating, weight: g.weight, status: g.status, dueDate: g.due_date }))
      }
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST create review (admin/manager)
router.post('/', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const { employeeId, cycleName, periodStart, periodEnd, goals = [] } = req.body;
    if (!employeeId || !cycleName || !periodStart || !periodEnd) return res.status(400).json({ success: false, message: 'Required fields missing' });
    const r = await pool.query(
      `INSERT INTO performance_reviews (employee_id, reviewer_id, cycle_name, period_start, period_end) VALUES ($1,$2,$3,$4,$5)
       RETURNING id as "_id"`,
      [employeeId, req.user._id, cycleName, periodStart, periodEnd]
    );
    const reviewId = r.rows[0]._id;
    for (const g of goals) {
      await pool.query(
        'INSERT INTO performance_goals (review_id, employee_id, title, description, target, weight, due_date) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [reviewId, employeeId, g.title, g.description, g.target, g.weight || 1, g.dueDate || null]
      );
    }
    res.status(201).json({ success: true, data: { _id: reviewId } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// PUT update review ratings + comments (reviewer)
router.put('/:id', async (req, res) => {
  try {
    // Only full-access or the assigned reviewer may edit a review.
    const owner = await pool.query('SELECT reviewer_id FROM performance_reviews WHERE id=$1', [req.params.id]);
    if (owner.rows.length === 0) return res.status(404).json({ success: false, message: 'Review not found' });
    if (!isFullAccess(req.user.role) && String(owner.rows[0].reviewer_id) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Only the reviewer can edit this review.' });
    }

    const { overallRating, reviewerComments, employeeComments, status, goals } = req.body;
    await pool.query(
      `UPDATE performance_reviews SET overall_rating=$1, reviewer_comments=$2, employee_comments=$3, status=$4, updated_at=NOW() WHERE id=$5`,
      [overallRating || null, reviewerComments || null, employeeComments || null, status || 'draft', req.params.id]
    );
    if (goals && Array.isArray(goals)) {
      for (const g of goals) {
        if (g._id) {
          await pool.query(
            'UPDATE performance_goals SET achievement=$1, rating=$2, status=$3 WHERE id=$4',
            [g.achievement || null, g.rating || null, g.status || 'in_progress', g._id]
          );
        }
      }
    }
    res.json({ success: true, message: 'Review updated' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// DELETE review (admin)
router.delete('/:id', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM performance_reviews WHERE id=$1', [req.params.id]);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── Standalone (employee-set) goals ──────────────────────────────────────────
// These live in the same performance_goals table but with review_id = NULL.
// Employees use /performance/goals to track personal OKRs; managers can rate
// any goal they have visibility on.

// GET own standalone goals
router.get('/goals/my', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id AS "_id", title, target, description,
              status, rating, achievement, due_date AS "dueDate",
              created_at AS "createdAt"
         FROM performance_goals
        WHERE employee_id = $1 AND review_id IS NULL
        ORDER BY
          CASE status WHEN 'completed' THEN 2 ELSE 1 END,
          created_at DESC`,
      [req.user._id]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST a new standalone goal
router.post('/goals', async (req, res) => {
  try {
    const { title, target, description, dueDate } = req.body;
    if (!title) return res.status(400).json({ success: false, message: 'title is required' });
    const r = await pool.query(
      `INSERT INTO performance_goals
         (employee_id, title, target, description, due_date, status)
       VALUES ($1, $2, $3, $4, $5, 'not_started')
       RETURNING id AS "_id"`,
      [req.user._id, title, target || null, description || null, dueDate || null]
    );
    res.status(201).json({ success: true, data: { _id: r.rows[0]._id } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// PUT update a standalone goal (own only — admin/manager can rate via a separate flow)
router.put('/goals/:id', async (req, res) => {
  try {
    const { title, target, description, dueDate, status, rating, achievement } = req.body;
    // Verify ownership before update.
    const own = await pool.query(
      'SELECT employee_id FROM performance_goals WHERE id = $1 AND review_id IS NULL',
      [req.params.id]
    );
    if (own.rows.length === 0) return res.status(404).json({ success: false, message: 'Goal not found' });
    const isOwner = own.rows[0].employee_id === req.user._id;
    const isPrivileged = isFullAccess(req.user.role) || isManager(req.user.role);
    if (!isOwner && !isPrivileged) return res.status(403).json({ success: false, message: 'Forbidden' });

    const r = await pool.query(
      `UPDATE performance_goals
          SET title       = COALESCE($1, title),
              target      = COALESCE($2, target),
              description = COALESCE($3, description),
              due_date    = COALESCE($4, due_date),
              status      = COALESCE($5, status),
              rating      = COALESCE($6, rating),
              achievement = COALESCE($7, achievement)
        WHERE id = $8 AND review_id IS NULL
        RETURNING id`,
      [title || null, target || null, description || null, dueDate || null,
       status || null, rating ?? null, achievement || null, req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ success: false, message: 'Goal not found' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/goals/:id', async (req, res) => {
  try {
    const r = await pool.query(
      `DELETE FROM performance_goals
        WHERE id = $1 AND employee_id = $2 AND review_id IS NULL
        RETURNING id`,
      [req.params.id, req.user._id]
    );
    if (r.rows.length === 0) return res.status(404).json({ success: false, message: 'Goal not found' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
