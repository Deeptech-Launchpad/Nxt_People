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

router.use(protect);

const COLS = `
  id, pf_rate AS "pfRate", pf_wage_ceiling AS "pfWageCeiling",
  esi_employee_rate AS "esiEmployeeRate", esi_employer_rate AS "esiEmployerRate", esi_threshold AS "esiThreshold",
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
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.get('/history', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  try {
    const r = await pool.query(`SELECT ${COLS} FROM payroll_compliance_settings ORDER BY effective_from DESC`);
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
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
    const ptSlabs = Array.isArray(b.ptSlabs) ? b.ptSlabs : [];
    const effectiveFrom = b.effectiveFrom || new Date().toLocaleDateString('en-CA');

    const r = await pool.query(
      `INSERT INTO payroll_compliance_settings
         (pf_rate, pf_wage_ceiling, esi_employee_rate, esi_employer_rate, esi_threshold, pt_slabs, effective_from, created_by)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::date,$8) RETURNING ${COLS}`,
      [pfRate, pfWageCeiling, esiEmployeeRate, esiEmployerRate, esiThreshold, JSON.stringify(ptSlabs), effectiveFrom, req.user._id]
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

module.exports = router;
