/**
 * routes/shift-patterns.js
 * Settings → Shifts → Configuration → Shift Patterns.
 *
 * A pattern is a recipe that fills shift_roster, which attendance resolves
 * against — so a pattern decides what someone is actually expected to work.
 * Generated rows carry their pattern_id and only that pattern's rows are ever
 * replaced, so a day rostered by hand survives a regeneration.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const logger = require('../logger');
const { protect, authorize } = require('../middleware/auth');
const { generateRoster, DAY_KEYS } = require('../utils/shiftPatterns');

router.use(protect);

const WRITE = ['admin', 'director', 'hr_admin'];

class Invalid extends Error {
  constructor(message) { super(message); this.expected = true; }
}
const bad = m => new Invalid(m);

const fail = (res, err) => {
  if (err.expected) return res.status(400).json({ success: false, message: err.message });
  logger.error({ err: err.message, code: err.code }, 'Shift pattern request failed');
  return res.status(500).json({ success: false, message: 'An internal server error occurred' });
};

const TYPES = new Set(['weekly', 'monthly', 'custom']);
const CYCLE_MODES = new Set(['every', 'calendar_weeks']);

// The reference's Shift Pattern Gallery. Three starting points rather than a
// blank grid — the shift ids are filled in by the client from what exists,
// because a template naming a shift this organization does not have would
// produce a pattern that rosters nobody.
const GALLERY = [
  {
    key: 'alternate_week',
    name: 'Alternate Week Shift pattern',
    patternType: 'weekly',
    description: 'Employee works alternate weeks on shifts A and B',
    cycleMode: 'every', cycleWeeks: 1,
    weeks: 2, shiftsNeeded: 2,
  },
  {
    key: 'four_on_four_off',
    name: '4 on 4 off Shift Pattern',
    patternType: 'custom',
    description: 'Employee works 4 days on shift (typically 12-hour shifts), followed by 4 days off',
    cycleMode: 'every', cycleWeeks: 1,
    weeks: 2, shiftsNeeded: 1,
  },
  {
    key: 'monthly',
    name: 'Monthly Shift Pattern',
    patternType: 'monthly',
    description: 'Employee works in shift A from 1st to 15th of each month, and shift B for the rest of the month',
    cycleMode: 'calendar_weeks', cycleWeeks: 1,
    weeks: 3, shiftsNeeded: 2,
  },
];

const ROW = `
  p.id, p.name, p.pattern_type AS "patternType", p.cycle_mode AS "cycleMode",
  p.cycle_weeks AS "cycleWeeks", p.weeks, p.is_active AS "isActive",
  (SELECT COUNT(*)::int FROM shift_pattern_assignments a WHERE a.pattern_id = p.id) AS "assignedCount",
  (SELECT COUNT(*)::int FROM shift_roster r WHERE r.pattern_id = p.id AND r.date >= CURRENT_DATE) AS "rosteredAhead"`;

router.get('/gallery', (req, res) => res.json({ success: true, data: GALLERY }));

router.get('/', async (req, res) => {
  try {
    const type = TYPES.has(req.query.patternType) ? req.query.patternType : null;
    const r = await pool.query(
      `SELECT ${ROW} FROM shift_patterns p
        ${type ? 'WHERE p.pattern_type = $1' : ''}
        ORDER BY p.name`,
      type ? [type] : []
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { fail(res, err); }
});

router.get('/:id', async (req, res) => {
  try {
    const r = await pool.query(`SELECT ${ROW} FROM shift_patterns p WHERE p.id = $1`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Pattern not found' });
    const assigned = await pool.query(
      `SELECT a.id, a.employee_id AS "employeeId", a.start_date AS "startDate", a.end_date AS "endDate",
              TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS name, e.employee_id AS "employeeCode"
         FROM shift_pattern_assignments a
         JOIN employees e ON e.id = a.employee_id
        WHERE a.pattern_id = $1 ORDER BY e.first_name`,
      [req.params.id]
    );
    res.json({ success: true, data: { ...r.rows[0], assignments: assigned.rows } });
  } catch (err) { fail(res, err); }
});

async function clean(b) {
  const name = String(b.name ?? '').trim();
  if (!name) throw bad('A pattern name is required');
  if (name.length > 150) throw bad('The pattern name must be 150 characters or fewer');

  const patternType = TYPES.has(b.patternType) ? b.patternType : 'weekly';
  const cycleMode = CYCLE_MODES.has(b.cycleMode) ? b.cycleMode : 'every';
  const cycleWeeks = Math.max(1, Math.min(6, Number(b.cycleWeeks) || 1));

  const weeks = Array.isArray(b.weeks) ? b.weeks : [];
  if (!weeks.length) throw bad('A pattern needs at least one week');
  if (weeks.length > 6) throw bad('A pattern can have at most six weeks');

  // Every shift named must exist. A pattern pointing at a deleted shift would
  // generate a roster row whose shift resolves to nothing.
  const named = new Set();
  for (const w of weeks) {
    for (const key of DAY_KEYS) {
      const v = w?.days?.[key];
      if (v) named.add(String(v));
    }
  }
  if (named.size) {
    const found = await pool.query(`SELECT id FROM shifts WHERE id = ANY($1::uuid[])`, [[...named]]);
    if (found.rows.length !== named.size) throw bad('That pattern names a shift that no longer exists');
  }
  // Every day blank is a pattern that rosters nobody onto anything.
  if (named.size === 0) throw bad('Set at least one day to a shift');

  const cleanWeeks = weeks.map((w, i) => ({
    week: i + 1,
    days: Object.fromEntries(DAY_KEYS.map(k => [k, w?.days?.[k] || null])),
  }));

  return {
    name,
    pattern_type: patternType,
    cycle_mode: cycleMode,
    cycle_weeks: cycleWeeks,
    weeks: JSON.stringify(cleanWeeks),
    is_active: b.isActive !== false,
  };
}

router.post('/', authorize(...WRITE), async (req, res) => {
  try {
    const v = await clean(req.body || {});
    const cols = Object.keys(v);
    const r = await pool.query(
      `INSERT INTO shift_patterns (${cols.join(', ')})
       VALUES (${cols.map((c, i) => `$${i + 1}${c === 'weeks' ? '::jsonb' : ''}`).join(', ')})
       RETURNING id`,
      cols.map(c => v[c])
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ success: false, message: 'A pattern with that name already exists' });
    fail(res, err);
  }
});

router.put('/:id', authorize(...WRITE), async (req, res) => {
  try {
    const v = await clean(req.body || {});
    const cols = Object.keys(v);
    const r = await pool.query(
      `UPDATE shift_patterns SET ${cols.map((c, i) => `${c} = $${i + 1}${c === 'weeks' ? '::jsonb' : ''}`).join(', ')},
              updated_at = NOW()
        WHERE id = $${cols.length + 1} RETURNING id`,
      [...cols.map(c => v[c]), req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Pattern not found' });
    // The roster it already generated is now out of date with the pattern that
    // made it, so it is rebuilt rather than left to disagree.
    const summary = await generateRoster(req.params.id);
    res.json({ success: true, data: { id: req.params.id, regenerated: summary } });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ success: false, message: 'A pattern with that name already exists' });
    fail(res, err);
  }
});

router.delete('/:id', authorize(...WRITE), async (req, res) => {
  try {
    // The cascade takes the assignments and nulls pattern_id on rostered days.
    // Those days are deliberately left standing: somebody may already have
    // worked them, and deleting the recipe should not rewrite the past.
    const future = await pool.query(
      `DELETE FROM shift_roster WHERE pattern_id = $1 AND date > CURRENT_DATE RETURNING id`,
      [req.params.id]);
    const r = await pool.query(`DELETE FROM shift_patterns WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Pattern not found' });
    res.json({ success: true, message: `Pattern deleted, ${future.rowCount} future rostered day(s) removed` });
  } catch (err) { fail(res, err); }
});

// Who follows the pattern. Replaces the list wholesale, then rebuilds.
router.put('/:id/assignments', authorize(...WRITE), async (req, res) => {
  const client = await pool.connect();
  try {
    const list = Array.isArray(req.body?.assignments) ? req.body.assignments : [];
    await client.query('BEGIN');
    await client.query(`DELETE FROM shift_pattern_assignments WHERE pattern_id = $1`, [req.params.id]);
    for (const a of list) {
      if (!a?.employeeId || !a?.startDate) throw bad('Each assignment needs an employee and a start date');
      await client.query(
        `INSERT INTO shift_pattern_assignments (pattern_id, employee_id, start_date, end_date)
         VALUES ($1, $2, $3::date, $4) ON CONFLICT DO NOTHING`,
        [req.params.id, a.employeeId, a.startDate, a.endDate || null]
      );
    }
    await client.query('COMMIT');
    const summary = await generateRoster(req.params.id);
    res.json({ success: true, data: summary });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    fail(res, err);
  } finally { client.release(); }
});

// The reference's Preview Pattern. Shows what would land on the roster without
// writing anything — a pattern whose effect you cannot see before applying is
// one nobody will trust with a rota.
router.post('/preview', async (req, res) => {
  try {
    const { shiftForDate } = require('../utils/shiftPatterns');
    const v = await clean(req.body || {});
    const pattern = {
      cycle_mode: v.cycle_mode, cycle_weeks: v.cycle_weeks, weeks: JSON.parse(v.weeks),
    };
    const days = Math.max(7, Math.min(56, Number(req.body?.days) || 28));
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const names = new Map((await pool.query(`SELECT id, name, color FROM shifts`))
      .rows.map(s => [s.id, s]));

    const out = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(start); d.setDate(d.getDate() + i);
      const shiftId = shiftForDate(pattern, d, start);
      out.push({
        date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
        shiftId,
        shiftName: shiftId ? names.get(shiftId)?.name || 'Unknown' : null,
        color: shiftId ? names.get(shiftId)?.color : null,
      });
    }
    res.json({ success: true, data: out });
  } catch (err) { fail(res, err); }
});

router.post('/:id/regenerate', authorize(...WRITE), async (req, res) => {
  try {
    const summary = await generateRoster(req.params.id, { days: Number(req.body?.days) || 60 });
    res.json({ success: true, data: summary });
  } catch (err) { fail(res, err); }
});

module.exports = router;
