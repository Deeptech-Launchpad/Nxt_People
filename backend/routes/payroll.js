/**
 * routes/payroll.js — core payroll: salary structures, payroll run/lock/
 * paid/correct lifecycle, payslip PDF, self/team views, adjustments, loans,
 * NEFT export, tax declarations, tax slabs viewer.
 *
 * New feature areas (increments/arrears, salary templates, versioned
 * compliance settings, declaration windows, EPF/ESI summary reports) live in
 * sibling routes/payroll-*.js files, all mounted under /api/payroll* in
 * app.js. Shared math (PF/ESI/PT/TDS, structure/settings resolution) lives in
 * utils/payroll-calc.js so it can't drift between files.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const logger = require('../logger');
const xlsx = require('xlsx');
const multer = require('multer');
const { protect, authorize } = require('../middleware/auth');
const { isFullAccess } = require('../utils/roles');
const { logAudit } = require('../utils/audit');
const { sendMail } = require('../utils/mailer');
const { ruleMatchesDate, holidayClosesOffice } = require('../utils/workingDays');
const {
  resolveComplianceSettings, resolveSalaryStructure,
  computePF, computeEmployerPF, computeESIEmployee, computeEmployerESI, computePT,
  computeMonthlyTDS, computeArrearsExtraTds, getUnpaidArrears,
} = require('../utils/payroll-calc');

router.use(protect);

// Tiny inline wrapper for the audit middleware, matching the rest of this
// module's existing convention.
function logAuditWrapper(action, resource) {
  const { audit } = require('../middleware/audit');
  return audit(action, resource);
}

// Full-access for payroll purposes includes hr_admin (utils/roles.js already
// treats hr_admin as FULL_ACCESS; the old file inconsistently omitted it from
// several guards — corrected here).
const PAYROLL_ADMIN = ['admin', 'director', 'hr_admin'];

// Pull a number from req.body and floor at 0. Empty/garbage -> 0.
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/* ════════════════════════════════════════════════════════════════════════
 *  PHASE 1 — Salary Structures
 *  Open-interval model: a structure's effective_from marks when it starts;
 *  "current" = latest row with effective_from <= asOf. No effective_to to
 *  manage — a new row simply supersedes the previous one from that date on.
 * ══════════════════════════════════════════════════════════════════════ */

const STRUCT_COLS = `
  id, employee_id AS "employeeId",
  effective_from AS "effectiveFrom", template_id AS "templateId",
  ctc_annual AS "ctcAnnual",
  basic, hra, conveyance,
  other_components AS "otherComponents",
  pf_applicable AS "pfApplicable", esi_applicable AS "esiApplicable",
  pf_override AS "pfOverride", esi_override AS "esiOverride", pt_override AS "ptOverride",
  notes, created_at AS "createdAt"
`;

/** Add computed totals to a structure row for display — tolerant to null (a
 *  brand-new employee with no structure yet returns zeros, not NaN). Uses
 *  live current compliance settings for the PF/ESI/PT preview shown in the
 *  admin UI; actual payslip generation resolves settings as of the pay
 *  month, not "now" — this is a display convenience only. */
async function withTotals(client, row, state) {
  if (!row) return null;
  const other = Array.isArray(row.otherComponents) ? row.otherComponents : [];
  const otherTotal = other.reduce((s, c) => s + (Number(c.value) || 0), 0);
  const monthlyGross = round2(
    Number(row.basic || 0) + Number(row.hra || 0) + Number(row.conveyance || 0) + otherTotal
  );
  const settings = await resolveComplianceSettings(client, new Date());
  const pf = computePF(row.basic, settings, row.pfApplicable, row.pfOverride);
  const esi = computeESIEmployee(monthlyGross, settings, row.esiApplicable, row.esiOverride);
  const pt = computePT(monthlyGross, settings, state, row.ptOverride);
  const employerPf = computeEmployerPF(row.basic, settings, row.pfApplicable);
  const employerEsi = computeEmployerESI(monthlyGross, settings, row.esiApplicable);
  const monthlyDeductions = round2(pf + esi + pt);
  const monthlyNet = round2(monthlyGross - monthlyDeductions);
  const ctcAnnual = Number(row.ctcAnnual) || round2(monthlyGross * 12 + employerPf.total * 12);
  return {
    ...row, monthlyGross, monthlyDeductions, monthlyNet, ctcAnnual,
    pf, esi, pt, employerPf: employerPf.total, employerEsi,
  };
}

// GET /api/payroll/admin/employees — active employees with their current
// salary structure totals. structure: null if never set up.
router.get('/admin/employees', authorize(...PAYROLL_ADMIN), async (req, res) => {
  try {
    const empRes = await pool.query(
      `SELECT id AS "_id", employee_id AS "employeeId",
              first_name AS "firstName", last_name AS "lastName",
              email, department, designation, company, state
         FROM employees WHERE status = 'active' ORDER BY first_name ASC`
    );
    const today = new Date().toLocaleDateString('en-CA');
    const data = await Promise.all(empRes.rows.map(async (emp) => {
      const structRes = await pool.query(
        `SELECT ${STRUCT_COLS} FROM salary_structures
          WHERE employee_id = $1 AND effective_from <= $2::date
          ORDER BY effective_from DESC LIMIT 1`,
        [emp._id, today]
      );
      if (structRes.rows.length === 0) return { ...emp, structure: null };
      const totals = await withTotals(pool, structRes.rows[0], emp.state);
      return {
        ...emp,
        structure: {
          monthlyGross: totals.monthlyGross,
          monthlyDeductions: totals.monthlyDeductions,
          monthlyNet: totals.monthlyNet,
          ctcAnnual: totals.ctcAnnual,
        },
      };
    }));
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  }
});

// GET /api/payroll/admin/employees/:id/structure — current + last 5
// historical rows (everything with an earlier effective_from than current).
router.get('/admin/employees/:id/structure', authorize(...PAYROLL_ADMIN), async (req, res) => {
  try {
    const empRes = await pool.query('SELECT state FROM employees WHERE id = $1', [req.params.id]);
    const state = empRes.rows[0]?.state || null;
    const today = new Date().toLocaleDateString('en-CA');

    const current = await pool.query(
      `SELECT ${STRUCT_COLS} FROM salary_structures
        WHERE employee_id = $1 AND effective_from <= $2::date
        ORDER BY effective_from DESC LIMIT 1`,
      [req.params.id, today]
    );
    const currentRow = current.rows[0] || null;
    const history = await pool.query(
      `SELECT ${STRUCT_COLS} FROM salary_structures
        WHERE employee_id = $1 AND effective_from <= $2::date ${currentRow ? 'AND id <> $3' : ''}
        ORDER BY effective_from DESC LIMIT 5`,
      currentRow ? [req.params.id, today, currentRow.id] : [req.params.id, today]
    );

    res.json({
      success: true,
      data: {
        current: await withTotals(pool, currentRow, state),
        history: await Promise.all(history.rows.map(r => withTotals(pool, r, state))),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  }
});

// PUT /api/payroll/admin/employees/:id/structure — upsert on
// (employee_id, effective_from). A row for the same date gets corrected in
// place (same-day typo fixes); a new date creates a genuinely new versioned
// row, preserving history. Body: either mode:"template" ({templateId,
// ctcAnnual}) or mode:"custom" ({basic, hra, conveyance, otherComponents}).
router.put('/admin/employees/:id/structure',
  authorize(...PAYROLL_ADMIN),
  logAuditWrapper('UPDATE', 'salary_structure'),
  async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const emp = await client.query(
        `SELECT id FROM employees WHERE id = $1 AND status = 'active'`,
        [req.params.id]
      );
      if (emp.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, message: 'Active employee not found' });
      }

      const b = req.body || {};
      const effectiveFrom = b.effectiveFrom || new Date().toLocaleDateString('en-CA');

      let basic, hra, conveyance, otherComponents, ctcAnnual, templateId = null;
      if (b.mode === 'template' && b.templateId) {
        const { splitCtcFromTemplate } = require('../utils/payroll-calc');
        const tplRes = await client.query(
          `SELECT id, name, type, value FROM salary_template_components WHERE template_id = $1 ORDER BY seq ASC`,
          [b.templateId]
        );
        if (tplRes.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ success: false, message: 'Template not found or has no components' });
        }
        ctcAnnual = num(b.ctcAnnual);
        const split = splitCtcFromTemplate(ctcAnnual, tplRes.rows);
        ({ basic, hra, conveyance, otherComponents } = split);
        templateId = b.templateId;
      } else {
        basic = num(b.basic); hra = num(b.hra); conveyance = num(b.conveyance);
        otherComponents = Array.isArray(b.otherComponents)
          ? b.otherComponents.filter(c => c && c.name).map(c => ({ name: String(c.name).trim(), value: num(c.value) }))
          : [];
        const otherTotal = otherComponents.reduce((s, c) => s + c.value, 0);
        ctcAnnual = b.ctcAnnual != null ? num(b.ctcAnnual) : round2((basic + hra + conveyance + otherTotal) * 12);
      }

      const insert = await client.query(
        `INSERT INTO salary_structures
           (employee_id, effective_from, template_id, ctc_annual,
            basic, hra, conveyance, other_components,
            pf_applicable, esi_applicable, pf_override, esi_override, pt_override,
            notes, created_by)
         VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (employee_id, effective_from) DO UPDATE SET
           template_id = EXCLUDED.template_id, ctc_annual = EXCLUDED.ctc_annual,
           basic = EXCLUDED.basic, hra = EXCLUDED.hra, conveyance = EXCLUDED.conveyance,
           other_components = EXCLUDED.other_components,
           pf_applicable = EXCLUDED.pf_applicable, esi_applicable = EXCLUDED.esi_applicable,
           pf_override = EXCLUDED.pf_override, esi_override = EXCLUDED.esi_override, pt_override = EXCLUDED.pt_override,
           notes = EXCLUDED.notes
         RETURNING ${STRUCT_COLS}`,
        [
          req.params.id, effectiveFrom, templateId, ctcAnnual,
          basic, hra, conveyance, JSON.stringify(otherComponents),
          b.pfApplicable !== false, !!b.esiApplicable,
          b.pfOverride != null ? num(b.pfOverride) : null,
          b.esiOverride != null ? num(b.esiOverride) : null,
          b.ptOverride != null ? num(b.ptOverride) : null,
          b.notes || null, req.user._id,
        ]
      );

      await client.query('COMMIT');
      const empRow = await pool.query('SELECT state FROM employees WHERE id = $1', [req.params.id]);
      res.json({ success: true, data: await withTotals(pool, insert.rows[0], empRow.rows[0]?.state) });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      res.status(500).json({ success: false, message: 'An internal server error occurred' });
    } finally {
      client.release();
    }
  }
);

