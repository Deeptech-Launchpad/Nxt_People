/* ── Shift patterns ────────────────────────────────────────────────────────
 *  A pattern is a recipe, not a second schedule. It generates rows into
 *  shift_roster, which is what attendance now resolves against — so a pattern
 *  changes what someone is actually expected to work rather than sitting in a
 *  table nobody reads.
 *
 *  Generated rows carry their pattern_id, so regenerating replaces only the
 *  rows that pattern made. A day somebody rostered by hand is never touched.
 *
 *  Auto shift assignment is the other half of this file: when it is on, a
 *  check-in with no rostered shift picks the shift whose window the check-in
 *  falls closest to. It only ever writes today, never the past.
 * ───────────────────────────────────────────────────────────────────────── */

const pool = require('../db');
const logger = require('../logger');

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Which calendar week of the month a date falls in, 1-6. */
const weekOfMonth = d => Math.floor((d.getDate() - 1) / 7) + 1;

/**
 * The shift a pattern puts an employee on for one date, or null for a day the
 * pattern leaves blank — which is a day off, not "fall back to the standing
 * shift", because a blank cell in the builder is a deliberate gap.
 */
function shiftForDate(pattern, date, startDate) {
  const weeks = Array.isArray(pattern.weeks) ? pattern.weeks : [];
  if (!weeks.length) return null;

  let index;
  if (pattern.cycle_mode === 'calendar_weeks') {
    // "Based on 1-6 calendar weeks in a month" — the week of the month picks
    // the row, so the pattern resets with the month rather than running on.
    index = (weekOfMonth(date) - 1) % weeks.length;
  } else {
    // "Every N weeks" — count whole weeks since the assignment began, so the
    // cycle is anchored to when the person joined the pattern, not to an
    // arbitrary epoch.
    const days = Math.floor((date - startDate) / 86400000);
    if (days < 0) return null;
    const cycle = Math.max(1, Number(pattern.cycle_weeks) || 1);
    index = Math.floor(days / 7 / cycle) % weeks.length;
  }

  const week = weeks[index];
  return week?.days?.[DAY_KEYS[date.getDay()]] || null;
}

/**
 * Fill shift_roster from a pattern for everyone assigned to it.
 *
 * Only forward from today by default: rewriting a past roster would change
 * what attendance already resolved against, and the reference says the same of
 * auto assignment — current entries only, without impacting past data.
 */
async function generateRoster(patternId, { days = 60, from = new Date() } = {}) {
  const summary = { employees: 0, written: 0, cleared: 0 };

  const pattern = (await pool.query(
    `SELECT * FROM shift_patterns WHERE id = $1 AND is_active = TRUE`, [patternId])).rows[0];
  if (!pattern) return summary;

  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(start); end.setDate(end.getDate() + days);

  const assignments = (await pool.query(
    `SELECT a.employee_id, a.start_date, a.end_date
       FROM shift_pattern_assignments a
       JOIN employees e ON e.id = a.employee_id AND e.deleted_at IS NULL AND e.status = 'active'
      WHERE a.pattern_id = $1`, [patternId])).rows;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Only this pattern's own future rows. A hand-made assignment has no
    // pattern_id and survives.
    const cleared = await client.query(
      `DELETE FROM shift_roster
        WHERE pattern_id = $1 AND date >= $2::date AND date <= $3::date RETURNING id`,
      [patternId, ymd(start), ymd(end)]);
    summary.cleared = cleared.rowCount;

    for (const a of assignments) {
      summary.employees++;
      const anchor = new Date(a.start_date);
      const stop = a.end_date ? new Date(a.end_date) : null;

      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        if (d < anchor) continue;
        if (stop && d > stop) break;
        const shiftId = shiftForDate(pattern, d, anchor);
        if (!shiftId) continue;
        await client.query(
          `INSERT INTO shift_roster (employee_id, shift_id, date, pattern_id)
           VALUES ($1, $2, $3::date, $4)
           ON CONFLICT DO NOTHING`,
          [a.employee_id, shiftId, ymd(d), patternId]
        );
        summary.written++;
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { client.release(); }

  return summary;
}

/**
 * Auto shift assignment: the shift whose start is nearest the check-in time.
 *
 * Only consulted when nothing else has already decided — a rostered shift, or
 * one a pattern generated, wins. Returns null when it cannot tell, which leaves
 * the employee's standing shift in charge rather than guessing.
 */
async function shiftForCheckIn(checkInMinutes) {
  const shifts = (await pool.query(
    `SELECT id, name, start_time FROM shifts WHERE start_time IS NOT NULL`)).rows;
  if (shifts.length < 2) return null;   // Nothing to choose between.

  let best = null;
  for (const s of shifts) {
    const [h, m] = String(s.start_time).split(':').map(Number);
    if (Number.isNaN(h)) continue;
    const start = h * 60 + m;
    // Circular distance, so a 22:00 shift is near a 23:50 check-in rather than
    // 1430 minutes away from it.
    const raw = Math.abs(checkInMinutes - start);
    const distance = Math.min(raw, 1440 - raw);
    if (!best || distance < best.distance) best = { id: s.id, name: s.name, distance };
  }
  return best;
}

/** Whether the Auto Shift Assignment toggle is on. */
async function autoAssignEnabled() {
  try {
    const r = await pool.query(`SELECT shift_config AS c FROM settings LIMIT 1`);
    return !!r.rows[0]?.c?.autoShiftAssignment?.enabled;
  } catch (err) {
    logger.error({ err: err.message }, 'Could not read the auto shift assignment setting');
    return false;
  }
}

module.exports = { generateRoster, shiftForDate, shiftForCheckIn, autoAssignEnabled, DAY_KEYS, weekOfMonth };
