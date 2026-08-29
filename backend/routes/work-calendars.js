/**
 * routes/work-calendars.js
 * Work calendars — the work week, weekend pattern and calendar year, per location.
 *
 * Readable by any signed-in user: the weekend pattern decides how the shared
 * attendance and leave views shade a day, so it cannot be admin-only. Only
 * full-access roles can change one, because a calendar edit silently changes
 * every working-day count in attendance, leave and payroll.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { serverError } = require('../utils/serverError');

router.use(protect);

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_CODES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const SELECT_COLS = `
  id AS "_id", location,
  week_starts_on   AS "weekStartsOn",
  work_week_start  AS "workWeekStart",
  work_week_end    AS "workWeekEnd",
  half_day_weekend AS "halfDayWeekend",
  year_mode        AS "yearMode",
  year_start::text AS "yearStart",
  year_end::text   AS "yearEnd",
  statutory_weekends AS "statutoryWeekends",
  is_active AS "isActive"
`;

// The weekend grid is stored as one weekend_rules row per weekday, carrying the
// weeks of the month it applies to. An empty weeks array means every week —
// which is what the "All" column represents.
async function loadWeekendGrid(calendarIds) {
  const r = await pool.query(
    `SELECT calendar_id, days_of_week, weeks_of_month
       FROM weekend_rules
      WHERE is_active = TRUE AND calendar_id = ANY($1::uuid[])`,
    [calendarIds]
  );
  const byCalendar = {};
  const everyWeek = {};
  for (const row of r.rows) {
    const grid = byCalendar[row.calendar_id] || (byCalendar[row.calendar_id] = {});
    const seen = everyWeek[row.calendar_id] || (everyWeek[row.calendar_id] = new Set());
    const weeks = Array.isArray(row.weeks_of_month) ? row.weeks_of_month : [];
    for (const code of (Array.isArray(row.days_of_week) ? row.days_of_week : [])) {
      // A day covered by an every-week rule stays every-week even if another
      // rule also names specific weeks — the broader rule already includes them.
      if (!weeks.length) { seen.add(code); grid[code] = []; continue; }
      if (seen.has(code)) continue;
      grid[code] = [...new Set([...(grid[code] || []), ...weeks])].sort((a, b) => a - b);
    }
  }
  return byCalendar;
}

// Replaces a calendar's weekend rules wholesale. Editing the grid is a single
// user action, so a partial update would leave a calendar describing a weekend
// pattern the user never chose.
async function saveWeekendGrid(client, calendarId, grid, name) {
  await client.query('DELETE FROM weekend_rules WHERE calendar_id = $1', [calendarId]);
  for (const code of DAY_CODES) {
    const weeks = grid?.[code];
    if (!Array.isArray(weeks)) continue;
    // Absent = not a weekend. Present-but-empty = every week.
    await client.query(
      `INSERT INTO weekend_rules (name, days_of_week, weeks_of_month, calendar_id, is_active)
       VALUES ($1, $2::jsonb, $3::jsonb, $4, TRUE)`,
      [`${name} — ${DAY_NAMES[DAY_CODES.indexOf(code)]}`, JSON.stringify([code]), JSON.stringify(weeks), calendarId]
    );
  }
}

function validate(body) {
  const inRange = v => Number.isInteger(v) && v >= 0 && v <= 6;
  if (body.weekStartsOn !== undefined && !inRange(Number(body.weekStartsOn))) return 'Week starts on is not a valid day';
  if (body.workWeekStart !== undefined && !inRange(Number(body.workWeekStart))) return 'Work week start is not a valid day';
  if (body.workWeekEnd !== undefined && !inRange(Number(body.workWeekEnd))) return 'Work week end is not a valid day';
  if (body.yearMode !== undefined && !['current', 'custom'].includes(body.yearMode)) return 'Calendar year definition is not valid';
  if (body.yearMode === 'custom') {
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    if (!iso.test(String(body.yearStart || ''))) return 'Year starts on is required for a custom year';
    if (!iso.test(String(body.yearEnd || ''))) return 'Year ends on is required for a custom year';
    if (String(body.yearEnd) < String(body.yearStart)) return 'Year ends on cannot be before it starts';
  }
  if (body.grid) {
    for (const [code, weeks] of Object.entries(body.grid)) {
      if (!DAY_CODES.includes(code)) return 'Weekend grid names a day that does not exist';
      if (!Array.isArray(weeks)) return 'Weekend grid is malformed';
      if (weeks.some(w => !Number.isInteger(w) || w < 1 || w > 5)) return 'Weekend grid names a week that does not exist';
    }
  }
  return null;
}

// The calendar year as concrete dates, which is what the list column shows.
function yearRange(row) {
  if (row.yearMode === 'custom' && row.yearStart && row.yearEnd) {
    return { start: row.yearStart, end: row.yearEnd };
  }
  const y = new Date().getUTCFullYear();
  return { start: `${y}-01-01`, end: `${y}-12-31` };
}

router.get('/', async (req, res) => {
  try {
    const r = await pool.query(`SELECT ${SELECT_COLS} FROM work_calendars ORDER BY location NULLS FIRST`);
    const grids = r.rows.length ? await loadWeekendGrid(r.rows.map(c => c._id)) : {};
    res.json({
      success: true,
      data: r.rows.map(c => ({
        ...c,
        grid: grids[c._id] || {},
        year: yearRange(c),
        workWeekLabel: `${DAY_NAMES[c.workWeekStart]} - ${DAY_NAMES[c.workWeekEnd]}`,
      })),
    });
  } catch (err) { serverError(res, err); }
});

router.post('/', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  const invalid = validate(req.body);
  if (invalid) return res.status(400).json({ success: false, message: invalid });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const b = req.body;
    const r = await client.query(
      `INSERT INTO work_calendars
         (location, week_starts_on, work_week_start, work_week_end, half_day_weekend,
          year_mode, year_start, year_end, statutory_weekends, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8::date,$9,$10) RETURNING ${SELECT_COLS}`,
      [b.location || null, Number(b.weekStartsOn ?? 0), Number(b.workWeekStart ?? 1), Number(b.workWeekEnd ?? 6),
       !!b.halfDayWeekend, b.yearMode || 'current',
       b.yearMode === 'custom' ? b.yearStart : null, b.yearMode === 'custom' ? b.yearEnd : null,
       !!b.statutoryWeekends, req.user._id]
    );
    await saveWeekendGrid(client, r.rows[0]._id, b.grid, b.location || 'Default');
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(400).json({ success: false, message: 'A work calendar already exists for that location' });
    serverError(res, err);
  } finally { client.release(); }
});

router.patch('/:id', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  const invalid = validate(req.body);
  if (invalid) return res.status(400).json({ success: false, message: invalid });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const b = req.body;
    const sets = [];
    const params = [];
    const add = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
    if (b.location !== undefined) add('location', b.location || null);
    if (b.weekStartsOn !== undefined) add('week_starts_on', Number(b.weekStartsOn));
    if (b.workWeekStart !== undefined) add('work_week_start', Number(b.workWeekStart));
    if (b.workWeekEnd !== undefined) add('work_week_end', Number(b.workWeekEnd));
    if (b.halfDayWeekend !== undefined) add('half_day_weekend', !!b.halfDayWeekend);
    if (b.statutoryWeekends !== undefined) add('statutory_weekends', !!b.statutoryWeekends);
    if (b.yearMode !== undefined) {
      add('year_mode', b.yearMode);
      // Switching back to the current year has to clear the custom dates, or
      // the CHECK constraint passes on stale values nobody can see any more.
      add('year_start', b.yearMode === 'custom' ? b.yearStart : null);
      add('year_end', b.yearMode === 'custom' ? b.yearEnd : null);
    }

    let row;
    if (sets.length) {
      sets.push('updated_at = NOW()');
      params.push(req.params.id);
      const r = await client.query(
        `UPDATE work_calendars SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${SELECT_COLS}`,
        params
      );
      if (!r.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Work calendar not found' }); }
      row = r.rows[0];
    } else {
      const r = await client.query(`SELECT ${SELECT_COLS} FROM work_calendars WHERE id = $1`, [req.params.id]);
      if (!r.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Work calendar not found' }); }
      row = r.rows[0];
    }

    if (b.grid !== undefined) await saveWeekendGrid(client, row._id, b.grid, row.location || 'Default');
    await client.query('COMMIT');
    res.json({ success: true, data: row });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(400).json({ success: false, message: 'A work calendar already exists for that location' });
    serverError(res, err);
  } finally { client.release(); }
});

// The Default calendar is what every unmatched location falls back to, so
// deleting it would leave those locations with no weekend pattern at all.
router.delete('/:id', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  try {
    const r = await pool.query('SELECT location FROM work_calendars WHERE id = $1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Work calendar not found' });
    if (!r.rows[0].location) return res.status(400).json({ success: false, message: 'The Default work calendar cannot be deleted' });
    await pool.query('DELETE FROM work_calendars WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

module.exports = router;
