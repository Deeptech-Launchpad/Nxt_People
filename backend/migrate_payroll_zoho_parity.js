#!/usr/bin/env node
/* ── Salary structure parity with Zoho Payroll ──────────────────────────────
 *  Comparing the same employee (Balaji D) in both systems, Zoho's Cost to
 *  Company came to 1,84,248 a year and ours to 1,78,560 — short by exactly
 *  5,688, which is 696 of EPF admin charges plus 4,992 of employer ESI. Two
 *  real gaps: admin charges were never modelled, and employer ESI was
 *  computed for the payslip but left out of the CTC figure.
 *
 *  Zoho also offers four choices we had no column for at all:
 *
 *    PF on the ACTUAL wage rather than the 15,000-restricted wage
 *    whether to contribute to EPS at all
 *    whether EPS follows the actual wage too
 *    employer benefits — Mediclaim, Gratuity, Accident Insurance
 *
 *  and computes ESI on a wage that EXCLUDES some components (Zoho's ESI on
 *  this employee is 3.25% of 12,800 = basic + HRA, leaving out the 700
 *  statutory bonus), where we passed the whole gross.
 *
 *  Every default here preserves current behaviour, with one deliberate
 *  exception: epf_admin_rate starts at 0.5%, because that is the gap this
 *  exists to close. EDLI defaults to ZERO rather than its statutory 0.5% —
 *  Zoho's own breakdown for this org shows admin charges and no EDLI line,
 *  and matching Zoho is the point. Turn it on in Compliance Settings if the
 *  org actually pays it.
 *
 *    docker compose exec backend node migrate_payroll_zoho_parity.js
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
const pool = require('./db');

const STEPS = [
  // ── Compliance settings: employer-side EPF costs beyond the 12% ──────────
  `ALTER TABLE payroll_compliance_settings
     ADD COLUMN IF NOT EXISTS epf_admin_rate NUMERIC(6,4) NOT NULL DEFAULT 0.0050`,
  // Statutory EDLI is 0.5%, but Zoho is not charging it for this org and the
  // CTC has to agree with Zoho's. Off unless somebody turns it on.
  `ALTER TABLE payroll_compliance_settings
     ADD COLUMN IF NOT EXISTS edli_rate NUMERIC(6,4) NOT NULL DEFAULT 0.0000`,
  // Component names that do NOT count toward the ESI wage. Zoho excludes the
  // statutory bonus; the list is data rather than code so it can be corrected
  // without a deploy.
  `ALTER TABLE payroll_compliance_settings
     ADD COLUMN IF NOT EXISTS esi_wage_excludes JSONB NOT NULL DEFAULT '["Statutory Bonus"]'::jsonb`,

  // ── Salary structure: the per-employee choices Zoho offers ──────────────
  // 'restricted' caps the PF wage at pf_wage_ceiling (what we have always
  // done); 'actual' contributes on the real basic however high it goes.
  `ALTER TABLE salary_structures
     ADD COLUMN IF NOT EXISTS pf_wage_basis VARCHAR(20) NOT NULL DEFAULT 'restricted'`,
  `ALTER TABLE salary_structures
     ADD COLUMN IF NOT EXISTS eps_enabled BOOLEAN NOT NULL DEFAULT TRUE`,
  // EPS is normally capped at the restricted wage even when EPF is not.
  `ALTER TABLE salary_structures
     ADD COLUMN IF NOT EXISTS eps_at_actual_wage BOOLEAN NOT NULL DEFAULT FALSE`,
  // [{ name, monthly }] — Mediclaim, Gratuity, Accident Insurance and any
  // other employer-borne cost that belongs in CTC but is never deducted.
  `ALTER TABLE salary_structures
     ADD COLUMN IF NOT EXISTS benefits JSONB NOT NULL DEFAULT '[]'::jsonb`,

  // ── Payslip: record what was actually charged, not just the 12% ─────────
  `ALTER TABLE payroll_payslips
     ADD COLUMN IF NOT EXISTS employer_epf_admin NUMERIC(12,2) NOT NULL DEFAULT 0`,
  `ALTER TABLE payroll_payslips
     ADD COLUMN IF NOT EXISTS employer_edli NUMERIC(12,2) NOT NULL DEFAULT 0`,
  `ALTER TABLE payroll_payslips
     ADD COLUMN IF NOT EXISTS employer_benefits NUMERIC(12,2) NOT NULL DEFAULT 0`,

  `ALTER TABLE salary_structures
     ADD CONSTRAINT salary_structures_pf_wage_basis_chk
     CHECK (pf_wage_basis IN ('restricted','actual'))`,
];

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const sql of STEPS) {
      try {
        await client.query(sql);
      } catch (err) {
        // A CHECK constraint that is already there is not a failure worth
        // rolling six good ALTERs back for.
        if (err.code === '42710' || /already exists/i.test(err.message)) {
          console.log(`  (skipped, already present) ${sql.slice(0, 60).replace(/\s+/g, ' ')}...`);
          continue;
        }
        throw err;
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`\n  Migration failed, nothing changed: ${err.message}\n`);
    await pool.end();
    process.exit(1);
  } finally {
    client.release();
  }

  const s = (await pool.query(
    `SELECT pf_rate, pf_wage_ceiling, epf_admin_rate, edli_rate,
            esi_employee_rate, esi_employer_rate, esi_threshold, esi_wage_excludes
       FROM payroll_compliance_settings ORDER BY effective_from DESC LIMIT 1`)).rows[0];

  console.log('\n  Salary structure parity columns are in place.\n');
  console.log('  Compliance settings now in effect:\n');
  console.log(`    PF                 ${(Number(s.pf_rate) * 100).toFixed(2)}% of basic, restricted to ${s.pf_wage_ceiling}`);
  console.log(`    EPF admin charges  ${(Number(s.epf_admin_rate) * 100).toFixed(2)}%   <- new, this is the gap against Zoho`);
  console.log(`    EDLI               ${(Number(s.edli_rate) * 100).toFixed(2)}%   (off by default — Zoho is not charging it here)`);
  console.log(`    ESI                ${(Number(s.esi_employee_rate) * 100).toFixed(2)}% employee / ${(Number(s.esi_employer_rate) * 100).toFixed(2)}% employer, threshold ${s.esi_threshold}`);
  console.log(`    ESI wage excludes  ${JSON.stringify(s.esi_wage_excludes)}\n`);

  await pool.end();
})().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
