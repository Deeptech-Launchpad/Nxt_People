/**
 * routes/org.js — Organization module endpoints
 * Handles: birthdays, new-hires, employee tree, department directory
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect } = require('../middleware/auth');
const { serverError } = require('../utils/serverError');
const { requireFunction, optionsFor } = require('../utils/functionAccess');

router.use(protect);

// ── GET /api/org/birthdays?month=5&year=2026 ──────────────────────────────────
router.get('/birthdays', requireFunction('birthday_buddy'), async (req, res) => {
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
    serverError(res, err);
  }
});

// ── GET /api/org/new-hires ────────────────────────────────────────────────────
router.get('/new-hires', requireFunction('new_joinee_list'), async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 15;
    const r = await pool.query(
      `SELECT id as "_id", employee_id as "employeeId",
       first_name as "firstName", last_name as "lastName",
       email, designation, department, photo_url as "photoUrl",
       joining_date as "joinDate"
       FROM employees
       WHERE status = 'active' AND deleted_at IS NULL
         AND joining_date >= CURRENT_DATE - INTERVAL '${days} days'
       ORDER BY joining_date DESC`
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    serverError(res, err);
  }
});

// ── GET /api/org/departments ──────────────────────────────────────────────────
router.get('/departments', requireFunction('department_tree'), async (req, res) => {
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
    serverError(res, err);
  }
});

// ── GET /api/org/departments/:id/employees ────────────────────────────────────
router.get('/departments/:id/employees', requireFunction('department_data'), async (req, res) => {
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
    serverError(res, err);
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
/* Not guarded by search_employee.
 *
 * This endpoint looks like the Search Employee feature and is not: the leave
 * tracker's employee picker, the attendance location screen, the org chart and
 * two dashboard widgets all read it. A 403 here would switch off four
 * unrelated screens to honour one row on a settings page. The switch is
 * applied where the feature actually lives — the search control itself. */
router.get('/directory', async (req, res) => {
  try {
    /* An optional department narrows the result.
     *
     * The dashboard polls this every five seconds per open tab, purely to work
     * out who else is in the viewer's own department — and was fetching the
     * whole company to find them. With a dozen people signed in that is the
     * entire directory, with its attendance and leave joins, several times a
     * second. Omitting the parameter still returns everybody, so every other
     * caller is unaffected. */
    const department = String(req.query.department || '').trim();
    const params = department ? [department] : [];
    const narrow = department ? 'AND e.department = $1' : '';

    const r = await pool.query(
      `SELECT e.id as "_id", e.employee_id as "employeeId",
              e.first_name as "firstName", e.last_name as "lastName",
              e.designation, e.department, e.photo_url as "photoUrl",
              e.email, e.phone, e.reporting_manager_id as "reportingManagerId",
              (a.check_in IS NOT NULL AND a.check_out IS NULL) as "isCheckedIn",
              -- Real attendance wins; approved leave only shows when not clocked in.
              CASE
                WHEN a.check_in IS NOT NULL AND a.check_out IS NULL THEN 'in'
                WHEN a.check_out IS NOT NULL THEN 'out'
                WHEN EXISTS (
                  SELECT 1 FROM leaves lv
                   WHERE lv.employee_id = e.id AND lv.status = 'approved'
                     AND lv.start_date <= CURRENT_DATE AND lv.end_date >= CURRENT_DATE
                ) THEN 'onLeave'
                ELSE 'yetToCheckIn'
              END as presence
         FROM employees e
         LEFT JOIN attendance a ON a.employee_id = e.id AND a.date = CURRENT_DATE
        WHERE e.status = 'active' AND e.deleted_at IS NULL ${narrow}
        ORDER BY e.first_name ASC`,
      params
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    serverError(res, err);
  }
});

router.get('/employee-tree', requireFunction('employee_tree'), async (req, res) => {
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

    /* The sub-control beside Employee Tree on the permissions screen. Organization
     * shows the whole company from its roots; Reportee shows only the caller and
     * everyone under them. The counts are computed before this narrows the result,
     * so a manager still sees the true size of their own subtree. */
    const { tree } = await optionsFor(req, 'employee_tree');
    if (tree === 'reportee') {
      const mine = map[req.user?.id];
      return res.json({ success: true, data: mine ? [mine] : [] });
    }

    res.json({ success: true, data: roots });
  } catch (err) {
    serverError(res, err);
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
    serverError(res, err);
  }
});

// ── GET /api/org/announcements ────────────────────────────────────────────────
router.get('/announcements', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id as "_id", title, content, created_by as "authorId",
       created_at as "createdAt", expires_at as "expiresAt"
       FROM announcements ORDER BY created_at DESC LIMIT 20`
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    serverError(res, err);
  }
});

module.exports = router;
