/**
 * routes/leave-types.js
 * Leave type definitions + per-employee balance management
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { isFullAccess } = require('../utils/roles');

router.use(protect);

// GET /api/leave-types — all active leave types
router.get('/', async (req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM leave_types WHERE is_active=true ORDER BY name`);
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET /api/leave-types/policies — the Leave Policy configuration screen.
// Unlike GET / this returns disabled policies too, because the point of the
// screen is to turn them on and off. Ordered so the screen and the reports
// agree on sequence.
router.get('/policies', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id AS "_id", name, code, icon, color, is_active AS "isActive",
              pay_type AS "payType", unit, accrual_mode AS "accrualMode",
              accrual_amount AS "accrualAmount", carry_forward AS "carryForward",
              policy_type AS "policyType",
              max_days_per_year AS "maxDaysPerYear", sort_order AS "sortOrder"
         FROM leave_types ORDER BY sort_order, name`
    );
    res.json({ success: true, data: r.rows.map(x => ({ ...x, accrualAmount: parseFloat(x.accrualAmount) || 0 })) });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// PATCH /api/leave-types/policies/:id — partial update from that screen.
// Only the listed fields are writable, and each is validated: these values
// drive how leave accrues and how balances are reported, so a bad enum here
// would quietly corrupt every balance figure rather than fail loudly.
const PAY_TYPES = ['paid', 'unpaid', 'comp_off'];
const UNITS = ['days', 'hours'];
const ACCRUAL_MODES = ['annual', 'monthly', 'earned', 'none'];
const POLICY_TYPES = ['fixed', 'experience', 'grant', 'attendance'];

router.patch('/policies/:id', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  try {
    const { name, color, isActive, payType, unit, accrualMode, accrualAmount, carryForward, policyType } = req.body;

    if (payType !== undefined && !PAY_TYPES.includes(payType)) {
      return res.status(400).json({ success: false, message: 'Invalid pay type' });
    }
    if (unit !== undefined && !UNITS.includes(unit)) {
      return res.status(400).json({ success: false, message: 'Invalid unit' });
    }
    if (accrualMode !== undefined && !ACCRUAL_MODES.includes(accrualMode)) {
      return res.status(400).json({ success: false, message: 'Invalid accrual mode' });
    }
    if (accrualAmount !== undefined && (Number.isNaN(Number(accrualAmount)) || Number(accrualAmount) < 0)) {
      return res.status(400).json({ success: false, message: 'Accrual amount must be a non-negative number' });
    }
    if (policyType !== undefined && policyType && !POLICY_TYPES.includes(policyType)) {
      return res.status(400).json({ success: false, message: 'Invalid policy type' });
    }

    const sets = [];
    const params = [];
    const add = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
    if (name !== undefined) add('name', name);
    if (color !== undefined) add('color', color);
    if (isActive !== undefined) add('is_active', !!isActive);
    if (payType !== undefined) add('pay_type', payType);
    if (unit !== undefined) add('unit', unit);
    if (accrualMode !== undefined) add('accrual_mode', accrualMode);
    if (accrualAmount !== undefined) add('accrual_amount', Number(accrualAmount));
    if (carryForward !== undefined) add('carry_forward', !!carryForward);
    // Blank is a real value here: comp-off and no-entitlement types show no
    // policy type at all, so null has to be settable rather than ignored.
    if (policyType !== undefined) add('policy_type', policyType || null);
    if (!sets.length) return res.status(400).json({ success: false, message: 'Nothing to update' });

    sets.push('updated_at = NOW()');
    params.push(req.params.id);
    const r = await pool.query(
      `UPDATE leave_types SET ${sets.join(', ')} WHERE id = $${params.length}
       RETURNING id AS "_id", name, code, color, is_active AS "isActive",
                 pay_type AS "payType", unit, accrual_mode AS "accrualMode",
                 accrual_amount AS "accrualAmount", carry_forward AS "carryForward",
                 policy_type AS "policyType"`,
      params
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Leave policy not found' });
    res.json({ success: true, data: { ...r.rows[0], accrualAmount: parseFloat(r.rows[0].accrualAmount) || 0 } });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// GET /api/leave-types/balances?year=2025&employeeId=  (employee sees own, admin can pass id)
router.get('/balances', async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const empId = (isFullAccess(req.user.role) && req.query.employeeId)
      ? req.query.employeeId : req.user._id;

    // Get all active leave types
    const ltRes = await pool.query(`SELECT * FROM leave_types WHERE is_active=true ORDER BY name`);

    // Get existing balances for this employee/year
    const balRes = await pool.query(
      `SELECT * FROM leave_balances WHERE employee_id=$1 AND year=$2`,
      [empId, year]
    );
    const balMap = {};
    balRes.rows.forEach(b => { balMap[b.leave_type_id] = b; });

    // Also pull leave balances from employees table for legacy types
    const empRes = await pool.query(
      `SELECT casual_leave, sick_leave, earned_leave FROM employees WHERE id=$1`,
      [empId]
    );
    const legacyBal = empRes.rows[0] || {};

    const LEGACY_MAP = {
      casual: parseFloat(legacyBal.casual_leave) || 0,
      sick:   parseFloat(legacyBal.sick_leave)   || 0,
      earned: parseFloat(legacyBal.earned_leave) || 0,
    };

    const result = ltRes.rows.map(lt => {
      const bal = balMap[lt.id];
      const legacyAvail = LEGACY_MAP[lt.code] ?? lt.max_days_per_year;
      return {
        _id: lt.id,
        leaveTypeId: lt.id,
        name: lt.name,
        code: lt.code,
        icon: lt.icon,
        color: lt.color,
        maxDays: lt.max_days_per_year,
        available: bal ? parseFloat(bal.available) : legacyAvail,
        booked:    bal ? parseFloat(bal.booked)    : 0,
        year,
      };
    });

    res.json({ success: true, data: result, year });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// POST /api/leave-types — create (admin)
router.post('/', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  try {
    const { name, code, icon, color, maxDaysPerYear, carryForward } = req.body;
    if (!name || !code) return res.status(400).json({ success: false, message: 'name and code required' });
    const r = await pool.query(
      `INSERT INTO leave_types (name, code, icon, color, max_days_per_year, carry_forward)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id as "_id", name, code, icon, color`,
      [name, code.toLowerCase(), icon||'📅', color||'#1a73e8', maxDaysPerYear||0, carryForward||false]
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ success: false, message: 'Code already exists' });
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/leave-types/balances/:employeeId — admin: set balance for employee
router.put('/balances/:employeeId', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  try {
    const { leaveTypeId, available, year } = req.body;
    const y = year || new Date().getFullYear();
    await pool.query(
      `INSERT INTO leave_balances (employee_id, leave_type_id, year, available, booked)
       VALUES ($1,$2,$3,$4,0)
       ON CONFLICT (employee_id, leave_type_id, year) DO UPDATE SET available=$4`,
      [req.params.employeeId, leaveTypeId, y, available]
    );
    res.json({ success: true, message: 'Balance updated' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET /api/leave-types/methods — the Methods configuration screen.
//
// A method is a way of tracking leave that can be switched off wholesale.
// Readable by any signed-in user, because whether comp-off exists decides
// whether the comp-off screens are worth showing to anyone.
router.get('/methods', async (req, res) => {
  try {
    const r = await pool.query('SELECT comp_off_enabled AS "compOffEnabled" FROM settings LIMIT 1');
    res.json({ success: true, data: r.rows[0] || { compOffEnabled: true } });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.patch('/methods', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  try {
    const { compOffEnabled } = req.body;
    if (compOffEnabled === undefined) return res.status(400).json({ success: false, message: 'Nothing to update' });
    const r = await pool.query(
      `UPDATE settings SET comp_off_enabled = $1, updated_at = NOW()
        WHERE id = (SELECT id FROM settings LIMIT 1)
        RETURNING comp_off_enabled AS "compOffEnabled"`,
      [!!compOffEnabled]
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Settings row not found' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

module.exports = router;
