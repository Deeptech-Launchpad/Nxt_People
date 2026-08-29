/**
 * routes/payroll-reports.js — employee-facing annual EPF/ESI contribution
 * summary PDFs. Unlike the design prototype these were ported from (which
 * applied TODAY's compliance settings retroactively to historical payslips —
 * a documented approximation), this reads employer_epf/employer_eps/
 * employer_esi directly off each payslip row, snapshotted at generation
 * time — so a historical summary is correct for whatever rates were
 * actually in effect that month, not whatever the rates happen to be today.
 * Mounted at /api/payroll/reports.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect } = require('../middleware/auth');
const { isFullAccess } = require('../utils/roles');
const { serverError } = require('../utils/serverError');

router.use(protect);

/** Parse "YYYY-YY" (e.g. "2026-27") into {startYear, endYear}, or null if
 *  malformed / the second half doesn't match (startYear+1)%100. */
function parseFy(fy) {
  const m = String(fy || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const startYear = Number(m[1]);
  const expected = String((startYear + 1) % 100).padStart(2, '0');
  if (m[2] !== expected) return null;
  return { startYear, endYear: startYear + 1 };
}

async function assertAccess(req, res, employeeId) {
  if (isFullAccess(req.user.role)) return true;
  if (String(req.user._id) === String(employeeId)) return true;
  res.status(403).json({ success: false, message: 'Not authorized to view this report.' });
  return false;
}

async function fyPayslips(employeeId, fy) {
  const { startYear, endYear } = fy;
  const r = await pool.query(
    `SELECT pay_month AS "payMonth", pay_year AS "payYear", basic, gross_earnings AS "grossEarnings",
            pf_employee AS "pfEmployee", employer_epf AS "employerEpf", employer_eps AS "employerEps",
            esi_employee AS "esiEmployee", employer_esi AS "employerEsi"
       FROM payroll_payslips
      WHERE employee_id = $1 AND status IN ('locked','paid') AND superseded_by IS NULL
        AND ((pay_year = $2 AND pay_month >= 4) OR (pay_year = $3 AND pay_month <= 3))
      ORDER BY pay_year ASC, pay_month ASC`,
    [employeeId, startYear, endYear]
  );
  return r.rows;
}

const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function streamPdf(res, filename, buildFn) {
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);
  buildFn(doc);
  doc.end();
}

function drawLetterhead(doc, empName, empCode, title) {
  const company = process.env.COMPANY_NAME || 'AltiusNxt';
  doc.font('Helvetica-Bold').fontSize(16).text(company, { align: 'center' });
  doc.font('Helvetica').fontSize(11).text(title, { align: 'center' });
  doc.moveDown();
  doc.fontSize(9).text(`${empName} (${empCode || '-'})`);
  doc.moveDown(0.5);
}

