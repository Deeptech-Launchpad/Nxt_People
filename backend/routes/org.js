/**
 * routes/org.js — Organization module endpoints
 * Handles: birthdays, new-hires, employee tree, department directory
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect } = require('../middleware/auth');

router.use(protect);

// ── GET /api/org/birthdays?month=5&year=2026 ──────────────────────────────────
router.get('/birthdays', async (req, res) => {
  try {
    const month = parseInt(req.query.month) || (new Date().getMonth() + 1);
    const year  = parseInt(req.query.year)  || new Date().getFullYear();

    const r = await pool.query(
      `SELECT id as "_id", employee_id as "employeeId",
       first_name as "firstName", last_name as "lastName",
       email, designation, department, photo_url as "photoUrl", phone,
       date_of_birth as "dateOfBirth"
       FROM employees
       WHERE status = 'active' AND deleted_at IS NULL
         AND date_of_birth IS NOT NULL
         AND EXTRACT(MONTH FROM date_of_birth) = $1
       ORDER BY EXTRACT(DAY FROM date_of_birth) ASC`,
      [month]
    );
    res.json({ success: true, data: r.rows, month, year });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/org/new-hires ────────────────────────────────────────────────────
router.get('/new-hires', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 15;
    const r = await pool.query(
      `SELECT id as "_id", employee_id as "employeeId",
       first_name as "firstName", last_name as "lastName",
       email, designation, department, photo_url as "photoUrl",
       join_date as "joinDate"
       FROM employees
       WHERE status = 'active' AND deleted_at IS NULL
         AND join_date >= CURRENT_DATE - INTERVAL '${days} days'
       ORDER BY join_date DESC`
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/org/departments ──────────────────────────────────────────────────
router.get('/departments', async (req, res) => {
  try {
    // Try departments table first
    let r;
    try {
      r = await pool.query(
        `SELECT d.id as "_id", d.name, d.code, d.head_id as "headId",
         COUNT(e.id) as "employeeCount"
         FROM departments d
         LEFT JOIN employees e ON e.department_id = d.id AND e.status = 'active' AND e.deleted_at IS NULL
         GROUP BY d.id, d.name, d.code, d.head_id
         ORDER BY d.name ASC`
      );
    } catch (_) {
      // Fallback: aggregate from employees.department column
      r = await pool.query(
        `SELECT department as name, COUNT(*) as "employeeCount"
         FROM employees WHERE status='active' AND deleted_at IS NULL AND department IS NOT NULL
         GROUP BY department ORDER BY department ASC`
      );
      r.rows = r.rows.map((row, i) => ({ _id: i + 1, name: row.name, employeeCount: row.employeeCount }));
    }
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/org/departments/:id/employees ────────────────────────────────────
router.get('/departments/:id/employees', async (req, res) => {
  try {
    const { search } = req.query;
    let q = `SELECT id as "_id", employee_id as "employeeId",
             first_name as "firstName", last_name as "lastName",
             email, designation, department, photo_url as "photoUrl", status
             FROM employees
             WHERE status = 'active' AND deleted_at IS NULL`;
    const params = [];

    // Try by department_id first, fall back to name matching
    const isNumeric = /^\d+$/.test(req.params.id);
    if (isNumeric) {
      q += ` AND department_id = $${params.length + 1}`;
      params.push(req.params.id);
    } else {
      q += ` AND LOWER(department) = LOWER($${params.length + 1})`;
      params.push(req.params.id);
    }

    if (search) {
      q += ` AND (LOWER(first_name) LIKE $${params.length + 1} OR LOWER(last_name) LIKE $${params.length + 1} OR LOWER(email) LIKE $${params.length + 1})`;
      params.push(`%${search.toLowerCase()}%`);
    }
    q += ' ORDER BY first_name ASC';

    const r = await pool.query(q, params);
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/org/employee-tree ─────────────────────────────────────────────────
// Each node carries:
//   • directReportsCount   = immediate children only
//   • totalReportsCount    = the whole subtree (matches what Zoho People shows
//                            on each card — e.g. "Karthick · 35" means his
//                            entire org has 35 people under him)
//   • children             = nested tree
// ── GET /api/org/directory ────────────────────────────────────────────────
// Flat list of active employees with BASIC, non-sensitive directory fields
// only. Open to every authenticated role (protect-only, no scoping) so the
// Employee/Department Tree and the "Department Members" card render the full
// org for everyone. Deliberately excludes salary/CTC/documents/leave/personal
// records — viewing the directory grants no access to sensitive data, which
// stays behind its own RBAC guards (profile pages, payroll, documents, edits).
router.get('/directory', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id as "_id", employee_id as "employeeId",
              first_name as "firstName", last_name as "lastName",
              designation, department, photo_url as "photoUrl",
              email, phone, reporting_manager_id as "reportingManagerId"
         FROM employees
        WHERE status = 'active' AND deleted_at IS NULL
        ORDER BY first_name ASC`
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/employee-tree', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, employee_id as "employeeId", first_name as "firstName",
       last_name as "lastName", designation, department, photo_url as "photoUrl",
       reporting_manager_id as "managerId"
       FROM employees WHERE status = 'active' AND deleted_at IS NULL ORDER BY id`
    );
    const all = r.rows;
    const map = {};
    all.forEach(e => { map[e.id] = { ...e, children: [], directReportsCount: 0, totalReportsCount: 0 }; });

    const roots = [];
    all.forEach(e => {
      if (e.managerId && map[e.managerId]) {
        map[e.managerId].children.push(map[e.id]);
      } else {
        roots.push(map[e.id]);
      }
    });

    // Walk bottom-up to compute total subtree size. Recursive function —
    // safe for our scale (a few hundred nodes max; depth rarely exceeds 6).
    const computeCounts = (node) => {
      node.directReportsCount = node.children.length;
      let subtree = 0;
      for (const child of node.children) {
        subtree += 1 + computeCounts(child);
      }
      node.totalReportsCount = subtree;
      return subtree;
    };
    roots.forEach(computeCounts);

    res.json({ success: true, data: roots });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/org/info ─────────────────────────────────────────────────────────
router.get('/info', async (req, res) => {
  try {
    const [empCount, deptCount] = await Promise.all([
      pool.query("SELECT COUNT(*) FROM employees WHERE status='active' AND deleted_at IS NULL"),
      pool.query("SELECT COUNT(DISTINCT department) FROM employees WHERE status='active' AND deleted_at IS NULL"),
    ]);
    res.json({
      success: true,
      data: {
        totalEmployees: parseInt(empCount.rows[0].count),
        totalDepartments: parseInt(deptCount.rows[0].count),
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/org/announcements ────────────────────────────────────────────────
router.get('/announcements', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id as "_id", title, content, author_id as "authorId",
       created_at as "createdAt", expires_at as "expiresAt"
       FROM announcements ORDER BY created_at DESC LIMIT 20`
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
