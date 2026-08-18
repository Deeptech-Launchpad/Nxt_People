/**
 * routes/shifts.js
 * Settings → Shifts → Configuration → Manage Shifts.
 *
 * A shift is more than a start and an end. The reference's Add Shift form adds
 * four things this now carries:
 *
 *   Shift Margin        the boundary within which payable hours count, so
 *                       arriving two hours early is not two hours of pay
 *   Core Working Hours  the window an employee must be present for, which is a
 *                       narrower question than the shift's own span
 *   Weekends            from the location calendar, or from this shift
 *   Eligibility         who the shift may be assigned to
 *
 * working_days only decides anything when weekend_source is 'shift'. It has
 * been written by the shift form since it was built and read by nothing;
 * weekends come from work_calendars and weekend_rules. Saying so on the field
 * beats a picker that quietly decides nothing.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const logger = require('../logger');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

const WRITE = ['admin', 'director', 'hr_admin'];

class Invalid extends Error {
  constructor(message) { super(message); this.expected = true; }
}
const bad = m => new Invalid(m);

// The old handlers returned err.message straight to the client, which hands a
// caller the raw SQL error on any unexpected failure.
const fail = (res, err) => {
  if (err.expected) return res.status(400).json({ success: false, message: err.message });
  logger.error({ err: err.message, code: err.code }, 'Shift request failed');
  return res.status(500).json({ success: false, message: 'An internal server error occurred' });
};

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const hhmm = (v, label, { required = true } = {}) => {
  const s = String(v ?? '').trim();
  if (!s) {
    if (required) throw bad(`${label} is required`);
    return null;
  }
  const m = HHMM.exec(s);
  if (!m) throw bad(`${label} must be in HH:mm form`);
  return `${String(Number(m[1])).padStart(2, '0')}:${m[2]}`;
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// What a shift can be restricted to. Kept to fields an employee actually
// carries, so a criterion cannot be written that never matches anybody.
const ELIGIBILITY_FIELDS = [
  { key: 'location', label: 'Locations', column: 'work_location' },
  { key: 'department', label: 'Departments', column: 'department' },
  { key: 'designation', label: 'Designations', column: 'designation' },
  { key: 'employmentType', label: 'Employee type', column: 'employment_type' },
];
const ELIGIBILITY_BY_KEY = new Map(ELIGIBILITY_FIELDS.map(f => [f.key, f]));

const ROW = `
  id AS "_id", id, name, start_time AS "startTime", end_time AS "endTime",
  grace_minutes AS "graceMinutes", working_days AS "workingDays", color,
  is_default AS "isDefault", sort_order AS "sortOrder",
  margin_enabled AS "marginEnabled", margin_before AS "marginBefore", margin_after AS "marginAfter",
  core_enabled AS "coreEnabled", core_start AS "coreStart", core_end AS "coreEnd",
  weekend_source AS "weekendSource", allowance_enabled AS "allowanceEnabled",
  eligibility`;

router.get('/meta', (req, res) => {
  res.json({ success: true, data: { eligibilityFields: ELIGIBILITY_FIELDS, days: DAYS } });
});

router.get('/', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT ${ROW},
              (SELECT COUNT(*)::int FROM employees e
                WHERE e.shift_id = shifts.id AND e.deleted_at IS NULL AND e.status = 'active') AS "employeeCount"
         FROM shifts ORDER BY sort_order, name`);
    res.json({ success: true, data: r.rows });
  } catch (err) { fail(res, err); }
});

function clean(b) {
  const name = String(b.name ?? '').trim();
  if (!name) throw bad('A shift name is required');
  if (name.length > 150) throw bad('The shift name must be 150 characters or fewer');

  const marginOn = !!b.marginEnabled;
  const coreOn = !!b.coreEnabled;
  const weekendSource = b.weekendSource === 'shift' ? 'shift' : 'location';

  const days = Array.isArray(b.workingDays) ? b.workingDays.filter(d => DAYS.includes(d)) : [];
  // A shift that decides its own weekends with no working day is a shift
  // nobody ever works.
  if (weekendSource === 'shift' && days.length === 0) {
    throw bad('A shift that sets its own weekends needs at least one working day');
  }

  const eligibility = (Array.isArray(b.eligibility) ? b.eligibility : [])
    .filter(c => ELIGIBILITY_BY_KEY.has(c?.field) && String(c?.value ?? '').trim())
    .map(c => ({ field: c.field, value: String(c.value).trim() }));

  const grace = Number(b.graceMinutes);
  if (!Number.isInteger(grace) || grace < 0 || grace > 120) {
    throw bad('Grace must be a whole number of minutes between 0 and 120');
  }

  return {
    name,
    start_time: hhmm(b.startTime, 'Start time'),
    end_time: hhmm(b.endTime, 'End time'),
    grace_minutes: grace,
    working_days: JSON.stringify(days),
    color: String(b.color ?? '#4F46E5').slice(0, 20),
    sort_order: Number.isInteger(Number(b.sortOrder)) ? Number(b.sortOrder) : 100,
    margin_enabled: marginOn,
    margin_before: marginOn ? hhmm(b.marginBefore || '00:30', 'Margin before') : null,
    margin_after: marginOn ? hhmm(b.marginAfter || '00:30', 'Margin after') : null,
    core_enabled: coreOn,
    core_start: coreOn ? hhmm(b.coreStart, 'Core start') : null,
    core_end: coreOn ? hhmm(b.coreEnd, 'Core end') : null,
    weekend_source: weekendSource,
    allowance_enabled: !!b.allowanceEnabled,
    eligibility: JSON.stringify(eligibility),
  };
}

const jsonbCols = new Set(['working_days', 'eligibility']);
const cast = (c, i) => `$${i + 1}${jsonbCols.has(c) ? '::jsonb' : ''}`;

router.post('/', authorize(...WRITE), async (req, res) => {
  try {
    const v = clean(req.body || {});
    const cols = Object.keys(v);
    const r = await pool.query(
      `INSERT INTO shifts (${cols.join(', ')}) VALUES (${cols.map(cast).join(', ')}) RETURNING ${ROW}`,
      cols.map(c => v[c])
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ success: false, message: 'A shift with that name already exists' });
    fail(res, err);
  }
});

router.put('/:id', authorize(...WRITE), async (req, res) => {
  try {
    const v = clean(req.body || {});
    const cols = Object.keys(v);
    const r = await pool.query(
      `UPDATE shifts SET ${cols.map((c, i) => `${c} = ${cast(c, i)}`).join(', ')}, updated_at = NOW()
        WHERE id = $${cols.length + 1} RETURNING ${ROW}`,
      [...cols.map(c => v[c]), req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Shift not found' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ success: false, message: 'A shift with that name already exists' });
    fail(res, err);
  }
});

// The copy icon on the reference's row.
router.post('/:id/duplicate', authorize(...WRITE), async (req, res) => {
  try {
    const r = await pool.query(
      `INSERT INTO shifts (name, start_time, end_time, grace_minutes, working_days, color,
                           sort_order, margin_enabled, margin_before, margin_after,
                           core_enabled, core_start, core_end, weekend_source,
                           allowance_enabled, eligibility)
       SELECT LEFT(name || ' (copy)', 150), start_time, end_time, grace_minutes, working_days,
              color, sort_order + 1, margin_enabled, margin_before, margin_after,
              core_enabled, core_start, core_end, weekend_source, allowance_enabled, eligibility
         FROM shifts WHERE id = $1 RETURNING ${ROW}`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Shift not found' });
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ success: false, message: 'A copy of that shift already exists' });
    fail(res, err);
  }
});

router.patch('/:id/default', authorize(...WRITE), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Exactly one default. Two would make "which shift does a new employee
    // start on" a question with two answers.
    await client.query(`UPDATE shifts SET is_default = FALSE WHERE is_default = TRUE`);
    const r = await client.query(
      `UPDATE shifts SET is_default = TRUE, updated_at = NOW() WHERE id = $1 RETURNING ${ROW}`,
      [req.params.id]);
    if (!r.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Shift not found' }); }
    await client.query('COMMIT');
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    fail(res, err);
  } finally { client.release(); }
});

router.delete('/:id', authorize(...WRITE), async (req, res) => {
  try {
    const s = (await pool.query(`SELECT name, is_default FROM shifts WHERE id = $1`, [req.params.id])).rows[0];
    if (!s) return res.status(404).json({ success: false, message: 'Shift not found' });

    // The reference shows no delete on its default shift, and for good reason:
    // it is what a new employee is put on.
    if (s.is_default) throw bad(`${s.name} is the default shift. Make another shift the default first.`);

    // Deleting used to be unguarded. shift_id is ON DELETE SET NULL, so this
    // silently left employees with no shift — no expected start, and no basis
    // for counting anyone late.
    const held = (await pool.query(
      `SELECT COUNT(*)::int AS n FROM employees WHERE shift_id = $1 AND deleted_at IS NULL`,
      [req.params.id])).rows[0].n;
    if (held > 0) throw bad(`${held} employee(s) are on this shift. Move them to another shift first.`);

    const rostered = (await pool.query(
      `SELECT COUNT(*)::int AS n FROM shift_roster WHERE shift_id = $1 AND date >= CURRENT_DATE`,
      [req.params.id])).rows[0].n;
    if (rostered > 0) throw bad(`${rostered} upcoming rostered day(s) use this shift.`);

    await pool.query('DELETE FROM shifts WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Shift deleted' });
  } catch (err) { fail(res, err); }
});

// Who a shift may be given to, from its eligibility criteria. Empty criteria
// means everybody, which is what the reference's blank list means.
router.get('/:id/eligible', async (req, res) => {
  try {
    const s = (await pool.query(`SELECT eligibility FROM shifts WHERE id = $1`, [req.params.id])).rows[0];
    if (!s) return res.status(404).json({ success: false, message: 'Shift not found' });

    const where = [`e.deleted_at IS NULL`, `e.status = 'active'`];
    const params = [];
    for (const c of s.eligibility || []) {
      const f = ELIGIBILITY_BY_KEY.get(c.field);
      if (!f) continue;
      params.push(c.value);
      where.push(`e.${f.column} = $${params.length}`);
    }
    const r = await pool.query(
      `SELECT e.id, e.employee_id AS "employeeId",
              TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS name,
              e.department, e.designation, e.work_location AS "workLocation"
         FROM employees e WHERE ${where.join(' AND ')}
        ORDER BY e.first_name, e.last_name`,
      params
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { fail(res, err); }
});

router.post('/:id/assign', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const { employeeIds } = req.body;
    if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
      throw bad('No employees specified');
    }
    if (req.user.role === 'manager') {
      const uniqueIds = [...new Set(employeeIds)];
      const scope = await pool.query(
        'SELECT id FROM employees WHERE id = ANY($1) AND reporting_manager_id = $2',
        [uniqueIds, req.user._id]
      );
      if (scope.rows.length !== uniqueIds.length) {
        return res.status(403).json({ success: false, message: 'You can only assign shifts to employees in your team' });
      }
    }
    await pool.query('UPDATE employees SET shift_id = $1 WHERE id = ANY($2)', [req.params.id, employeeIds]);
    res.json({ success: true, message: 'Shift assigned' });
  } catch (err) { fail(res, err); }
});

module.exports = router;