router.get('/epf-summary/:employeeId', async (req, res) => {
  try {
    if (!(await assertAccess(req, res, req.params.employeeId))) return;
    const fy = parseFy(req.query.fy);
    if (!fy) return res.status(400).json({ success: false, message: 'fy must be in the form YYYY-YY, e.g. 2026-27' });

    const empRes = await pool.query(`SELECT first_name, last_name, employee_id AS "employeeCode", uan_number FROM employees WHERE id = $1`, [req.params.employeeId]);
    if (empRes.rows.length === 0) return res.status(404).json({ success: false, message: 'Employee not found' });
    const emp = empRes.rows[0];
    const rows = await fyPayslips(req.params.employeeId, fy);

    streamPdf(res, `epf-summary-${req.query.fy}.pdf`, (doc) => {
      drawLetterhead(doc, `${emp.first_name} ${emp.last_name}`, emp.employeeCode, `EPF Contribution Summary — FY ${req.query.fy}`);
      doc.fontSize(8).text(`UAN: ${emp.uan_number ? '••••' + String(emp.uan_number).slice(-4) : '-'}`);
      doc.moveDown();
      if (rows.length === 0) {
        doc.fontSize(10).text('No locked/paid payslips found for this financial year.');
        return;
      }
      doc.font('Helvetica-Bold').fontSize(9);
      const cols = [40, 130, 220, 320, 420];
      ['MONTH', 'PF WAGES', 'YOUR EPF', 'EMPLOYER EPF', 'EMPLOYER EPS'].forEach((h, i) => doc.text(h, cols[i], doc.y));
      doc.moveDown();
      doc.font('Helvetica').fontSize(9);
      let totalEmp = 0, totalEpf = 0, totalEps = 0;
      for (const r of rows) {
        const y = doc.y;
        doc.text(`${MONTH_NAMES[r.payMonth]} ${r.payYear}`, cols[0], y);
        doc.text(Number(r.basic).toFixed(2), cols[1], y);
        doc.text(Number(r.pfEmployee).toFixed(2), cols[2], y);
        doc.text(Number(r.employerEpf).toFixed(2), cols[3], y);
        doc.text(Number(r.employerEps).toFixed(2), cols[4], y);
        doc.moveDown();
        totalEmp += Number(r.pfEmployee); totalEpf += Number(r.employerEpf); totalEps += Number(r.employerEps);
      }
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold');
      doc.text(`Total — Your EPF: ${totalEmp.toFixed(2)}   Employer EPF: ${totalEpf.toFixed(2)}   Employer EPS: ${totalEps.toFixed(2)}`);
      doc.text(`Grand Total Contribution: ${(totalEmp + totalEpf + totalEps).toFixed(2)}`);
    });
  } catch (err) { serverError(res, err); }
});

router.get('/esi-summary/:employeeId', async (req, res) => {
  try {
    if (!(await assertAccess(req, res, req.params.employeeId))) return;
    const fy = parseFy(req.query.fy);
    if (!fy) return res.status(400).json({ success: false, message: 'fy must be in the form YYYY-YY, e.g. 2026-27' });

    const empRes = await pool.query(`SELECT first_name, last_name, employee_id AS "employeeCode" FROM employees WHERE id = $1`, [req.params.employeeId]);
    if (empRes.rows.length === 0) return res.status(404).json({ success: false, message: 'Employee not found' });
    const emp = empRes.rows[0];
    const rows = await fyPayslips(req.params.employeeId, fy);

    streamPdf(res, `esi-summary-${req.query.fy}.pdf`, (doc) => {
      drawLetterhead(doc, `${emp.first_name} ${emp.last_name}`, emp.employeeCode, `ESI Contribution Summary — FY ${req.query.fy}`);
      doc.moveDown();
      if (rows.length === 0) {
        doc.fontSize(10).text('No locked/paid payslips found for this financial year.');
        return;
      }
      doc.font('Helvetica-Bold').fontSize(9);
      const cols = [40, 160, 280, 400];
      ['MONTH', 'GROSS WAGES', 'YOUR CONTRIBUTION', 'EMPLOYER CONTRIBUTION'].forEach((h, i) => doc.text(h, cols[i], doc.y));
      doc.moveDown();
      doc.font('Helvetica').fontSize(9);
      let totalEmp = 0, totalEr = 0;
      for (const r of rows) {
        const y = doc.y;
        doc.text(`${MONTH_NAMES[r.payMonth]} ${r.payYear}`, cols[0], y);
        doc.text(Number(r.grossEarnings).toFixed(2), cols[1], y);
        doc.text(Number(r.esiEmployee).toFixed(2), cols[2], y);
        doc.text(Number(r.employerEsi).toFixed(2), cols[3], y);
        doc.moveDown();
        totalEmp += Number(r.esiEmployee); totalEr += Number(r.employerEsi);
      }
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold');
      doc.text(`Total — Your Contribution: ${totalEmp.toFixed(2)}   Employer Contribution: ${totalEr.toFixed(2)}`);
      doc.text(`Grand Total: ${(totalEmp + totalEr).toFixed(2)}`);
    });
  } catch (err) { serverError(res, err); }
});

module.exports = router;