/* ════════════════════════════════════════════════════════════════════════
 *  PHASE 2 — Payroll Run + Payslip lifecycle
 * ══════════════════════════════════════════════════════════════════════ */

async function loadHolidaysAndRules(month, year) {
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const monthEnd = new Date(year, month, 0).toLocaleDateString('en-CA');
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
    holMap.set(`${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`, h.type);
  }
  return { holMap, rules: rulesRes.rows };
}

function workingDaysInRange(start, end, holMap, rules) {
  if (!start || !end || start > end) return 0;
  let working = 0;
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const stop = new Date(end);
  stop.setHours(0, 0, 0, 0);
  while (cursor <= stop) {
    const key = `${cursor.getFullYear()}-${cursor.getMonth() + 1}-${cursor.getDate()}`;
    const holType = holMap.get(key);
    if (holType === 'working_day') {
      working++;
    } else if (!holidayClosesOffice(holType)) {
      const isWeekend = rules.some(rule => ruleMatchesDate(rule, cursor));
      if (!isWeekend) working++;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return working;
}

// Same walk as workingDaysInRange but returns the actual dates instead of
// just a count — needed to resolve LOP day-by-day below.
function listWorkingDays(start, end, holMap, rules) {
  const days = [];
  if (!start || !end || start > end) return days;
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const stop = new Date(end);
  stop.setHours(0, 0, 0, 0);
  while (cursor <= stop) {
    const key = `${cursor.getFullYear()}-${cursor.getMonth() + 1}-${cursor.getDate()}`;
    const holType = holMap.get(key);
    if (holType === 'working_day') {
      days.push(new Date(cursor));
    } else if (!holidayClosesOffice(holType)) {
      const isWeekend = rules.some(rule => ruleMatchesDate(rule, cursor));
      if (!isWeekend) days.push(new Date(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

// LOP (Loss of Pay) days for an employee inside a date range. A working day
// is LOP *only* when explicitly covered by an approved 'unpaid' leave
// application (the employee themselves chose Leave Without Pay).
//
// Bare absences (forgot to check in, cron-marked 'absent') and unaccounted
// days are NOT LOP — the employee may regularize attendance or apply for
// leave retroactively. Pending leave applications also protect the day
// from being counted as LOP, since the employee has already acted.
//
// Only days strictly before today are judged — an in-progress or future day
// has no verdict yet, so it's never counted as LOP.
async function lopDaysForRange(employeeId, startDate, endDate, holMap, rules, queryRunner = pool) {
  const workingDates = listWorkingDays(startDate, endDate, holMap, rules);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const pastWorkingDates = workingDates.filter(d => d < today);
  if (pastWorkingDates.length === 0) return 0;

  const start = startDate instanceof Date ? startDate.toLocaleDateString('en-CA') : startDate;
  const end = endDate instanceof Date ? endDate.toLocaleDateString('en-CA') : endDate;

  // Sequential, not Promise.all — queryRunner may be a single client inside
  // a transaction (runMonthlyPayroll), which can't run concurrent queries.
  const leaveRes = await queryRunner.query(
    `SELECT leave_type, start_date, end_date, is_half_day
       FROM leaves
      WHERE employee_id = $1 AND status = 'approved'
        AND start_date <= $3::date AND end_date >= $2::date`,
    [employeeId, start, end]
  );

  const leaves = leaveRes.rows.map(r => ({
    type: r.leave_type,
    start: new Date(r.start_date),
    end: new Date(r.end_date),
    isHalfDay: r.is_half_day,
  }));

  let lop = 0;
  for (const day of pastWorkingDates) {
    const coveringLeave = leaves.find(l => day >= l.start && day <= l.end);
    if (coveringLeave && coveringLeave.type === 'unpaid') {
      lop += coveringLeave.isHalfDay ? 0.5 : 1;
    }
    // Any other situation (absent, no record, paid leave, pending leave,
    // WFH, etc.) is NOT LOP — only explicit approved unpaid leave counts.
  }
  return lop;
}

/**
 * Unmarked absences in a range: a past working day with no approved leave and
 * no on-duty, where the person either never punched OR punched in and never
 * out. The second half is deliberate — see the query below. Previously: no
 * leave and no on-duty record.
 *
 * Deliberately NOT folded into lopDaysForRange(). Both are unpaid, but they are
 * different facts and the reference reports them in separate columns —
 * "Unpaid Off Day(s): Leave | Absent | Total". Only approved unpaid leave is
 * deducted automatically; an absence is surfaced for HR to act on, because a
 * missing punch is not the same as not working. Auto-deducting would dock a
 * month's pay from somebody whose biometric never registered, which is exactly
 * what regularization exists to correct.
 *
 * Counts whole days only. A half-day leave still covers the day, so it is not
 * an absence — the unpaid half of it is already lopDaysForRange()'s business.
 */
async function absentDaysForRange(employeeId, startDate, endDate, holMap, rules, queryRunner = pool) {
  const workingDates = listWorkingDays(startDate, endDate, holMap, rules);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const past = workingDates.filter(d => d < today);
  if (past.length === 0) return 0;

  const start = startDate instanceof Date ? startDate.toLocaleDateString('en-CA') : startDate;
  const end = endDate instanceof Date ? endDate.toLocaleDateString('en-CA') : endDate;

  // Sequential for the same reason as lopDaysForRange: queryRunner may be a
  // single client inside a transaction.
  // A day counts as attended only when BOTH punches are there. A check-in on
  // its own used to be enough, so somebody who badged in and never badged out
  // was reported present for a full day — the same day the regularization
  // reminder chases them about. Two definitions of the same word in one
  // system is how a report and an email end up contradicting each other.
  //
  // On-duty still counts without punches: the whole point of it is being
  // somewhere there is no device.
  const att = await queryRunner.query(
    `SELECT date::text AS d FROM attendance
      WHERE employee_id = $1 AND date BETWEEN $2::date AND $3::date
        AND ((check_in IS NOT NULL AND check_out IS NOT NULL) OR status = 'on_duty')`,
    [employeeId, start, end]
  );
  const punched = new Set(att.rows.map(r => r.d));

  const lv = await queryRunner.query(
    `SELECT start_date::text AS s, end_date::text AS e FROM leaves
      WHERE employee_id = $1 AND status = 'approved' AND leave_type <> 'permission'
        AND start_date <= $3::date AND end_date >= $2::date`,
    [employeeId, start, end]
  );
  const od = await queryRunner.query(
    `SELECT start_date::text AS s, end_date::text AS e FROM on_duty_requests
      WHERE employee_id = $1 AND status = 'approved'
        AND start_date <= $3::date AND end_date >= $2::date`,
    [employeeId, start, end]
  ).catch(() => ({ rows: [] }));
  const covered = [...lv.rows, ...od.rows];

  let absent = 0;
  for (const day of past) {
    // Local parts, never toISOString — the punched set is keyed by date::text
    // out of Postgres, which is the true calendar day.
    const ymd = day.toLocaleDateString('en-CA');
    if (punched.has(ymd)) continue;
    if (covered.some(c => ymd >= c.s && ymd <= c.e)) continue;
    absent += 1;
  }
  return absent;
}

/** Indian FY for a given (month, year). Apr-Mar boundary. Returns "2026-27". */
function fyForMonth(month, year) {
  const fy = month >= 4 ? year : year - 1;
  return `${fy}-${String((fy + 1) % 100).padStart(2, '0')}`;
}

// Next slip number for a (month, year), advisory-locked so two concurrent
// generations for the same month can't race on the sequence.
async function nextSlipNumber(client, month, year) {
  const lockKey = year * 100 + month;
  await client.query('SELECT pg_advisory_xact_lock($1)', [lockKey]);
  // Extract only the trailing sequence digits (e.g. "0002" out of
  // "PSL-2026-07-0002") — stripping ALL non-digits (previous behaviour)
  // also pulled in the year/month digits and compounded on every call.
  const r = await client.query(
    `SELECT COALESCE(MAX(NULLIF(substring(slip_number FROM '(\\d+)$'), '')::int), 0) AS max_seq
       FROM payroll_payslips WHERE pay_month = $1 AND pay_year = $2`,
    [month, year]
  );
  const seq = (r.rows[0].max_seq || 0) + 1;
  return `PSL-${year}-${String(month).padStart(2, '0')}-${String(seq).padStart(4, '0')}`;
}

async function reimbursementsFor(client, employeeId, month, year) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const end = new Date(year, month, 0).toLocaleDateString('en-CA');
  const r = await client.query(
    `SELECT id, amount FROM compensation_claims
      WHERE employee_id = $1 AND status = 'approved'
        AND claim_date BETWEEN $2::date AND $3::date
        AND approved_at <= NOW()`,
    [employeeId, start, end]
  );
  const total = r.rows.reduce((s, x) => s + Number(x.amount || 0), 0);
  return { total, ids: r.rows.map(x => x.id) };
}

async function adjustmentsFor(client, employeeId, month, year) {
  const r = await client.query(
    `SELECT type, amount FROM payroll_adjustments WHERE employee_id = $1 AND pay_month = $2 AND pay_year = $3`,
    [employeeId, month, year]
  );
  let bonus = 0, overtime = 0, deduction = 0, other = 0;
  for (const a of r.rows) {
    const amt = Number(a.amount || 0);
    if (a.type === 'bonus') bonus += amt;
    else if (a.type === 'overtime') overtime += amt;
    else if (a.type === 'deduction') deduction += amt;
    else other += amt;
  }
  return { bonus, overtime, deduction, other };
}

async function loanRecoveryFor(client, employeeId) {
  const r = await client.query(
    `SELECT id, principal, recovered, monthly_recovery FROM payroll_loans WHERE employee_id = $1 AND status = 'active'`,
    [employeeId]
  );
  let total = 0;
  const lines = [];
  for (const l of r.rows) {
    const outstanding = Number(l.principal) - Number(l.recovered || 0);
    if (outstanding <= 0) continue;
    const amt = Math.min(Number(l.monthly_recovery || 0), outstanding);
    if (amt > 0) { total += amt; lines.push({ id: l.id, amount: amt, outstanding }); }
  }
  return { total, lines };
}

/** Compute one employee's draft payslip figures for a pay month — the single
 *  shared implementation used by POST /admin/run-month, the preview
 *  endpoint, and the monthly cron in server.js. Arrears are a PREVIEW here
 *  (read-only, via getUnpaidArrears) — actual consumption only happens at
 *  lock time. Returns null if the employee falls entirely outside the month
 *  (not yet joined / already exited). */
async function computeDraftPayslip(client, emp, { month, year, workingDays, holMap, rules, fy, monthStart, monthEnd }) {
  const joining = emp.joining_date ? new Date(emp.joining_date) : null;
  const exit = emp.exit_date ? new Date(emp.exit_date) : null;
  let effectiveStart = monthStart, effectiveEnd = monthEnd, isPartial = false;

  if (joining && joining > monthEnd) return null;
  if (joining && joining > monthStart) { effectiveStart = joining; isPartial = true; }
  if (exit && exit < monthStart) return null;
  if (exit && exit < monthEnd) { effectiveEnd = exit; isPartial = true; }

  const structure = await resolveSalaryStructure(client, emp.id, monthEnd);
  if (!structure) return { skip: true, reason: 'no_structure' };

  const empWorkingDays = isPartial ? workingDaysInRange(effectiveStart, effectiveEnd, holMap, rules) : workingDays;
  const rawLop = await lopDaysForRange(emp.id, effectiveStart, effectiveEnd, holMap, rules, client);
  const lopDays = Math.min(rawLop, empWorkingDays);
  const paidDays = empWorkingDays - lopDays;
  const ratio = workingDays > 0 ? paidDays / workingDays : 1;

  const basic = round2(Number(structure.basic || 0) * ratio);
  const hra = round2(Number(structure.hra || 0) * ratio);
  const conveyance = round2(Number(structure.conveyance || 0) * ratio);
  const otherComponentsFull = Array.isArray(structure.other_components) ? structure.other_components : [];
  const otherComponents = otherComponentsFull.map(c => ({ name: c.name, value: round2((Number(c.value) || 0) * ratio) }));
  const otherTotal = otherComponents.reduce((s, c) => s + c.value, 0);

  const basicFull = Number(structure.basic || 0);
  const grossFull = basicFull + Number(structure.hra || 0) + Number(structure.conveyance || 0)
    + otherComponentsFull.reduce((s, c) => s + (Number(c.value) || 0), 0);
  const baseGross = round2(basic + hra + conveyance + otherTotal);
  const lopAmount = round2(grossFull - baseGross);

  const reim = await reimbursementsFor(client, emp.id, month, year);
  const adj = await adjustmentsFor(client, emp.id, month, year);
  const loans = await loanRecoveryFor(client, emp.id);
  const arrears = await getUnpaidArrears(client, emp.id);
  const arrearsExtraTds = arrears.total > 0
    ? await computeArrearsExtraTds(client, { employeeId: emp.id, fy, baseAnnualGrossFull: grossFull * 12, arrearsAmount: arrears.total })
    : 0;

  const gross = round2(baseGross + adj.bonus + adj.overtime + reim.total + arrears.total);

  const settings = await resolveComplianceSettings(client, monthEnd);
  const pfE = computePF(basic, settings, structure.pf_applicable, structure.pf_override);
  const esiE = computeESIEmployee(baseGross, settings, structure.esi_applicable, structure.esi_override);
  const pt = computePT(baseGross, settings, emp.state, structure.pt_override);
  const employerPf = computeEmployerPF(basic, settings, structure.pf_applicable);
  const employerEsi = computeEmployerESI(baseGross, settings, structure.esi_applicable);
  const tds = await computeMonthlyTDS(client, { employeeId: emp.id, monthlyGrossFull: grossFull, fy });

  const totalDed = round2(pfE + esiE + pt + tds + arrearsExtraTds + loans.total + adj.deduction);
  const net = round2(gross - totalDed + adj.other);

  return {
    skip: false,
    basic, hra, conveyance, otherComponents,
    workingDays: empWorkingDays, paidDays, lopDays, lopAmount,
    pfE, esiE, pt, tds, employerPf: employerPf.total, employerEpf: employerPf.epf, employerEps: employerPf.eps, employerEsi,
    arrearsAmount: arrears.total, arrearsExtraTds, arrearsIncrementIds: arrears.incrementIds,
    gross, totalDed, net,
    reimbursement: reim.total, loanRecovery: loans.total,
    bonus: adj.bonus, overtime: adj.overtime, otherAdjustment: adj.other - adj.deduction,
  };
}

/** Generate/regenerate draft payslips for all active employees with a
 *  salary structure. Shared by the route handler and the monthly cron so
 *  there is exactly one implementation of "what a draft payslip contains" —
 *  the old cron duplicated a simplified, drifted version of this; that
 *  drift is exactly what this function exists to eliminate. */
async function runMonthlyPayroll({ month, year, force, actorId }) {
  const client = await pool.connect();
  try {
    const { holMap, rules } = await loadHolidaysAndRules(month, year);
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0);
    const workingDays = workingDaysInRange(monthStart, monthEnd, holMap, rules);
    const fy = fyForMonth(month, year);

    const employees = await client.query(
      `SELECT id, first_name, last_name, joining_date, exit_date, status, state
         FROM employees WHERE status = 'active'`
    );

    const results = { created: 0, updated: 0, skipped: 0, errors: [] };

    for (const emp of employees.rows) {
      try {
        await client.query('BEGIN');
        const existing = await client.query(
          `SELECT id, status FROM payroll_payslips
            WHERE employee_id = $1 AND pay_month = $2 AND pay_year = $3 AND superseded_by IS NULL`,
          [emp.id, month, year]
        );
        if (existing.rows.length > 0) {
          const status = existing.rows[0].status;
          if (status !== 'draft' || !force) { results.skipped++; await client.query('ROLLBACK'); continue; }
        }

        const draft = await computeDraftPayslip(client, emp, { month, year, workingDays, holMap, rules, fy, monthStart, monthEnd });
        if (!draft) { results.skipped++; await client.query('ROLLBACK'); continue; }
        if (draft.skip) { results.skipped++; await client.query('ROLLBACK'); continue; }

        if (existing.rows.length > 0 && force) {
          await client.query(
            `UPDATE payroll_payslips SET
               basic=$1, hra=$2, conveyance=$3, other_components=$4::jsonb,
               working_days=$5, present_days=$6, lop_days=$7, lop_amount=$8,
               pf_employee=$9, esi_employee=$10, professional_tax=$11, tds=$12,
               employer_pf=$13, employer_epf=$14, employer_eps=$15, employer_esi=$16,
               arrears_amount=$17, arrears_extra_tds=$18,
               gross_earnings=$19, total_deductions=$20, net_pay=$21,
               reimbursement=$22, loan_recovery=$23, bonus=$24, overtime=$25, other_adjustment=$26,
               generated_at=NOW(), generated_by=$27
             WHERE id=$28`,
            [draft.basic, draft.hra, draft.conveyance, JSON.stringify(draft.otherComponents),
             draft.workingDays, draft.paidDays, draft.lopDays, draft.lopAmount,
             draft.pfE, draft.esiE, draft.pt, draft.tds,
             draft.employerPf, draft.employerEpf, draft.employerEps, draft.employerEsi,
             draft.arrearsAmount, draft.arrearsExtraTds,
             draft.gross, draft.totalDed, draft.net,
             draft.reimbursement, draft.loanRecovery, draft.bonus, draft.overtime, draft.otherAdjustment,
             actorId, existing.rows[0].id]
          );
          results.updated++;
        } else {
          const slip = await nextSlipNumber(client, month, year);
          await client.query(
            `INSERT INTO payroll_payslips
               (employee_id, pay_month, pay_year, slip_number,
                basic, hra, conveyance, other_components,
                working_days, present_days, lop_days, lop_amount,
                pf_employee, esi_employee, professional_tax, tds,
                employer_pf, employer_epf, employer_eps, employer_esi,
                arrears_amount, arrears_extra_tds,
                gross_earnings, total_deductions, net_pay,
                reimbursement, loan_recovery, bonus, overtime, other_adjustment,
                generated_by)
             VALUES ($1,$2,$3,$4, $5,$6,$7,$8::jsonb, $9,$10,$11,$12,
                     $13,$14,$15,$16, $17,$18,$19,$20, $21,$22,
                     $23,$24,$25, $26,$27,$28,$29,$30, $31)`,
            [emp.id, month, year, slip,
             draft.basic, draft.hra, draft.conveyance, JSON.stringify(draft.otherComponents),
             draft.workingDays, draft.paidDays, draft.lopDays, draft.lopAmount,
             draft.pfE, draft.esiE, draft.pt, draft.tds,
             draft.employerPf, draft.employerEpf, draft.employerEps, draft.employerEsi,
             draft.arrearsAmount, draft.arrearsExtraTds,
             draft.gross, draft.totalDed, draft.net,
             draft.reimbursement, draft.loanRecovery, draft.bonus, draft.overtime, draft.otherAdjustment,
             actorId]
          );
          results.created++;
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        results.errors.push({ employeeId: emp.id, message: err.message });
      }
    }
    return results;
  } finally {
    client.release();
  }
}

router.post('/admin/run-month', authorize(...PAYROLL_ADMIN), logAuditWrapper('PAYROLL_RUN', 'payroll'), async (req, res) => {
  try {
    const month = Number(req.body.month) || (new Date().getMonth() + 1);
    const year = Number(req.body.year) || new Date().getFullYear();
    const force = !!req.body.force;
    if (month < 1 || month > 12) return res.status(400).json({ success: false, message: 'Invalid month' });
    const results = await runMonthlyPayroll({ month, year, force, actorId: req.user._id });
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  }
});

// POST /api/payroll/admin/run-month/preview — dry run of the exact same
// pipeline, writes nothing. Absorbs the old standalone LOP-report page's
// value (a preview before committing to generate drafts) without its
// disconnected employees.basic_salary/monthly_ctc data path.
router.post('/admin/run-month/preview', authorize(...PAYROLL_ADMIN), async (req, res) => {
  try {
    const month = Number(req.body.month) || (new Date().getMonth() + 1);
    const year = Number(req.body.year) || new Date().getFullYear();
    if (month < 1 || month > 12) return res.status(400).json({ success: false, message: 'Invalid month' });

    const { holMap, rules } = await loadHolidaysAndRules(month, year);
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0);
    const workingDays = workingDaysInRange(monthStart, monthEnd, holMap, rules);
    const fy = fyForMonth(month, year);

    const employees = await pool.query(
      `SELECT id, employee_id AS "employeeCode", first_name AS "firstName", last_name AS "lastName", department, designation,
              joining_date, exit_date, status, state
         FROM employees WHERE status = 'active' ORDER BY first_name ASC`
    );

    const periodStart = monthStart.toLocaleDateString('en-CA');
    const periodEnd = monthEnd.toLocaleDateString('en-CA');
    const absentRes = await pool.query(
      `SELECT employee_id, COUNT(*)::int AS n FROM attendance
        WHERE status = 'absent' AND date >= $1::date AND date <= $2::date
        GROUP BY employee_id`,
      [periodStart, periodEnd]
    );
    const absentMap = new Map(absentRes.rows.map(r => [r.employee_id, r.n]));

    const preview = [];
    for (const emp of employees.rows) {
      const draft = await computeDraftPayslip(pool, emp, { month, year, workingDays, holMap, rules, fy, monthStart, monthEnd });
      if (!draft || draft.skip) {
        preview.push({ employee: { firstName: emp.firstName, lastName: emp.lastName, department: emp.department }, hasStructure: !draft?.skip === false ? false : !(draft && draft.skip), status: 'no_structure' });
        continue;
      }
      preview.push({
        employee: { _id: emp.id, employeeCode: emp.employeeCode, firstName: emp.firstName, lastName: emp.lastName, department: emp.department, designation: emp.designation },
        workingDays: draft.workingDays, paidDays: draft.paidDays, lopDays: draft.lopDays,
        absentDays: absentMap.get(emp.id) || 0,
        grossEarnings: draft.gross, totalDeductions: draft.totalDed, netPay: draft.net,
        arrearsAmount: draft.arrearsAmount,
      });
    }
    res.json({ success: true, month, year, workingDays, data: preview });
  } catch (err) {
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  }
});

router.get('/admin/payslips', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const month = Number(req.query.month) || (new Date().getMonth() + 1);
    const year = Number(req.query.year) || new Date().getFullYear();
    const isMgrOnly = !isFullAccess(req.user.role);
    const periodStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const periodEnd = new Date(year, month, 0).toLocaleDateString('en-CA');
    const where = isMgrOnly
      ? `WHERE p.pay_month=$1 AND p.pay_year=$2 AND p.superseded_by IS NULL AND (e.reporting_manager_id=$5 OR e.approving_authority_id=$5)`
      : `WHERE p.pay_month=$1 AND p.pay_year=$2 AND p.superseded_by IS NULL`;
    const params = isMgrOnly ? [month, year, periodStart, periodEnd, req.user._id] : [month, year, periodStart, periodEnd];
    const r = await pool.query(
      `SELECT p.id, p.slip_number AS "slipNumber", p.status,
              p.gross_earnings AS "grossEarnings", p.total_deductions AS "totalDeductions",
              p.net_pay AS "netPay", p.lop_days AS "lopDays",
              p.present_days AS "presentDays", p.working_days AS "workingDays",
              COALESCE(ab.absent_days, 0) AS "absentDays",
              e.employee_id AS "employeeCode", e.first_name AS "firstName", e.last_name AS "lastName",
              e.designation, e.department
         FROM payroll_payslips p JOIN employees e ON p.employee_id = e.id
         LEFT JOIN (
           SELECT employee_id, COUNT(*)::int AS absent_days
             FROM attendance
            WHERE status = 'absent' AND date >= $3::date AND date <= $4::date
            GROUP BY employee_id
         ) ab ON ab.employee_id = p.employee_id
         ${where} ORDER BY e.first_name ASC`,
      params
    );
    res.json({ success: true, data: r.rows, month, year });
  } catch (err) {
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  }
});

// Registered ahead of '/admin/payslips/:id' deliberately. Express matches in
// registration order, so with this below it the :id route captured the word
// "export" as an id, Postgres rejected it as a malformed uuid, and this
// handler was unreachable code that answered 500 to every request.
router.get('/admin/payslips/export', authorize(...PAYROLL_ADMIN), async (req, res) => {
  try {
    const month = Number(req.query.month) || (new Date().getMonth() + 1);
    const year = Number(req.query.year) || new Date().getFullYear();
    const r = await pool.query(
      `SELECT e.employee_id AS code, e.first_name, e.last_name, e.designation, e.department,
              e.bank_name, e.bank_account, e.bank_ifsc, e.pan_number,
              p.status, p.gross_earnings, p.pf_employee, p.esi_employee, p.professional_tax, p.tds,
              p.total_deductions, p.net_pay, p.lop_days, p.slip_number
         FROM payroll_payslips p JOIN employees e ON p.employee_id = e.id
        WHERE p.pay_month = $1 AND p.pay_year = $2 AND p.superseded_by IS NULL
        ORDER BY e.first_name ASC`,
      [month, year]
    );
    const period = `${String(month).padStart(2, '0')}-${year}`;
    sendCsv(res, `payroll-verification-${period}.csv`,
      ['Employee ID', 'Name', 'Designation', 'Department', 'Bank Name', 'Account Number', 'IFSC', 'PAN',
       'Gross Earnings', 'PF', 'ESI', 'Professional Tax', 'TDS', 'Total Deductions', 'Net Pay', 'LOP Days', 'Status', 'Slip Number'],
      r.rows.map(x => [x.code, `${x.first_name} ${x.last_name}`, x.designation || '', x.department || '',
        x.bank_name || '', x.bank_account || '', x.bank_ifsc || '', x.pan_number || '',
        x.gross_earnings, x.pf_employee, x.esi_employee, x.professional_tax, x.tds, x.total_deductions, x.net_pay,
        x.lop_days, x.status, x.slip_number || '']));
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.get('/admin/payslips/:id', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT p.*,
              e.employee_id AS "employeeCode",
              e.first_name AS "firstName", e.last_name AS "lastName",
              e.email, e.department, e.designation, e.company, e.joining_date,
              e.bank_name, e.bank_account, e.bank_ifsc, e.pan_number, e.uan_number,
              e.reporting_manager_id, e.approving_authority_id
         FROM payroll_payslips p JOIN employees e ON p.employee_id = e.id
        WHERE p.id = $1`,
      [req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ success: false, message: 'Payslip not found' });
    if (!isFullAccess(req.user.role)
        && String(r.rows[0].reporting_manager_id) !== String(req.user._id)
        && String(r.rows[0].approving_authority_id) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'You can only view your direct reports’ payslips.' });
    }
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  }
});

router.get('/admin/payslips/:id/preview-email', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT p.*, e.first_name, e.last_name, e.reporting_manager_id, e.approving_authority_id
         FROM payroll_payslips p JOIN employees e ON p.employee_id = e.id WHERE p.id = $1`,
      [req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ success: false, message: 'Payslip not found' });
    if (!isFullAccess(req.user.role)
        && String(r.rows[0].reporting_manager_id) !== String(req.user._id)
        && String(r.rows[0].approving_authority_id) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'You can only view your direct reports’ payslips.' });
    }
    const html = buildLockEmailHtml(r.rows[0]);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Email Preview</title></head><body style="margin:0">${html}</body></html>`);
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.put('/admin/payslips/:id/lock', authorize(...PAYROLL_ADMIN), logAuditWrapper('LOCK', 'payslip'), async (req, res) => {
  const client = await pool.connect();
  try {
    const settingsRes = await client.query('SELECT require_manager_approval_before_lock FROM settings LIMIT 1');
    const mustApprove = !!settingsRes.rows[0]?.require_manager_approval_before_lock;
    if (mustApprove) {
      const check = await client.query(`SELECT approved_by_manager_at, status FROM payroll_payslips WHERE id = $1`, [req.params.id]);
      if (check.rows.length === 0) return res.status(404).json({ success: false, message: 'Payslip not found' });
      if (check.rows[0].status === 'draft' && !check.rows[0].approved_by_manager_at) {
        return res.status(400).json({
          success: false, code: 'MANAGER_APPROVAL_REQUIRED',
          message: 'This payslip needs manager approval before it can be locked. Open the slip and ask the reporting manager to approve first.',
        });
      }
    }

    await client.query('BEGIN');
    const lockRes = await client.query(
      `UPDATE payroll_payslips SET status='locked', locked_at=NOW()
        WHERE id=$1 AND status='draft' RETURNING id, employee_id, pay_month, pay_year,
                                              reimbursement, loan_recovery, gross_earnings, total_deductions, net_pay, tds, generated_at`,
      [req.params.id]
    );
    if (lockRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Only draft payslips can be locked' });
    }
    const slip = lockRes.rows[0];

    if (Number(slip.reimbursement) > 0) {
      const start = `${slip.pay_year}-${String(slip.pay_month).padStart(2, '0')}-01`;
      const end = new Date(slip.pay_year, slip.pay_month, 0).toLocaleDateString('en-CA');
      await client.query(
        `UPDATE compensation_claims SET status='paid', approved_at=COALESCE(approved_at, NOW())
          WHERE employee_id=$1 AND status='approved'
            AND claim_date BETWEEN $2::date AND $3::date
            AND (approved_at IS NULL OR approved_at <= $4)`,
        [slip.employee_id, start, end, slip.generated_at]
      );
    }

    if (Number(slip.loan_recovery) > 0) {
      const loans = await loanRecoveryFor(client, slip.employee_id);
      for (const ln of loans.lines) {
        await client.query(
          `UPDATE payroll_loans SET recovered = recovered + $1,
                  status = CASE WHEN recovered + $1 >= principal THEN 'closed' ELSE status END,
                  closed_at = CASE WHEN recovered + $1 >= principal THEN NOW() ELSE closed_at END
            WHERE id=$2`,
          [ln.amount, ln.id]
        );
      }
    }

    // Arrears: authoritative consumption happens HERE, not at draft time —
    // re-read currently-unpaid-approved increments under FOR UPDATE (closes
    // the double-consumption race a concurrent second lock/draft could
    // otherwise hit) and reconcile the slip to whatever is actually unpaid
    // right now, since a new increment may have been approved since the
    // draft was last generated.
    const unpaidRes = await client.query(
      `SELECT id, arrears_json FROM payroll_increments
        WHERE employee_id=$1 AND status='approved' AND arrears_paid=false AND arrears_json IS NOT NULL
        FOR UPDATE`,
      [slip.employee_id]
    );
    if (unpaidRes.rows.length > 0) {
      let arrearsTotal = 0;
      const claimIds = [];
      for (const row of unpaidRes.rows) {
        const amt = Number(row.arrears_json?.totalArrears) || 0;
        if (amt > 0) { arrearsTotal += amt; claimIds.push(row.id); }
      }
      if (arrearsTotal > 0) {
        const fy = fyForMonth(slip.pay_month, slip.pay_year);
        const baseGrossFull = Number(slip.gross_earnings) - arrearsTotal >= 0
          ? Number(slip.gross_earnings) : Number(slip.gross_earnings);
        const extraTds = await computeArrearsExtraTds(client, {
          employeeId: slip.employee_id, fy,
          baseAnnualGrossFull: baseGrossFull * 12, arrearsAmount: arrearsTotal,
        });
        const newGross = round2(Number(slip.gross_earnings) + arrearsTotal);
        const newTds = round2(Number(slip.tds) + extraTds);
        const newDed = round2(Number(slip.total_deductions) + extraTds);
        const newNet = round2(Number(slip.net_pay) + arrearsTotal - extraTds);
        await client.query(
          `UPDATE payroll_payslips SET arrears_amount = arrears_amount + $1, arrears_extra_tds = arrears_extra_tds + $2,
                  gross_earnings=$3, tds=$4, total_deductions=$5, net_pay=$6 WHERE id=$7`,
          [arrearsTotal, extraTds, newGross, newTds, newDed, newNet, slip.id]
        );
        for (const row of unpaidRes.rows) {
          const amt = Number(row.arrears_json?.totalArrears) || 0;
          if (amt > 0) {
            await client.query(
              `INSERT INTO payroll_payslip_arrears (payslip_id, increment_id, amount) VALUES ($1,$2,$3)`,
              [slip.id, row.id, amt]
            );
          }
        }
        await client.query(`UPDATE payroll_increments SET arrears_paid=true WHERE id = ANY($1::uuid[])`, [claimIds]);
      }
    }

    await client.query('COMMIT');
    res.json({ success: true });
    sendLockEmail(req.params.id).catch(err => logger.error({ err: err.message }, '[payroll] lock email failed'));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  } finally {
    client.release();
  }
});

router.put('/admin/payslips/:id/mark-paid', authorize(...PAYROLL_ADMIN), logAuditWrapper('MARK_PAID', 'payslip'), async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE payroll_payslips SET status='paid', paid_at=NOW() WHERE id=$1 AND status='locked' RETURNING id`,
      [req.params.id]
    );
    if (r.rows.length === 0) return res.status(400).json({ success: false, message: 'Only locked payslips can be marked paid' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.delete('/admin/payslips/:id', authorize(...PAYROLL_ADMIN), logAuditWrapper('DELETE', 'payslip'), async (req, res) => {
  try {
    const r = await pool.query(`DELETE FROM payroll_payslips WHERE id=$1 AND status='draft' RETURNING id`, [req.params.id]);
    if (r.rows.length === 0) return res.status(400).json({ success: false, message: 'Only draft payslips can be deleted' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.get('/my', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id AS "_id", slip_number AS "slipNumber", pay_month AS "payMonth", pay_year AS "payYear",
              status, gross_earnings AS "grossEarnings", net_pay AS "netPay", locked_at AS "lockedAt", paid_at AS "paidAt",
              reimbursement, total_deductions AS "totalDeductions"
         FROM payroll_payslips
        WHERE employee_id = $1 AND status IN ('locked','paid') AND superseded_by IS NULL
        ORDER BY pay_year DESC, pay_month DESC`,
      [req.user._id]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.get('/my/:id', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT p.*, e.employee_id AS "employeeCode", e.first_name AS "firstName", e.last_name AS "lastName",
              e.email, e.department, e.designation, e.company, e.joining_date,
              e.bank_name, e.bank_account, e.bank_ifsc, e.pan_number, e.uan_number
         FROM payroll_payslips p JOIN employees e ON p.employee_id = e.id
        WHERE p.id = $1 AND p.employee_id = $2 AND p.status IN ('locked','paid')`,
      [req.params.id, req.user._id]
    );
    if (r.rows.length === 0) return res.status(404).json({ success: false, message: 'Payslip not found' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.get('/team', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const month = Number(req.query.month) || (new Date().getMonth() + 1);
    const year = Number(req.query.year) || new Date().getFullYear();
    const filterClause = isFullAccess(req.user.role) ? `WHERE e.status = 'active'` : `WHERE e.reporting_manager_id = $1 AND e.status = 'active'`;
    const filterParams = isFullAccess(req.user.role) ? [] : [req.user._id];

    const team = await pool.query(
      `SELECT e.id AS "_id", e.employee_id AS "employeeId", e.first_name AS "firstName", e.last_name AS "lastName",
              e.designation, e.department, e.photo_url AS "photoUrl",
              p.id AS "payslipId", p.status AS "payslipStatus",
              p.net_pay AS "netPay", p.gross_earnings AS "grossEarnings", p.lop_days AS "lopDays"
         FROM employees e
         LEFT JOIN payroll_payslips p ON p.employee_id = e.id AND p.pay_month = $${filterParams.length + 1} AND p.pay_year = $${filterParams.length + 2} AND p.superseded_by IS NULL
         ${filterClause} ORDER BY e.first_name ASC`,
      [...filterParams, month, year]
    );

    const total = team.rows.reduce((acc, r) => ({
      headcount: acc.headcount + 1,
      withSlip: acc.withSlip + (r.payslipId ? 1 : 0),
      gross: acc.gross + Number(r.grossEarnings || 0),
      net: acc.net + Number(r.netPay || 0),
    }), { headcount: 0, withSlip: 0, gross: 0, net: 0 });

    res.json({ success: true, month, year, summary: total, data: team.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.put('/payslips/:id/approve', authorize('admin', 'director', 'hr_admin', 'manager'), logAuditWrapper('APPROVE', 'payslip'), async (req, res) => {
  try {
    const where = isFullAccess(req.user.role) ? `p.id = $1 AND p.status = 'draft'` : `p.id = $1 AND p.status = 'draft' AND e.reporting_manager_id = $2`;
    const params = isFullAccess(req.user.role) ? [req.params.id] : [req.params.id, req.user._id];
    const r = await pool.query(
      `UPDATE payroll_payslips p SET approved_by_manager_id = $${params.length + 1}, approved_by_manager_at = NOW()
         FROM employees e WHERE p.employee_id = e.id AND ${where} RETURNING p.id`,
      [...params, req.user._id]
    );
    if (r.rows.length === 0) return res.status(400).json({ success: false, message: 'Slip not found or not eligible for approval' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.post('/admin/payslips/:id/correct', authorize(...PAYROLL_ADMIN), logAuditWrapper('CORRECT', 'payslip'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const old = await client.query(`SELECT * FROM payroll_payslips WHERE id = $1 AND superseded_by IS NULL`, [req.params.id]);
    if (old.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Slip not found or already superseded' });
    }
    const o = old.rows[0];
    const b = req.body || {};
    const apply = (key, col) => b[key] !== undefined ? Number(b[key]) : Number(o[col || key] || 0);

    const basic = apply('basic'), hra = apply('hra'), conveyance = apply('conveyance');
    const otherComponents = b.otherComponents !== undefined ? b.otherComponents : (o.other_components || []);
    const otherTotal = (otherComponents || []).reduce((s, c) => s + (Number(c.value) || 0), 0);
    const bonus = apply('bonus'), overtime = apply('overtime'), reimbursement = apply('reimbursement');
    const pfE = apply('pfEmployee', 'pf_employee'), esiE = apply('esiEmployee', 'esi_employee'), pt = apply('professionalTax', 'professional_tax'), tds = apply('tds');
    const loanRec = apply('loanRecovery', 'loan_recovery'), otherAdj = apply('otherAdjustment', 'other_adjustment');
    const arrearsAmount = Number(o.arrears_amount || 0), arrearsExtraTds = Number(o.arrears_extra_tds || 0);

    const gross = round2(basic + hra + conveyance + otherTotal + bonus + overtime + reimbursement + arrearsAmount);
    const totalDed = round2(pfE + esiE + pt + tds + arrearsExtraTds + loanRec + Math.max(0, otherAdj));
    const net = round2(gross - totalDed + (otherAdj < 0 ? otherAdj : 0));

    const slip = await nextSlipNumber(client, o.pay_month, o.pay_year);
    const ins = await client.query(
      `INSERT INTO payroll_payslips
         (employee_id, pay_month, pay_year, slip_number, supersedes,
          basic, hra, conveyance, other_components,
          working_days, present_days, lop_days, lop_amount,
          pf_employee, esi_employee, professional_tax, tds,
          employer_pf, employer_epf, employer_eps, employer_esi,
          arrears_amount, arrears_extra_tds,
          gross_earnings, total_deductions, net_pay,
          reimbursement, loan_recovery, bonus, overtime, other_adjustment,
          generated_by, status)
       VALUES ($1,$2,$3,$4,$5, $6,$7,$8,$9::jsonb, $10,$11,$12,$13, $14,$15,$16,$17,
               $18,$19,$20,$21, $22,$23, $24,$25,$26, $27,$28,$29,$30,$31, $32,'draft')
       RETURNING id`,
      [o.employee_id, o.pay_month, o.pay_year, slip, o.id,
       basic, hra, conveyance, JSON.stringify(otherComponents),
       o.working_days, o.present_days, o.lop_days, o.lop_amount,
       pfE, esiE, pt, tds,
       o.employer_pf, o.employer_epf, o.employer_eps, o.employer_esi,
       arrearsAmount, arrearsExtraTds,
       gross, totalDed, net,
       reimbursement, loanRec, bonus, overtime, otherAdj,
       req.user._id]
    );
    await client.query(`UPDATE payroll_payslips SET superseded_by = $1 WHERE id = $2`, [ins.rows[0].id, o.id]);

    if (Number(o.reimbursement) > 0) {
      const start = `${o.pay_year}-${String(o.pay_month).padStart(2, '0')}-01`;
      const end = new Date(o.pay_year, o.pay_month, 0).toLocaleDateString('en-CA');
      await client.query(
        `UPDATE compensation_claims SET status = 'approved' WHERE employee_id = $1 AND status = 'paid' AND claim_date BETWEEN $2::date AND $3::date`,
        [o.employee_id, start, end]
      );
    }
    if (Number(o.loan_recovery) > 0) {
      await client.query(
        `UPDATE payroll_loans SET recovered = GREATEST(0, recovered - $1),
                status = CASE WHEN status = 'closed' THEN 'active' ELSE status END,
                closed_at = CASE WHEN status = 'closed' THEN NULL ELSE closed_at END
          WHERE employee_id = $2 AND status IN ('active','closed')`,
        [Number(o.loan_recovery), o.employee_id]
      );
    }
    // Release arrears consumed by the old slip so the corrected slip's own
    // lock can re-consume (or the increment goes back to genuinely unpaid).
    const arrearsRows = await client.query(`SELECT increment_id FROM payroll_payslip_arrears WHERE payslip_id = $1`, [o.id]);
    if (arrearsRows.rows.length > 0) {
      await client.query(
        `UPDATE payroll_increments SET arrears_paid = false WHERE id = ANY($1::uuid[])`,
        [arrearsRows.rows.map(r => r.increment_id)]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ success: true, id: ins.rows[0].id, slipNumber: slip });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  } finally { client.release(); }
});

/* ════════════════════════════════════════════════════════════════════════
 *  PHASE 3 — PDF generation + bulk salary upload
 * ══════════════════════════════════════════════════════════════════════ */

function renderPayslipDoc(doc, p) {
  const company = process.env.COMPANY_NAME || 'AltiusNxt';
  doc.font('Helvetica-Bold').fontSize(16).text(company, { align: 'center' });
  doc.font('Helvetica').fontSize(10).text('Payslip', { align: 'center' });
  doc.moveDown();
  doc.font('Helvetica-Bold').fontSize(11).text(`${p.firstName || ''} ${p.lastName || ''}`);
  doc.font('Helvetica').fontSize(9);
  doc.text(`Employee ID: ${p.employeeCode || '-'}`);
  doc.text(`Designation: ${p.designation || '-'}   Department: ${p.department || '-'}`);
  doc.text(`Pay Period: ${p.pay_month}/${p.pay_year}   Slip #: ${p.slip_number || '-'}`);
  doc.moveDown();

  doc.font('Helvetica-Bold').text('Earnings').moveUp().text('Deductions', 300);
  doc.font('Helvetica');
  const other = Array.isArray(p.other_components) ? p.other_components : [];
  let y = doc.y + 14;
  const earnLines = [['Basic', p.basic], ['HRA', p.hra], ['Conveyance', p.conveyance], ...other.map(c => [c.name, c.value])];
  if (Number(p.arrears_amount) > 0) earnLines.push(['Arrears', p.arrears_amount]);
  const dedLines = [['PF', p.pf_employee], ['ESI', p.esi_employee], ['Professional Tax', p.professional_tax], ['TDS', p.tds]];
  if (Number(p.loan_recovery) > 0) dedLines.push(['Loan Recovery', p.loan_recovery]);
  const maxLines = Math.max(earnLines.length, dedLines.length);
  for (let i = 0; i < maxLines; i++) {
    if (earnLines[i]) doc.text(`${earnLines[i][0]}: ${Number(earnLines[i][1] || 0).toFixed(2)}`, 40, y);
    if (dedLines[i]) doc.text(`${dedLines[i][0]}: ${Number(dedLines[i][1] || 0).toFixed(2)}`, 300, y);
    y += 14;
  }
  doc.y = y + 10;
  doc.font('Helvetica-Bold');
  doc.text(`Gross Earnings: ${Number(p.gross_earnings || 0).toFixed(2)}`, 40, doc.y);
  doc.text(`Total Deductions: ${Number(p.total_deductions || 0).toFixed(2)}`, 300, doc.y);
  doc.moveDown();
  doc.fontSize(12).text(`Net Pay: ${Number(p.net_pay || 0).toFixed(2)}`, { align: 'center' });
  doc.moveDown();
  doc.font('Helvetica').fontSize(8);
  doc.text('Employer Contributions (not part of take-home)');
  doc.text(`Employer PF: ${Number(p.employer_pf || 0).toFixed(2)}  (EPF ${Number(p.employer_epf || 0).toFixed(2)} + EPS ${Number(p.employer_eps || 0).toFixed(2)})`);
  doc.text(`Employer ESI: ${Number(p.employer_esi || 0).toFixed(2)}`);
  doc.moveDown();
  doc.text('Bank Details');
  doc.text(`Bank: ${p.bank_name || '-'}`);
  doc.text(`Account No: ${p.bank_account || '-'}`);
  doc.text(`IFSC: ${p.bank_ifsc || '-'}`);
}

async function buildPayslipPdfBuffer(payslip) {
  const PDFDocument = require('pdfkit');
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    renderPayslipDoc(doc, payslip);
    doc.end();
  });
}

function buildLockEmailHtml(p) {
  const company = process.env.COMPANY_NAME || 'AltiusNxt';
  return `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
    <h2 style="color:#0f172a">${company} — Payslip Ready</h2>
    <p>Hi ${p.first_name || ''},</p>
    <p>Your payslip for ${p.pay_month}/${p.pay_year} has been finalized.</p>
    <p><strong>Net Pay: ₹${Number(p.net_pay || 0).toFixed(2)}</strong></p>
    <p>Log in to Nxt People to view and download your payslip PDF.</p>
  </div>`;
}

async function sendLockEmail(payslipId) {
  const r = await pool.query(
    `SELECT p.*, e.email, e.first_name FROM payroll_payslips p JOIN employees e ON p.employee_id = e.id WHERE p.id = $1`,
    [payslipId]
  );
  const p = r.rows[0];
  if (!p?.email) return;
  await sendMail({ to: p.email, subject: `Payslip for ${p.pay_month}/${p.pay_year}`, html: buildLockEmailHtml(p) });
  await pool.query(`UPDATE payroll_payslips SET email_sent_at = NOW() WHERE id = $1`, [payslipId]);
}

router.get('/admin/payslips/:id/pdf', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT p.*, e.employee_id AS "employeeCode", e.first_name AS "firstName", e.last_name AS "lastName",
              e.designation, e.department, e.bank_name, e.bank_account, e.bank_ifsc,
              e.reporting_manager_id, e.approving_authority_id
         FROM payroll_payslips p JOIN employees e ON p.employee_id = e.id WHERE p.id = $1`,
      [req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ success: false, message: 'Payslip not found' });
    const p = r.rows[0];
    if (!isFullAccess(req.user.role)
        && String(p.reporting_manager_id) !== String(req.user._id)
        && String(p.approving_authority_id) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'You can only view your direct reports’ payslips.' });
    }
    const buf = await buildPayslipPdfBuffer(p);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="payslip-${p.pay_month}-${p.pay_year}.pdf"`);
    res.send(buf);
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.get('/my/:id/pdf', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT p.*, e.employee_id AS "employeeCode", e.first_name AS "firstName", e.last_name AS "lastName",
              e.designation, e.department, e.bank_name, e.bank_account, e.bank_ifsc
         FROM payroll_payslips p JOIN employees e ON p.employee_id = e.id
        WHERE p.id = $1 AND p.employee_id = $2 AND p.status IN ('locked','paid')`,
      [req.params.id, req.user._id]
    );
    if (r.rows.length === 0) return res.status(404).json({ success: false, message: 'Payslip not found' });
    const buf = await buildPayslipPdfBuffer(r.rows[0]);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="payslip-${r.rows[0].pay_month}-${r.rows[0].pay_year}.pdf"`);
    res.send(buf);
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.get('/admin/structure-template', authorize(...PAYROLL_ADMIN), (req, res) => {
  const wb = xlsx.utils.book_new();
  const data = [{
    'Employee ID': 'SAMPLE-EMP-ID',
    'Basic': 30000, 'HRA': 15000, 'Conveyance': 1600,
    'Other Allowances (name:amount, comma-separated)': 'Medical:1250,Special Allowance:12150',
    'PF Applicable': 'TRUE', 'ESI Applicable': 'FALSE',
    'Notes': 'Example row — replace with real employees. PF/ESI/PT are computed from Compliance Settings, not entered here.',
  }];
  const ws = xlsx.utils.json_to_sheet(data);
  xlsx.utils.book_append_sheet(wb, ws, 'Salary Structures');
  const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="salary_structure_template.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

const bulkUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.post('/admin/bulk-upload', authorize(...PAYROLL_ADMIN), logAuditWrapper('BULK_UPLOAD', 'salary_structure'), bulkUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const wb = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet);

    const results = { processed: 0, succeeded: 0, failed: [], notFound: [] };
    const today = new Date().toLocaleDateString('en-CA');

    for (const row of rows) {
      results.processed++;
      const empCode = String(row['Employee ID'] || '').trim();
      if (!empCode) { results.failed.push({ row: results.processed, reason: 'Missing Employee ID' }); continue; }
      const emp = await pool.query(`SELECT id FROM employees WHERE employee_id = $1 AND status='active'`, [empCode]);
      if (emp.rows.length === 0) { results.notFound.push(empCode); continue; }
      try {
        const basic = num(row['Basic']), hra = num(row['HRA']), conveyance = num(row['Conveyance']);
        const otherRaw = String(row['Other Allowances (name:amount, comma-separated)'] || '').trim();
        const otherComponents = otherRaw ? otherRaw.split(',').map(pair => {
          const [name, val] = pair.split(':');
          return { name: (name || '').trim(), value: num(val) };
        }).filter(c => c.name) : [];
        const otherTotal = otherComponents.reduce((s, c) => s + c.value, 0);
        const ctcAnnual = round2((basic + hra + conveyance + otherTotal) * 12);

        await pool.query(
          `INSERT INTO salary_structures (employee_id, effective_from, ctc_annual, basic, hra, conveyance, other_components, pf_applicable, esi_applicable, notes, created_by)
           VALUES ($1,$2::date,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)
           ON CONFLICT (employee_id, effective_from) DO UPDATE SET
             ctc_annual=EXCLUDED.ctc_annual, basic=EXCLUDED.basic, hra=EXCLUDED.hra, conveyance=EXCLUDED.conveyance,
             other_components=EXCLUDED.other_components, pf_applicable=EXCLUDED.pf_applicable, esi_applicable=EXCLUDED.esi_applicable`,
          [emp.rows[0].id, today, ctcAnnual, basic, hra, conveyance, JSON.stringify(otherComponents),
           String(row['PF Applicable']).toUpperCase() !== 'FALSE',
           String(row['ESI Applicable']).toUpperCase() === 'TRUE',
           row['Notes'] || null, req.user._id]
        );
        results.succeeded++;
      } catch (e) {
        results.failed.push({ row: results.processed, employeeId: empCode, reason: e.message });
      }
    }
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  }
});

/* ════════════════════════════════════════════════════════════════════════
 *  PHASE 4 — Tax declarations
 * ══════════════════════════════════════════════════════════════════════ */

function currentFY() {
  const d = new Date();
  const y = d.getFullYear();
  const fy = d.getMonth() >= 3 ? y : y - 1;
  return `${fy}-${String((fy + 1) % 100).padStart(2, '0')}`;
}

router.get('/declarations/my', async (req, res) => {
  try {
    const fy = req.query.fy || currentFY();
    const r = await pool.query(
      `SELECT id, financial_year AS "financialYear", regime,
              hra_annual_rent AS "hraAnnualRent", section_80c AS "section80c", section_80d AS "section80d",
              section_80e AS "section80e", home_loan_interest AS "homeLoanInterest", other_deductions AS "otherDeductions",
              status, rejection_reason AS "rejectionReason", created_at AS "createdAt", updated_at AS "updatedAt"
         FROM payroll_tax_declarations WHERE employee_id = $1 AND financial_year = $2`,
      [req.user._id, fy]
    );
    res.json({ success: true, data: r.rows[0] || null, financialYear: fy });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.post('/declarations', logAuditWrapper('SUBMIT', 'tax_declaration'), async (req, res) => {
  try {
    const fy = req.body.financialYear || currentFY();
    const b = req.body || {};
    const regime = b.regime || 'new';

    const windowRes = await pool.query(`SELECT is_open, opens_at, closes_at FROM payroll_declaration_windows WHERE financial_year = $1`, [fy]);
    const win = windowRes.rows[0];
    if (!win || !win.is_open) {
      return res.status(400).json({ success: false, message: 'Declaration window is closed for this financial year' });
    }
    const now = new Date();
    if (win.opens_at && now < new Date(win.opens_at)) return res.status(400).json({ success: false, message: 'Declaration window has not opened yet' });
    if (win.closes_at && now > new Date(win.closes_at)) return res.status(400).json({ success: false, message: 'Declaration window has closed' });

    const isOld = regime === 'old';
    const hraAnnualRent = isOld ? num(b.hraAnnualRent) : 0;
    const section80c = isOld ? num(b.section80c) : 0;
    const section80d = isOld ? num(b.section80d) : 0;
    const section80e = isOld ? num(b.section80e) : 0;
    const homeLoanInterest = isOld ? num(b.homeLoanInterest) : 0;
    const otherDeductions = isOld ? num(b.otherDeductions) : 0;

    const existing = await pool.query(`SELECT id, status FROM payroll_tax_declarations WHERE employee_id = $1 AND financial_year = $2`, [req.user._id, fy]);
    if (existing.rows[0] && existing.rows[0].status === 'approved') {
      return res.status(400).json({ success: false, message: 'Declaration already approved — contact HR for revisions' });
    }

    if (existing.rows[0]) {
      const r = await pool.query(
        `UPDATE payroll_tax_declarations SET regime=$1, hra_annual_rent=$2, section_80c=$3, section_80d=$4,
                section_80e=$5, home_loan_interest=$6, other_deductions=$7, status='submitted', rejection_reason=NULL, updated_at=NOW()
          WHERE id=$8 RETURNING id`,
        [regime, hraAnnualRent, section80c, section80d, section80e, homeLoanInterest, otherDeductions, existing.rows[0].id]
      );
      return res.json({ success: true, id: r.rows[0].id });
    }
    const r = await pool.query(
      `INSERT INTO payroll_tax_declarations (employee_id, financial_year, regime, hra_annual_rent, section_80c, section_80d, section_80e, home_loan_interest, other_deductions)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [req.user._id, fy, regime, hraAnnualRent, section80c, section80d, section80e, homeLoanInterest, otherDeductions]
    );
    res.status(201).json({ success: true, id: r.rows[0].id });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ success: false, message: 'A declaration for this financial year already exists. Please refresh and try again.' });
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  }
});

router.get('/admin/declarations', authorize(...PAYROLL_ADMIN), async (req, res) => {
  try {
    const status = req.query.status || 'submitted';
    const fy = req.query.fy || currentFY();
    const r = await pool.query(
      `SELECT d.id, d.financial_year AS "financialYear", d.regime,
              d.hra_annual_rent AS "hraAnnualRent", d.section_80c AS "section80c", d.section_80d AS "section80d",
              d.section_80e AS "section80e", d.home_loan_interest AS "homeLoanInterest", d.other_deductions AS "otherDeductions",
              d.status, d.rejection_reason AS "rejectionReason", d.created_at AS "createdAt", d.updated_at AS "updatedAt",
              e.id AS "employeeId", e.employee_id AS "employeeCode", e.first_name AS "firstName", e.last_name AS "lastName",
              e.department, e.designation
         FROM payroll_tax_declarations d JOIN employees e ON d.employee_id = e.id
        WHERE d.status = $1 AND d.financial_year = $2 ORDER BY d.updated_at DESC`,
      [status, fy]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.put('/admin/declarations/:id/action', authorize(...PAYROLL_ADMIN), logAuditWrapper('ACTION', 'tax_declaration'), async (req, res) => {
  try {
    const action = req.body.action === 'approve' ? 'approved' : 'rejected';
    const reason = req.body.reason || null;
    const r = await pool.query(
      `UPDATE payroll_tax_declarations SET status=$1, rejection_reason=$2, reviewed_by=$3, reviewed_at=NOW(), updated_at=NOW()
        WHERE id=$4 AND status='submitted' RETURNING id`,
      [action, action === 'rejected' ? reason : null, req.user._id, req.params.id]
    );
    if (r.rows.length === 0) return res.status(400).json({ success: false, message: 'Only submitted declarations can be actioned' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

/* ════════════════════════════════════════════════════════════════════════
 *  PHASE 5 — Compliance reports (CSV exports)
 * ══════════════════════════════════════════════════════════════════════ */

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
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

router.get('/admin/reports/:type', authorize(...PAYROLL_ADMIN), async (req, res) => {
  try {
    const type = req.params.type;
    const month = Number(req.query.month) || (new Date().getMonth() + 1);
    const year = Number(req.query.year) || new Date().getFullYear();
    const r = await pool.query(
      `SELECT e.employee_id AS code, e.first_name, e.last_name, e.uan_number, e.pan_number,
              p.pf_employee, p.esi_employee, p.professional_tax, p.tds,
              p.gross_earnings, p.basic, p.net_pay
         FROM payroll_payslips p JOIN employees e ON p.employee_id = e.id
        WHERE p.pay_month = $1 AND p.pay_year = $2 AND p.status IN ('locked','paid') AND p.superseded_by IS NULL
        ORDER BY e.first_name ASC`,
      [month, year]
    );
    const period = `${String(month).padStart(2, '0')}-${year}`;

    if (type === 'pf') return sendCsv(res, `pf-return-${period}.csv`, ['UAN', 'Employee ID', 'Name', 'Basic', 'PF Employee', 'Gross'],
      r.rows.filter(x => Number(x.pf_employee) > 0).map(x => [x.uan_number, x.code, `${x.first_name} ${x.last_name}`, x.basic, x.pf_employee, x.gross_earnings]));
    if (type === 'esi') return sendCsv(res, `esi-return-${period}.csv`, ['Employee ID', 'Name', 'Gross', 'ESI Employee'],
      r.rows.filter(x => Number(x.esi_employee) > 0).map(x => [x.code, `${x.first_name} ${x.last_name}`, x.gross_earnings, x.esi_employee]));
    if (type === 'tds') return sendCsv(res, `tds-register-${period}.csv`, ['PAN', 'Employee ID', 'Name', 'Gross', 'TDS'],
      r.rows.map(x => [x.pan_number, x.code, `${x.first_name} ${x.last_name}`, x.gross_earnings, x.tds]));
    if (type === 'pt') return sendCsv(res, `pt-register-${period}.csv`, ['Employee ID', 'Name', 'Gross', 'Professional Tax'],
      r.rows.filter(x => Number(x.professional_tax) > 0).map(x => [x.code, `${x.first_name} ${x.last_name}`, x.gross_earnings, x.professional_tax]));
    res.status(400).json({ success: false, message: 'type must be pf | esi | tds | pt' });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// GET /api/payroll/admin/payslips/export — full payslip + bank-detail CSV
// for a given month, at ANY status (unlike the NEFT export below, which is
// deliberately locked/paid-only). This is the pre-lock verification list —
// accounts can eyeball bank details against a draft run before anything is
// finalised, then this same sheet is what actually goes to the bank.

/* ════════════════════════════════════════════════════════════════════════
 *  PHASE 6 — Manager approval, corrections, adjustments, loans, NEFT
 * ══════════════════════════════════════════════════════════════════════ */

router.get('/admin/adjustments', authorize(...PAYROLL_ADMIN), async (req, res) => {
  try {
    const month = Number(req.query.month) || (new Date().getMonth() + 1);
    const year = Number(req.query.year) || new Date().getFullYear();
    const r = await pool.query(
      `SELECT a.id, a.type, a.amount, a.reason, a.created_at AS "createdAt",
              json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name) as employee
         FROM payroll_adjustments a JOIN employees e ON a.employee_id = e.id
        WHERE a.pay_month = $1 AND a.pay_year = $2 ORDER BY a.created_at DESC`,
      [month, year]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.post('/admin/adjustments', authorize(...PAYROLL_ADMIN), logAuditWrapper('CREATE', 'payroll_adjustment'), async (req, res) => {
  try {
    const { employeeId, month, year, type, amount, reason } = req.body;
    if (!employeeId || !month || !year || !type || amount == null) {
      return res.status(400).json({ success: false, message: 'employeeId, month, year, type, amount required' });
    }
    const r = await pool.query(
      `INSERT INTO payroll_adjustments (employee_id, pay_month, pay_year, type, amount, reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [employeeId, month, year, type, num(amount), reason || null, req.user._id]
    );
    res.status(201).json({ success: true, id: r.rows[0].id });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.delete('/admin/adjustments/:id', authorize(...PAYROLL_ADMIN), logAuditWrapper('DELETE', 'payroll_adjustment'), async (req, res) => {
  try {
    await pool.query(`DELETE FROM payroll_adjustments WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.get('/admin/loans', authorize(...PAYROLL_ADMIN), async (req, res) => {
  try {
    const { status } = req.query;
    const where = status ? `WHERE l.status = $1` : '';
    const r = await pool.query(
      `SELECT l.id, l.principal, l.monthly_recovery AS "monthlyRecovery", l.recovered, l.status, l.notes,
              l.issued_at AS "issuedAt",
              json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name) as employee
         FROM payroll_loans l JOIN employees e ON l.employee_id = e.id
         ${where} ORDER BY l.created_at DESC`,
      status ? [status] : []
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.post('/admin/loans', authorize(...PAYROLL_ADMIN), logAuditWrapper('CREATE', 'payroll_loan'), async (req, res) => {
  try {
    const { employeeId, principal, monthlyRecovery, notes } = req.body;
    if (!employeeId || !principal || !monthlyRecovery) {
      return res.status(400).json({ success: false, message: 'employeeId, principal, monthlyRecovery required' });
    }
    const r = await pool.query(
      `INSERT INTO payroll_loans (employee_id, principal, monthly_recovery, notes, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [employeeId, num(principal), num(monthlyRecovery), notes || null, req.user._id]
    );
    res.status(201).json({ success: true, id: r.rows[0].id });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.put('/admin/loans/:id', authorize(...PAYROLL_ADMIN), logAuditWrapper('UPDATE', 'payroll_loan'), async (req, res) => {
  try {
    const { status, monthlyRecovery, notes } = req.body;
    const r = await pool.query(
      `UPDATE payroll_loans SET
         status = COALESCE($1, status),
         monthly_recovery = COALESCE($2, monthly_recovery),
         notes = COALESCE($3, notes),
         closed_at = CASE WHEN $1 = 'closed' THEN NOW() ELSE closed_at END
       WHERE id = $4 RETURNING id`,
      [status || null, monthlyRecovery != null ? num(monthlyRecovery) : null, notes || null, req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ success: false, message: 'Loan not found' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.delete('/admin/loans/:id', authorize(...PAYROLL_ADMIN), logAuditWrapper('DELETE', 'payroll_loan'), async (req, res) => {
  try {
    const check = await pool.query(`SELECT recovered FROM payroll_loans WHERE id = $1`, [req.params.id]);
    if (check.rows.length === 0) return res.status(404).json({ success: false, message: 'Loan not found' });
    if (Number(check.rows[0].recovered) > 0) {
      return res.status(400).json({ success: false, message: 'Cannot delete a loan that already has recovery recorded against it' });
    }
    await pool.query(`DELETE FROM payroll_loans WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.get('/admin/reports/neft/status', authorize(...PAYROLL_ADMIN), async (req, res) => {
  try {
    const month = Number(req.query.month) || (new Date().getMonth() + 1);
    const year = Number(req.query.year) || new Date().getFullYear();
    const r = await pool.query(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE payment_exported_at IS NOT NULL) AS already_exported,
              COUNT(*) FILTER (WHERE payment_exported_at IS NULL) AS fresh,
              MAX(payment_exported_at) AS last_exported_at
         FROM payroll_payslips
        WHERE pay_month = $1 AND pay_year = $2 AND status IN ('locked','paid') AND superseded_by IS NULL`,
      [month, year]
    );
    const row = r.rows[0] || {};
    res.json({
      success: true, month, year,
      total: Number(row.total || 0), alreadyExported: Number(row.already_exported || 0),
      fresh: Number(row.fresh || 0), lastExportedAt: row.last_exported_at,
    });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.get('/admin/reports/neft', authorize(...PAYROLL_ADMIN), async (req, res) => {
  try {
    const month = Number(req.query.month) || (new Date().getMonth() + 1);
    const year = Number(req.query.year) || new Date().getFullYear();
    const force = req.query.force === 'true';

    const dupeCheck = await pool.query(
      `SELECT COUNT(*) AS already_exported, MAX(payment_exported_at) AS last_exported_at
         FROM payroll_payslips
        WHERE pay_month = $1 AND pay_year = $2 AND status IN ('locked','paid') AND superseded_by IS NULL AND payment_exported_at IS NOT NULL`,
      [month, year]
    );
    const alreadyExported = Number(dupeCheck.rows[0]?.already_exported || 0);
    if (alreadyExported > 0 && !force) {
      return res.status(409).json({
        success: false, code: 'ALREADY_EXPORTED',
        message: `${alreadyExported} payslip(s) for ${String(month).padStart(2, '0')}/${year} were already exported to the bank on ${dupeCheck.rows[0].last_exported_at}. Re-download could cause a double payment. Add ?force=true to override.`,
        alreadyExported, lastExportedAt: dupeCheck.rows[0].last_exported_at,
      });
    }

    const r = await pool.query(
      `SELECT p.id AS payslip_id, e.employee_id AS code, e.first_name, e.last_name,
              e.bank_account, e.bank_ifsc, e.bank_name, p.net_pay, p.slip_number
         FROM payroll_payslips p JOIN employees e ON p.employee_id = e.id
        WHERE p.pay_month = $1 AND p.pay_year = $2 AND p.status IN ('locked','paid') AND p.superseded_by IS NULL
        ORDER BY e.first_name ASC`,
      [month, year]
    );

    const ids = r.rows.map(x => x.payslip_id);
    if (ids.length > 0) {
      await pool.query(`UPDATE payroll_payslips SET payment_exported_at = NOW() WHERE id = ANY($1::uuid[])`, [ids]);
    }

    const period = `${String(month).padStart(2, '0')}-${year}`;
    sendCsv(res, `neft-${period}.csv`, ['Beneficiary Name', 'Beneficiary A/c No', 'IFSC', 'Bank', 'Amount', 'Reference'],
      r.rows.map(x => [`${x.first_name} ${x.last_name}`, x.bank_account || '', x.bank_ifsc || '', x.bank_name || '', x.net_pay, x.slip_number || '']));
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.get('/admin/tax-slabs', authorize(...PAYROLL_ADMIN), async (req, res) => {
  try {
    const fy = req.query.fy || currentFY();
    const r = await pool.query(
      `SELECT regime, threshold_from AS "from", threshold_to AS "to", rate_percent AS "ratePercent", seq
         FROM payroll_tax_slabs WHERE financial_year = $1 ORDER BY regime, seq`,
      [fy]
    );
    const out = { old: [], new: [] };
    for (const row of r.rows) if (out[row.regime]) out[row.regime].push(row);
    res.json({ success: true, data: out, financialYear: fy });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

module.exports = router;
module.exports.runMonthlyPayroll = runMonthlyPayroll;
// Reused by reports.js so the Leave/Attendance reports (Loss of pay,
// Muster roll, Expected vs Worked Hours) read the working-day calendar and
// LOP exactly the same way Payroll Run itself computes it — one
// implementation, not a second copy that could drift.
module.exports.lopDaysForRange = lopDaysForRange;
module.exports.absentDaysForRange = absentDaysForRange;
module.exports.listWorkingDays = listWorkingDays;
module.exports.loadHolidaysAndRules = loadHolidaysAndRules;
module.exports.workingDaysInRange = workingDaysInRange;
