/**
 * routes/payroll-increments.js — salary increment propose -> approve/reject
 * workflow with automatic arrears computation. Approval scales every salary
 * component proportionally (proposedGross/currentGross ratio), not just
 * basic. Arrears consumption into an actual payslip (the arrears_paid flip)
 * happens in routes/payroll.js's lock handler, under a row lock — this file
 * only ever produces an ESTIMATE (at propose time) and a REFRESHED estimate
 * (at approve time); it never itself marks arrears as paid.
 * Mounted at /api/payroll/increments.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { resolveSalaryStructure } = require('../utils/payroll-calc');

router.use(protect, authorize('admin', 'director', 'hr_admin'));

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; };

function grossOf(structure) {
  if (!structure) return 0;
  const other = Array.isArray(structure.other_components) ? structure.other_components : [];
  return round2(
    Number(structure.basic || 0) + Number(structure.hra || 0) + Number(structure.conveyance || 0) +
    other.reduce((s, c) => s + (Number(c.value) || 0), 0)
  );
}

/** Estimate arrears: monthlyDelta x count of already-LOCKED/PAID payslips
 *  for months on/after the increment's effective month. This is always an
 *  estimate — more months may lock between proposal and approval, so the
 *  approval step recomputes it fresh rather than trusting the stored value. */
async function computeArrears(client, employeeId, effectiveDate, currentGross, proposedGross) {
  const effYear = effectiveDate.getFullYear();
  const effMonth = effectiveDate.getMonth() + 1;
  const runs = await client.query(
    `SELECT pay_month, pay_year FROM payroll_payslips
      WHERE employee_id = $1 AND status IN ('locked','paid') AND superseded_by IS NULL
        AND (pay_year > $2 OR (pay_year = $2 AND pay_month >= $3))`,
    [employeeId, effYear, effMonth]
  );
  if (runs.rows.length === 0) return null;
  const monthlyDelta = round2(proposedGross - currentGross);
  const totalArrears = round2(monthlyDelta * runs.rows.length);
  return {
    affectedMonths: runs.rows.map(r => ({ month: r.pay_month, year: r.pay_year })),
    monthlyDelta, totalArrears,
  };
}

router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    const where = status ? `WHERE i.status = $1` : '';
    const r = await pool.query(
      `SELECT i.id, i.current_gross AS "currentGross", i.proposed_gross AS "proposedGross",
              i.effective_date AS "effectiveDate", i.status, i.arrears_json AS "arrearsJson",
              i.arrears_paid AS "arrearsPaid", i.rejection_reason AS "rejectionReason",
              i.decided_at AS "decidedAt", i.created_at AS "createdAt",
              json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name, 'department', e.department) as employee,
              json_build_object('_id', pb.id, 'firstName', pb.first_name, 'lastName', pb.last_name) as "proposedBy"
         FROM payroll_increments i
         JOIN employees e ON i.employee_id = e.id
         JOIN employees pb ON i.proposed_by = pb.id
         ${where} ORDER BY i.created_at DESC`,
      status ? [status] : []
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.get('/pending', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT i.id, i.current_gross AS "currentGross", i.proposed_gross AS "proposedGross",
              i.effective_date AS "effectiveDate", i.arrears_json AS "arrearsJson", i.created_at AS "createdAt",
              json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name, 'department', e.department, 'designation', e.designation) as employee
         FROM payroll_increments i JOIN employees e ON i.employee_id = e.id
        WHERE i.status = 'pending' ORDER BY i.created_at ASC`
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.get('/employee/:employeeId', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, current_gross AS "currentGross", proposed_gross AS "proposedGross",
              effective_date AS "effectiveDate", status, arrears_json AS "arrearsJson",
              arrears_paid AS "arrearsPaid", rejection_reason AS "rejectionReason", created_at AS "createdAt"
         FROM payroll_increments WHERE employee_id = $1 ORDER BY created_at DESC`,
      [req.params.employeeId]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.post('/', audit('PROPOSE', 'increment'), async (req, res) => {
  try {
    const { employeeId, proposedGross, effectiveDate } = req.body;
    if (!employeeId || !Number.isFinite(Number(proposedGross)) || !effectiveDate) {
      return res.status(400).json({ success: false, message: 'employeeId, proposedGross, and effectiveDate are required' });
    }
    const emp = await pool.query(`SELECT id FROM employees WHERE id = $1 AND status = 'active'`, [employeeId]);
    if (emp.rows.length === 0) return res.status(404).json({ success: false, message: 'Active employee not found' });

    const effDate = new Date(`${effectiveDate}T00:00:00`);
    const structure = await resolveSalaryStructure(pool, employeeId, effDate);
    if (!structure) {
      return res.status(400).json({ success: false, message: 'This employee has no salary structure yet — set one up before proposing an increment.' });
    }
    const currentGross = grossOf(structure);
    const arrears = await computeArrears(pool, employeeId, effDate, currentGross, Number(proposedGross));

    const r = await pool.query(
      `INSERT INTO payroll_increments (employee_id, current_gross, proposed_gross, effective_date, proposed_by, arrears_json)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING id`,
      [employeeId, currentGross, num(proposedGross), effectiveDate, req.user._id, arrears ? JSON.stringify(arrears) : null]
    );
    res.status(201).json({ success: true, id: r.rows[0].id, arrears });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ success: false, message: 'This employee already has a pending increment proposal.' });
    }
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  }
});

