const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
router.use(protect);

// GET performance reviews for current user (or all if admin)
router.get('/', async (req, res) => {
  try {
    const isAdmin = ['admin', 'manager'].includes(req.user.role);
    const where = isAdmin ? '' : 'WHERE pr.employee_id = $1';
    const params = isAdmin ? [] : [req.user._id];
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
router.post('/', authorize('admin', 'manager'), async (req, res) => {
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
router.delete('/:id', authorize('admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM performance_reviews WHERE id=$1', [req.params.id]);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
