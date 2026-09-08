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

/** The wage PF is charged on.
 *
 *  'restricted' caps it at the statutory ceiling (15,000) — the default, and
 *  what this system did unconditionally before. 'actual' contributes on the
 *  real basic however high it goes, which is Zoho's "12% of Actual PF Wage"
 *  option. The choice lives on the salary structure because it is negotiated
 *  per employee, not set org-wide.
 */
function pfWageFor(basic, settings, wageBasis) {
  const b = Number(basic) || 0;
  if (wageBasis === 'actual') return b;
  return Math.min(b, Number(settings.pf_wage_ceiling) || 15000);
}

/** Employee-side PF. `override` (salary_structures.pf_override) bypasses the
 *  formula entirely when set — the per-employee escape hatch. */
function computePF(basic, settings, pfApplicable, override, wageBasis) {
  if (override != null) return round2(override);
  if (!pfApplicable) return 0;
  return round2(pfWageFor(basic, settings, wageBasis) * (Number(settings.pf_rate) || 0.12));
}

/** Everything the employer pays into EPF for one month.
 *
 *  This used to be the 12% alone, with a comment conceding that admin charges
 *  and EDLI were left out as an "accepted approximation". They are not an
 *  approximation in a CTC figure — against Zoho, the missing 0.5% admin
 *  charge was 696 a year on a single employee, and CTC is the number that
 *  ends up on an offer letter.
 *
 *  The 12% splits into EPS and EPF; admin charges and EDLI sit on top and are
 *  employer cost, never a deduction. EPS is normally pegged to the restricted
 *  wage even when EPF follows the actual one, which is exactly what Zoho's
 *  "Contribute EPS at actual PF Wages" tick changes.
 *
 *  opts: { wageBasis, epsEnabled, epsAtActualWage }
 */
function computeEmployerPF(basic, settings, pfApplicable, opts = {}) {
  if (!pfApplicable) return { total: 0, epf: 0, eps: 0, admin: 0, edli: 0, grandTotal: 0 };

  const { wageBasis, epsEnabled = true, epsAtActualWage = false } = opts;
  const wage = pfWageFor(basic, settings, wageBasis);
  const rate = Number(settings.pf_rate) || 0.12;
  const total = round2(wage * rate);

  // EPS follows the restricted wage unless explicitly told otherwise — the
  // whole point of the separate tick.
  const epsWage = epsAtActualWage ? wage : pfWageFor(basic, settings, 'restricted');
  const eps = epsEnabled ? round2(epsWage * rate * 8.33 / 12) : 0;
  // Whatever the 12% does not spend on EPS goes to EPF, so the two always sum
  // back to the contribution rather than drifting apart.
  const epf = round2(total - eps);

  // Admin and EDLI are charged on the restricted wage, the way EPFO bills
  // them, regardless of which basis EPF itself follows.
  const statutoryWage = pfWageFor(basic, settings, 'restricted');
  const admin = round2(statutoryWage * (Number(settings.epf_admin_rate) || 0));
  const edli = round2(statutoryWage * (Number(settings.edli_rate) || 0));

  return { total, epf, eps, admin, edli, grandTotal: round2(total + admin + edli) };
}

/** The wage ESI is charged on.
 *
 *  Not simply the gross: Zoho leaves the statutory bonus out, which is why
 *  its employer ESI on Balaji D is 3.25% of 12,800 (basic + HRA) rather than
 *  of the 13,488 gross. The excluded names are configuration, so a payroll
 *  admin can correct the list without a deploy.
 *
 *  components: [{ name, value }] — the named earnings beyond basic/HRA/conveyance.
 */
function esiWageFor({ basic = 0, hra = 0, conveyance = 0, components = [] }, settings) {
  const excludes = new Set(
    (Array.isArray(settings.esi_wage_excludes) ? settings.esi_wage_excludes : [])
      .map(n => String(n).trim().toLowerCase()));
  const extra = components
    .filter(c => !excludes.has(String(c?.name ?? '').trim().toLowerCase()))
    .reduce((s, c) => s + (Number(c?.value) || 0), 0);
  return round2((Number(basic) || 0) + (Number(hra) || 0) + (Number(conveyance) || 0) + extra);
}

/** Employer-borne benefits — Mediclaim, Gratuity, Accident Insurance and the
 *  like. Part of cost to company, never deducted from anybody. */
function benefitsTotal(benefits) {
  if (!Array.isArray(benefits)) return 0;
  return round2(benefits.reduce((s, b) => s + (Number(b?.monthly) || 0), 0));
}

/** Cost to company for one month — every rupee the employer spends.
 *
 *  One function so the setup screen, the payslip and any report cannot each
 *  arrive at a different CTC. The setup screen used to compute
 *  `gross * 12 + employerPf * 12` inline, which silently left out employer
 *  ESI and admin charges and understated everybody's CTC.
 */
function computeCTC({ gross, employerPf, employerEsi, benefits }) {
  const pf = employerPf && typeof employerPf === 'object'
    ? (Number(employerPf.grandTotal) || 0)
    : (Number(employerPf) || 0);
  const monthly = round2((Number(gross) || 0) + pf + (Number(employerEsi) || 0) + (Number(benefits) || 0));
  return { monthly, annual: round2(monthly * 12) };
}

/** Employee-side ESI. Threshold, not a cap — once gross exceeds it, ESI is
 *  fully zero for the month (matches real ESI: you exit the scheme, the base
 *  isn't just capped). */
/* ESIC rounds a contribution UP to the next rupee — not to nearest, and not
 * down. Rounding to two decimals instead is what put us a rupee under Zoho on
 * the employer share: 12,788 x 3.25% is 415.61, which ESIC and Zoho both
 * charge as 416. A rupee an employee a month is small until it is a
 * reconciliation against an ESIC challan that never quite balances. */
const roundUpRupee = (n) => Math.ceil((Number(n) || 0) - 1e-9);

function computeESIEmployee(wage, settings, esiApplicable, override) {
  if (override != null) return round2(override);
  if (!esiApplicable) return 0;
  const w = Number(wage) || 0;
  if (w > (Number(settings.esi_threshold) || 21000)) return 0;
  return roundUpRupee(w * (Number(settings.esi_employee_rate) || 0.0075));
}

function computeEmployerESI(wage, settings, esiApplicable) {
  if (!esiApplicable) return 0;
  const w = Number(wage) || 0;
  if (w > (Number(settings.esi_threshold) || 21000)) return 0;
  return roundUpRupee(w * (Number(settings.esi_employer_rate) || 0.0325));
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
  pfWageFor,
  esiWageFor,
  benefitsTotal,
  computeCTC,
  computePT,
  computeMonthlyTDS,
  computeArrearsExtraTds,
  getUnpaidArrears,
  splitCtcFromTemplate,
};
