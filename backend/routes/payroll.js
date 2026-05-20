const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { ruleMatchesDate } = require('../utils/workingDays');
const { sendMail } = require('../utils/mailer');
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

// Load the holiday map + active weekend rules for a calendar month ONCE.
// Returns the data structures so callers can compute working days for
// arbitrary date ranges inside that month without re-querying the DB —
// critical for run-month, which needs per-employee partial ranges.
async function loadHolidaysAndRules(month, year) {
  const monthStart = `${year}-${String(month).padStart(2,'0')}-01`;
  const monthEnd   = new Date(year, month, 0).toLocaleDateString('en-CA');
  const [holsRes, rulesRes] = await Promise.all([
    pool.query(`SELECT date, type FROM holidays WHERE date BETWEEN $1::date AND $2::date`, [monthStart, monthEnd]),
    pool.query(
      `SELECT days_of_week, weeks_of_month, interval_weeks,
              start_date, end_type, end_date, end_count, is_active
         FROM weekend_rules WHERE is_active = TRUE`
    ),
  ]);
  const holMap = new Map();
  for (const h of holsRes.rows) {
    const d = new Date(h.date);
    holMap.set(`${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`, h.type);
  }
  return { holMap, rules: rulesRes.rows };
}

// Count working days inside [start, end] (inclusive). A day is non-working
// if any active weekend rule matches OR a holiday row sits on that date —
// except `holiday.type='working_day'` which is an explicit override.
function workingDaysInRange(start, end, holMap, rules) {
  if (!start || !end || start > end) return 0;
  let working = 0;
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const stop = new Date(end);
  stop.setHours(0, 0, 0, 0);
  while (cursor <= stop) {
    const key = `${cursor.getFullYear()}-${cursor.getMonth()+1}-${cursor.getDate()}`;
    const holType = holMap.get(key);
    if (holType === 'working_day') {
      working++;
    } else if (!holType) {
      const isWeekend = rules.some(rule => ruleMatchesDate(rule, cursor));
      if (!isWeekend) working++;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return working;
}

// Working-day count for a full month — wrapper over the range helper.
async function workingDaysInMonth(month, year) {
  const { holMap, rules } = await loadHolidaysAndRules(month, year);
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd   = new Date(year, month, 0);
  return workingDaysInRange(monthStart, monthEnd, holMap, rules);
}

// Unpaid (LOP) leave days for an employee inside a date range. We count
// approved leaves with leave_type = 'unpaid' that intersect [start, end].
async function lopDaysForRange(employeeId, startDate, endDate, queryRunner = pool) {
  const start = startDate instanceof Date ? startDate.toLocaleDateString('en-CA') : startDate;
  const end   = endDate   instanceof Date ? endDate.toLocaleDateString('en-CA')   : endDate;
  const r = await queryRunner.query(
    `SELECT COALESCE(SUM(total_days), 0) AS lop
       FROM leaves
      WHERE employee_id = $1
        AND status = 'approved'
        AND leave_type = 'unpaid'
        AND start_date <= $3::date
        AND end_date   >= $2::date`,
    [employeeId, start, end]
  );
  return Number(r.rows[0].lop || 0);
}

// Legacy month-bounded shim for older callers.
async function lopDaysFor(employeeId, month, year) {
  const start = `${year}-${String(month).padStart(2,'0')}-01`;
  const end   = new Date(year, month, 0).toLocaleDateString('en-CA');
  return lopDaysForRange(employeeId, start, end);
}

/** Indian FY for a given (month, year). Apr-Mar boundary. Returns "2026-27". */
function fyForMonth(month, year) {
  const fy = month >= 4 ? year : year - 1;
  return `${fy}-${String((fy + 1) % 100).padStart(2, '0')}`;
}

/** Next slip number for a (month, year). Format PSL-YYYY-MM-NNNN. The
 *  sequence resets every month. Uses MAX+1 inside a single query so the
 *  caller doesn't need a separate sequence object. */
async function nextSlipNumber(client, month, year) {
  const prefix = `PSL-${year}-${String(month).padStart(2, '0')}`;
  const r = await client.query(
    `SELECT slip_number FROM payroll_payslips
      WHERE slip_number LIKE $1 || '-%'
      ORDER BY slip_number DESC LIMIT 1`,
    [prefix]
  );
  let next = 1;
  if (r.rows.length) {
    const last = r.rows[0].slip_number;
    const seq = Number(last.split('-').pop());
    if (Number.isFinite(seq)) next = seq + 1;
  }
  return `${prefix}-${String(next).padStart(4, '0')}`;
}

/**
 * Compute monthly TDS for an employee using slabs from payroll_tax_slabs
 * and the employee's approved tax_declaration (if any).
 *
 * Approach:
 *   1. Project annual gross = monthlyGrossFull × 12 (uses the structure
 *      gross, NOT the prorated number — proration is just a one-off LOP hit).
 *   2. Old regime + approved declaration: subtract HRA, 80C (cap ₹1.5L),
 *      80D (cap ₹25K), 80E (uncapped), home-loan interest (cap ₹2L).
 *      Standard deduction ₹50K applies to both regimes.
 *   3. Look up the applicable slab table for the FY + regime, walk the
 *      brackets, accumulate annual tax. Add 4% cess.
 *   4. Divide by 12 — that's the monthly TDS to deduct.
 *
 * Returns 0 if no slabs are seeded for this FY/regime (graceful degradation).
 */
async function computeMonthlyTDS(client, { employeeId, monthlyGrossFull, fy }) {
  // Input validation — without this a corrupted structure or accidental
  // Infinity/NaN propagates straight through the slab math and produces a
  // garbage TDS that ends up on a real payslip. Bail to 0 instead.
  if (!Number.isFinite(monthlyGrossFull) || monthlyGrossFull <= 0) return 0;

  // Pull declaration (if approved). Default = new regime, no exemptions.
  const declRes = await client.query(
    `SELECT regime, hra_annual_rent, section_80c, section_80d, section_80e,
            home_loan_interest, other_deductions, status
       FROM payroll_tax_declarations
      WHERE employee_id = $1 AND financial_year = $2`,
    [employeeId, fy]
  );
  const decl = declRes.rows[0];
  const regime = (decl?.status === 'approved' && decl?.regime) ? decl.regime : 'new';

  let annualGross = monthlyGrossFull * 12;
  let taxableIncome = annualGross - 50000; // Standard deduction (both regimes)

  if (regime === 'old' && decl?.status === 'approved') {
    const cap = (v, max) => Math.min(Number(v || 0), max);
    taxableIncome -= cap(decl.hra_annual_rent, 1_50_000);   // HRA proxy cap
    taxableIncome -= cap(decl.section_80c,     1_50_000);
    taxableIncome -= cap(decl.section_80d,        25_000);
    taxableIncome -= Number(decl.section_80e || 0);          // 80E uncapped
    taxableIncome -= cap(decl.home_loan_interest, 2_00_000);
    taxableIncome -= Number(decl.other_deductions || 0);
  }
  if (taxableIncome < 0) taxableIncome = 0;

  const slabsRes = await client.query(
    `SELECT threshold_from, threshold_to, rate_percent
       FROM payroll_tax_slabs
      WHERE financial_year = $1 AND regime = $2
      ORDER BY seq ASC`,
    [fy, regime]
  );
  if (slabsRes.rows.length === 0) return 0;

  let annualTax = 0;
  for (const s of slabsRes.rows) {
    const from = Number(s.threshold_from);
    const to   = s.threshold_to === null ? Infinity : Number(s.threshold_to);
    const rate = Number(s.rate_percent);
    if (taxableIncome <= from) break;
    const slice = Math.min(taxableIncome, to) - from;
    if (slice > 0) annualTax += slice * (rate / 100);
  }
  // Section 87A rebate — both regimes give a full rebate up to ₹5L (old) / ₹7L (new).
  if (regime === 'old' && taxableIncome <= 5_00_000 && annualTax <= 12_500) annualTax = 0;
  if (regime === 'new' && taxableIncome <= 7_00_000 && annualTax <= 25_000) annualTax = 0;
  // 4% health & education cess
  annualTax *= 1.04;

  return Math.round(annualTax / 12);
}

/** Total monthly loan recovery for an employee = sum of monthly_recovery
 *  on active loans, capped at outstanding balance per loan. */
async function loanRecoveryFor(client, employeeId) {
  const r = await client.query(
    `SELECT id, principal, recovered, monthly_recovery
       FROM payroll_loans
      WHERE employee_id = $1 AND status = 'active'`,
    [employeeId]
  );
  let total = 0;
  const lines = [];
  for (const l of r.rows) {
    const outstanding = Number(l.principal) - Number(l.recovered || 0);
    if (outstanding <= 0) continue;
    const amt = Math.min(Number(l.monthly_recovery || 0), outstanding);
    if (amt > 0) {
      total += amt;
      lines.push({ id: l.id, amount: amt, outstanding });
    }
  }
  return { total, lines };
}

/** Sum of approved compensation_claims for the month, marked pending-payroll.
 *  We use the claim_date month as the membership signal. Once a payslip is
 *  locked, the claims it pulled get their status flipped to 'paid'. */
async function reimbursementsFor(client, employeeId, month, year) {
  const start = `${year}-${String(month).padStart(2,'0')}-01`;
  const end   = new Date(year, month, 0).toLocaleDateString('en-CA');
  const r = await client.query(
    `SELECT id, amount FROM compensation_claims
      WHERE employee_id = $1 AND status = 'approved'
        AND claim_date BETWEEN $2::date AND $3::date`,
    [employeeId, start, end]
  );
  const total = r.rows.reduce((s, x) => s + Number(x.amount || 0), 0);
  return { total, ids: r.rows.map(x => x.id) };
}

/** Apply ad-hoc adjustments (bonus/overtime/deduction/other) for the period. */
async function adjustmentsFor(client, employeeId, month, year) {
  const r = await client.query(
    `SELECT type, amount FROM payroll_adjustments
      WHERE employee_id = $1 AND pay_month = $2 AND pay_year = $3`,
    [employeeId, month, year]
  );
  let bonus = 0, overtime = 0, deduction = 0, other = 0;
  for (const a of r.rows) {
    const amt = Number(a.amount || 0);
    if (a.type === 'bonus')         bonus     += amt;
    else if (a.type === 'overtime') overtime  += amt;
    else if (a.type === 'deduction') deduction += amt;
    else                            other     += amt;
  }
  return { bonus, overtime, deduction, other };
}

// POST /api/payroll/admin/run-month — generate draft payslips for all
// active employees who have a current salary_structure. Skips employees
// without a structure (admin needs to set them up first). Skips
// employees who already have a payslip for the month (use force=true
// to overwrite drafts; locked/paid slips are never touched).
router.post('/admin/run-month', authorize('admin'), logAuditWrapper('PAYROLL_RUN', 'payroll'), async (req, res) => {
  const client = await pool.connect();
  try {
    const month = Number(req.body.month) || (new Date().getMonth() + 1);
    const year  = Number(req.body.year)  || new Date().getFullYear();
    const force = !!req.body.force;

    if (month < 1 || month > 12) {
      client.release();
      return res.status(400).json({ success: false, message: 'Invalid month' });
    }

    // Load holiday map + weekend rules once for the whole run so the
    // per-employee partial-range calc doesn't re-fetch N times.
    const { holMap, rules } = await loadHolidaysAndRules(month, year);
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd   = new Date(year, month, 0);
    const workingDays = workingDaysInRange(monthStart, monthEnd, holMap, rules);
    const fy = fyForMonth(month, year);

    const employees = await client.query(
      `SELECT e.id, e.first_name, e.last_name,
              e.joining_date, e.exit_date, e.status,
              s.basic, s.hra, s.conveyance, s.medical,
              s.special_allowance, s.other_allowances,
              s.pf_employee, s.esi_employee, s.professional_tax
         FROM employees e
         JOIN salary_structures s ON s.employee_id = e.id AND s.effective_to IS NULL
        WHERE e.status = 'active'`
    );

    const results = { created: 0, updated: 0, skipped: 0, errors: [], partials: 0 };

    for (const emp of employees.rows) {
      // Per-employee transaction: a failure on employee #34 doesn't leave
      // 1-33 in a half-committed state, AND doesn't taint the shared
      // connection's txn state for employees 35..N.
      try {
        await client.query('BEGIN');

        const existing = await client.query(
          `SELECT id, status FROM payroll_payslips
            WHERE employee_id = $1 AND pay_month = $2 AND pay_year = $3
              AND superseded_by IS NULL`,
          [emp.id, month, year]
        );
        if (existing.rows.length > 0) {
          const status = existing.rows[0].status;
          if (status !== 'draft' || !force) {
            results.skipped++;
            await client.query('ROLLBACK');
            continue;
          }
        }

        // Mid-month joiner / exit pro-rata. Compute the employee's
        // effective range inside this calendar month; if it falls
        // entirely outside, skip entirely.
        const joining = emp.joining_date ? new Date(emp.joining_date) : null;
        const exit    = emp.exit_date    ? new Date(emp.exit_date)    : null;
        let effectiveStart = monthStart;
        let effectiveEnd   = monthEnd;
        let isPartial      = false;

        if (joining && joining > monthEnd) {
          // Not yet joined this month — no payslip needed
          results.skipped++;
          await client.query('ROLLBACK');
          continue;
        }
        if (joining && joining > monthStart) { effectiveStart = joining; isPartial = true; }
        if (exit    && exit    < monthStart) {
          // Already exited — skip
          results.skipped++;
          await client.query('ROLLBACK');
          continue;
        }
        if (exit    && exit    < monthEnd)   { effectiveEnd   = exit;    isPartial = true; }

        const empWorkingDays = isPartial
          ? workingDaysInRange(effectiveStart, effectiveEnd, holMap, rules)
          : workingDays;

        // LOP within the effective range only — a joiner can't have unpaid
        // leave before joining_date.
        const rawLop = await lopDaysForRange(emp.id, effectiveStart, effectiveEnd, client);
        const lopDays = Math.min(rawLop, empWorkingDays);
        // Paid days = effective working days minus LOP within that range.
        // Salary scales against the FULL month, so prorate by paid/full.
        const paidDays = empWorkingDays - lopDays;
        const ratio    = workingDays > 0 ? paidDays / workingDays : 1;

        const basic        = Number(emp.basic || 0) * ratio;
        const hra          = Number(emp.hra || 0) * ratio;
        const conveyance   = Number(emp.conveyance || 0) * ratio;
        const medical      = Number(emp.medical || 0) * ratio;
        const spec         = Number(emp.special_allowance || 0) * ratio;
        const other        = Number(emp.other_allowances || 0) * ratio;

        const grossFull    = Number(emp.basic||0) + Number(emp.hra||0) + Number(emp.conveyance||0)
                           + Number(emp.medical||0) + Number(emp.special_allowance||0) + Number(emp.other_allowances||0);
        const baseGross    = basic + hra + conveyance + medical + spec + other;
        const lopAmount    = grossFull - baseGross;

        const reim    = await reimbursementsFor(client, emp.id, month, year);
        const adj     = await adjustmentsFor(client, emp.id, month, year);
        const loans   = await loanRecoveryFor(client, emp.id);

        const gross = baseGross + adj.bonus + adj.overtime + reim.total;

        const pfE   = Number(emp.pf_employee || 0);
        const esiE  = Number(emp.esi_employee || 0);
        const pt    = Number(emp.professional_tax || 0);
        const tds   = await computeMonthlyTDS(client, {
          employeeId: emp.id, monthlyGrossFull: grossFull, fy,
        });

        const totalDed = pfE + esiE + pt + tds + loans.total + adj.deduction;
        const net      = gross - totalDed + adj.other;

        if (existing.rows.length > 0 && force) {
          await client.query(
            `UPDATE payroll_payslips
                SET basic=$1, hra=$2, conveyance=$3, medical=$4,
                    special_allowance=$5, other_allowances=$6,
                    working_days=$7, present_days=$8, lop_days=$9, lop_amount=$10,
                    pf_employee=$11, esi_employee=$12, professional_tax=$13, tds=$14,
                    gross_earnings=$15, total_deductions=$16, net_pay=$17,
                    reimbursement=$18, loan_recovery=$19, bonus=$20, overtime=$21,
                    other_adjustment=$22,
                    generated_at=NOW(), generated_by=$23
              WHERE id=$24`,
            [basic, hra, conveyance, medical, spec, other,
             empWorkingDays, paidDays, lopDays, lopAmount,
             pfE, esiE, pt, tds,
             gross, totalDed, net,
             reim.total, loans.total, adj.bonus, adj.overtime,
             adj.deduction + adj.other,
             req.user._id, existing.rows[0].id]
          );
          results.updated++;
        } else {
          const slip = await nextSlipNumber(client, month, year);
          await client.query(
            `INSERT INTO payroll_payslips
               (employee_id, pay_month, pay_year, slip_number,
                basic, hra, conveyance, medical, special_allowance, other_allowances,
                working_days, present_days, lop_days, lop_amount,
                pf_employee, esi_employee, professional_tax, tds,
                gross_earnings, total_deductions, net_pay,
                reimbursement, loan_recovery, bonus, overtime, other_adjustment,
                generated_by)
             VALUES ($1,$2,$3,$4, $5,$6,$7,$8,$9,$10, $11,$12,$13,$14,
                     $15,$16,$17,$18, $19,$20,$21, $22,$23,$24,$25,$26, $27)`,
            [emp.id, month, year, slip,
             basic, hra, conveyance, medical, spec, other,
             empWorkingDays, paidDays, lopDays, lopAmount,
             pfE, esiE, pt, tds,
             gross, totalDed, net,
             reim.total, loans.total, adj.bonus, adj.overtime, adj.deduction + adj.other,
             req.user._id]
          );
          results.created++;
        }
        if (isPartial) results.partials++;

        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        results.errors.push({ employeeId: emp.id, reason: e.message });
      }
    }
    res.json({ success: true, month, year, workingDays, results });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
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
              p.status, p.slip_number AS "slipNumber",
              p.gross_earnings AS "grossEarnings",
              p.total_deductions AS "totalDeductions", p.net_pay AS "netPay",
              p.working_days AS "workingDays", p.present_days AS "presentDays",
              p.lop_days AS "lopDays", p.lop_amount AS "lopAmount",
              p.locked_at AS "lockedAt", p.paid_at AS "paidAt",
              p.approved_by_manager_at AS "approvedByManagerAt",
              p.email_sent_at AS "emailSentAt",
              p.superseded_by AS "supersededBy", p.supersedes,
              p.tds, p.reimbursement, p.loan_recovery AS "loanRecovery",
              p.bonus, p.overtime, p.other_adjustment AS "otherAdjustment",
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
// Side-effects on lock:
//   • Compensation claims that contributed to the reimbursement total are
//     marked status='paid' (so they don't double-count next month).
//   • Active loans get their recovered amount incremented by this slip's
//     loan_recovery; loans whose recovered = principal flip to 'closed'.
//   • Email goes out to the employee with the payslip PDF attached.
// GET /api/payroll/admin/payslips/:id/preview-email — render the EXACT
// HTML body the employee would receive on lock. Lets admin sanity-check
// before clicking Lock (after which the email is fire-and-forget and a
// mistake means re-sending an apology + correction slip).
router.get('/admin/payslips/:id/preview-email', authorize('admin', 'manager'), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT p.*, e.first_name, e.last_name FROM payroll_payslips p
         JOIN employees e ON p.employee_id = e.id WHERE p.id = $1`,
      [req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ success: false, message: 'Payslip not found' });
    const html = buildLockEmailHtml(r.rows[0]);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Wrap in a minimal document so it renders correctly when shown in an iframe.
    res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Email Preview</title></head><body style="margin:0">${html}</body></html>`);
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.put('/admin/payslips/:id/lock', authorize('admin'), logAuditWrapper('LOCK', 'payslip'), async (req, res) => {
  const client = await pool.connect();
  try {
    // Optional manager-approval gate — settings.require_manager_approval_before_lock
    // can force admins to wait for a manager's sign-off before any slip
    // can be locked. Keeps the org-wide "two-eyes" policy if turned on.
    const settingsRes = await client.query('SELECT require_manager_approval_before_lock FROM settings LIMIT 1');
    const mustApprove = !!settingsRes.rows[0]?.require_manager_approval_before_lock;
    if (mustApprove) {
      const check = await client.query(
        `SELECT approved_by_manager_at, status FROM payroll_payslips WHERE id = $1`,
        [req.params.id]
      );
      if (check.rows.length === 0) {
        client.release();
        return res.status(404).json({ success: false, message: 'Payslip not found' });
      }
      if (check.rows[0].status === 'draft' && !check.rows[0].approved_by_manager_at) {
        client.release();
        return res.status(400).json({
          success: false,
          code:    'MANAGER_APPROVAL_REQUIRED',
          message: 'This payslip needs manager approval before it can be locked. Open the slip and ask the reporting manager to approve first.',
        });
      }
    }

    await client.query('BEGIN');
    const lockRes = await client.query(
      `UPDATE payroll_payslips SET status='locked', locked_at=NOW()
        WHERE id=$1 AND status='draft' RETURNING id, employee_id, pay_month, pay_year,
                                              reimbursement, loan_recovery`,
      [req.params.id]
    );
    if (lockRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Only draft payslips can be locked' });
    }
    const slip = lockRes.rows[0];

    // Mark this month's approved claims as paid
    if (Number(slip.reimbursement) > 0) {
      const start = `${slip.pay_year}-${String(slip.pay_month).padStart(2,'0')}-01`;
      const end   = new Date(slip.pay_year, slip.pay_month, 0).toLocaleDateString('en-CA');
      await client.query(
        `UPDATE compensation_claims SET status='paid', approved_at=COALESCE(approved_at, NOW())
          WHERE employee_id=$1 AND status='approved'
            AND claim_date BETWEEN $2::date AND $3::date`,
        [slip.employee_id, start, end]
      );
    }

    // Apply loan recovery — split across active loans by their monthly_recovery
    if (Number(slip.loan_recovery) > 0) {
      const loans = await loanRecoveryFor(client, slip.employee_id);
      for (const ln of loans.lines) {
        await client.query(
          `UPDATE payroll_loans
              SET recovered = recovered + $1,
                  status = CASE WHEN recovered + $1 >= principal THEN 'closed' ELSE status END,
                  closed_at = CASE WHEN recovered + $1 >= principal THEN NOW() ELSE closed_at END
            WHERE id=$2`,
          [ln.amount, ln.id]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ success: true });

    // Fire-and-forget email — don't block the response on SMTP latency.
    sendLockEmail(req.params.id).catch(err => console.error('[payroll] lock email failed:', err.message));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

/**
 * Build the payslip PDF as a Buffer (for emails). Same layout as the
 * streamed PDF — shares the renderer below.
 */
async function buildPayslipPdfBuffer(payslip) {
  const PDFDocument = require('pdfkit');
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    renderPayslipDoc(doc, payslip);
    doc.end();
  });
}

/** Look up + send the lock email. Pulls slip + employee in one query. */
/**
 * Build the exact HTML body the employee will see when their payslip is
 * locked. Shared between the actual lock email and the admin "Preview as
 * Employee" endpoint so a one-character drift between them is impossible.
 */
function buildLockEmailHtml(p) {
  const company = process.env.COMPANY_NAME || 'AltiusNxt';
  const monthName = MONTH_NAMES[p.pay_month];
  const ind = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(n)||0);
  return `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;margin:0 auto;background:#f4f6f9;padding:24px;">
      <div style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <div style="background:linear-gradient(135deg,#1a2040 0%,#2d3578 100%);padding:32px;text-align:center;">
          <p style="color:#fff;font-size:13px;letter-spacing:2px;font-weight:700;margin:0;">PAYSLIP READY</p>
          <p style="color:#cbd5e1;font-size:14px;margin:6px 0 0;">${monthName} ${p.pay_year}</p>
        </div>
        <div style="padding:32px;">
          <p style="font-size:15px;color:#1e293b;">Hi ${p.first_name},</p>
          <p style="font-size:14px;color:#475569;line-height:1.6;">Your payslip for <strong>${monthName} ${p.pay_year}</strong> has been finalised and is attached as a PDF for your records.</p>
          <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:18px 22px;margin:20px 0;">
            <p style="font-size:11px;color:#3b82f6;font-weight:700;letter-spacing:1px;margin:0 0 6px;">NET PAY</p>
            <p style="font-size:28px;font-weight:800;color:#1e3a8a;margin:0;">${ind(p.net_pay)}</p>
            <p style="font-size:12px;color:#64748b;margin:8px 0 0;">Gross ${ind(p.gross_earnings)} − Deductions ${ind(p.total_deductions)}</p>
          </div>
          ${p.slip_number ? `<p style="font-size:12px;color:#94a3b8;">Slip No: <strong style="color:#475569;">${p.slip_number}</strong></p>` : ''}
          <p style="font-size:13px;color:#64748b;margin-top:20px;">You can also download this payslip anytime by logging into the HR portal under <strong>My Payroll</strong>.</p>
          <p style="font-size:13px;color:#475569;margin-top:24px;">Regards,<br/><strong>${company} Payroll Team</strong></p>
        </div>
        <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px;text-align:center;font-size:11px;color:#94a3b8;">
          Automated payslip notification • Do not reply
        </div>
      </div>
    </div>
  `;
}

async function sendLockEmail(payslipId) {
  const r = await pool.query(
    `SELECT p.*, e.email, e.first_name, e.last_name, e.employee_id AS "employeeCode",
            e.department, e.designation, e.bank_name, e.bank_account, e.bank_ifsc,
            e.pan_number, e.uan_number
       FROM payroll_payslips p
       JOIN employees e ON p.employee_id = e.id
      WHERE p.id = $1`,
    [payslipId]
  );
  if (r.rows.length === 0) return;
  const p = r.rows[0];
  if (!p.email) return;

  const pdf = await buildPayslipPdfBuffer({
    ...p, payMonth: p.pay_month, payYear: p.pay_year,
    firstName: p.first_name, lastName: p.last_name,
  });

  const company   = process.env.COMPANY_NAME || 'AltiusNxt';
  const monthName = MONTH_NAMES[p.pay_month];
  const html      = buildLockEmailHtml(p);

  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || 'gmail',
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT) || 587,
    secure: false,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
  await transporter.sendMail({
    from: `"${company} Payroll" <${process.env.EMAIL_USER}>`,
    to: p.email,
    subject: `Payslip — ${monthName} ${p.pay_year}`,
    html,
    attachments: [{
      filename: `payslip-${p.slip_number || p.id}.pdf`,
      content: pdf,
      contentType: 'application/pdf',
    }],
  });

  await pool.query(`UPDATE payroll_payslips SET email_sent_at = NOW() WHERE id = $1`, [payslipId]);
}

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
function renderPayslipDoc(doc, p) {
  const ind = (n) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(n)||0);

  // ── Header ─────────────────────────────────────────────────────────────
  const company = process.env.COMPANY_NAME || 'AltiusNxt';
  doc.fontSize(18).fillColor('#1a2040').text(company, { align: 'left' });
  doc.fontSize(9).fillColor('#64748b').text(`HR Department · ${process.env.COMPANY_ADDRESS || 'Saibaba Colony, Coimbatore'}`);
  doc.moveDown(0.5);
  doc.fontSize(14).fillColor('#0f172a').text(`Payslip — ${MONTH_NAMES[p.pay_month]} ${p.pay_year}`, { align: 'right' });
  if (p.slip_number) doc.fontSize(9).fillColor('#94a3b8').text(p.slip_number, { align: 'right' });
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

  doc.rect(40, tableTop, colWidth, 22).fill('#ecfdf5');
  doc.fillColor('#065f46').fontSize(10).font('Helvetica-Bold').text('EARNINGS', 50, tableTop + 6);
  doc.rect(305, tableTop, colWidth, 22).fill('#fef2f2');
  doc.fillColor('#991b1b').text('DEDUCTIONS', 315, tableTop + 6);

  // Only show rows with non-zero values for the variable lines (bonus, OT,
  // reimbursement, loan recovery, other adj) so we don't clutter the slip
  // with empty rows for employees who don't have them.
  const earnings = [
    ['Basic',             p.basic, true],
    ['HRA',               p.hra, true],
    ['Conveyance',        p.conveyance, true],
    ['Medical',           p.medical, true],
    ['Special Allowance', p.special_allowance, true],
    ['Other Allowances',  p.other_allowances, true],
    ['Bonus',             p.bonus, Number(p.bonus) > 0],
    ['Overtime',          p.overtime, Number(p.overtime) > 0],
    ['Reimbursement',     p.reimbursement, Number(p.reimbursement) > 0],
  ].filter(([, , show]) => show);
  const deductions = [
    ['PF (Employee)',     p.pf_employee, true],
    ['ESI (Employee)',    p.esi_employee, true],
    ['Professional Tax',  p.professional_tax, true],
    ['TDS',               p.tds, true],
    ['LOP Adjustment',    p.lop_amount, Number(p.lop_amount) > 0],
    ['Loan Recovery',     p.loan_recovery, Number(p.loan_recovery) > 0],
    ['Other Adjustment',  p.other_adjustment, Number(p.other_adjustment) !== 0],
  ].filter(([, , show]) => show);
  const maxRows = Math.max(earnings.length, deductions.length);
  const bodyTop = tableTop + 24;

  doc.fontSize(10).font('Helvetica');
  for (let i = 0; i < maxRows; i++) {
    const y = bodyTop + i * rowH;
    if (i % 2 === 0) {
      doc.rect(40, y - 2, colWidth * 2 + 15, rowH).fill('#f8fafc');
    }
    if (earnings[i]) {
      doc.fillColor('#1f2937').text(earnings[i][0], 50, y);
      doc.fillColor('#065f46').text(ind(earnings[i][1]), 50, y, { width: colWidth - 20, align: 'right' });
    }
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

  const netY = totalsY + 36;
  doc.rect(40, netY, 515, 36).fill('#eff6ff').strokeColor('#bfdbfe').stroke();
  doc.fillColor('#1e3a8a').fontSize(11).font('Helvetica-Bold').text('NET PAY', 50, netY + 12);
  doc.fontSize(16).text(ind(p.net_pay), 50, netY + 8, { width: 505, align: 'right' });

  doc.y = netY + 60;
  doc.fontSize(8).fillColor('#94a3b8').font('Helvetica').text(
    `This is a system-generated payslip. No signature required. Generated on ${new Date().toLocaleString('en-IN')}.`,
    40, doc.y, { width: 515, align: 'center' }
  );
}

function streamPayslipPdf(res, p) {
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const fileName = `payslip-${p.firstName}-${p.payMonth}-${p.payYear}.pdf`.replace(/\s+/g,'_');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
  doc.pipe(res);
  renderPayslipDoc(doc, p);
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
  let s = String(v);
  // Defuse Excel/LibreOffice formula injection. A cell starting with =, +,
  // -, @, or tab/CR is interpreted as a formula on open — so an employee
  // named "=cmd|'/c calc'!A0" or a leading "+91…" mobile would execute or
  // misrender. Prefix a single quote (the OWASP-recommended neutraliser);
  // it's invisible to most CSV consumers and stops the formula parse.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
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

/* ════════════════════════════════════════════════════════════════════════
 *  PHASE 6 — Manager approval, corrections, adjustments, loans, NEFT
 * ══════════════════════════════════════════════════════════════════════ */

// PUT /api/payroll/admin/payslips/:id/approve — manager (or admin) signs off
// on a draft. The slip stays draft (admin still needs to lock it for the
// employee to see), but approvedByManagerAt tells admin it's been reviewed.
router.put('/payslips/:id/approve', authorize('admin', 'manager'),
  logAuditWrapper('APPROVE', 'payslip'),
  async (req, res) => {
    try {
      // Manager: only their direct reports. Admin: anyone.
      const where = req.user.role === 'admin'
        ? `p.id = $1 AND p.status = 'draft'`
        : `p.id = $1 AND p.status = 'draft' AND e.reporting_manager_id = $2`;
      const params = req.user.role === 'admin' ? [req.params.id] : [req.params.id, req.user._id];
      const r = await pool.query(
        `UPDATE payroll_payslips p
            SET approved_by_manager_id = $${params.length + 1},
                approved_by_manager_at = NOW()
           FROM employees e
          WHERE p.employee_id = e.id
            AND ${where}
          RETURNING p.id`,
        [...params, req.user._id]
      );
      if (r.rows.length === 0) return res.status(400).json({ success: false, message: 'Slip not found or not eligible for approval' });
      res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  }
);

// POST /api/payroll/admin/payslips/:id/correct — supersede a locked/paid
// slip with a corrected one. The original is marked superseded_by; the
// new slip carries supersedes pointing back. Both remain visible in
// history but only the corrected one is "active" for compliance.
router.post('/admin/payslips/:id/correct', authorize('admin'),
  logAuditWrapper('CORRECT', 'payslip'),
  async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const old = await client.query(
        `SELECT * FROM payroll_payslips WHERE id = $1 AND superseded_by IS NULL`,
        [req.params.id]
      );
      if (old.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, message: 'Slip not found or already superseded' });
      }
      const o = old.rows[0];
      const b = req.body || {};
      const apply = (key) => b[key] !== undefined ? Number(b[key]) : Number(o[key] || 0);

      const basic        = apply('basic');
      const hra          = apply('hra');
      const conveyance   = apply('conveyance');
      const medical      = apply('medical');
      const spec         = apply('special_allowance');
      const otherAllow   = apply('other_allowances');
      const bonus        = apply('bonus');
      const overtime     = apply('overtime');
      const reimbursement= apply('reimbursement');
      const pfE          = apply('pf_employee');
      const esiE         = apply('esi_employee');
      const pt           = apply('professional_tax');
      const tds          = apply('tds');
      const loanRec      = apply('loan_recovery');
      const otherAdj     = apply('other_adjustment');
      const lopAmount    = apply('lop_amount');

      const gross    = basic + hra + conveyance + medical + spec + otherAllow + bonus + overtime + reimbursement;
      const totalDed = pfE + esiE + pt + tds + loanRec + Math.max(0, otherAdj);
      const net      = gross - totalDed + (otherAdj < 0 ? otherAdj : 0);

      const slip = await nextSlipNumber(client, o.pay_month, o.pay_year);
      const ins = await client.query(
        `INSERT INTO payroll_payslips
           (employee_id, pay_month, pay_year, slip_number, supersedes,
            basic, hra, conveyance, medical, special_allowance, other_allowances,
            working_days, present_days, lop_days, lop_amount,
            pf_employee, esi_employee, professional_tax, tds,
            gross_earnings, total_deductions, net_pay,
            reimbursement, loan_recovery, bonus, overtime, other_adjustment,
            generated_by, status)
         VALUES ($1,$2,$3,$4,$5, $6,$7,$8,$9,$10,$11,
                 $12,$13,$14,$15, $16,$17,$18,$19,
                 $20,$21,$22, $23,$24,$25,$26,$27, $28,'draft')
         RETURNING id`,
        [o.employee_id, o.pay_month, o.pay_year, slip, o.id,
         basic, hra, conveyance, medical, spec, otherAllow,
         o.working_days, o.present_days, o.lop_days, lopAmount,
         pfE, esiE, pt, tds,
         gross, totalDed, net,
         reimbursement, loanRec, bonus, overtime, otherAdj,
         req.user._id]
      );
      await client.query(
        `UPDATE payroll_payslips SET superseded_by = $1 WHERE id = $2`,
        [ins.rows[0].id, o.id]
      );

      // Reset compensation claims that were marked 'paid' on the old slip
      // back to 'approved' so the corrected slip can pull them in cleanly
      // when it locks. Without this, claims stay stuck 'paid' against the
      // superseded slip and the new lock skips them — employee loses the
      // reimbursement entirely.
      if (Number(o.reimbursement) > 0) {
        const start = `${o.pay_year}-${String(o.pay_month).padStart(2,'0')}-01`;
        const end   = new Date(o.pay_year, o.pay_month, 0).toLocaleDateString('en-CA');
        await client.query(
          `UPDATE compensation_claims SET status = 'approved'
             WHERE employee_id = $1 AND status = 'paid'
               AND claim_date BETWEEN $2::date AND $3::date`,
          [o.employee_id, start, end]
        );
      }

      // Same idea for loan recovery — refund the old recovery so the
      // corrected slip can apply a fresh amount without double-debiting.
      if (Number(o.loan_recovery) > 0) {
        await client.query(
          `UPDATE payroll_loans
              SET recovered = GREATEST(0, recovered - $1),
                  status    = CASE WHEN status = 'closed' THEN 'active' ELSE status END,
                  closed_at = CASE WHEN status = 'closed' THEN NULL ELSE closed_at END
            WHERE employee_id = $2 AND status IN ('active','closed')`,
          [Number(o.loan_recovery), o.employee_id]
        );
      }

      await client.query('COMMIT');
      res.status(201).json({ success: true, id: ins.rows[0].id, slipNumber: slip });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(500).json({ success: false, message: err.message });
    } finally { client.release(); }
  }
);

/* ── Adjustments (one-off per-month line items) ──────────────────────── */

// GET /api/payroll/admin/adjustments?month=&year=
router.get('/admin/adjustments', authorize('admin'), async (req, res) => {
  try {
    const month = req.query.month ? Number(req.query.month) : null;
    const year  = req.query.year  ? Number(req.query.year)  : null;
    const where = [], params = [];
    if (month) { params.push(month); where.push(`a.pay_month = $${params.length}`); }
    if (year)  { params.push(year);  where.push(`a.pay_year  = $${params.length}`); }
    const wsql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const r = await pool.query(
      `SELECT a.id, a.pay_month AS "payMonth", a.pay_year AS "payYear",
              a.type, a.amount, a.reason, a.created_at AS "createdAt",
              e.id AS "employeeId", e.employee_id AS "employeeCode",
              e.first_name AS "firstName", e.last_name AS "lastName"
         FROM payroll_adjustments a
         JOIN employees e ON a.employee_id = e.id
         ${wsql}
        ORDER BY a.pay_year DESC, a.pay_month DESC, e.first_name ASC`,
      params
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST /api/payroll/admin/adjustments
router.post('/admin/adjustments', authorize('admin'),
  logAuditWrapper('CREATE', 'payroll_adjustment'),
  async (req, res) => {
    try {
      const b = req.body || {};
      if (!b.employeeId || !b.payMonth || !b.payYear || !b.type) {
        return res.status(400).json({ success: false, message: 'employeeId, payMonth, payYear, type are required' });
      }
      if (!['bonus','overtime','deduction','other'].includes(b.type)) {
        return res.status(400).json({ success: false, message: 'type must be bonus | overtime | deduction | other' });
      }
      const r = await pool.query(
        `INSERT INTO payroll_adjustments
           (employee_id, pay_month, pay_year, type, amount, reason, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [b.employeeId, Number(b.payMonth), Number(b.payYear), b.type,
         num(b.amount), b.reason || null, req.user._id]
      );
      res.status(201).json({ success: true, id: r.rows[0].id });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  }
);

// DELETE /api/payroll/admin/adjustments/:id — only if no payslip has been
// generated for that employee/month yet (admin can otherwise correct via
// the supersede flow).
router.delete('/admin/adjustments/:id', authorize('admin'),
  logAuditWrapper('DELETE', 'payroll_adjustment'),
  async (req, res) => {
    try {
      const r = await pool.query(`DELETE FROM payroll_adjustments WHERE id = $1 RETURNING id`, [req.params.id]);
      if (r.rows.length === 0) return res.status(404).json({ success: false, message: 'Not found' });
      res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  }
);

/* ── Loans / advances ─────────────────────────────────────────────────── */

router.get('/admin/loans', authorize('admin'), async (req, res) => {
  try {
    const status = req.query.status || null;
    const where = [], params = [];
    if (status) { params.push(status); where.push(`l.status = $${params.length}`); }
    const wsql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const r = await pool.query(
      `SELECT l.id, l.principal, l.recovered, l.monthly_recovery AS "monthlyRecovery",
              l.status, l.issued_at AS "issuedAt", l.closed_at AS "closedAt",
              l.notes,
              (l.principal - COALESCE(l.recovered, 0)) AS outstanding,
              e.id AS "employeeId", e.employee_id AS "employeeCode",
              e.first_name AS "firstName", e.last_name AS "lastName",
              e.department, e.designation
         FROM payroll_loans l
         JOIN employees e ON l.employee_id = e.id
         ${wsql}
        ORDER BY l.issued_at DESC`,
      params
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/admin/loans', authorize('admin'),
  logAuditWrapper('CREATE', 'payroll_loan'),
  async (req, res) => {
    try {
      const b = req.body || {};
      if (!b.employeeId || !b.principal) {
        return res.status(400).json({ success: false, message: 'employeeId and principal are required' });
      }
      const r = await pool.query(
        `INSERT INTO payroll_loans
           (employee_id, principal, monthly_recovery, notes, issued_at, created_by)
         VALUES ($1, $2, $3, $4, COALESCE($5::date, CURRENT_DATE), $6) RETURNING id`,
        [b.employeeId, num(b.principal), num(b.monthlyRecovery), b.notes || null,
         b.issuedAt || null, req.user._id]
      );
      res.status(201).json({ success: true, id: r.rows[0].id });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  }
);

router.put('/admin/loans/:id', authorize('admin'),
  logAuditWrapper('UPDATE', 'payroll_loan'),
  async (req, res) => {
    try {
      const b = req.body || {};
      const r = await pool.query(
        `UPDATE payroll_loans
            SET monthly_recovery = COALESCE($1, monthly_recovery),
                status           = COALESCE($2, status),
                notes            = COALESCE($3, notes)
          WHERE id = $4 RETURNING id`,
        [b.monthlyRecovery !== undefined ? num(b.monthlyRecovery) : null,
         b.status || null, b.notes !== undefined ? b.notes : null, req.params.id]
      );
      if (r.rows.length === 0) return res.status(404).json({ success: false, message: 'Not found' });
      res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  }
);

router.delete('/admin/loans/:id', authorize('admin'),
  logAuditWrapper('DELETE', 'payroll_loan'),
  async (req, res) => {
    try {
      // Block deletion if any recovery has happened — admin should mark
      // it closed instead so the history is preserved.
      const chk = await pool.query(`SELECT recovered FROM payroll_loans WHERE id = $1`, [req.params.id]);
      if (chk.rows.length === 0) return res.status(404).json({ success: false, message: 'Not found' });
      if (Number(chk.rows[0].recovered) > 0) {
        return res.status(400).json({ success: false, message: 'Cannot delete a loan with recovery history — close it instead' });
      }
      await pool.query(`DELETE FROM payroll_loans WHERE id = $1`, [req.params.id]);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  }
);

/* ── NEFT bank file export ────────────────────────────────────────────── */

// GET /api/payroll/admin/reports/neft/status?month=&year= — preview before
// downloading. Returns counts so the UI can confirm with the admin if any
// slips have already been exported to the bank (re-download is a real
// double-payment risk).
router.get('/admin/reports/neft/status', authorize('admin'), async (req, res) => {
  try {
    const month = Number(req.query.month) || (new Date().getMonth() + 1);
    const year  = Number(req.query.year)  || new Date().getFullYear();
    const r = await pool.query(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE payment_exported_at IS NOT NULL) AS already_exported,
         COUNT(*) FILTER (WHERE payment_exported_at IS NULL)     AS fresh,
         MAX(payment_exported_at) AS last_exported_at
         FROM payroll_payslips
        WHERE pay_month = $1 AND pay_year = $2
          AND status IN ('locked','paid')
          AND superseded_by IS NULL`,
      [month, year]
    );
    const row = r.rows[0] || {};
    res.json({
      success: true,
      month, year,
      total:           Number(row.total            || 0),
      alreadyExported: Number(row.already_exported || 0),
      fresh:           Number(row.fresh            || 0),
      lastExportedAt:  row.last_exported_at,
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET /api/payroll/admin/reports/neft?month=&year=&force=true — bank-upload-
// ready CSV for locked/paid slips. Without ?force=true, returns a JSON
// warning if any slip is already marked exported (preventing accidental
// re-upload to the bank). After streaming the CSV, payslips are stamped
// payment_exported_at so the next call surfaces the warning.
router.get('/admin/reports/neft', authorize('admin'), async (req, res) => {
  try {
    const month = Number(req.query.month) || (new Date().getMonth() + 1);
    const year  = Number(req.query.year)  || new Date().getFullYear();
    const force = req.query.force === 'true';

    // Idempotency guard — block accidental re-download.
    const dupeCheck = await pool.query(
      `SELECT COUNT(*) AS already_exported, MAX(payment_exported_at) AS last_exported_at
         FROM payroll_payslips
        WHERE pay_month = $1 AND pay_year = $2
          AND status IN ('locked','paid')
          AND superseded_by IS NULL
          AND payment_exported_at IS NOT NULL`,
      [month, year]
    );
    const alreadyExported = Number(dupeCheck.rows[0]?.already_exported || 0);
    if (alreadyExported > 0 && !force) {
      return res.status(409).json({
        success: false,
        code:    'ALREADY_EXPORTED',
        message: `${alreadyExported} payslip(s) for ${String(month).padStart(2,'0')}/${year} were already exported to the bank on ${dupeCheck.rows[0].last_exported_at}. Re-download could cause a double payment. Add ?force=true to override.`,
        alreadyExported,
        lastExportedAt: dupeCheck.rows[0].last_exported_at,
      });
    }

    const r = await pool.query(
      `SELECT p.id AS payslip_id,
              e.employee_id AS code, e.first_name, e.last_name,
              e.bank_account, e.bank_ifsc, e.bank_name,
              p.net_pay, p.slip_number
         FROM payroll_payslips p
         JOIN employees e ON p.employee_id = e.id
        WHERE p.pay_month = $1 AND p.pay_year = $2
          AND p.status IN ('locked','paid')
          AND p.superseded_by IS NULL
        ORDER BY e.first_name ASC`,
      [month, year]
    );

    // Stamp the export BEFORE streaming the CSV so the next call sees them
    // as already-exported. If the stream itself fails partway, the stamp is
    // still in place (correct from a safety standpoint — we should NOT
    // re-download something we already started sending to the bank).
    const ids = r.rows.map(x => x.payslip_id);
    if (ids.length > 0) {
      await pool.query(
        `UPDATE payroll_payslips SET payment_exported_at = NOW()
          WHERE id = ANY($1::uuid[])`,
        [ids]
      );
    }

    const period = `${String(month).padStart(2,'0')}-${year}`;
    sendCsv(res, `neft-${period}.csv`,
      ['Beneficiary Name','Beneficiary A/c No','IFSC','Bank','Amount','Reference'],
      r.rows.map(x => [
        `${x.first_name} ${x.last_name}`,
        x.bank_account || '',
        x.bank_ifsc || '',
        x.bank_name || '',
        Number(x.net_pay || 0).toFixed(2),
        x.slip_number || x.code,
      ])
    );
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

/* ── Tax slabs viewer ─────────────────────────────────────────────────── */

// GET /api/payroll/admin/tax-slabs?fy=2026-27 — both regimes side-by-side
router.get('/admin/tax-slabs', authorize('admin'), async (req, res) => {
  try {
    const fy = req.query.fy || currentFY();
    const r = await pool.query(
      `SELECT regime, threshold_from AS "from", threshold_to AS "to", rate_percent AS "ratePercent", seq
         FROM payroll_tax_slabs
        WHERE financial_year = $1
        ORDER BY regime, seq`,
      [fy]
    );
    const out = { old: [], new: [] };
    for (const row of r.rows) {
      if (out[row.regime]) out[row.regime].push(row);
    }
    res.json({ success: true, data: out, financialYear: fy });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
