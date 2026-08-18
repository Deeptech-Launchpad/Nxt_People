/* ── Shift rotation ────────────────────────────────────────────────────────
 *  On its scheduled day, a rotation moves everybody it applies to from one
 *  shift to another. Distinct from a pattern: a pattern rosters specific days,
 *  a rotation changes the STANDING shift, which is what "General Shift to
 *  General" means on the reference's form.
 *
 *  A rotation with no criteria and no named employee moves nobody. Treating an
 *  empty scope as "everybody" would silently move the whole organization onto
 *  a different shift, which is the worst thing this file could do.
 *
 *  Every move is recorded, so a shift that changed under somebody can be
 *  explained rather than guessed at.
 * ───────────────────────────────────────────────────────────────────────── */

const pool = require('../db');
const logger = require('../logger');

// What a rotation can be scoped by. Real columns on employees, so a criterion
// cannot be written that never matches anybody.
const CRITERIA_FIELDS = [
  { key: 'location', label: 'Locations', column: 'work_location' },
  { key: 'department', label: 'Departments', column: 'department' },
  { key: 'designation', label: 'Designations', column: 'designation' },
  { key: 'employmentType', label: 'Employee type', column: 'employment_type' },
];
const BY_KEY = new Map(CRITERIA_FIELDS.map(f => [f.key, f]));

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Everybody a rotation applies to. Criteria OR named employees, never all. */
async function scopeOf(rotation) {
  const ors = [];
  const params = [];

  for (const c of rotation.criteria || []) {
    const f = BY_KEY.get(c.field);
    if (!f || !c.value) continue;
    params.push(c.value);
    ors.push(`e.${f.column} = $${params.length}`);
  }
  if (rotation.employee_ids?.length) {
    params.push(rotation.employee_ids);
    ors.push(`e.id = ANY($${params.length})`);
  }
  // The guard that matters.
  if (!ors.length) return { rows: [], reason: 'The rotation applies to nobody' };

  const r = await pool.query(
    `SELECT e.id, e.shift_id, TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS name
       FROM employees e
      WHERE e.deleted_at IS NULL AND e.status = 'active' AND (${ors.join(' OR ')})`,
    params
  );
  return { rows: r.rows, reason: null };
}

/** The next date this rotation is due, from `from`. */
function nextRunDate(rotation, from = new Date()) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  if (rotation.frequency === 'monthly') {
    const day = Math.max(1, Math.min(28, rotation.day_of_month || 1));
    const candidate = new Date(d.getFullYear(), d.getMonth(), day);
    if (candidate < d) candidate.setMonth(candidate.getMonth() + 1);
    return candidate;
  }
  const target = rotation.day_of_week ?? 0;
  const ahead = (target - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + ahead);
  return d;
}

/** The window the changed shifts hold for, which the reference states on the form. */
function periodFor(rotation, start) {
  const end = new Date(start);
  end.setDate(end.getDate() + (rotation.frequency === 'monthly' ? 29 : 6));
  return { start, end };
}

/**
 * Run one rotation now.
 *
 * @param dryRun when true, works out what would move and writes nothing —
 *        what the screen's preview uses, because a rotation that reassigns 68
 *        people is not something to find out about afterwards.
 */
async function runRotation(rotationId, { dryRun = false } = {}) {
  const summary = { moved: 0, unchanged: 0, skipped: 0, moves: [] };

  const rotation = (await pool.query(
    `SELECT * FROM shift_rotations WHERE id = $1`, [rotationId])).rows[0];
  if (!rotation) return summary;

  const steps = (await pool.query(
    `SELECT s.from_shift_id, s.to_shift_id,
            f.name AS from_name, t.name AS to_name
       FROM shift_rotation_steps s
       JOIN shifts f ON f.id = s.from_shift_id
       JOIN shifts t ON t.id = s.to_shift_id
      WHERE s.rotation_id = $1 ORDER BY s.sort_order`, [rotationId])).rows;
  if (!steps.length) { summary.skipped = 1; return summary; }

  const byFrom = new Map(steps.map(s => [s.from_shift_id, s]));
  const { rows: people, reason } = await scopeOf(rotation);
  if (reason) { summary.skipped = 1; return summary; }

  // Read every current shift first, then write. Applying step by step would
  // let A→B and B→A chase each other and land everybody on one shift.
  const planned = [];
  for (const p of people) {
    const step = byFrom.get(p.shift_id);
    if (!step) { summary.unchanged++; continue; }
    planned.push({ employeeId: p.id, name: p.name, from: step.from_shift_id,
                   to: step.to_shift_id, fromName: step.from_name, toName: step.to_name });
  }
  summary.moves = planned;

  if (dryRun) { summary.moved = planned.length; return summary; }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const m of planned) {
      await client.query(`UPDATE employees SET shift_id = $1, updated_at = NOW() WHERE id = $2`,
        [m.to, m.employeeId]);
      await client.query(
        `INSERT INTO shift_rotation_runs
           (rotation_id, rotation_name, employee_id, from_shift_id, to_shift_id, status, message)
         VALUES ($1, $2, $3, $4, $5, 'success', $6)`,
        [rotationId, rotation.name, m.employeeId, m.from, m.to, `${m.fromName} to ${m.toName}`]
      );
      summary.moved++;
    }
    await client.query(`UPDATE shift_rotations SET last_run_at = NOW() WHERE id = $1`, [rotationId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { client.release(); }

  // A shift change is exactly what an Automation workflow watching the
  // employee's shift field is for, so each move raises one. Fire-and-forget:
  // a workflow must never be able to fail the rotation.
  try {
    const { fire } = require('./workflowEngine');
    for (const m of summary.moves) {
      fire('employee', 'field_updated', { recordId: m.employeeId, changedFields: ['shift_id'] });
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'Shift rotation could not raise its workflow events');
  }

  return summary;
}

/**
 * The scheduled sweep. Runs the rotations due in the window just elapsed.
 */
async function sweepShiftRotations({ now = new Date(), windowMinutes = 60 } = {}) {
  const summary = { ran: 0, moved: 0 };
  const rotations = (await pool.query(
    `SELECT * FROM shift_rotations WHERE is_active = TRUE`)).rows;
  if (!rotations.length) return summary;

  const minutesNow = now.getHours() * 60 + now.getMinutes();

  for (const r of rotations) {
    const due = nextRunDate(r, now);
    // Today, and inside the window since the last sweep.
    if (due.toDateString() !== now.toDateString()) continue;
    const [h, m] = String(r.run_at || '00:00').split(':').map(Number);
    const at = h * 60 + m;
    if (!(at <= minutesNow && at > minutesNow - windowMinutes)) continue;
    // Already run today.
    if (r.last_run_at && new Date(r.last_run_at).toDateString() === now.toDateString()) continue;

    try {
      const out = await runRotation(r.id);
      summary.ran++;
      summary.moved += out.moved;
    } catch (err) {
      logger.error({ err: err.message, rotation: r.name }, 'Shift rotation failed');
      await pool.query(
        `INSERT INTO shift_rotation_runs (rotation_id, rotation_name, status, message)
         VALUES ($1, $2, 'failed', $3)`, [r.id, r.name, err.message]).catch(() => {});
    }
  }
  return summary;
}

module.exports = {
  runRotation, sweepShiftRotations, nextRunDate, periodFor, scopeOf,
  CRITERIA_FIELDS, DAYS,
};