router.put('/:id/approve', audit('APPROVE', 'increment'), async (req, res) => {
  const client = await pool.connect();
  try {
    const existing = await client.query(`SELECT * FROM payroll_increments WHERE id = $1`, [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ success: false, message: 'Increment not found' });
    const inc = existing.rows[0];
    if (String(inc.proposed_by) === String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'You cannot approve your own increment proposal.' });
    }
    if (inc.status !== 'pending') {
      return res.status(400).json({ success: false, message: `This increment has already been ${inc.status}.` });
    }

    await client.query('BEGIN');
    // Atomic claim — closes the double-approve race (double-click, or two
    // approvers acting within the same window).
    const claim = await client.query(
      `UPDATE payroll_increments SET status='approved', approved_by=$1, decided_at=NOW() WHERE id=$2 AND status='pending' RETURNING *`,
      [req.user._id, req.params.id]
    );
    if (claim.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'This increment has already been actioned.' });
    }
    const claimed = claim.rows[0];
    const effDate = new Date(claimed.effective_date);

    const latest = await resolveSalaryStructure(client, claimed.employee_id, effDate);
    const latestGrossNow = latest ? grossOf(latest) : Number(claimed.current_gross);
    const ratio = latestGrossNow > 0 ? Number(claimed.proposed_gross) / latestGrossNow : null;

    let basic, hra, conveyance, otherComponents, templateId;
    if (latest && ratio != null) {
      basic = round2(Number(latest.basic || 0) * ratio);
      hra = round2(Number(latest.hra || 0) * ratio);
      conveyance = round2(Number(latest.conveyance || 0) * ratio);
      otherComponents = (Array.isArray(latest.other_components) ? latest.other_components : [])
        .map(c => ({ name: c.name, value: round2((Number(c.value) || 0) * ratio) }));
      templateId = latest.template_id || null;
    } else {
      basic = Number(claimed.proposed_gross); hra = 0; conveyance = 0; otherComponents = []; templateId = null;
    }

    await client.query(
      `INSERT INTO salary_structures (employee_id, effective_from, template_id, ctc_annual, basic, hra, conveyance, other_components, pf_applicable, esi_applicable, created_by)
       VALUES ($1,$2::date,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)
       ON CONFLICT (employee_id, effective_from) DO UPDATE SET
         template_id=EXCLUDED.template_id, ctc_annual=EXCLUDED.ctc_annual,
         basic=EXCLUDED.basic, hra=EXCLUDED.hra, conveyance=EXCLUDED.conveyance, other_components=EXCLUDED.other_components`,
      [claimed.employee_id, claimed.effective_date, templateId, round2(Number(claimed.proposed_gross) * 12),
       basic, hra, conveyance, JSON.stringify(otherComponents),
       latest?.pf_applicable !== false, !!latest?.esi_applicable, req.user._id]
    );

    // Refresh arrears using the authoritative baseline (latestGrossNow), not
    // the possibly-stale current_gross captured at propose time.
    const arrears = await computeArrears(client, claimed.employee_id, effDate, latestGrossNow, Number(claimed.proposed_gross));
    await client.query(`UPDATE payroll_increments SET arrears_json = $1::jsonb WHERE id = $2`, [arrears ? JSON.stringify(arrears) : null, claimed.id]);

    await client.query('COMMIT');
    res.json({ success: true, arrears });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  } finally { client.release(); }
});

router.put('/:id/reject', audit('REJECT', 'increment'), async (req, res) => {
  try {
    const existing = await pool.query(`SELECT proposed_by, status FROM payroll_increments WHERE id = $1`, [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ success: false, message: 'Increment not found' });
    if (String(existing.rows[0].proposed_by) === String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'You cannot reject your own increment proposal.' });
    }
    const r = await pool.query(
      `UPDATE payroll_increments SET status='rejected', approved_by=$1, decided_at=NOW(), rejection_reason=$2
        WHERE id=$3 AND status='pending' RETURNING id`,
      [req.user._id, req.body.reason || null, req.params.id]
    );
    if (r.rows.length === 0) return res.status(400).json({ success: false, message: 'This increment has already been actioned.' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

module.exports = router;
