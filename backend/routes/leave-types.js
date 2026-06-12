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
router.post('/', authorize('super_admin', 'hr'), async (req, res) => {
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
router.put('/balances/:employeeId', authorize('super_admin', 'hr'), async (req, res) => {
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

module.exports = router;
