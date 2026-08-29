/**
 * routes/leave-types.js
 * Leave type definitions + per-employee balance management
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { getLeavePolicies } = require('../utils/leavePolicy');
const { ledgerFor } = require('../utils/leaveLedger');
const { audit } = require('../middleware/audit');
const { isFullAccess } = require('../utils/roles');
const { serverError } = require('../utils/serverError');

router.use(protect);

// GET /api/leave-types — all active leave types
router.get('/', async (req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM leave_types WHERE is_active=true ORDER BY name`);
    res.json({ success: true, data: r.rows });
  } catch (err) { serverError(res, err); }
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
  } catch (err) { serverError(res, err); }
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
  } catch (err) { serverError(res, err); }
});

// POST /api/leave-types/policies/:id/clone — duplicate a policy.
// A copy starts disabled. Enabling it is a separate, deliberate act: a second
// live policy with the same rules would double what a balance report grants.
router.post('/policies/:id/clone', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  try {
    const src = await pool.query(`SELECT * FROM leave_types WHERE id = $1`, [req.params.id]);
    const row = src.rows[0];
    if (!row) return res.status(404).json({ success: false, message: 'Leave policy not found' });

    // The code is a unique key, so the copy needs its own. Counting up rather
    // than appending blindly means cloning twice does not collide.
    const taken = new Set((await pool.query(`SELECT code FROM leave_types`)).rows.map(x => x.code));
    let code = `${row.code}_copy`, n = 1;
    while (taken.has(code)) { n += 1; code = `${row.code}_copy${n}`; }

    const r = await pool.query(
      `INSERT INTO leave_types
         (name, code, icon, color, is_active, pay_type, unit, accrual_mode, accrual_amount,
          carry_forward, policy_type, max_days_per_year, sort_order)
       VALUES ($1,$2,$3,$4,FALSE,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id AS "_id", name, code`,
      [`${row.name} (Copy)`, code, row.icon, row.color, row.pay_type, row.unit,
       row.accrual_mode, row.accrual_amount, row.carry_forward, row.policy_type,
       row.max_days_per_year, row.sort_order]
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) { serverError(res, err); }
});

// DELETE /api/leave-types/policies/:id — remove a policy outright.
//
// Guarded, because the row is what every leave and every balance points at.
// leaves.leave_type stores the code as text with no foreign key, so deleting a
// used policy would not fail — it would leave leaves naming a policy that no
// longer exists, and those rows would stop resolving a name, a colour or a pay
// type. Disabling is the reversible answer and the toggle already does it.
router.delete('/policies/:id', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  try {
    const src = await pool.query(`SELECT id, name, code FROM leave_types WHERE id = $1`, [req.params.id]);
    const row = src.rows[0];
    if (!row) return res.status(404).json({ success: false, message: 'Leave policy not found' });

    // leaves.leave_type spells comp-off with an underscore; leave_types.code
    // does not. They have always disagreed, so the guard has to translate or
    // it would report zero leaves for the one policy most likely to have them.
    const leaveCode = row.code === 'compoff' ? 'comp_off' : row.code;
    const used = await pool.query(`SELECT COUNT(*)::int n FROM leaves WHERE leave_type = $1`, [leaveCode]);
    if (used.rows[0].n > 0) {
      return res.status(400).json({
        success: false,
        message: `${row.name} is used by ${used.rows[0].n} leave request${used.rows[0].n === 1 ? '' : 's'}. Disable it instead — that stops new requests without breaking the old ones.`,
      });
    }

    const held = await pool.query(
      `SELECT COUNT(*)::int n FROM leave_balances WHERE leave_type_id = $1 AND (available > 0 OR booked > 0)`,
      [req.params.id]
    );
    if (held.rows[0].n > 0) {
      return res.status(400).json({
        success: false,
        message: `${held.rows[0].n} employee${held.rows[0].n === 1 ? ' holds' : 's hold'} a balance of ${row.name}. Clear those balances or disable the policy instead.`,
      });
    }

    // Only empty balance rows are left, and they are derived — the accrual job
    // recreates them for whatever policies exist.
    await pool.query(`DELETE FROM leave_balances WHERE leave_type_id = $1`, [req.params.id]);
    await pool.query(`DELETE FROM leave_types WHERE id = $1`, [req.params.id]);
    res.json({ success: true, message: `${row.name} deleted` });
  } catch (err) { serverError(res, err); }
});

// GET /api/leave-types/balances?year=2025&employeeId=  (employee sees own, admin can pass id)
/* Every employee's balance for every leave type, in one read.
 *
 * Zoho's Customize Balance is a grid — people down the side, leave types along
 * the top — and /balances answers for one person at a time. Asking it once per
 * employee would be a hundred and fifty requests to draw one screen, so the
 * grid gets its own query.
 *
 * A person with no row for a type has not been given one yet; that reads as the
 * type's annual maximum, which is what /balances falls back to for a single
 * employee. Same rule, so the grid and the detail cannot disagree. */
