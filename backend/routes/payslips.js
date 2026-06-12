/**
 * routes/payslips.js
 * Financial year payslip management (Apr–Mar FY)
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { isFullAccess } = require('../utils/roles');

router.use(protect);

// Helper: given FY label like "2025-26" return { fromYear, fromMonth, toYear, toMonth }
function parseFY(fy) {
  if (!fy) {
    // Current FY
    const now = new Date();
    const m = now.getMonth() + 1; // 1-based
    const y = now.getFullYear();
    return m >= 4
      ? { fromYear: y, fromMonth: 4, toYear: y + 1, toMonth: 3 }
      : { fromYear: y - 1, fromMonth: 4, toYear: y, toMonth: 3 };
  }
  const [startY] = fy.split('-').map(Number);
  return { fromYear: startY, fromMonth: 4, toYear: startY + 1, toMonth: 3 };
}

// GET /api/payslips?fy=2025-26   (employee sees their own, admin sees all)
router.get('/', async (req, res) => {
  try {
    const { fy, employeeId } = req.query;
    const { fromYear, fromMonth, toYear, toMonth } = parseFY(fy);
    const empId = isFullAccess(req.user.role) && employeeId ? employeeId : req.user._id;

    const r = await pool.query(
      `SELECT id as "_id", month, year, gross_pay as "grossPay",
       reimbursements, deductions, take_home as "takeHome",
       payslip_url as "payslipUrl", tax_worksheet_url as "taxWorksheetUrl",
       created_at as "createdAt"
       FROM payslips
       WHERE employee_id = $1
         AND ((year = $2 AND month >= $3) OR (year = $4 AND month <= $5))
       ORDER BY year DESC, month DESC`,
      [empId, fromYear, fromMonth, toYear, toMonth]
    );
    res.json({ success: true, data: r.rows, fy: fy || 'current' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET /api/payslips/fy-list  — returns list of available financial years for employee
router.get('/fy-list', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT DISTINCT year FROM payslips WHERE employee_id = $1 ORDER BY year DESC`,
      [req.user._id]
    );
    // Build FY labels from distinct years (Apr–Mar straddles two calendar years)
    const fys = new Set();
    r.rows.forEach(({ year }) => {
      fys.add(`${year - 1}-${String(year).slice(2)}`);
      fys.add(`${year}-${String(year + 1).slice(2)}`);
    });
    res.json({ success: true, data: Array.from(fys).sort().reverse() });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST /api/payslips  — create / upsert payslip (admin only)
router.post('/', authorize('super_admin', 'hr'), async (req, res) => {
  try {
    const { employeeId, month, year, grossPay, reimbursements, deductions, takeHome, payslipUrl, taxWorksheetUrl } = req.body;
    if (!employeeId || !month || !year) {
      return res.status(400).json({ success: false, message: 'employeeId, month, year required' });
    }
    const r = await pool.query(
      `INSERT INTO payslips (employee_id, month, year, gross_pay, reimbursements, deductions, take_home, payslip_url, tax_worksheet_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (employee_id, month, year) DO UPDATE
         SET gross_pay=$4, reimbursements=$5, deductions=$6, take_home=$7,
             payslip_url=COALESCE($8, payslips.payslip_url),
             tax_worksheet_url=COALESCE($9, payslips.tax_worksheet_url)
       RETURNING id as "_id", month, year, gross_pay as "grossPay", take_home as "takeHome"`,
      [employeeId, month, year,
       grossPay || 0, reimbursements || 0, deductions || 0, takeHome || 0,
       payslipUrl || null, taxWorksheetUrl || null]
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
