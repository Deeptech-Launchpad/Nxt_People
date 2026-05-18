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

/* ════════════════════════════════════════════════════════════════════════
 *  PHASE 2 — Monthly payroll run + payslip CRUD
 *  Generates payslips from each employee's current salary_structure,
 *  prorated by attendance. Uses a snapshot so a later structure edit
 *  doesn't rewrite history. Lifecycle: draft -> locked -> paid.
 *  Employees can only see locked/paid slips; drafts are admin-only.
 * ══════════════════════════════════════════════════════════════════════ */

const MONTH_NAMES = ['', 'January','February','March','April','May','June',
                     'July','August','September','October','November','December'];

// Working-day count for a month — Mon-Fri minus public holidays. Saturday
// counts per the org's weekend rules; for Phase 2 we treat Sat/Sun as
// non-working. (Phase 4 can integrate the configurable weekend rules.)
async function workingDaysInMonth(month, year) {
  const days = new Date(year, month, 0).getDate(); // 28..31
  // Holidays in this calendar month
  const hols = await pool.query(
    `SELECT date FROM holidays WHERE year = $1 AND EXTRACT(MONTH FROM date) = $2 AND type != 'working_day'`,
    [year, month]
  );
  const holSet = new Set(hols.rows.map(r => {
    const d = new Date(r.date);
    return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
  }));
  let working = 0;
  for (let d = 1; d <= days; d++) {
    const dt = new Date(year, month - 1, d);
    const dow = dt.getDay();
    if (dow === 0 || dow === 6) continue;                 // Sat/Sun off
    if (holSet.has(`${year}-${month}-${d}`)) continue;    // Holiday off
    working++;
  }
  return working;
}

// Unpaid (LOP) leave days for an employee in a given month. We count
// approved leaves with leave_type = 'unpaid' that intersect the period.
async function lopDaysFor(employeeId, month, year) {
  const start = `${year}-${String(month).padStart(2,'0')}-01`;
  const end   = new Date(year, month, 0).toLocaleDateString('en-CA');
  const r = await pool.query(
    `SELECT COALESCE(SUM(total_days), 0) AS lop
       FROM leaves
      WHERE employee_id = $1
        AND status = 'approved'
        AND leave_type = 'unpaid'
        AND start_date <= $3
        AND end_date   >= $2`,
    [employeeId, start, end]
  );
  return Number(r.rows[0].lop || 0);
}