router.get('/balances/all', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const now = new Date();
    // Only accrue up to the month actually reached. Granting December's
    // entitlement in March shows a balance nobody has earned yet.
    const upToMonth = year < now.getFullYear() ? 12
      : year > now.getFullYear() ? 0 : now.getMonth() + 1;

    const [policies, types, people, leaves, stored, comp] = await Promise.all([
      getLeavePolicies(),
      pool.query(`SELECT id, name, code, unit, pay_type AS "payType", max_days_per_year
                    FROM leave_types WHERE is_active = true ORDER BY sort_order, name`),
      pool.query(
        `SELECT id, employee_id AS "employeeCode", TRIM(CONCAT(first_name,' ',last_name)) AS name,
                department, joining_date::text AS "joiningDate"
           FROM employees
          WHERE deleted_at IS NULL AND status = 'active'
          ORDER BY employee_id`),
      pool.query(
        `SELECT employee_id, leave_type AS "leaveType", start_date::text AS "startDate",
                total_days AS "totalDays", hours, reason
           FROM leaves
          WHERE status = 'approved' AND EXTRACT(YEAR FROM start_date) = $1`, [year]),
      pool.query(`SELECT employee_id, leave_type_id, available FROM leave_balances WHERE year = $1`, [year]),
      pool.query(
        `SELECT employee_id, COALESCE(SUM(days_earned), 0)::float AS earned
           FROM comp_offs
          WHERE status = 'approved' AND EXTRACT(YEAR FROM worked_date) = $1
          GROUP BY employee_id`, [year]),
    ]);

    const leavesByEmp = new Map();
    for (const l of leaves.rows) {
      if (!leavesByEmp.has(l.employee_id)) leavesByEmp.set(l.employee_id, []);
      leavesByEmp.get(l.employee_id).push(l);
    }
    const storedByKey = new Map(stored.rows.map(b => [`${b.employee_id}|${b.leave_type_id}`, b.available]));
    const earnedByEmp = new Map(comp.rows.map(c => [c.employee_id, c.earned]));

    const rows = people.rows.map(p => {
      const mine = leavesByEmp.get(p.id) || [];
      return {
        _id: p.id, employeeCode: p.employeeCode, name: p.name, department: p.department,
        balances: types.rows.map(t => {
          const l = ledgerFor(policies.get(t.code), p, mine.filter(x => x.leaveType === t.code), {
            year, upToMonth,
            stored: storedByKey.get(`${p.id}|${t.id}`) ?? null,
            earnedAmount: earnedByEmp.get(p.id) || 0,
          });
          return {
            leaveTypeId: t.id, available: l.balance, granted: l.granted,
            used: l.used, overridden: l.overridden, unit: l.unit,
          };
        }),
      };
    });

    res.json({
      success: true, year,
      types: types.rows.map(t => ({
        _id: t.id, name: t.name, code: t.code, unit: t.unit,
        payType: t.payType, maxDays: t.max_days_per_year,
      })),
      data: rows,
    });
  } catch (err) { serverError(res, err); }
});

