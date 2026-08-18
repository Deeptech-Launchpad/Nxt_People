/**
 * routes/shift-rotation.js
 * Settings → Shifts → Automation → Shift Rotation.
 *
 * The reference's Shifts Automation tab also carries Workflows, Blueprints,
 * Actions, Templates and Logs. Those are not duplicated here: this application
 * has one Automation, under Manage Accounts, covering every record type it
 * has. Two workflow builders for one workflows table is how the two drift
 * apart. A shift change raises an employee field_updated event there instead.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const logger = require('../logger');
const { protect, authorize } = require('../middleware/auth');
const {
  runRotation, nextRunDate, periodFor, CRITERIA_FIELDS, DAYS,
} = require('../utils/shiftRotation');

router.use(protect);

const WRITE = ['admin', 'director', 'hr_admin'];

class Invalid extends Error {
  constructor(message) { super(message); this.expected = true; }
}
const bad = m => new Invalid(m);

const fail = (res, err) => {
  if (err.expected) return res.status(400).json({ success: false, message: err.message });
  logger.error({ err: err.message, code: err.code }, 'Shift rotation request failed');
  return res.status(500).json({ success: false, message: 'An internal server error occurred' });
};

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const CRITERIA_KEYS = new Set(CRITERIA_FIELDS.map(f => f.key));

const ROW = `
  r.id, r.name, r.is_active AS "isActive", r.frequency,
  r.day_of_week AS "dayOfWeek", r.day_of_month AS "dayOfMonth",
  r.run_at AS "runAt", r.period_from AS "periodFrom",
  r.criteria, r.employee_ids AS "employeeIds", r.last_run_at AS "lastRunAt"`;

const stepsOf = async id => (await pool.query(
  `SELECT s.id, s.from_shift_id AS "fromShiftId", s.to_shift_id AS "toShiftId",
          f.name AS "fromName", t.name AS "toName", s.sort_order AS "sortOrder"
     FROM shift_rotation_steps s
     JOIN shifts f ON f.id = s.from_shift_id
     JOIN shifts t ON t.id = s.to_shift_id
    WHERE s.rotation_id = $1 ORDER BY s.sort_order`, [id])).rows;

router.get('/meta', (req, res) => {
  res.json({ success: true, data: { criteriaFields: CRITERIA_FIELDS, days: DAYS } });
});

router.get('/', async (req, res) => {
  try {
    const r = await pool.query(`SELECT ${ROW} FROM shift_rotations r ORDER BY r.name`);
    const out = [];
    for (const row of r.rows) {
      const next = nextRunDate(
        { frequency: row.frequency, day_of_week: row.dayOfWeek, day_of_month: row.dayOfMonth });
      const period = periodFor({ frequency: row.frequency }, next);
      out.push({
        ...row,
        steps: await stepsOf(row.id),
        // What the reference states on its form: when the next change happens
        // and how long the changed shifts hold for.
        nextRun: next.toISOString().slice(0, 10),
        periodEnd: period.end.toISOString().slice(0, 10),
      });
    }
    res.json({ success: true, data: out });
  } catch (err) { fail(res, err); }
});

function clean(b) {
  const name = String(b.name ?? '').trim();
  if (!name) throw bad('A scheduler name is required');
  if (name.length > 150) throw bad('The scheduler name must be 150 characters or fewer');

  const frequency = b.frequency === 'monthly' ? 'monthly' : 'weekly';
  if (b.runAt && !HHMM.test(b.runAt)) throw bad('Time of schedule must be in HH:mm form');

  const criteria = (Array.isArray(b.criteria) ? b.criteria : [])
    .filter(c => CRITERIA_KEYS.has(c?.field) && String(c?.value ?? '').trim())
    .map(c => ({ field: c.field, value: String(c.value).trim() }));
  const employeeIds = (Array.isArray(b.employeeIds) ? b.employeeIds : []).filter(Boolean);

  // The guard that matters most. An empty scope treated as "everybody" would
  // move the whole organization onto a different shift.
  if (!criteria.length && !employeeIds.length) {
    throw bad('Add a criterion or an employee, or the rotation moves nobody');
  }

  return {
    name,
    is_active: b.isActive !== false,
    frequency,
    day_of_week: Math.max(0, Math.min(6, Number(b.dayOfWeek) || 0)),
    day_of_month: Math.max(1, Math.min(28, Number(b.dayOfMonth) || 1)),
    run_at: b.runAt || '00:00',
    period_from: Math.max(0, Math.min(6, Number(b.periodFrom) || 0)),
    criteria: JSON.stringify(criteria),
    employee_ids: employeeIds,
  };
}

const saveSteps = async (client, rotationId, steps) => {
  await client.query(`DELETE FROM shift_rotation_steps WHERE rotation_id = $1`, [rotationId]);
  const list = Array.isArray(steps) ? steps : [];
  if (!list.length) throw bad('A rotation needs at least one shift change');
  let order = 0;
  const seen = new Set();
  for (const s of list) {
    if (!s?.fromShiftId || !s?.toShiftId) throw bad('Each rotation needs a shift to move from and to');
    if (s.fromShiftId === s.toShiftId) throw bad('A rotation that moves a shift to itself changes nothing');
    // Two steps from the same shift would make the destination arbitrary.
    if (seen.has(s.fromShiftId)) throw bad('Two rotations cannot start from the same shift');
    seen.add(s.fromShiftId);
    await client.query(
      `INSERT INTO shift_rotation_steps (rotation_id, from_shift_id, to_shift_id, sort_order)
       VALUES ($1, $2, $3, $4)`,
      [rotationId, s.fromShiftId, s.toShiftId, order++]
    );
  }
};

router.post('/', authorize(...WRITE), async (req, res) => {
  const client = await pool.connect();
  try {
    const v = clean(req.body || {});
    await client.query('BEGIN');
    const cols = Object.keys(v);
    const created = await client.query(
      `INSERT INTO shift_rotations (${cols.join(', ')})
       VALUES (${cols.map((c, i) => `$${i + 1}${c === 'criteria' ? '::jsonb' : c === 'employee_ids' ? '::uuid[]' : ''}`).join(', ')})
       RETURNING id`,
      cols.map(c => v[c])
    );
    await saveSteps(client, created.rows[0].id, req.body?.steps);
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: { id: created.rows[0].id } });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return res.status(400).json({ success: false, message: 'A rotation with that name already exists' });
    fail(res, err);
  } finally { client.release(); }
});

router.put('/:id', authorize(...WRITE), async (req, res) => {
  const client = await pool.connect();
  try {
    const v = clean(req.body || {});
    await client.query('BEGIN');
    const cols = Object.keys(v);
    const upd = await client.query(
      `UPDATE shift_rotations SET ${cols.map((c, i) => `${c} = $${i + 1}${c === 'criteria' ? '::jsonb' : c === 'employee_ids' ? '::uuid[]' : ''}`).join(', ')},
              updated_at = NOW()
        WHERE id = $${cols.length + 1} RETURNING id`,
      [...cols.map(c => v[c]), req.params.id]
    );
    if (!upd.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Rotation not found' }); }
    await saveSteps(client, req.params.id, req.body?.steps);
    await client.query('COMMIT');
    res.json({ success: true, data: { id: req.params.id } });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return res.status(400).json({ success: false, message: 'A rotation with that name already exists' });
    fail(res, err);
  } finally { client.release(); }
});

router.patch('/:id/status', authorize(...WRITE), async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE shift_rotations SET is_active = $1, updated_at = NOW() WHERE id = $2
       RETURNING id, is_active AS "isActive"`,
      [req.body?.isActive !== false, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Rotation not found' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { fail(res, err); }
});

router.delete('/:id', authorize(...WRITE), async (req, res) => {
  try {
    const r = await pool.query(`DELETE FROM shift_rotations WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Rotation not found' });
    res.json({ success: true, message: 'Rotation deleted' });
  } catch (err) { fail(res, err); }
});

// Who would move, without moving anybody. Reassigning sixty-eight people is
// not something to find out about afterwards.
router.get('/:id/preview', async (req, res) => {
  try {
    const out = await runRotation(req.params.id, { dryRun: true });
    res.json({ success: true, data: out });
  } catch (err) { fail(res, err); }
});

router.post('/:id/run', authorize(...WRITE), async (req, res) => {
  try {
    const out = await runRotation(req.params.id);
    res.json({ success: true, data: out });
  } catch (err) { fail(res, err); }
});

router.get('/runs', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT rr.id, rr.rotation_name AS "rotationName", rr.status, rr.message,
              rr.ran_at AS "ranAt",
              TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS "employeeName",
              f.name AS "fromShift", t.name AS "toShift"
         FROM shift_rotation_runs rr
         LEFT JOIN employees e ON e.id = rr.employee_id
         LEFT JOIN shifts f ON f.id = rr.from_shift_id
         LEFT JOIN shifts t ON t.id = rr.to_shift_id
        ORDER BY rr.ran_at DESC LIMIT 200`);
    res.json({ success: true, data: r.rows });
  } catch (err) { fail(res, err); }
});

module.exports = router;
