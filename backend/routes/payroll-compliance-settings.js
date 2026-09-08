/**
 * routes/payroll-compliance-settings.js — versioned PF/ESI/Professional Tax
 * rates. Every save inserts a new row (never updates in place) so past
 * payroll runs remain reproducible against the settings that were actually
 * in effect at the time. Mounted at /api/payroll/compliance-settings.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { serverError } = require('../utils/serverError');

router.use(protect);

const COLS = `
  id, pf_rate AS "pfRate", pf_wage_ceiling AS "pfWageCeiling",
  epf_admin_rate AS "epfAdminRate", edli_rate AS "edliRate",
  esi_employee_rate AS "esiEmployeeRate", esi_employer_rate AS "esiEmployerRate", esi_threshold AS "esiThreshold",
  esi_wage_excludes AS "esiWageExcludes",
  pt_slabs AS "ptSlabs", effective_from AS "effectiveFrom", created_at AS "createdAt"
`;

// GET /api/payroll/compliance-settings — current effective row. Not
// full-access-only: employees need pfWageCeiling/thresholds for their own
// salary breakdown preview; none of these figures are sensitive.
router.get('/', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT ${COLS} FROM payroll_compliance_settings WHERE effective_from <= CURRENT_DATE ORDER BY effective_from DESC LIMIT 1`
    );
    res.json({ success: true, data: r.rows[0] || null });
  } catch (err) { serverError(res, err); }
});

router.get('/history', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  try {
    const r = await pool.query(`SELECT ${COLS} FROM payroll_compliance_settings ORDER BY effective_from DESC`);
    res.json({ success: true, data: r.rows });
  } catch (err) { serverError(res, err); }
});

router.post('/', authorize('admin', 'director', 'hr_admin'), audit('CREATE', 'compliance_settings'), async (req, res) => {
  try {
    const b = req.body || {};
    const pfRate = Number(b.pfRate), esiEmployeeRate = Number(b.esiEmployeeRate), esiEmployerRate = Number(b.esiEmployerRate);
    const pfWageCeiling = Number(b.pfWageCeiling), esiThreshold = Number(b.esiThreshold);

    if (![pfRate, esiEmployeeRate, esiEmployerRate].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) {
      return res.status(400).json({ success: false, message: 'pfRate, esiEmployeeRate, esiEmployerRate must be fractions between 0 and 1' });
    }
    if (![pfWageCeiling, esiThreshold].every(n => Number.isFinite(n) && n > 0)) {
      return res.status(400).json({ success: false, message: 'pfWageCeiling and esiThreshold must be positive numbers' });
    }
    /* Employer-side EPF costs beyond the 12%. Absent from the body means
     * "keep what is in effect", not "zero" — a client that predates these
     * fields must not silently wipe the admin charge and understate every
     * CTC again. */
    const current = (await pool.query(
      `SELECT epf_admin_rate, edli_rate, esi_wage_excludes FROM payroll_compliance_settings
        WHERE effective_from <= CURRENT_DATE ORDER BY effective_from DESC LIMIT 1`)).rows[0] || {};
    const epfAdminRate = b.epfAdminRate == null ? Number(current.epf_admin_rate ?? 0.005) : Number(b.epfAdminRate);
    const edliRate = b.edliRate == null ? Number(current.edli_rate ?? 0) : Number(b.edliRate);
    if (![epfAdminRate, edliRate].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) {
      return res.status(400).json({ success: false, message: 'epfAdminRate and edliRate must be fractions between 0 and 1' });
    }
    const esiWageExcludes = Array.isArray(b.esiWageExcludes)
      ? b.esiWageExcludes.map(n => String(n).trim()).filter(Boolean)
      : (Array.isArray(current.esi_wage_excludes) ? current.esi_wage_excludes : []);

    const ptSlabs = Array.isArray(b.ptSlabs) ? b.ptSlabs : [];
    const effectiveFrom = b.effectiveFrom || new Date().toLocaleDateString('en-CA');

    const r = await pool.query(
      `INSERT INTO payroll_compliance_settings
         (pf_rate, pf_wage_ceiling, epf_admin_rate, edli_rate,
          esi_employee_rate, esi_employer_rate, esi_threshold, esi_wage_excludes,
          pt_slabs, effective_from, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::date,$11) RETURNING ${COLS}`,
      [pfRate, pfWageCeiling, epfAdminRate, edliRate,
       esiEmployeeRate, esiEmployerRate, esiThreshold, JSON.stringify(esiWageExcludes),
       JSON.stringify(ptSlabs), effectiveFrom, req.user._id]
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) { serverError(res, err); }
});

module.exports = router;
