/**
 * utils/payroll-calc.js — shared payroll math, used by routes/payroll.js and
 * every routes/payroll-*.js file. Centralised so compliance-rate logic can't
 * drift between files the way the old run-month route and the server.js cron
 * used to (two independent, slowly-diverging reimplementations of the same
 * thing — this file exists specifically so that never happens again).
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Resolve the compliance settings row in effect on `asOf` (Date or 'YYYY-MM-DD').
 *  Falls back to the same defaults the migration seeds, in case the seed row
 *  is ever missing (e.g. a fresh install where migrate_payroll_v2 hasn't run). */
async function resolveComplianceSettings(client, asOf) {
  const asOfStr = asOf instanceof Date ? asOf.toLocaleDateString('en-CA') : asOf;
  const r = await client.query(
    `SELECT * FROM payroll_compliance_settings WHERE effective_from <= $1::date ORDER BY effective_from DESC LIMIT 1`,
    [asOfStr]
  );
  if (r.rows[0]) return r.rows[0];
  return {
    pf_rate: 0.12, pf_wage_ceiling: 15000,
    esi_employee_rate: 0.0075, esi_employer_rate: 0.0325, esi_threshold: 21000,
    pt_slabs: [],
  };
}

/** Resolve the salary structure row in effect on `asOf` — open-interval model,
 *  "the structure in effect on date X" = latest row with effective_from <= X.
 *  Payroll runs must pass the PAY MONTH's last day, not "today" — otherwise
 *  correcting/re-running a past month after a later raise silently uses the
 *  wrong structure. */
async function resolveSalaryStructure(client, employeeId, asOf) {
  const asOfStr = asOf instanceof Date ? asOf.toLocaleDateString('en-CA') : asOf;
  const r = await client.query(
    `SELECT * FROM salary_structures WHERE employee_id = $1 AND effective_from <= $2::date ORDER BY effective_from DESC LIMIT 1`,
    [employeeId, asOfStr]
  );
  return r.rows[0] || null;
}

/** Employee-side PF. `override` (salary_structures.pf_override) bypasses the
 *  formula entirely when set — the per-employee escape hatch. */
function computePF(basic, settings, pfApplicable, override) {
  if (override != null) return round2(override);
  if (!pfApplicable) return 0;
  const base = Math.min(Number(basic) || 0, Number(settings.pf_wage_ceiling) || 15000);
  return round2(base * (Number(settings.pf_rate) || 0.12));
}

/** Employer-side PF, split into EPS (8.33 of the 12 statutory points) and EPF
 *  (the remainder). Simplification: real EPFO employer contribution isn't
 *  simply "same total rate as employee PF" (admin charges, EDLI differ) —
 *  accepted approximation, ported from the design prototype deliberately. */
function computeEmployerPF(basic, settings, pfApplicable) {
  if (!pfApplicable) return { total: 0, epf: 0, eps: 0 };
  const base = Math.min(Number(basic) || 0, Number(settings.pf_wage_ceiling) || 15000);
  const total = round2(base * (Number(settings.pf_rate) || 0.12));
  const eps = round2(total * 8.33 / 12);
  const epf = round2(total - eps);
  return { total, epf, eps };
}

/** Employee-side ESI. Threshold, not a cap — once gross exceeds it, ESI is
 *  fully zero for the month (matches real ESI: you exit the scheme, the base
 *  isn't just capped). */
function computeESIEmployee(gross, settings, esiApplicable, override) {
  if (override != null) return round2(override);
  if (!esiApplicable) return 0;
  const g = Number(gross) || 0;
  if (g > (Number(settings.esi_threshold) || 21000)) return 0;
  return round2(g * (Number(settings.esi_employee_rate) || 0.0075));
}

function computeEmployerESI(gross, settings, esiApplicable) {
  if (!esiApplicable) return 0;
  const g = Number(gross) || 0;
  if (g > (Number(settings.esi_threshold) || 21000)) return 0;
  return round2(g * (Number(settings.esi_employer_rate) || 0.0325));
}

