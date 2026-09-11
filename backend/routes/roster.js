const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { serverError } = require('../utils/serverError');
const { isFullAccess } = require('../utils/roles');
const { shiftConfig, mayEditMapping, mayViewMapping } = require('../utils/shiftConfig');
router.use(protect);

// Shifts → General → "Shift mapping permission" decides who may look at and
// change somebody else's roster. Until it was wired, this file answered a
// different question entirely: it checked the caller's role and stopped there,
// so any manager could roster any employee in the organisation — unlike
// /shifts/:id/assign next door, which has always scoped a manager to their own
// team. Full access (HR and above) is unaffected throughout.

/** 'self' | 'manager' | null — how the caller stands to this employee. */
async function relationTo(user, employeeId) {
  if (String(user._id) === String(employeeId)) return 'self';
  const r = await pool.query(
    `SELECT 1 FROM employees WHERE id = $1 AND reporting_manager_id = $2`,
    [employeeId, user._id]
  );
  return r.rows.length ? 'manager' : null;
}

const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Editing a past date needs its own permission, and which one depends on how
 * far back the date is. The pay period is read from settings; without one
 * configured the calendar month stands in, since that is the window the rest
 * of the app falls back to.
 */
async function pastWindow(date) {
  const today = ymd(new Date());
  const target = String(date).slice(0, 10);
  if (target >= today) return { past: false, withinPayPeriod: false };

  let start = null;
  try {
    const r = await pool.query(
      `SELECT start_day AS "startDay" FROM pay_periods ORDER BY created_at LIMIT 1`);
    const day = Number(r.rows[0]?.startDay);
    if (Number.isFinite(day) && day >= 1 && day <= 28) {
      const now = new Date();
      const s = new Date(now.getFullYear(), now.getMonth(), day);
      if (s > now) s.setMonth(s.getMonth() - 1);
      start = ymd(s);
    }
  } catch (_) { /* no pay period table or row — the month stands in */ }
  if (!start) start = today.slice(0, 8) + '01';

  return { past: true, withinPayPeriod: target >= start };
}

/**
 * Refuse unless the caller may edit this employee's mapping on this date.
 * Returns a message when refused, null when allowed.
 */
async function refuseEdit(user, employeeId, date) {
  if (isFullAccess(user.role)) return null;
  const cfg = await shiftConfig();
  const relation = await relationTo(user, employeeId);
  if (!relation) return 'You can only change the roster for people who report to you';
  const when = date ? await pastWindow(date) : { past: false, withinPayPeriod: false };
  if (!mayEditMapping(cfg, relation, when)) {
    return when.past
      ? 'Changing a past shift schedule is not permitted for your role'
      : 'Changing shift mapping is not permitted for your role';
  }
  return null;
}

// GET roster for a date range (week view)
router.get('/', async (req, res) => {
  try {
    const { startDate, endDate, department } = req.query;
    if (!startDate || !endDate) return res.status(400).json({ success: false, message: 'startDate and endDate required' });

    // Who this caller is allowed to see. Full access sees everyone; anyone else
    // sees themselves, plus their reportees when the matrix says a manager may
    // view mapping, plus their whole department when the department-schedules
    // switch is on.
    let scope = null;                                  // null = unrestricted
    if (!isFullAccess(req.user.role)) {
      const cfg = await shiftConfig();
      const ids = new Set([String(req.user._id)]);
      if (mayViewMapping(cfg, 'manager')) {
        const team = await pool.query(
          `SELECT id FROM employees WHERE reporting_manager_id = $1`, [req.user._id]);
        team.rows.forEach(r => ids.add(String(r.id)));
      }
      if (cfg.allowViewDepartmentSchedules) {
        const dept = await pool.query(
          `SELECT id FROM employees WHERE department = (
             SELECT department FROM employees WHERE id = $1) AND department IS NOT NULL`,
          [req.user._id]);
        dept.rows.forEach(r => ids.add(String(r.id)));
      }
      scope = [...ids];
    }

    const params = [startDate, endDate];
    let where = 'sr.date BETWEEN $1 AND $2';
    if (department) { params.push(department); where += ` AND e.department = $${params.length}`; }
    if (scope) { params.push(scope); where += ` AND sr.employee_id = ANY($${params.length}::uuid[])`; }

    const r = await pool.query(
      `SELECT sr.id as "_id", sr.date, sr.employee_id as "employeeId",
       json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name, 'department', e.department) as employee,
       json_build_object('id', s.id, 'name', s.name, 'startTime', s.start_time, 'endTime', s.end_time) as shift
       FROM shift_roster sr
       JOIN employees e ON sr.employee_id = e.id
       JOIN shifts s ON sr.shift_id = s.id
       WHERE ${where}
       ORDER BY sr.date, e.first_name`,
      params
    );

    // Also get employees without roster assignment for the period, narrowed the
    // same way — a name absent from the grid but present in this list would
    // leak exactly what the scope above is there to withhold.
    const empParams = [];
    let empWhere = `e.status='active'`;
    if (department) { empParams.push(department); empWhere += ` AND e.department = $${empParams.length}`; }
    if (scope) { empParams.push(scope); empWhere += ` AND e.id = ANY($${empParams.length}::uuid[])`; }
    const emps = await pool.query(
      `SELECT e.id as "_id", e.first_name as "firstName", e.last_name as "lastName", e.department,
       s.id as "shiftId", s.name as "shiftName", s.start_time as "startTime", s.end_time as "endTime"
       FROM employees e LEFT JOIN shifts s ON e.shift_id = s.id
       WHERE ${empWhere} ORDER BY e.first_name`,
      empParams
    );
    /* The reference draws approved leave and permission INSIDE the schedule
     * grid, in the same cell as the shift — "General Shift 9:30-6:00" with
     * "Permission 5:00 PM - 6:00 PM" under it. That is the whole point of
     * looking at a roster: not what someone was scheduled for in the
     * abstract, but whether they will actually be there. Scoped identically
     * to the roster rows above, so this cannot become a side door onto
     * somebody else's leave. */
    const leaveParams = [startDate, endDate];
    let leaveWhere = `l.status = 'approved' AND l.start_date <= $2::date AND l.end_date >= $1::date
                      AND e.deleted_at IS NULL`;
    if (department) { leaveParams.push(department); leaveWhere += ` AND e.department = $${leaveParams.length}`; }
    if (scope) { leaveParams.push(scope); leaveWhere += ` AND l.employee_id = ANY($${leaveParams.length}::uuid[])`; }

    const leaves = await pool.query(
      `SELECT l.id AS "_id", l.employee_id AS "employeeId", l.leave_type AS "leaveType",
              l.start_date::text AS "startDate", l.end_date::text AS "endDate",
              l.start_time::text AS "startTime", l.end_time::text AS "endTime",
              l.is_half_day AS "isHalfDay", l.half_day_type AS "halfDayType"
         FROM leaves l JOIN employees e ON e.id = l.employee_id
        WHERE ${leaveWhere}
        ORDER BY l.start_date`,
      leaveParams
    );

    res.json({ success: true, data: r.rows, employees: emps.rows, leaves: leaves.rows });
  } catch (err) { serverError(res, err); }
});

