/**
 * routes/pay-periods.js
 * Pay periods — the named ranges the payroll-facing leave reports run over.
 *
 * Readable by any signed-in user, because the chip on Loss of pay, Leave
 * encashment and Leave data for payroll has to populate for whoever can open
 * those reports. Only full-access roles can change one: the range a period
 * covers decides what those reports report.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

const SELECT_COLS = `
  id AS "_id", name,
  start_date::text AS "startDate",
  end_date::text   AS "endDate",
  process_encashment AS "processEncashment",
  is_active AS "isActive"
`;

// Validates a create/update payload. Returns an error string, or null.
function validate({ name, startDate, endDate }) {
  if (!name || !String(name).trim()) return 'Name is required';
  if (String(name).trim().length > 120) return 'Name is too long';
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(String(startDate || ''))) return 'Start date is required (YYYY-MM-DD)';
  if (!iso.test(String(endDate || ''))) return 'End date is required (YYYY-MM-DD)';
  if (String(endDate) < String(startDate)) return 'End date cannot be before the start date';
  return null;
}

// GET / — newest first, which is the order the chip lists them in.
// ?activeOnly=true drops retired periods; the chip uses it so a retired
// period stays readable on old reports without being offered for new ones.
router.get('/', async (req, res) => {
  try {
    const activeOnly = req.query.activeOnly === 'true';
    const r = await pool.query(
      `SELECT ${SELECT_COLS} FROM pay_periods
        ${activeOnly ? 'WHERE is_active = TRUE' : ''}
        ORDER BY start_date DESC, name ASC`
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.post('/', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  try {
    const { name, startDate, endDate, processEncashment, isActive } = req.body;
    const invalid = validate({ name, startDate, endDate });
    if (invalid) return res.status(400).json({ success: false, message: invalid });

    const r = await pool.query(
      `INSERT INTO pay_periods (name, start_date, end_date, process_encashment, is_active)
       VALUES ($1, $2::date, $3::date, $4, $5) RETURNING ${SELECT_COLS}`,
      [String(name).trim(), startDate, endDate, !!processEncashment, isActive === undefined ? true : !!isActive]
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ success: false, message: 'A pay period with that name already exists' });
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  }
});

router.patch('/:id', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  try {
    const current = await pool.query('SELECT name, start_date::text AS s, end_date::text AS e FROM pay_periods WHERE id = $1', [req.params.id]);
    if (!current.rows[0]) return res.status(404).json({ success: false, message: 'Pay period not found' });

    const { name, startDate, endDate, processEncashment, isActive } = req.body;
    // Validate the row as it will be, not just the fields that were sent —
    // moving one end of the range past the other is only visible in combination.
    const invalid = validate({
      name: name === undefined ? current.rows[0].name : name,
      startDate: startDate === undefined ? current.rows[0].s : startDate,
      endDate: endDate === undefined ? current.rows[0].e : endDate,
    });
    if (invalid) return res.status(400).json({ success: false, message: invalid });

    const sets = [];
    const params = [];
    const add = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
    if (name !== undefined) add('name', String(name).trim());
    if (startDate !== undefined) add('start_date', startDate);
    if (endDate !== undefined) add('end_date', endDate);
    if (processEncashment !== undefined) add('process_encashment', !!processEncashment);
    if (isActive !== undefined) add('is_active', !!isActive);
    if (!sets.length) return res.status(400).json({ success: false, message: 'Nothing to update' });

    sets.push('updated_at = NOW()');
    params.push(req.params.id);
    const r = await pool.query(
      `UPDATE pay_periods SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${SELECT_COLS}`,
      params
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ success: false, message: 'A pay period with that name already exists' });
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  }
});

router.delete('/:id', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM pay_periods WHERE id = $1 RETURNING id', [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Pay period not found' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

module.exports = router;
