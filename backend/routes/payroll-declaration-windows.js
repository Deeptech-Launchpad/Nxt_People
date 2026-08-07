/**
 * routes/payroll-declaration-windows.js — per-financial-year gate on tax
 * declaration submission. is_open is the quick admin kill-switch; when
 * opens_at/closes_at are also set, they're actually enforced (checked live
 * on every submit in routes/payroll.js's POST /declarations) — unlike the
 * design prototype this was ported from, where those two fields were stored
 * but never read by anything.
 * Mounted at /api/payroll/declaration-windows.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { audit } = require('../middleware/audit');

router.use(protect);

const COLS = `id, financial_year AS "financialYear", is_open AS "isOpen", opens_at AS "opensAt", closes_at AS "closesAt", updated_at AS "updatedAt"`;

router.get('/', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  try {
    const r = await pool.query(`SELECT ${COLS} FROM payroll_declaration_windows ORDER BY financial_year DESC`);
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// Any authenticated employee needs to know whether they can submit right now.
router.get('/current', async (req, res) => {
  try {
    const fy = req.query.fy;
    const r = fy
      ? await pool.query(`SELECT ${COLS} FROM payroll_declaration_windows WHERE financial_year = $1`, [fy])
      : await pool.query(`SELECT ${COLS} FROM payroll_declaration_windows ORDER BY financial_year DESC LIMIT 1`);
    res.json({ success: true, data: r.rows[0] || null });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.post('/', authorize('admin', 'director', 'hr_admin'), audit('UPSERT', 'declaration_window'), async (req, res) => {
  try {
    const { financialYear, isOpen, opensAt, closesAt } = req.body;
    if (!financialYear) return res.status(400).json({ success: false, message: 'financialYear is required' });
    const r = await pool.query(
      `INSERT INTO payroll_declaration_windows (financial_year, is_open, opens_at, closes_at)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (financial_year) DO UPDATE SET
         is_open = EXCLUDED.is_open, opens_at = EXCLUDED.opens_at, closes_at = EXCLUDED.closes_at, updated_at = NOW()
       RETURNING ${COLS}`,
      [financialYear, !!isOpen, opensAt || null, closesAt || null]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.put('/:id/toggle', authorize('admin', 'director', 'hr_admin'), audit('TOGGLE', 'declaration_window'), async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE payroll_declaration_windows SET is_open = NOT is_open, updated_at = NOW() WHERE id = $1 RETURNING ${COLS}`,
      [req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ success: false, message: 'Window not found' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

module.exports = router;
