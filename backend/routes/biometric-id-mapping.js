/* ── Operations → Attendance → Biometric ID mapping ──────────────────────────
 *  A record of which employee a biometric device's numeric user ID belongs
 *  to. See migrate_biometric_id_mapping.js — nothing yet reads this to import
 *  a device's punches; this is the mapping a future sync would consume.
 * ───────────────────────────────────────────────────────────────────────── */

const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { serverError } = require('../utils/serverError');
const { audit } = require('../middleware/audit');

router.use(protect);
const FULL = ['admin', 'director', 'hr_admin'];
router.use(authorize(...FULL));

// GET — every mapping, newest first, with enough of the employee record to
// render the list without a second round trip per row.
router.get('/', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT m.id AS "_id", m.biometric_id AS "biometricId", m.created_at AS "createdAt",
              e.id AS "employeeId", e.employee_id AS "employeeCode",
              e.first_name AS "firstName", e.last_name AS "lastName", e.department
         FROM biometric_id_mappings m
         JOIN employees e ON e.id = m.employee_id
        ORDER BY m.created_at DESC`
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { serverError(res, err); }
});

// POST — create a mapping. Both sides are unique, so a person or a device ID
// already in use is refused with which one, rather than a raw constraint
// error the screen would have to interpret.
router.post('/', audit('CREATE', 'BiometricIdMapping'), async (req, res) => {
  try {
    const { employeeId, biometricId } = req.body;
    if (!employeeId || !String(biometricId || '').trim()) {
      return res.status(400).json({ success: false, message: 'An employee and a biometric ID are required' });
    }
    const bId = String(biometricId).trim();

    const emp = await pool.query(
      `SELECT id FROM employees WHERE id = $1 AND deleted_at IS NULL`, [employeeId]);
    if (!emp.rows.length) return res.status(404).json({ success: false, message: 'Employee not found' });

    const [byEmployee, byDevice] = await Promise.all([
      pool.query(`SELECT id FROM biometric_id_mappings WHERE employee_id = $1`, [employeeId]),
      pool.query(`SELECT id FROM biometric_id_mappings WHERE biometric_id = $1`, [bId]),
    ]);
    if (byEmployee.rows.length) {
      return res.status(400).json({ success: false, message: 'This employee already has a biometric ID mapped. Remove it first to map a different one.' });
    }
    if (byDevice.rows.length) {
      return res.status(400).json({ success: false, message: `Biometric ID "${bId}" is already mapped to another employee.` });
    }

    const r = await pool.query(
      `INSERT INTO biometric_id_mappings (employee_id, biometric_id, created_by)
       VALUES ($1, $2, $3)
       RETURNING id AS "_id", biometric_id AS "biometricId", created_at AS "createdAt"`,
      [employeeId, bId, req.user._id]
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ success: false, message: 'That employee or biometric ID is already mapped.' });
    }
    serverError(res, err);
  }
});

// DELETE — unmap. Never blocks: an unmapped employee is exactly the state
// before this feature existed, not an error condition.
router.delete('/:id', audit('DELETE', 'BiometricIdMapping'), async (req, res) => {
  try {
    const r = await pool.query(
      `DELETE FROM biometric_id_mappings WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Mapping not found' });
    res.json({ success: true, message: 'Mapping removed' });
  } catch (err) { serverError(res, err); }
});

module.exports = router;