/**
 * Assign one shift across a DATE RANGE — the reference's "Assign shift" form,
 * which takes a shift, a from/to pair and a reason, not a single day.
 *
 * Two ways to say who it applies to, matching the two places the form appears:
 *   employeeIds  an explicit list (User-specific Operations, one person)
 *   criteria     [{ field, values[] }] OR-ed together (Employee Shift Mapping)
 *
 * Every day in the range is written, weekends included. That is deliberate:
 * shift_roster says which shift applies IF the day is worked, and whether it
 * is worked at all is weekend_rules' and the holiday calendar's answer, not
 * this table's. Filtering weekends out here would mean a Saturday callout had
 * no shift to be measured against.
 */
router.post('/assign-range', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { employeeIds, criteria, shiftId, fromDate, toDate, reason } = req.body;
    if (!shiftId || !fromDate || !toDate) {
      return res.status(400).json({ success: false, message: 'shiftId, fromDate and toDate are required' });
    }
    if (String(toDate) < String(fromDate)) {
      return res.status(400).json({ success: false, message: 'The end date cannot be before the start date' });
    }

    const shift = (await client.query(`SELECT id, name FROM shifts WHERE id = $1`, [shiftId])).rows[0];
    if (!shift) return res.status(404).json({ success: false, message: 'That shift no longer exists' });

    // Resolve who this applies to.
    let targets = [];
    if (Array.isArray(employeeIds) && employeeIds.length) {
      targets = [...new Set(employeeIds.map(String))];
    } else if (Array.isArray(criteria) && criteria.length) {
      /* OR across criteria rows, exactly as the reference's builder reads —
       * its rows are joined by an OR bubble, not an AND. A whitelist of
       * columns rather than interpolating the field name: this is the one
       * place a criteria builder turns user input into SQL. */
      const COLUMN = {
        employee: 'e.id', department: 'e.department', designation: 'e.designation',
        location: 'e.work_location',
      };
      const ors = [];
      const params = [];
      for (const c of criteria) {
        const col = COLUMN[c.field];
        const values = (c.values || []).filter(Boolean);
        if (!col || !values.length) continue;
        params.push(values);
        ors.push(col === 'e.id'
          ? `e.id = ANY($${params.length}::uuid[])`
          : `${col} = ANY($${params.length}::text[])`);
      }
      if (!ors.length) {
        return res.status(400).json({ success: false, message: 'Choose who this shift applies to' });
      }
      const found = await client.query(
        `SELECT id FROM employees
          WHERE deleted_at IS NULL AND status = 'active' AND (${ors.join(' OR ')})`, params);
      targets = found.rows.map(r => String(r.id));
    }

    if (!targets.length) {
      return res.status(400).json({ success: false, message: 'That matched nobody — nothing was assigned' });
    }

    /* Permission is per person AND per date, so it is checked against the
     * first and last day of the range rather than once for the range as a
     * whole: a manager allowed to roster forward but not backward must not
     * get the whole span because the end of it happens to be in the future. */
    const refused = [];
    const allowed = [];
    for (const id of targets) {
      const refusal = (await refuseEdit(req.user, id, fromDate))
        || (await refuseEdit(req.user, id, toDate));
      if (refusal) refused.push({ employeeId: id, reason: refusal });
      else allowed.push(id);
    }
    if (!allowed.length) {
      return res.status(403).json({ success: false,
        message: refused[0]?.reason || 'You may not change the roster for these people' });
    }

    await client.query('BEGIN');
    // generate_series rather than a loop in JS: one statement, and the range
    // is expanded by the database that is going to store it.
    const written = await client.query(
      `INSERT INTO shift_roster (employee_id, shift_id, date, created_by, reason)
       SELECT emp.id, $2::uuid, d::date, $5::uuid, $6
         FROM unnest($1::uuid[]) AS emp(id),
              generate_series($3::date, $4::date, INTERVAL '1 day') AS d
       ON CONFLICT (employee_id, date)
         DO UPDATE SET shift_id = EXCLUDED.shift_id,
                       created_by = EXCLUDED.created_by,
                       reason = EXCLUDED.reason`,
      [allowed, shiftId, fromDate, toDate, req.user._id, (reason || '').trim() || null]
    );
    await client.query('COMMIT');

    res.json({
      success: true,
      assigned: written.rowCount,
      employees: allowed.length,
      skipped: refused,
      message: `${shift.name} assigned to ${allowed.length} employee(s) across ${written.rowCount} day(s)`
        + (refused.length ? ` — ${refused.length} skipped` : ''),
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    serverError(res, err);
  } finally {
    client.release();
  }
});

