/**
 * migrate_payroll_v2.js — Full payroll module rebuild.
 *
 * Archives every existing payroll-related table (renamed, not dropped — a
 * human-inspectable safety net, not a data migration path) and creates the
 * new schema: salary templates, open-interval salary structures, versioned
 * compliance settings (PF/ESI/PT rates), increments & arrears, declaration
 * windows, and the extended payslip shape (employer contributions + arrears).
 *
 * Old data is NOT migrated into the new shape — this is an intentional
 * clean-slate rebuild, not an in-place upgrade. See the archive_* tables to
 * recover old figures by hand if ever needed.
 *
 * Safe to run multiple times (idempotent).
 */

const pool = require('./db');

const ARCHIVE_SUFFIX = '20260806';

// Renames `from` -> `archive_<from>_<suffix>` only if `from` exists and the
// archive name doesn't already exist (so re-running this script is a no-op
// on a box where the rename already happened).
function archiveRename(from) {
  const to = `archive_${from}_${ARCHIVE_SUFFIX}`;
  return `DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = '${from}')
         AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = '${to}') THEN
        ALTER TABLE ${from} RENAME TO ${to};
      END IF;
    END$$`;
}

const steps = [
  // ── Archive every table this rebuild changes the shape of ────────────────
  archiveRename('salary_structures'),
  archiveRename('payroll_payslips'),
  archiveRename('payroll_tax_declarations'),
  archiveRename('payroll_tax_slabs'),
  archiveRename('payroll_adjustments'),
  archiveRename('payroll_loans'),
  archiveRename('payslips'),

  // ── Salary Templates (new) ────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS salary_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(120) NOT NULL,
    band VARCHAR(60),
    created_by UUID REFERENCES employees(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS salary_template_components (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES salary_templates(id) ON DELETE CASCADE,
    name VARCHAR(60) NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('fixed','percent_of_ctc')),
    value NUMERIC(12,4) NOT NULL,
    seq INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_template_components ON salary_template_components(template_id)`,

  // ── Salary Structures (redesigned: open interval, CTC-aware, JSONB) ───────
  // effective_to is gone — "structure in effect on date X" = latest row with
  // effective_from <= X. Needed so a backdated increment can insert a row in
  // the past without having to retroactively re-close an already-closed one.
  `CREATE TABLE IF NOT EXISTS salary_structures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    effective_from DATE NOT NULL,
    template_id UUID REFERENCES salary_templates(id) ON DELETE SET NULL,
    ctc_annual NUMERIC(14,2) NOT NULL DEFAULT 0,
    basic NUMERIC(12,2) NOT NULL DEFAULT 0,
    hra NUMERIC(12,2) NOT NULL DEFAULT 0,
    conveyance NUMERIC(12,2) NOT NULL DEFAULT 0,
    other_components JSONB NOT NULL DEFAULT '[]',
    pf_applicable BOOLEAN NOT NULL DEFAULT TRUE,
    esi_applicable BOOLEAN NOT NULL DEFAULT FALSE,
    pf_override NUMERIC(12,2),
    esi_override NUMERIC(12,2),
    pt_override NUMERIC(12,2),
    notes TEXT,
    created_by UUID REFERENCES employees(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (employee_id, effective_from)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_salary_struct_lookup ON salary_structures (employee_id, effective_from DESC)`,

  // ── Compliance Settings (new — versioned, effective-dated) ────────────────
  `CREATE TABLE IF NOT EXISTS payroll_compliance_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pf_rate NUMERIC(6,4) NOT NULL DEFAULT 0.1200,
    pf_wage_ceiling NUMERIC(12,2) NOT NULL DEFAULT 15000,
    esi_employee_rate NUMERIC(6,4) NOT NULL DEFAULT 0.0075,
    esi_employer_rate NUMERIC(6,4) NOT NULL DEFAULT 0.0325,
    esi_threshold NUMERIC(12,2) NOT NULL DEFAULT 21000,
    pt_slabs JSONB NOT NULL DEFAULT '[]',
    effective_from DATE NOT NULL,
    created_by UUID REFERENCES employees(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_compliance_settings_effective ON payroll_compliance_settings(effective_from DESC)`,
  // Seed one default row far enough in the past that it's always resolvable.
  `INSERT INTO payroll_compliance_settings (pf_rate, pf_wage_ceiling, esi_employee_rate, esi_employer_rate, esi_threshold, pt_slabs, effective_from)
     SELECT 0.12, 15000, 0.0075, 0.0325, 21000,
       '[{"state":"Karnataka","slabs":[{"upTo":15000,"amountPerMonth":0},{"upTo":null,"amountPerMonth":200}]},
         {"state":"Tamil Nadu","slabs":[{"upTo":21000,"amountPerMonth":0},{"upTo":null,"amountPerMonth":208}]}]'::jsonb,
       '2020-01-01'
     WHERE NOT EXISTS (SELECT 1 FROM payroll_compliance_settings)`,

  // ── Increments & Arrears (new) ─────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS payroll_increments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    current_gross NUMERIC(12,2) NOT NULL,
    proposed_gross NUMERIC(12,2) NOT NULL,
    effective_date DATE NOT NULL,
    proposed_by UUID NOT NULL REFERENCES employees(id),
    approved_by UUID REFERENCES employees(id),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    arrears_json JSONB,
    arrears_paid BOOLEAN NOT NULL DEFAULT FALSE,
    rejection_reason TEXT,
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_increments_employee ON payroll_increments(employee_id, status)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_increment_pending ON payroll_increments(employee_id) WHERE status = 'pending'`,

  // ── Declaration Windows (new) ──────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS payroll_declaration_windows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    financial_year VARCHAR(9) NOT NULL UNIQUE,
    is_open BOOLEAN NOT NULL DEFAULT FALSE,
    opens_at TIMESTAMPTZ,
    closes_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ── Payslips — extended (employer contributions + arrears, snapshot-first) ─
  `CREATE TABLE IF NOT EXISTS payroll_payslips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    pay_month INTEGER NOT NULL CHECK (pay_month BETWEEN 1 AND 12),
    pay_year INTEGER NOT NULL CHECK (pay_year >= 2020),
    basic NUMERIC(12,2) DEFAULT 0,
    hra NUMERIC(12,2) DEFAULT 0,
    conveyance NUMERIC(12,2) DEFAULT 0,
    other_components JSONB DEFAULT '[]',
    working_days NUMERIC(5,2) DEFAULT 0,
    present_days NUMERIC(5,2) DEFAULT 0,
    lop_days NUMERIC(5,2) DEFAULT 0,
    lop_amount NUMERIC(12,2) DEFAULT 0,
    pf_employee NUMERIC(12,2) DEFAULT 0,
    esi_employee NUMERIC(12,2) DEFAULT 0,
    professional_tax NUMERIC(12,2) DEFAULT 0,
    tds NUMERIC(12,2) DEFAULT 0,
    employer_pf NUMERIC(12,2) DEFAULT 0,
    employer_epf NUMERIC(12,2) DEFAULT 0,
    employer_eps NUMERIC(12,2) DEFAULT 0,
    employer_esi NUMERIC(12,2) DEFAULT 0,
    arrears_amount NUMERIC(12,2) DEFAULT 0,
    arrears_extra_tds NUMERIC(12,2) DEFAULT 0,
    gross_earnings NUMERIC(12,2) DEFAULT 0,
    total_deductions NUMERIC(12,2) DEFAULT 0,
    net_pay NUMERIC(12,2) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'draft',
    pdf_url VARCHAR(500),
    generated_at TIMESTAMPTZ DEFAULT NOW(),
    generated_by UUID REFERENCES employees(id),
    locked_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    notes TEXT,
    slip_number VARCHAR(30),
    supersedes UUID REFERENCES payroll_payslips(id),
    superseded_by UUID REFERENCES payroll_payslips(id),
    approved_by_manager_id UUID REFERENCES employees(id),
    approved_by_manager_at TIMESTAMPTZ,
    reimbursement NUMERIC(12,2) DEFAULT 0,
    loan_recovery NUMERIC(12,2) DEFAULT 0,
    bonus NUMERIC(12,2) DEFAULT 0,
    overtime NUMERIC(12,2) DEFAULT 0,
    other_adjustment NUMERIC(12,2) DEFAULT 0,
    email_sent_at TIMESTAMPTZ,
    payment_exported_at TIMESTAMPTZ
  )`,
  `CREATE INDEX IF NOT EXISTS idx_payslips_period ON payroll_payslips (pay_year, pay_month, status)`,
  `CREATE INDEX IF NOT EXISTS idx_payslips_employee_period ON payroll_payslips (employee_id, pay_year DESC, pay_month DESC)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_payslip_slip_number ON payroll_payslips (slip_number) WHERE slip_number IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_payslip_active ON payroll_payslips (employee_id, pay_month, pay_year) WHERE superseded_by IS NULL`,

  // Join table: which payslip consumed which increment's arrears, and how
  // much. Lets the correction/supersede flow release arrears_paid the same
  // way it already releases compensation_claims and loan recovery.
  `CREATE TABLE IF NOT EXISTS payroll_payslip_arrears (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payslip_id UUID NOT NULL REFERENCES payroll_payslips(id) ON DELETE CASCADE,
    increment_id UUID NOT NULL REFERENCES payroll_increments(id),
    amount NUMERIC(12,2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_payslip_arrears_payslip ON payroll_payslip_arrears(payslip_id)`,
  `CREATE INDEX IF NOT EXISTS idx_payslip_arrears_increment ON payroll_payslip_arrears(increment_id)`,

  // ── Tax declarations / tax slabs — unchanged shape, recreated as-is ────────
  `CREATE TABLE IF NOT EXISTS payroll_tax_declarations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    financial_year VARCHAR(9) NOT NULL,
    regime VARCHAR(10) DEFAULT 'new' CHECK (regime IN ('old','new')),
    hra_annual_rent NUMERIC(12,2) DEFAULT 0,
    section_80c NUMERIC(12,2) DEFAULT 0,
    section_80d NUMERIC(12,2) DEFAULT 0,
    section_80e NUMERIC(12,2) DEFAULT 0,
    home_loan_interest NUMERIC(12,2) DEFAULT 0,
    other_deductions NUMERIC(12,2) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'submitted',
    rejection_reason TEXT,
    reviewed_by UUID REFERENCES employees(id),
    reviewed_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (employee_id, financial_year)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tax_decl_status ON payroll_tax_declarations (status, financial_year DESC)`,

  `CREATE TABLE IF NOT EXISTS payroll_tax_slabs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    financial_year VARCHAR(9) NOT NULL,
    regime VARCHAR(10) NOT NULL CHECK (regime IN ('old','new')),
    threshold_from NUMERIC(14,2) NOT NULL,
    threshold_to NUMERIC(14,2),
    rate_percent NUMERIC(5,2) NOT NULL,
    seq INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tax_slabs_lookup ON payroll_tax_slabs (financial_year, regime, seq)`,
  `INSERT INTO payroll_tax_slabs (financial_year, regime, threshold_from, threshold_to, rate_percent, seq)
     SELECT * FROM (VALUES
       ('2026-27','new',       0::numeric,  400000::numeric, 0,  1),
       ('2026-27','new',  400000::numeric,  800000::numeric, 5,  2),
       ('2026-27','new',  800000::numeric, 1200000::numeric, 10, 3),
       ('2026-27','new', 1200000::numeric, 1600000::numeric, 15, 4),
       ('2026-27','new', 1600000::numeric, 2000000::numeric, 20, 5),
       ('2026-27','new', 2000000::numeric, 2400000::numeric, 25, 6),
       ('2026-27','new', 2400000::numeric, NULL,             30, 7),
       ('2026-27','old',       0::numeric,  250000::numeric, 0,  1),
       ('2026-27','old',  250000::numeric,  500000::numeric, 5,  2),
       ('2026-27','old',  500000::numeric, 1000000::numeric, 20, 3),
       ('2026-27','old', 1000000::numeric, NULL,             30, 4)
     ) AS t(financial_year, regime, threshold_from, threshold_to, rate_percent, seq)
     WHERE NOT EXISTS (SELECT 1 FROM payroll_tax_slabs WHERE financial_year = '2026-27')`,

  // ── Adjustments / Loans — unchanged shape, recreated as-is ─────────────────
  `CREATE TABLE IF NOT EXISTS payroll_adjustments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    pay_month INTEGER NOT NULL CHECK (pay_month BETWEEN 1 AND 12),
    pay_year INTEGER NOT NULL,
    type VARCHAR(40) NOT NULL,
    amount NUMERIC(12,2) NOT NULL,
    reason TEXT,
    created_by UUID REFERENCES employees(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_adj_employee_period ON payroll_adjustments (employee_id, pay_year, pay_month)`,

  `CREATE TABLE IF NOT EXISTS payroll_loans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    principal NUMERIC(12,2) NOT NULL,
    monthly_recovery NUMERIC(12,2) NOT NULL DEFAULT 0,
    recovered NUMERIC(12,2) NOT NULL DEFAULT 0,
    status VARCHAR(20) DEFAULT 'active',
    notes TEXT,
    issued_at DATE DEFAULT CURRENT_DATE,
    closed_at TIMESTAMPTZ,
    created_by UUID REFERENCES employees(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_loans_active ON payroll_loans (employee_id, status)`,
];

function isCriticalStep(sql) {
  // Anything that creates/renames a table or adds a hard constraint is
  // critical — a failure there means the API will 500 on that table.
  // Seed INSERTs and indexes are soft (best-effort, retryable).
  return /^\s*(CREATE TABLE|DO \$\$|ALTER TABLE .* RENAME)/i.test(sql.trim());
}

async function run() {
  console.log('Running payroll v2 migration...\n');
  let success = 0, criticalFailed = 0, softFailed = 0;

  for (const sql of steps) {
    const preview = sql.trim().replace(/\s+/g, ' ').substring(0, 90);
    try {
      await pool.query(sql);
      console.log(`  OK: ${preview}...`);
      success++;
    } catch (err) {
      const critical = isCriticalStep(sql);
      console.error(`  ${critical ? 'CRITICAL FAILED' : 'SOFT FAILED'}: ${preview}`);
      console.error(`     ${err.message}`);
      if (critical) criticalFailed++; else softFailed++;
    }
  }

  console.log(`\nPayroll v2 migration complete: ${success} succeeded, ${criticalFailed} critical failed, ${softFailed} soft failed`);
  await pool.end();
  process.exit(criticalFailed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