// POST /api/payroll/admin/run-month — generate draft payslips for all
// active employees who have a current salary_structure. Skips employees
// without a structure (admin needs to set them up first). Skips
// employees who already have a payslip for the month (use force=true
// to overwrite drafts; locked/paid slips are never touched).
router.post('/admin/run-month', authorize('admin'), logAuditWrapper('PAYROLL_RUN', 'payroll'), async (req, res) => {
  try {
    const month = Number(req.body.month) || (new Date().getMonth() + 1);
    const year  = Number(req.body.year)  || new Date().getFullYear();
    const force = !!req.body.force;

    if (month < 1 || month > 12) return res.status(400).json({ success: false, message: 'Invalid month' });

    const workingDays = await workingDaysInMonth(month, year);

    const employees = await pool.query(
      `SELECT e.id, e.first_name, e.last_name,
              s.basic, s.hra, s.conveyance, s.medical,
              s.special_allowance, s.other_allowances,
              s.pf_employee, s.esi_employee, s.professional_tax
         FROM employees e
         JOIN salary_structures s ON s.employee_id = e.id AND s.effective_to IS NULL
        WHERE e.status = 'active'`
    );

    const results = { created: 0, updated: 0, skipped: 0, errors: [] };

    for (const emp of employees.rows) {
      try {
        // Check for an existing slip — locked/paid are immutable.
        const existing = await pool.query(
          `SELECT id, status FROM payroll_payslips
            WHERE employee_id = $1 AND pay_month = $2 AND pay_year = $3`,
          [emp.id, month, year]
        );
        if (existing.rows.length > 0) {
          const status = existing.rows[0].status;
          if (status !== 'draft' || !force) { results.skipped++; continue; }
        }

        // LOP proration
        const lopDays = Math.min(await lopDaysFor(emp.id, month, year), workingDays);
        const ratio = workingDays > 0 ? (workingDays - lopDays) / workingDays : 1;

        const basic        = Number(emp.basic || 0) * ratio;
        const hra          = Number(emp.hra || 0) * ratio;
        const conveyance   = Number(emp.conveyance || 0) * ratio;
        const medical      = Number(emp.medical || 0) * ratio;
        const spec         = Number(emp.special_allowance || 0) * ratio;
        const other        = Number(emp.other_allowances || 0) * ratio;

        const grossFull    = Number(emp.basic||0) + Number(emp.hra||0) + Number(emp.conveyance||0)
                           + Number(emp.medical||0) + Number(emp.special_allowance||0) + Number(emp.other_allowances||0);
        const gross        = basic + hra + conveyance + medical + spec + other;
        const lopAmount    = grossFull - gross;

        // Deductions are flat (don't prorate PF/ESI/PT for LOP days —
        // statutory rules apply on the actual paid amount but for the
        // simplified Phase 2 we keep them constant).
        const pfE          = Number(emp.pf_employee || 0);
        const esiE         = Number(emp.esi_employee || 0);
        const pt           = Number(emp.professional_tax || 0);
        const tds          = 0; // Phase 5

        const totalDed     = pfE + esiE + pt + tds;
        const net          = gross - totalDed;

        if (existing.rows.length > 0 && force) {
          await pool.query(
            `UPDATE payroll_payslips
                SET basic=$1, hra=$2, conveyance=$3, medical=$4,
                    special_allowance=$5, other_allowances=$6,
                    working_days=$7, present_days=$8, lop_days=$9, lop_amount=$10,
                    pf_employee=$11, esi_employee=$12, professional_tax=$13, tds=$14,
                    gross_earnings=$15, total_deductions=$16, net_pay=$17,
                    generated_at=NOW(), generated_by=$18
              WHERE id=$19`,
            [basic, hra, conveyance, medical, spec, other,
             workingDays, workingDays - lopDays, lopDays, lopAmount,
             pfE, esiE, pt, tds,
             gross, totalDed, net,
             req.user._id, existing.rows[0].id]
          );
          results.updated++;
        } else {
          await pool.query(
            `INSERT INTO payroll_payslips
               (employee_id, pay_month, pay_year,
                basic, hra, conveyance, medical, special_allowance, other_allowances,
                working_days, present_days, lop_days, lop_amount,
                pf_employee, esi_employee, professional_tax, tds,
                gross_earnings, total_deductions, net_pay,
                generated_by)
             VALUES ($1,$2,$3, $4,$5,$6,$7,$8,$9, $10,$11,$12,$13,
                     $14,$15,$16,$17, $18,$19,$20, $21)`,
            [emp.id, month, year,
             basic, hra, conveyance, medical, spec, other,
             workingDays, workingDays - lopDays, lopDays, lopAmount,
             pfE, esiE, pt, tds,
             gross, totalDed, net,
             req.user._id]
          );
          results.created++;
        }
      } catch (e) {
        results.errors.push({ employeeId: emp.id, reason: e.message });
      }
    }

    res.json({ success: true, month, year, workingDays, results });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/payroll/admin/payslips?month=X&year=Y — list payslips for a
// period. Joins employee + designation/department for display.
router.get('/admin/payslips', authorize('admin', 'manager'), async (req, res) => {
  try {
    const month = req.query.month ? Number(req.query.month) : null;
    const year  = req.query.year  ? Number(req.query.year)  : null;
    const where = [];
    const params = [];
    if (month) { params.push(month); where.push(`p.pay_month = $${params.length}`); }
    if (year)  { params.push(year);  where.push(`p.pay_year  = $${params.length}`); }
    const wsql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const r = await pool.query(
      `SELECT p.id, p.pay_month AS "payMonth", p.pay_year AS "payYear",
              p.status, p.gross_earnings AS "grossEarnings",
              p.total_deductions AS "totalDeductions", p.net_pay AS "netPay",
              p.working_days AS "workingDays", p.present_days AS "presentDays",
              p.lop_days AS "lopDays", p.lop_amount AS "lopAmount",
              p.locked_at AS "lockedAt", p.paid_at AS "paidAt",
              e.id AS "employeeId", e.employee_id AS "employeeCode",
              e.first_name AS "firstName", e.last_name AS "lastName",
              e.department, e.designation
         FROM payroll_payslips p
         JOIN employees e ON p.employee_id = e.id
         ${wsql}
        ORDER BY p.pay_year DESC, p.pay_month DESC, e.first_name ASC`,
      params
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/payroll/admin/payslips/:id — full payslip details. Same
// payload shape used to render the admin viewer + the PDF.
router.get('/admin/payslips/:id', authorize('admin', 'manager'), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT p.*,
              e.employee_id AS "employeeCode",
              e.first_name AS "firstName", e.last_name AS "lastName",
              e.email, e.department, e.designation, e.company, e.joining_date,
              e.bank_name, e.bank_account, e.bank_ifsc, e.pan_number, e.uan_number
         FROM payroll_payslips p
         JOIN employees e ON p.employee_id = e.id
        WHERE p.id = $1`,
      [req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ success: false, message: 'Payslip not found' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/payroll/admin/payslips/:id/lock — once locked, employee can see.
router.put('/admin/payslips/:id/lock', authorize('admin'), logAuditWrapper('LOCK', 'payslip'), async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE payroll_payslips SET status='locked', locked_at=NOW()
        WHERE id=$1 AND status='draft' RETURNING id`,
      [req.params.id]
    );
    if (r.rows.length === 0) return res.status(400).json({ success: false, message: 'Only draft payslips can be locked' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/payroll/admin/payslips/:id/mark-paid — admin records payment.
router.put('/admin/payslips/:id/mark-paid', authorize('admin'), logAuditWrapper('PAID', 'payslip'), async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE payroll_payslips SET status='paid', paid_at=NOW()
        WHERE id=$1 AND status='locked' RETURNING id`,
      [req.params.id]
    );
    if (r.rows.length === 0) return res.status(400).json({ success: false, message: 'Only locked payslips can be marked paid' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/payroll/admin/payslips/:id — only drafts can be deleted.
router.delete('/admin/payslips/:id', authorize('admin'), logAuditWrapper('DELETE', 'payslip'), async (req, res) => {
  try {
    const r = await pool.query(
      `DELETE FROM payroll_payslips WHERE id=$1 AND status='draft' RETURNING id`,
      [req.params.id]
    );
    if (r.rows.length === 0) return res.status(400).json({ success: false, message: 'Only draft payslips can be deleted' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/payroll/my — employee: list their own payslips (locked/paid only).
router.get('/my', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, pay_month AS "payMonth", pay_year AS "payYear",
              status, gross_earnings AS "grossEarnings",
              total_deductions AS "totalDeductions", net_pay AS "netPay",
              locked_at AS "lockedAt", paid_at AS "paidAt"
         FROM payroll_payslips
        WHERE employee_id = $1 AND status IN ('locked','paid')
        ORDER BY pay_year DESC, pay_month DESC`,
      [req.user._id]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/payroll/my/:id — employee: own payslip detail.
router.get('/my/:id', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT p.*,
              e.employee_id AS "employeeCode",
              e.first_name AS "firstName", e.last_name AS "lastName",
              e.email, e.department, e.designation, e.company, e.joining_date,
              e.bank_name, e.bank_account, e.bank_ifsc, e.pan_number, e.uan_number
         FROM payroll_payslips p
         JOIN employees e ON p.employee_id = e.id
        WHERE p.id = $1 AND p.employee_id = $2 AND p.status IN ('locked','paid')`,
      [req.params.id, req.user._id]
    );
    if (r.rows.length === 0) return res.status(404).json({ success: false, message: 'Payslip not found' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/payroll/team — manager: payroll summary for direct reports.
router.get('/team', authorize('admin', 'manager'), async (req, res) => {
  try {
    const month = Number(req.query.month) || (new Date().getMonth() + 1);
    const year  = Number(req.query.year)  || new Date().getFullYear();
    // Direct reports OR (for admin) all employees
    const filterClause = req.user.role === 'admin'
      ? `WHERE e.status = 'active'`
      : `WHERE e.reporting_manager_id = $1 AND e.status = 'active'`;
    const filterParams = req.user.role === 'admin' ? [] : [req.user._id];

    const team = await pool.query(
      `SELECT e.id AS "_id", e.employee_id AS "employeeId",
              e.first_name AS "firstName", e.last_name AS "lastName",
              e.designation, e.department, e.photo_url AS "photoUrl",
              p.id AS "payslipId", p.status AS "payslipStatus",
              p.net_pay AS "netPay", p.gross_earnings AS "grossEarnings",
              p.lop_days AS "lopDays"
         FROM employees e
         LEFT JOIN payroll_payslips p
           ON p.employee_id = e.id AND p.pay_month = $${filterParams.length+1} AND p.pay_year = $${filterParams.length+2}
         ${filterClause}
         ORDER BY e.first_name ASC`,
      [...filterParams, month, year]
    );

    // Aggregate totals
    const total = team.rows.reduce((acc, r) => ({
      headcount: acc.headcount + 1,
      withSlip:  acc.withSlip + (r.payslipId ? 1 : 0),
      gross:     acc.gross + Number(r.grossEarnings || 0),
      net:       acc.net + Number(r.netPay || 0),
    }), { headcount: 0, withSlip: 0, gross: 0, net: 0 });

    res.json({ success: true, month, year, summary: total, data: team.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ════════════════════════════════════════════════════════════════════════
 *  PHASE 3 — PDF generation + bulk salary upload
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Build a single-page payslip PDF using pdfkit. Streamed to the response,
 * no temp files. Layout: company header, employee block, two-column
 * Earnings/Deductions table, totals, bank footer.
 */
function streamPayslipPdf(res, p) {
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const fileName = `payslip-${p.firstName}-${p.payMonth}-${p.payYear}.pdf`.replace(/\s+/g,'_');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
  doc.pipe(res);

  const ind = (n) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(n)||0);

  // ── Header ─────────────────────────────────────────────────────────────
  const company = process.env.COMPANY_NAME || 'AltiusNxt';
  doc.fontSize(18).fillColor('#1a2040').text(company, { align: 'left' });
  doc.fontSize(9).fillColor('#64748b').text(`HR Department · ${process.env.COMPANY_ADDRESS || 'Saibaba Colony, Coimbatore'}`);
  doc.moveDown(0.5);
  doc.fontSize(14).fillColor('#0f172a').text(`Payslip — ${MONTH_NAMES[p.pay_month]} ${p.pay_year}`, { align: 'right' });
  doc.moveTo(40, doc.y + 4).lineTo(555, doc.y + 4).strokeColor('#cbd5e1').stroke();
  doc.moveDown();

  // ── Employee block ────────────────────────────────────────────────────
  const startY = doc.y;
  doc.fontSize(9).fillColor('#475569');
  const left = (label, value) => {
    doc.font('Helvetica-Bold').text(label, 40, doc.y, { continued: true, width: 120 });
    doc.font('Helvetica').text('  ' + (value || '-'));
  };
  left('Employee Name:',  `${p.firstName || ''} ${p.lastName || ''}`);
  left('Employee ID:',    p.employeeCode);
  left('Designation:',    p.designation);
  left('Department:',     p.department);
  left('PAN:',            p.pan_number || '-');
  left('UAN:',            p.uan_number || '-');
  const empBlockY = doc.y;

  // Right-aligned bank info
  doc.y = startY;
  const rightX = 320;
  doc.font('Helvetica-Bold').text('Bank Name:', rightX, doc.y, { continued: true, width: 100 });
  doc.font('Helvetica').text('  ' + (p.bank_name || '-'));
  doc.font('Helvetica-Bold').text('Account No:', rightX, doc.y, { continued: true, width: 100 });
  doc.font('Helvetica').text('  ' + (p.bank_account || '-'));
  doc.font('Helvetica-Bold').text('IFSC:',       rightX, doc.y, { continued: true, width: 100 });
  doc.font('Helvetica').text('  ' + (p.bank_ifsc || '-'));
  doc.font('Helvetica-Bold').text('Pay Period:', rightX, doc.y, { continued: true, width: 100 });
  doc.font('Helvetica').text('  ' + `${MONTH_NAMES[p.pay_month]} ${p.pay_year}`);
  doc.font('Helvetica-Bold').text('Working Days:', rightX, doc.y, { continued: true, width: 100 });
  doc.font('Helvetica').text('  ' + `${p.present_days} / ${p.working_days}` + (Number(p.lop_days) > 0 ? `  (LOP: ${p.lop_days})` : ''));

  doc.y = Math.max(empBlockY, doc.y) + 16;

  // ── Earnings / Deductions tables ──────────────────────────────────────
  const tableTop = doc.y;
  const colWidth = 250;
  const rowH = 18;

  // Header bars
  doc.rect(40, tableTop, colWidth, 22).fill('#ecfdf5');
  doc.fillColor('#065f46').fontSize(10).font('Helvetica-Bold').text('EARNINGS', 50, tableTop + 6);
  doc.rect(305, tableTop, colWidth, 22).fill('#fef2f2');
  doc.fillColor('#991b1b').text('DEDUCTIONS', 315, tableTop + 6);

  const earnings = [
    ['Basic',             p.basic],
    ['HRA',               p.hra],
    ['Conveyance',        p.conveyance],
    ['Medical',           p.medical],
    ['Special Allowance', p.special_allowance],
    ['Other Allowances',  p.other_allowances],
  ];
  const deductions = [
    ['PF (Employee)',     p.pf_employee],
    ['ESI (Employee)',    p.esi_employee],
    ['Professional Tax',  p.professional_tax],
    ['TDS',               p.tds],
    ['LOP Adjustment',    p.lop_amount],
  ];
  const maxRows = Math.max(earnings.length, deductions.length);
  const bodyTop = tableTop + 24;

  doc.fontSize(10).font('Helvetica');
  for (let i = 0; i < maxRows; i++) {
    const y = bodyTop + i * rowH;
    if (i % 2 === 0) {
      doc.rect(40, y - 2, colWidth * 2 + 15, rowH).fill('#f8fafc');
    }
    // Earnings
    if (earnings[i]) {
      doc.fillColor('#1f2937').text(earnings[i][0], 50, y);
      doc.fillColor('#065f46').text(ind(earnings[i][1]), 50, y, { width: colWidth - 20, align: 'right' });
    }
    // Deductions
    if (deductions[i]) {
      doc.fillColor('#1f2937').text(deductions[i][0], 315, y);
      doc.fillColor('#991b1b').text(ind(deductions[i][1]), 315, y, { width: colWidth - 20, align: 'right' });
    }
  }

  const totalsY = bodyTop + maxRows * rowH + 8;
  doc.moveTo(40, totalsY).lineTo(555, totalsY).strokeColor('#cbd5e1').stroke();
  doc.font('Helvetica-Bold').fontSize(11);
  doc.fillColor('#1f2937').text('Gross Earnings',  50, totalsY + 8);
  doc.fillColor('#065f46').text(ind(p.gross_earnings), 50, totalsY + 8, { width: colWidth - 20, align: 'right' });
  doc.fillColor('#1f2937').text('Total Deductions', 315, totalsY + 8);
  doc.fillColor('#991b1b').text(ind(p.total_deductions), 315, totalsY + 8, { width: colWidth - 20, align: 'right' });

  // ── Net pay highlight ─────────────────────────────────────────────────
  const netY = totalsY + 36;
  doc.rect(40, netY, 515, 36).fill('#eff6ff').strokeColor('#bfdbfe').stroke();
  doc.fillColor('#1e3a8a').fontSize(11).font('Helvetica-Bold').text('NET PAY', 50, netY + 12);
  doc.fontSize(16).text(ind(p.net_pay), 50, netY + 8, { width: 505, align: 'right' });

  // ── Footer ────────────────────────────────────────────────────────────
  doc.y = netY + 60;
  doc.fontSize(8).fillColor('#94a3b8').font('Helvetica').text(
    `This is a system-generated payslip. No signature required. Generated on ${new Date().toLocaleString('en-IN')}.`,
    40, doc.y, { width: 515, align: 'center' }
  );

  doc.end();
}

// GET /api/payroll/admin/payslips/:id/pdf — admin: any employee
router.get('/admin/payslips/:id/pdf', authorize('admin', 'manager'), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT p.*,
              e.employee_id AS "employeeCode", e.first_name AS "firstName", e.last_name AS "lastName",
              e.email, e.department, e.designation,
              e.bank_name, e.bank_account, e.bank_ifsc, e.pan_number, e.uan_number
         FROM payroll_payslips p
         JOIN employees e ON p.employee_id = e.id
        WHERE p.id = $1`, [req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ success: false, message: 'Payslip not found' });
    streamPayslipPdf(res, { ...r.rows[0], payMonth: r.rows[0].pay_month, payYear: r.rows[0].pay_year });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/payroll/my/:id/pdf — employee: own payslip only
router.get('/my/:id/pdf', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT p.*,
              e.employee_id AS "employeeCode", e.first_name AS "firstName", e.last_name AS "lastName",
              e.email, e.department, e.designation,
              e.bank_name, e.bank_account, e.bank_ifsc, e.pan_number, e.uan_number
         FROM payroll_payslips p
         JOIN employees e ON p.employee_id = e.id
        WHERE p.id = $1 AND p.employee_id = $2 AND p.status IN ('locked','paid')`,
      [req.params.id, req.user._id]
    );
    if (r.rows.length === 0) return res.status(404).json({ success: false, message: 'Payslip not found' });
    streamPayslipPdf(res, { ...r.rows[0], payMonth: r.rows[0].pay_month, payYear: r.rows[0].pay_year });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/payroll/admin/structure-template — download an XLSX scaffold.
const multer = require('multer');
const xlsx = require('xlsx');
const bulkUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.get('/admin/structure-template', authorize('admin'), (req, res) => {
  const wb = xlsx.utils.book_new();
  const data = [{
    'Employee ID':       'ANXT2600149',
    'Basic':             30000,
    'HRA':               15000,
    'Conveyance':        1600,
    'Medical':           1250,
    'Special Allowance': 12150,
    'Other Allowances':  0,
    'PF Employee':       1800,
    'ESI Employee':      0,
    'Professional Tax':  208,
    'PF Employer':       1800,
    'PF Applicable':     'TRUE',
    'ESI Applicable':    'FALSE',
    'Notes':             'Example row — replace with real employees.',
  }];
  const ws = xlsx.utils.json_to_sheet(data);
  xlsx.utils.book_append_sheet(wb, ws, 'Salary Structures');
  const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="salary_structure_template.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// POST /api/payroll/admin/bulk-upload — upload xlsx of salary structures.
// Each row creates a new versioned row (closes any existing open one)
// using the same upsert flow as the single-employee editor.
router.post('/admin/bulk-upload',
  authorize('admin'),
  logAuditWrapper('BULK_UPLOAD', 'salary_structure'),
  bulkUpload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
      const wb = xlsx.read(req.file.buffer, { type: 'buffer' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = xlsx.utils.sheet_to_json(sheet);

      const results = { processed: 0, succeeded: 0, failed: [], notFound: [] };
      const client = await pool.connect();
      try {
        for (const row of rows) {
          results.processed++;
          const empCode = String(row['Employee ID'] || '').trim();
          if (!empCode) { results.failed.push({ row: results.processed, reason: 'Missing Employee ID' }); continue; }
          const emp = await client.query(
            `SELECT id FROM employees WHERE employee_id = $1 AND status='active'`, [empCode]
          );
          if (emp.rows.length === 0) { results.notFound.push(empCode); continue; }
          try {
            await client.query('BEGIN');
            await client.query(
              `UPDATE salary_structures SET effective_to=CURRENT_DATE
                WHERE employee_id=$1 AND effective_to IS NULL`,
              [emp.rows[0].id]
            );
            await client.query(
              `INSERT INTO salary_structures
                 (employee_id, effective_from,
                  basic, hra, conveyance, medical, special_allowance, other_allowances,
                  pf_employee, esi_employee, professional_tax, pf_employer,
                  pf_applicable, esi_applicable, notes, created_by)
               VALUES ($1, CURRENT_DATE,
                       $2,$3,$4,$5,$6,$7, $8,$9,$10,$11,
                       $12,$13,$14,$15)`,
              [emp.rows[0].id,
               num(row['Basic']), num(row['HRA']), num(row['Conveyance']),
               num(row['Medical']), num(row['Special Allowance']), num(row['Other Allowances']),
               num(row['PF Employee']), num(row['ESI Employee']), num(row['Professional Tax']), num(row['PF Employer']),
               String(row['PF Applicable']).toUpperCase() !== 'FALSE',
               String(row['ESI Applicable']).toUpperCase() === 'TRUE',
               row['Notes'] || null, req.user._id]
            );
            await client.query('COMMIT');
            results.succeeded++;
          } catch (e) {
            await client.query('ROLLBACK');
            results.failed.push({ row: results.processed, employeeId: empCode, reason: e.message });
          }
        }
      } finally {
        client.release();
      }
      res.json({ success: true, results });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

/* ════════════════════════════════════════════════════════════════════════
 *  PHASE 4 — Tax declarations
 * ══════════════════════════════════════════════════════════════════════ */

// Computes the current Indian financial year string (Apr–Mar).
function currentFY() {
  const d = new Date();
  const y = d.getFullYear();
  const fy = d.getMonth() >= 3 ? y : y - 1;
  return `${fy}-${String((fy + 1) % 100).padStart(2, '0')}`;
}

// GET /api/payroll/declarations/my — employee's own current-FY declaration.
router.get('/declarations/my', async (req, res) => {
  try {
    const fy = req.query.fy || currentFY();
    const r = await pool.query(
      `SELECT id, financial_year AS "financialYear", regime,
              hra_annual_rent AS "hraAnnualRent",
              section_80c AS "section80c", section_80d AS "section80d",
              section_80e AS "section80e",
              home_loan_interest AS "homeLoanInterest",
              other_deductions   AS "otherDeductions",
              status, rejection_reason AS "rejectionReason",
              created_at AS "createdAt", updated_at AS "updatedAt"
         FROM payroll_tax_declarations
        WHERE employee_id = $1 AND financial_year = $2`,
      [req.user._id, fy]
    );
    res.json({ success: true, data: r.rows[0] || null, financialYear: fy });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST /api/payroll/declarations — employee submits / updates own.
router.post('/declarations', logAuditWrapper('SUBMIT', 'tax_declaration'), async (req, res) => {
  try {
    const fy = req.body.financialYear || currentFY();
    const b = req.body || {};
    // Upsert: if already exists for this FY, update it (only if not yet approved).
    const existing = await pool.query(
      `SELECT id, status FROM payroll_tax_declarations
        WHERE employee_id = $1 AND financial_year = $2`,
      [req.user._id, fy]
    );
    if (existing.rows[0] && existing.rows[0].status === 'approved') {
      return res.status(400).json({ success: false, message: 'Declaration already approved — contact HR for revisions' });
    }

    if (existing.rows[0]) {
      const r = await pool.query(
        `UPDATE payroll_tax_declarations
            SET regime=$1, hra_annual_rent=$2, section_80c=$3, section_80d=$4,
                section_80e=$5, home_loan_interest=$6, other_deductions=$7,
                status='submitted', rejection_reason=NULL, updated_at=NOW()
          WHERE id=$8 RETURNING id`,
        [b.regime || 'new', num(b.hraAnnualRent), num(b.section80c), num(b.section80d),
         num(b.section80e), num(b.homeLoanInterest), num(b.otherDeductions),
         existing.rows[0].id]
      );
      return res.json({ success: true, id: r.rows[0].id });
    }
    const r = await pool.query(
      `INSERT INTO payroll_tax_declarations
         (employee_id, financial_year, regime,
          hra_annual_rent, section_80c, section_80d, section_80e,
          home_loan_interest, other_deductions)
       VALUES ($1,$2,$3, $4,$5,$6,$7, $8,$9) RETURNING id`,
      [req.user._id, fy, b.regime || 'new',
       num(b.hraAnnualRent), num(b.section80c), num(b.section80d), num(b.section80e),
       num(b.homeLoanInterest), num(b.otherDeductions)]
    );
    res.status(201).json({ success: true, id: r.rows[0].id });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET /api/payroll/admin/declarations?status=submitted — admin: review queue
router.get('/admin/declarations', authorize('admin'), async (req, res) => {
  try {
    const status = req.query.status || 'submitted';
    const fy = req.query.fy || currentFY();
    const r = await pool.query(
      `SELECT d.id, d.financial_year AS "financialYear", d.regime,
              d.hra_annual_rent AS "hraAnnualRent",
              d.section_80c AS "section80c", d.section_80d AS "section80d",
              d.section_80e AS "section80e",
              d.home_loan_interest AS "homeLoanInterest",
              d.other_deductions   AS "otherDeductions",
              d.status, d.rejection_reason AS "rejectionReason",
              d.created_at AS "createdAt", d.updated_at AS "updatedAt",
              e.id AS "employeeId", e.employee_id AS "employeeCode",
              e.first_name AS "firstName", e.last_name AS "lastName",
              e.department, e.designation
         FROM payroll_tax_declarations d
         JOIN employees e ON d.employee_id = e.id
        WHERE d.status = $1 AND d.financial_year = $2
        ORDER BY d.updated_at DESC`,
      [status, fy]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// PUT /api/payroll/admin/declarations/:id/action — approve / reject
router.put('/admin/declarations/:id/action', authorize('admin'),
  logAuditWrapper('ACTION', 'tax_declaration'),
  async (req, res) => {
    try {
      const action = req.body.action === 'approve' ? 'approved' : 'rejected';
      const reason = req.body.reason || null;
      const r = await pool.query(
        `UPDATE payroll_tax_declarations
            SET status=$1, rejection_reason=$2,
                reviewed_by=$3, reviewed_at=NOW(), updated_at=NOW()
          WHERE id=$4 AND status='submitted' RETURNING id`,
        [action, action === 'rejected' ? reason : null, req.user._id, req.params.id]
      );
      if (r.rows.length === 0) return res.status(400).json({ success: false, message: 'Only submitted declarations can be actioned' });
      res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  }
);

/* ════════════════════════════════════════════════════════════════════════
 *  PHASE 5 — Compliance reports (CSV exports)
 *  Simple register-style downloads admins can hand to their CA / file
 *  with PF/ESI portals. All four share the same shape: filter by month/
 *  year, join employees, dump as CSV.
 * ══════════════════════════════════════════════════════════════════════ */

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes('"') || s.includes(',') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function sendCsv(res, filename, header, rows) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.write(header.join(',') + '\n');
  for (const r of rows) res.write(r.map(csvEscape).join(',') + '\n');
  res.end();
}

router.get('/admin/reports/:type', authorize('admin'), async (req, res) => {
  try {
    const type = req.params.type;                // pf | esi | tds | pt
    const month = Number(req.query.month) || (new Date().getMonth() + 1);
    const year  = Number(req.query.year)  || new Date().getFullYear();
    const r = await pool.query(
      `SELECT e.employee_id AS code, e.first_name, e.last_name, e.uan_number, e.pan_number,
              p.pf_employee, p.esi_employee, p.professional_tax, p.tds,
              p.gross_earnings, p.basic, p.hra, p.net_pay
         FROM payroll_payslips p
         JOIN employees e ON p.employee_id = e.id
        WHERE p.pay_month = $1 AND p.pay_year = $2 AND p.status IN ('locked','paid')
        ORDER BY e.first_name ASC`,
      [month, year]
    );
    const period = `${String(month).padStart(2,'0')}-${year}`;

    if (type === 'pf') {
      return sendCsv(res, `pf-return-${period}.csv`,
        ['UAN','Employee ID','Name','Basic','PF Employee','Gross'],
        r.rows.filter(x => Number(x.pf_employee) > 0).map(x =>
          [x.uan_number, x.code, `${x.first_name} ${x.last_name}`, x.basic, x.pf_employee, x.gross_earnings]));
    }
    if (type === 'esi') {
      return sendCsv(res, `esi-return-${period}.csv`,
        ['Employee ID','Name','Gross','ESI Employee'],
        r.rows.filter(x => Number(x.esi_employee) > 0).map(x =>
          [x.code, `${x.first_name} ${x.last_name}`, x.gross_earnings, x.esi_employee]));
    }
    if (type === 'tds') {
      return sendCsv(res, `tds-register-${period}.csv`,
        ['PAN','Employee ID','Name','Gross','TDS'],
        r.rows.map(x =>
          [x.pan_number, x.code, `${x.first_name} ${x.last_name}`, x.gross_earnings, x.tds]));
    }
    if (type === 'pt') {
      return sendCsv(res, `pt-register-${period}.csv`,
        ['Employee ID','Name','Gross','Professional Tax'],
        r.rows.filter(x => Number(x.professional_tax) > 0).map(x =>
          [x.code, `${x.first_name} ${x.last_name}`, x.gross_earnings, x.professional_tax]));
    }
    res.status(400).json({ success: false, message: 'type must be pf | esi | tds | pt' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