/** Professional Tax — state-specific slabs, sorted ascending by `upTo` before
 *  matching (never trust stored array order — an unbounded row entered first
 *  would otherwise swallow every gross into the wrong bracket). First slab
 *  where gross <= upTo (or upTo is null/unbounded) wins. No match on state -> 0. */
function computePT(gross, settings, state, override) {
  if (override != null) return round2(override);
  const slabs = Array.isArray(settings.pt_slabs) ? settings.pt_slabs : [];
  const stateSlabs = slabs.find(s => String(s.state || '').toLowerCase() === String(state || '').toLowerCase());
  if (!stateSlabs || !Array.isArray(stateSlabs.slabs)) return 0;
  const sorted = [...stateSlabs.slabs].sort((a, b) => {
    const av = a.upTo == null ? Infinity : Number(a.upTo);
    const bv = b.upTo == null ? Infinity : Number(b.upTo);
    return av - bv;
  });
  const g = Number(gross) || 0;
  for (const slab of sorted) {
    if (slab.upTo == null || g <= Number(slab.upTo)) return round2(slab.amountPerMonth);
  }
  return 0;
}

/** Pure slab-walk + Section 87A rebate + 4% cess. Same math as the original
 *  computeMonthlyTDS, factored out so arrears can compute an incremental
 *  delta against the same slab table without duplicating the walk. */
function computeAnnualTaxFromSlabs(taxableIncome, regime, slabs) {
  let annualTax = 0;
  for (const s of slabs) {
    const from = Number(s.threshold_from);
    const to = s.threshold_to === null ? Infinity : Number(s.threshold_to);
    const rate = Number(s.rate_percent);
    if (taxableIncome <= from) break;
    const slice = Math.min(taxableIncome, to) - from;
    if (slice > 0) annualTax += slice * (rate / 100);
  }
  if (regime === 'old' && taxableIncome <= 5_00_000) annualTax = Math.max(0, annualTax - 12_500);
  if (regime === 'new' && taxableIncome <= 7_00_000) annualTax = Math.max(0, annualTax - 25_000);
  return annualTax * 1.04;
}

/** Resolve the employee's approved regime + taxable income (after standard
 *  deduction, and exemptions if old-regime + approved) for a given annual
 *  gross projection. Default = new regime, no exemptions, if no approved
 *  declaration exists for the FY. */
async function resolveRegimeAndTaxableIncome(client, employeeId, fy, annualGrossFull) {
  const declRes = await client.query(
    `SELECT regime, hra_annual_rent, section_80c, section_80d, section_80e,
            home_loan_interest, other_deductions, status
       FROM payroll_tax_declarations
      WHERE employee_id = $1 AND financial_year = $2`,
    [employeeId, fy]
  );
  const decl = declRes.rows[0];
  const regime = (decl?.status === 'approved' && decl?.regime) ? decl.regime : 'new';

  let taxableIncome = annualGrossFull - 50000; // standard deduction, both regimes
  if (regime === 'old' && decl?.status === 'approved') {
    const cap = (v, max) => Math.min(Number(v || 0), max);
    taxableIncome -= cap(decl.hra_annual_rent, 1_50_000);
    taxableIncome -= cap(decl.section_80c, 1_50_000);
    taxableIncome -= cap(decl.section_80d, 25_000);
    taxableIncome -= Number(decl.section_80e || 0);
    taxableIncome -= cap(decl.home_loan_interest, 2_00_000);
    taxableIncome -= Number(decl.other_deductions || 0);
  }
  if (taxableIncome < 0) taxableIncome = 0;
  return { regime, taxableIncome };
}

/** Monthly TDS for an employee — unchanged behavior from the original,
 *  already-verified computeMonthlyTDS. Returns 0 if no slabs are seeded for
 *  the FY/regime (graceful degradation) or the gross is non-finite/<=0. */
async function computeMonthlyTDS(client, { employeeId, monthlyGrossFull, fy }) {
  if (!Number.isFinite(monthlyGrossFull) || monthlyGrossFull <= 0) return 0;
  const annualGrossFull = monthlyGrossFull * 12;
  const { regime, taxableIncome } = await resolveRegimeAndTaxableIncome(client, employeeId, fy, annualGrossFull);

  const slabsRes = await client.query(
    `SELECT threshold_from, threshold_to, rate_percent FROM payroll_tax_slabs
      WHERE financial_year = $1 AND regime = $2 ORDER BY seq ASC`,
    [fy, regime]
  );
  if (slabsRes.rows.length === 0) return 0;

  const annualTax = computeAnnualTaxFromSlabs(taxableIncome, regime, slabsRes.rows);
  return Math.round(annualTax / 12);
}