/* One employee's policies, with the working shown - Zoho's Customize Policy.
 *
 * Its table is the balance per leave type; its View History is the ledger
 * behind one of them. Both come from here in one read, because a screen that
 * fetches the history separately can show a total that disagrees with the rows
 * underneath it. */
router.get('/ledger', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  try {
    const { employeeId } = req.query;
    if (!employeeId) return res.status(400).json({ success: false, message: 'An employee is required' });
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const now = new Date();
    const upToMonth = year < now.getFullYear() ? 12
      : year > now.getFullYear() ? 0 : now.getMonth() + 1;

    const emp = (await pool.query(
      `SELECT id, employee_id AS "employeeCode", TRIM(CONCAT(first_name,' ',last_name)) AS name,
              department, designation, joining_date::text AS "joiningDate"
         FROM employees WHERE id = $1 AND deleted_at IS NULL`, [employeeId])).rows[0];
    if (!emp) return res.status(404).json({ success: false, message: 'That employee no longer exists.' });

    const [policies, types, leaves, stored, comp] = await Promise.all([
      getLeavePolicies(),
      pool.query(`SELECT id, name, code, unit, pay_type AS "payType"
                    FROM leave_types WHERE is_active = true ORDER BY sort_order, name`),
      pool.query(
        `SELECT leave_type AS "leaveType", start_date::text AS "startDate",
                end_date::text AS "endDate", total_days AS "totalDays", hours, reason
           FROM leaves
          WHERE employee_id = $1 AND status = 'approved'
            AND EXTRACT(YEAR FROM start_date) = $2
          ORDER BY start_date`, [employeeId, year]),
      pool.query(`SELECT leave_type_id, available FROM leave_balances WHERE employee_id = $1 AND year = $2`,
        [employeeId, year]),
      pool.query(
        `SELECT COALESCE(SUM(days_earned), 0)::float AS earned FROM comp_offs
          WHERE employee_id = $1 AND status = 'approved' AND EXTRACT(YEAR FROM worked_date) = $2`,
        [employeeId, year]),
    ]);

    const storedByType = new Map(stored.rows.map(b => [b.leave_type_id, b.available]));
    const earned = comp.rows[0]?.earned || 0;

    const data = types.rows.map(t => ({
      leaveTypeId: t.id,
      ...ledgerFor(policies.get(t.code), emp, leaves.rows.filter(l => l.leaveType === t.code), {
        year, upToMonth, stored: storedByType.get(t.id) ?? null, earnedAmount: earned,
      }),
    }));

    res.json({ success: true, year, employee: emp, data });
  } catch (err) { serverError(res, err); }
});

/* Rerun a policy - drop the override and let the calculation stand again.
 *
 * Zoho's button of the same name. It does NOT invent a figure: it deletes the
 * stored row, after which the balance is whatever the policy and the leave
 * taken say it is. That is the only safe meaning, because a stored row exists
 * because somebody corrected something, and the honest way to undo a
 * correction is to remove it rather than write a different number over it. */
router.post('/ledger/rerun', authorize('admin', 'director', 'hr_admin'),
  audit('RERUN', 'leave_balance'), async (req, res) => {
  try {
    const { employeeId, leaveTypeId, year } = req.body;
    if (!employeeId || !leaveTypeId) {
      return res.status(400).json({ success: false, message: 'An employee and a leave type are required' });
    }
    const y = parseInt(year, 10) || new Date().getFullYear();
    const r = await pool.query(
      `DELETE FROM leave_balances WHERE employee_id = $1 AND leave_type_id = $2 AND year = $3`,
      [employeeId, leaveTypeId, y]);
    res.json({
      success: true,
      message: r.rowCount
        ? 'The override was removed. The balance now follows the policy.'
        : 'There was no override - this balance already follows the policy.',
    });
  } catch (err) { serverError(res, err); }
});

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
  } catch (err) { serverError(res, err); }
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
    serverError(res, err);
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
  } catch (err) { serverError(res, err); }
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
  } catch (err) { serverError(res, err); }
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
  } catch (err) { serverError(res, err); }
});

module.exports = router;
