const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
router.use(protect);

// GET payroll report for a month
router.get('/', authorize('admin', 'manager'), async (req, res) => {
  try {
    const { month, year } = req.query;
    const m = parseInt(month) || new Date().getMonth() + 1;
    const y = parseInt(year) || new Date().getFullYear();
    const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
    const endDate = new Date(y, m, 0).toLocaleDateString('en-CA');

    // Working days in this month (Mon-Fri, excluding holidays)
    const holidaysRes = await pool.query(
      `SELECT date FROM holidays WHERE EXTRACT(MONTH FROM date) = $1 AND EXTRACT(YEAR FROM date) = $2`,
      [m, y]
    );
    const holidayDates = new Set(holidaysRes.rows.map(h => h.date.toISOString().split('T')[0]));
    let totalWorkingDays = 0;
    const current = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T00:00:00');
    while (current <= end) {
      const day = current.getDay();
      const ds = current.toLocaleDateString('en-CA');
      if (day !== 0 && day !== 6 && !holidayDates.has(ds)) totalWorkingDays++;
      current.setDate(current.getDate() + 1);
    }

    // Per-employee summary
    const r = await pool.query(
      `SELECT e.id, e.first_name, e.last_name, e.employee_id as emp_id, e.department, e.designation,
       e.basic_salary, e.monthly_ctc,
       COUNT(CASE WHEN a.status IN ('present','late') THEN 1 END) as present_days,
       COUNT(CASE WHEN a.status = 'late' THEN 1 END) as late_days,
       COUNT(CASE WHEN a.status = 'half-day' THEN 1 END) as half_days,
       COALESCE(SUM(CASE WHEN a.check_out IS NOT NULL AND a.check_in IS NOT NULL
         THEN EXTRACT(EPOCH FROM (a.check_out - a.check_in))/3600 ELSE 0 END), 0) as total_hours,
       (SELECT COUNT(*) FROM leaves l WHERE l.employee_id = e.id AND l.status='approved'
         AND l.start_date <= $2 AND l.end_date >= $1) as approved_leave_days
       FROM employees e
       LEFT JOIN attendance a ON e.id = a.employee_id AND a.date BETWEEN $1::date AND $2::date
       WHERE e.status = 'active'
       GROUP BY e.id, e.first_name, e.last_name, e.employee_id, e.department, e.designation, e.basic_salary, e.monthly_ctc
       ORDER BY e.first_name`,
      [startDate, endDate]
    );

    const rows = r.rows.map(emp => {
      const present = parseInt(emp.present_days) || 0;
      const approved_leave = parseInt(emp.approved_leave_days) || 0;
      const half_days = parseInt(emp.half_days) || 0;
      const late = parseInt(emp.late_days) || 0;
      const paid_days = present + approved_leave + (half_days * 0.5);
      const lop_days = Math.max(0, totalWorkingDays - paid_days);
      const salary = parseFloat(emp.monthly_ctc) || 0;
      const per_day = salary > 0 ? salary / totalWorkingDays : 0;
      const net_salary = salary > 0 ? Math.round(salary - (lop_days * per_day)) : null;

      return {
        _id: emp.id,
        firstName: emp.first_name, lastName: emp.last_name,
        employeeId: emp.emp_id, department: emp.department, designation: emp.designation,
        basicSalary: parseFloat(emp.basic_salary) || 0,
        monthlyCTC: salary,
        presentDays: present, lateDays: late, halfDays: half_days,
        approvedLeaveDays: approved_leave,
        totalWorkingDays,
        paidDays: parseFloat(paid_days.toFixed(1)),
        lopDays: parseFloat(lop_days.toFixed(1)),
        totalHours: parseFloat(parseFloat(emp.total_hours).toFixed(1)),
        netSalary: net_salary
      };
    });

    res.json({ success: true, data: rows, meta: { month: m, year: y, totalWorkingDays, startDate, endDate } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET leave accrual — run monthly accrual
router.post('/accrue', authorize('admin'), async (req, res) => {
  try {
    const settingsRes = await pool.query('SELECT * FROM settings LIMIT 1');
    const s = settingsRes.rows[0];
    if (!s?.leave_accrual_enabled) return res.status(400).json({ success: false, message: 'Leave accrual is disabled in Settings' });

    // Batch the accrual: one UPDATE + one bulk INSERT per leave type instead
    // of 6 round-trips per employee. At 150 active employees that's 6 queries
    // total instead of ~900. INSERT uses unnest() so a single parameterised
    // statement covers every employee.
    const empRes = await pool.query("SELECT id FROM employees WHERE status='active'");
    const empIds = empRes.rows.map(r => r.id);
    const credited = empIds.length;

    const accrueLeaveType = async (column, code, days, reason) => {
      if (!days || days <= 0 || empIds.length === 0) return;
      await pool.query(
        `UPDATE employees SET ${column} = COALESCE(${column},0) + $1 WHERE id = ANY($2::uuid[])`,
        [days, empIds]
      );
      await pool.query(
        `INSERT INTO leave_accrual_log (employee_id, leave_type, days_added, reason)
         SELECT unnest($1::uuid[]), $2, $3, $4`,
        [empIds, code, days, reason]
      );
    };

    await accrueLeaveType('casual_leave', 'casual', s.casual_accrual_per_month, 'Monthly accrual');
    await accrueLeaveType('sick_leave',   'sick',   s.sick_accrual_per_month,   'Monthly accrual');
    await accrueLeaveType('earned_leave', 'earned', s.earned_accrual_per_month, 'Monthly accrual');
    await logAudit(req, {
      action: 'ACCRUE_LEAVE',
      resource: 'Payroll',
      details: { count: credited }
    });
    res.json({ success: true, message: `Leave accrued for ${credited} employees` });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* ════════════════════════════════════════════════════════════════════════
 *  PHASE 1 — Salary Structure (admin)
 *  Versioned per employee. Each edit closes the previous "current" row
 *  (effective_to = today) and INSERTs a fresh one so history is auditable.
 *  Read-only fields returned alongside the structure: monthlyGross,
 *  monthlyNet, ctcAnnual — the frontend uses them for the summary line.
 * ══════════════════════════════════════════════════════════════════════ */

// Earnings + deductions component names. Used for sums + the column
// list on INSERT. Order matters for the response shape.
const EARNINGS  = ['basic', 'hra', 'conveyance', 'medical', 'special_allowance', 'other_allowances'];
const DEDUCTIONS = ['pf_employee', 'esi_employee', 'professional_tax'];

// Helper: pull a number from req.body and floor at 0. Empty/garbage -> 0.
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

// SELECT clause used by both list and detail responses — keeps the camelCase
// alias mapping in one place so the frontend never sees snake_case.
const STRUCT_COLS = `
  id, employee_id AS "employeeId",
  effective_from AS "effectiveFrom", effective_to AS "effectiveTo",
  basic, hra, conveyance, medical,
  special_allowance AS "specialAllowance",
  other_allowances  AS "otherAllowances",
  pf_employee       AS "pfEmployee",
  esi_employee      AS "esiEmployee",
  professional_tax  AS "professionalTax",
  pf_employer       AS "pfEmployer",
  pf_applicable     AS "pfApplicable",
  esi_applicable    AS "esiApplicable",
  notes, created_at AS "createdAt"
`;

/** Add the computed totals (monthlyGross, monthlyDeductions, monthlyNet,
 *  ctcAnnual) to a structure row so the frontend doesn't have to re-do
 *  the math. Tolerant to nulls — a brand-new employee with no structure
 *  yet returns zeros instead of NaN. */
function withTotals(row) {
  if (!row) return null;
  const monthlyGross =
    Number(row.basic || 0) +
    Number(row.hra || 0) +
    Number(row.conveyance || 0) +
    Number(row.medical || 0) +
    Number(row.specialAllowance || 0) +
    Number(row.otherAllowances || 0);
  const monthlyDeductions =
    Number(row.pfEmployee || 0) +
    Number(row.esiEmployee || 0) +
    Number(row.professionalTax || 0);
  const monthlyNet = monthlyGross - monthlyDeductions;
  // CTC = annual gross + annual employer-PF (the "cost to company" employees never see).
  const ctcAnnual  = monthlyGross * 12 + Number(row.pfEmployer || 0) * 12;
  return { ...row, monthlyGross, monthlyDeductions, monthlyNet, ctcAnnual };
}

// GET /api/payroll/admin/employees — list all active employees with their
// current salary structure. Employees who don't have a structure yet show
// up with structure: null so the admin can spot them and click "Set up".
router.get('/admin/employees', authorize('admin'), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT
         e.id AS "_id", e.employee_id AS "employeeId",
         e.first_name AS "firstName", e.last_name AS "lastName",
         e.email, e.department, e.designation, e.company,
         s.id AS "structureId",
         s.basic, s.hra, s.conveyance, s.medical,
         s.special_allowance AS "specialAllowance",
         s.other_allowances  AS "otherAllowances",
         s.pf_employee       AS "pfEmployee",
         s.esi_employee      AS "esiEmployee",
         s.professional_tax  AS "professionalTax",
         s.pf_employer       AS "pfEmployer"
       FROM employees e
       LEFT JOIN salary_structures s
         ON s.employee_id = e.id AND s.effective_to IS NULL
       WHERE e.status = 'active'
       ORDER BY e.first_name ASC`
    );
    // Each row carries the current monthly gross + CTC so the list view can
    // render those columns without a second query per employee.
    const data = r.rows.map(emp => {
      if (!emp.structureId) return { ...emp, structure: null };
      const totals = withTotals(emp);
      return {
        _id: emp._id,
        employeeId: emp.employeeId,
        firstName: emp.firstName,
        lastName:  emp.lastName,
        email:     emp.email,
        department: emp.department,
        designation: emp.designation,
        company:    emp.company,
        structure: {
          monthlyGross:      totals.monthlyGross,
          monthlyDeductions: totals.monthlyDeductions,
          monthlyNet:        totals.monthlyNet,
          ctcAnnual:         totals.ctcAnnual,
        },
      };
    });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/payroll/admin/employees/:id/structure — full current structure +
// the last 5 historical rows for audit context. Returns 200 with structure
// null if the employee has never had one set up.
router.get('/admin/employees/:id/structure', authorize('admin'), async (req, res) => {
  try {
    const current = await pool.query(
      `SELECT ${STRUCT_COLS} FROM salary_structures
        WHERE employee_id = $1 AND effective_to IS NULL LIMIT 1`,
      [req.params.id]
    );
    const history = await pool.query(
      `SELECT ${STRUCT_COLS} FROM salary_structures
        WHERE employee_id = $1 AND effective_to IS NOT NULL
        ORDER BY effective_from DESC LIMIT 5`,
      [req.params.id]
    );
    res.json({
      success: true,
      data: {
        current: withTotals(current.rows[0]),
        history: history.rows.map(withTotals),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/payroll/admin/employees/:id/structure — upsert a new "current"
// structure. Closes any existing open row (effective_to = today) and
// INSERTs a fresh one. All-or-nothing inside one transaction so we never
// end up with two open rows (the partial unique index would catch that
// too, but the txn keeps the error message clean).
router.put('/admin/employees/:id/structure',
  authorize('admin'),
  logAuditWrapper('UPDATE', 'salary_structure'),
  async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Sanity: employee must exist + be active. Saves a confusing FK
      // violation if the admin opens an old tab with a stale id.
      const emp = await client.query(
        `SELECT id FROM employees WHERE id = $1 AND status = 'active'`,
        [req.params.id]
      );
      if (emp.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, message: 'Active employee not found' });
      }

      // Close any currently-open row. effective_to = today, so the new
      // row's effective_from = today reads as "from this moment onward".
      await client.query(
        `UPDATE salary_structures
            SET effective_to = CURRENT_DATE
          WHERE employee_id = $1 AND effective_to IS NULL`,
        [req.params.id]
      );

      const b = req.body || {};
      const insert = await client.query(
        `INSERT INTO salary_structures
           (employee_id, effective_from,
            basic, hra, conveyance, medical, special_allowance, other_allowances,
            pf_employee, esi_employee, professional_tax, pf_employer,
            pf_applicable, esi_applicable,
            notes, created_by)
         VALUES ($1, CURRENT_DATE,
                 $2, $3, $4, $5, $6, $7,
                 $8, $9, $10, $11,
                 $12, $13,
                 $14, $15)
         RETURNING ${STRUCT_COLS}`,
        [
          req.params.id,
          num(b.basic), num(b.hra), num(b.conveyance), num(b.medical),
          num(b.specialAllowance), num(b.otherAllowances),
          num(b.pfEmployee), num(b.esiEmployee), num(b.professionalTax), num(b.pfEmployer),
          b.pfApplicable !== false, !!b.esiApplicable,
          b.notes || null, req.user._id,
        ]
      );

      await client.query('COMMIT');
      res.json({ success: true, data: withTotals(insert.rows[0]) });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(500).json({ success: false, message: err.message });
    } finally {
      client.release();
    }
  }
);

// Tiny inline wrapper for the audit middleware — the existing audit()
// requires the action + resource at module-load time, this lets us
// describe it inline alongside the route. Same behaviour either way.
function logAuditWrapper(action, resource) {
  const { audit } = require('../middleware/audit');
  return audit(action, resource);
}

module.exports = router;