/** Incremental extra TDS for a lump-sum arrears payment in one month — the
 *  difference between "annual tax with arrears added to projected annual
 *  gross" and "annual tax without it", withheld entirely in the month the
 *  arrears is paid (not spread over 12 months, not a flat re-annualization —
 *  this mirrors how real payroll withholds an unusual lump sum). Returns 0 if
 *  no slabs are seeded. */
async function computeArrearsExtraTds(client, { employeeId, fy, baseAnnualGrossFull, arrearsAmount }) {
  if (!arrearsAmount || arrearsAmount <= 0) return 0;
  const { regime, taxableIncome: baseTaxable } = await resolveRegimeAndTaxableIncome(client, employeeId, fy, baseAnnualGrossFull);
  const { taxableIncome: withArrearsTaxable } = await resolveRegimeAndTaxableIncome(client, employeeId, fy, baseAnnualGrossFull + arrearsAmount);

  const slabsRes = await client.query(
    `SELECT threshold_from, threshold_to, rate_percent FROM payroll_tax_slabs
      WHERE financial_year = $1 AND regime = $2 ORDER BY seq ASC`,
    [fy, regime]
  );
  if (slabsRes.rows.length === 0) return 0;

  const baseTax = computeAnnualTaxFromSlabs(baseTaxable, regime, slabsRes.rows);
  const withArrearsTax = computeAnnualTaxFromSlabs(withArrearsTaxable, regime, slabsRes.rows);
  return Math.round(withArrearsTax - baseTax);
}

/** Sum of unpaid, approved increment arrears for an employee — a read-only
 *  preview (no row lock). The actual consumption/lock happens in payroll.js's
 *  lock handler with a FOR UPDATE claim, not here. */
async function getUnpaidArrears(client, employeeId) {
  const r = await client.query(
    `SELECT id, arrears_json FROM payroll_increments
      WHERE employee_id = $1 AND status = 'approved' AND arrears_paid = false AND arrears_json IS NOT NULL`,
    [employeeId]
  );
  let total = 0;
  const incrementIds = [];
  for (const row of r.rows) {
    const amt = Number(row.arrears_json?.totalArrears) || 0;
    if (amt > 0) { total += amt; incrementIds.push(row.id); }
  }
  return { total: round2(total), incrementIds };
}

/** Apply a salary template to an annual CTC -> monthly basic/hra/conveyance +
 *  other_components. type='percent_of_ctc': value is a percentage of ANNUAL
 *  ctc, divided by 12 for the monthly figure. type='fixed': value is already
 *  a flat monthly amount, used as-is. Name matching for basic/hra/conveyance
 *  is case-insensitive; everything else becomes an other_components entry. */
function splitCtcFromTemplate(ctcAnnual, components) {
  const ctc = Number(ctcAnnual) || 0;
  const resolved = (components || []).map(def => {
    const monthly = def.type === 'percent_of_ctc'
      ? round2((Number(def.value) / 100) * ctc / 12)
      : round2(def.value);
    return { name: def.name, value: monthly };
  });

  let basic = 0, hra = 0, conveyance = 0;
  const otherComponents = [];
  for (const c of resolved) {
    const key = String(c.name).trim().toLowerCase();
    if (key === 'basic') basic = c.value;
    else if (key === 'hra') hra = c.value;
    else if (key === 'conveyance') conveyance = c.value;
    else otherComponents.push(c);
  }
  return { basic, hra, conveyance, otherComponents };
}

module.exports = {
  resolveComplianceSettings,
  resolveSalaryStructure,
  computePF,
  computeEmployerPF,
  computeESIEmployee,
  computeEmployerESI,
  computePT,
  computeMonthlyTDS,
  computeArrearsExtraTds,
  getUnpaidArrears,
  splitCtcFromTemplate,
};