// POST assign shift (admin/manager)
router.post('/assign', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const { employeeId, shiftId, date } = req.body;
    if (!employeeId || !shiftId || !date) return res.status(400).json({ success: false, message: 'employeeId, shiftId, date required' });

    const refusal = await refuseEdit(req.user, employeeId, date);
    if (refusal) return res.status(403).json({ success: false, message: refusal });

    const r = await pool.query(
      `INSERT INTO shift_roster (employee_id, shift_id, date, created_by) VALUES ($1,$2,$3,$4)
       ON CONFLICT (employee_id, date) DO UPDATE SET shift_id=$2, created_by=$4
       RETURNING id as "_id"`,
      [employeeId, shiftId, date, req.user._id]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { serverError(res, err); }
});

// POST bulk assign (copy previous week)
router.post('/copy-week', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const { fromStart, toStart } = req.body;
    if (!fromStart || !toStart) {
      return res.status(400).json({ success: false, message: 'fromStart and toStart required' });
    }

    // Copying a week touches many employees at once, so the permission is
    // resolved once and the copy is narrowed to whoever the caller may edit —
    // rather than refusing the whole operation because one name in the source
    // week is out of reach.
    let scope = null;
    if (!isFullAccess(req.user.role)) {
      const cfg = await shiftConfig();
      if (!mayEditMapping(cfg, 'manager', await pastWindow(toStart))) {
        return res.status(403).json({ success: false,
          message: 'Changing shift mapping is not permitted for your role' });
      }
      const team = await pool.query(
        `SELECT id FROM employees WHERE reporting_manager_id = $1`, [req.user._id]);
      scope = team.rows.map(r => r.id);
      if (!scope.length) {
        return res.json({ success: true, message: 'Copied 0 assignments' });
      }
    }

    const params = [fromStart, toStart, req.user._id];
    let filter = '';
    if (scope) { params.push(scope); filter = ` AND employee_id = ANY($${params.length}::uuid[])`; }

    const r = await pool.query(
      `INSERT INTO shift_roster (employee_id, shift_id, date, created_by)
       SELECT employee_id, shift_id, date + ($2::date - $1::date), $3
       FROM shift_roster WHERE date BETWEEN $1 AND ($1::date + 6)${filter}
       ON CONFLICT (employee_id, date) DO UPDATE SET shift_id = EXCLUDED.shift_id`,
      params
    );
    res.json({ success: true, message: `Copied ${r.rowCount} assignments` });
  } catch (err) { serverError(res, err); }
});

// DELETE assignment
router.delete('/:id', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    // Read the row before removing it: which employee and which date it belongs
    // to is what decides whether this caller may touch it at all.
    const row = (await pool.query(
      `SELECT employee_id AS "employeeId", date::text AS date FROM shift_roster WHERE id=$1`,
      [req.params.id])).rows[0];
    if (!row) return res.status(404).json({ success: false, message: 'That roster entry no longer exists' });

    const refusal = await refuseEdit(req.user, row.employeeId, row.date);
    if (refusal) return res.status(403).json({ success: false, message: refusal });

    await pool.query('DELETE FROM shift_roster WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

module.exports = router;
