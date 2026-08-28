/* ── Operations → Attendance Marking ────────────────────────────────────────
 *  Attendance for staff who have no login: housekeeping, and anyone else who
 *  works a short shift with no device to punch on.
 *
 *  HR opens one page, picks a date, and marks each person's shift. That is
 *  written to attendance so it reaches the ordinary reports and exports.
 *
 *  Three states, not two — present, absent, and no mark at all. Absence is
 *  only ever recorded because somebody clicked absent. An unmarked scheduled
 *  day is treated as present when reporting, and the report says how many of
 *  the present days were presumed rather than confirmed. The presumption is
 *  applied on read and never stored, so the table keeps saying what actually
 *  happened even if the policy changes.
 *
 *  Everything here is full-access only. Marking is one person asserting
 *  another person's attendance, which is not a thing a manager should be able
 *  to do to somebody outside this page's own staff list.
 *
 *  PAYROLL-DECISION: whether a presumed-present day is a paid day has not been
 *  decided. Nothing here feeds payroll; the summary returns confirmed and
 *  presumed separately so that whoever wires payroll has to choose on purpose.
 * ───────────────────────────────────────────────────────────────────────── */

const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { serverError } = require('../utils/serverError');
const { audit } = require('../middleware/audit');
const {
  DAY_KEYS, clockMinutes, shiftSpanHours, runsOn, creditedHours, syncAttendanceDay,
} = require('../utils/manualAttendance');

router.use(protect);
const FULL = ['admin', 'director', 'hr_admin'];
router.use(authorize(...FULL));

const bad = (msg) => Object.assign(new Error(msg), { status: 400, expose: true });
const fail = (res, err) => {
  if (err?.expose) return res.status(err.status || 400).json({ success: false, message: err.message });
  return serverError(res, err);
};

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));

const SHIFT_COLS = `
  s.id, s.name, s.start_time AS "startTime", s.end_time AS "endTime",
  s.pay_mode AS "payMode", s.days_of_week AS "daysOfWeek",
  s.observes_holidays AS "observesHolidays", s.is_active AS "isActive"`;

// The same columns without the table alias, for RETURNING.
const SHIFT_RETURNING = SHIFT_COLS.replace(/\bs\./g, '');

/** Validate a shift body. Shared by create and update so they cannot diverge. */
function readShift(body) {
  const name = String(body?.name ?? '').trim();
  if (!name) throw bad('Give the shift a name');
  if (name.length > 100) throw bad('Shift name must be 100 characters or fewer');

  const start = String(body?.startTime ?? '').trim();
  const end = String(body?.endTime ?? '').trim();
  if (clockMinutes(start) === null) throw bad('Start time must be HH:MM');
  if (clockMinutes(end) === null) throw bad('End time must be HH:MM');
  if (start === end) throw bad('Start and end time cannot be the same');

  const payMode = body?.payMode === 'actual' ? 'actual' : 'fixed';

  const days = Array.isArray(body?.daysOfWeek) ? body.daysOfWeek.map(d => String(d).toLowerCase()) : [];
  const clean = DAY_KEYS.filter(d => days.includes(d));
  if (!clean.length) throw bad('Choose at least one day this shift runs');

  return {
    name, start, end, payMode, days: clean,
    observesHolidays: !!body?.observesHolidays,
  };
}

// ── Shifts ────────────────────────────────────────────────────────────────
/* Defined here rather than on the main Shifts screens because these belong to
 * this page, and because is_manual keeps them out of rotation, patterns and
 * every ordinary shift picker. */

router.get('/shifts', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${SHIFT_COLS},
              (SELECT COUNT(*)::int FROM manual_attendance_assignments a WHERE a.shift_id = s.id) AS "assignedCount"
         FROM shifts s WHERE s.is_manual ORDER BY s.start_time, s.name`);
    res.json({ success: true, data: rows.map(r => ({ ...r, spanHours: shiftSpanHours({ start_time: r.startTime, end_time: r.endTime }) })) });
  } catch (err) { fail(res, err); }
});

router.post('/shifts', audit('CREATE', 'manual_shift'), async (req, res) => {
  try {
    const s = readShift(req.body);
    const { rows } = await pool.query(
      `INSERT INTO shifts (name, start_time, end_time, is_manual, pay_mode, days_of_week, observes_holidays, is_active)
       VALUES ($1, $2::time, $3::time, TRUE, $4, $5::jsonb, $6, TRUE)
       RETURNING ${SHIFT_RETURNING}`,
      [s.name, s.start, s.end, s.payMode, JSON.stringify(s.days), s.observesHolidays]);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) { fail(res, err); }
});

router.put('/shifts/:id', audit('UPDATE', 'manual_shift'), async (req, res) => {
  const client = await pool.connect();
  try {
    if (!isUuid(req.params.id)) throw bad('That is not a shift');
    const s = readShift(req.body);
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE shifts SET name = $2, start_time = $3::time, end_time = $4::time,
              pay_mode = $5, days_of_week = $6::jsonb, observes_holidays = $7
        WHERE id = $1 AND is_manual
        RETURNING id`,
      [req.params.id, s.name, s.start, s.end, s.payMode, JSON.stringify(s.days), s.observesHolidays]);
    if (!rows.length) throw bad('That shift does not exist on this page');

    /* Changing a shift's times changes what every day already marked against it
     * is worth, so those days are rebuilt rather than left describing the old
     * span. Limited to days already marked — nothing new is created. */
    const days = await client.query(
      `SELECT DISTINCT employee_id, date FROM manual_attendance_marks WHERE shift_id = $1`,
      [req.params.id]);
    for (const d of days.rows) await syncAttendanceDay(client, d.employee_id, d.date);

    await client.query('COMMIT');
    res.json({ success: true, message: `Shift updated. ${days.rows.length} marked day(s) recalculated.` });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    fail(res, err);
  } finally { client.release(); }
});

router.delete('/shifts/:id', audit('DELETE', 'manual_shift'), async (req, res) => {
  try {
    if (!isUuid(req.params.id)) throw bad('That is not a shift');
    /* Refused rather than cascaded. Deleting a shift with marks against it
     * would delete attendance days somebody recorded, and a leave type that
     * vanished underneath its records is exactly how Zoho lost the type on 364
     * of them. Unassign everyone first, deliberately. */
    const used = (await pool.query(
      `SELECT COUNT(*)::int AS n FROM manual_attendance_marks WHERE shift_id = $1`, [req.params.id])).rows[0].n;
    if (used) throw bad(`${used} day(s) are already marked against this shift. It cannot be deleted.`);

    const { rowCount } = await pool.query(`DELETE FROM shifts WHERE id = $1 AND is_manual`, [req.params.id]);
    if (!rowCount) throw bad('That shift does not exist on this page');
    res.json({ success: true, message: 'Shift removed' });
  } catch (err) { fail(res, err); }
});

// ── Who is on this page ───────────────────────────────────────────────────
router.get('/staff', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.id AS "employeeId", e.employee_id AS "code",
              TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) AS name,
              e.department, e.designation, e.photo_url AS "photoUrl", e.status,
              COALESCE(json_agg(json_build_object(
                'id', s.id, 'name', s.name,
                'startTime', s.start_time, 'endTime', s.end_time,
                'payMode', s.pay_mode, 'daysOfWeek', s.days_of_week,
                'observesHolidays', s.observes_holidays
              ) ORDER BY s.start_time) FILTER (WHERE s.id IS NOT NULL), '[]') AS shifts
         FROM manual_attendance_assignments a
         JOIN employees e ON e.id = a.employee_id AND e.deleted_at IS NULL
         JOIN shifts s ON s.id = a.shift_id
        GROUP BY e.id
        ORDER BY name`);
    res.json({ success: true, data: rows });
  } catch (err) { fail(res, err); }
});

router.post('/staff', audit('CREATE', 'manual_attendance_assignment'), async (req, res) => {
  try {
    const { employeeId, shiftId } = req.body || {};
    if (!isUuid(employeeId)) throw bad('Choose an employee');
    if (!isUuid(shiftId)) throw bad('Choose a shift');

    const shift = (await pool.query(`SELECT id FROM shifts WHERE id = $1 AND is_manual`, [shiftId])).rows[0];
    if (!shift) throw bad('That shift does not exist on this page');
    const emp = (await pool.query(
      `SELECT id FROM employees WHERE id = $1 AND deleted_at IS NULL`, [employeeId])).rows[0];
    if (!emp) throw bad('That employee does not exist');

    await pool.query(
      `INSERT INTO manual_attendance_assignments (employee_id, shift_id, created_by)
       VALUES ($1, $2, $3) ON CONFLICT (employee_id, shift_id) DO NOTHING`,
      [employeeId, shiftId, req.user.id]);
    res.status(201).json({ success: true, message: 'Added' });
  } catch (err) { fail(res, err); }
});

router.delete('/staff/:employeeId/:shiftId', audit('DELETE', 'manual_attendance_assignment'), async (req, res) => {
  try {
    const { employeeId, shiftId } = req.params;
    if (!isUuid(employeeId) || !isUuid(shiftId)) throw bad('That is not an assignment');
    /* Marks already made are left alone. Taking somebody off a shift describes
     * the future; it does not unsay what was recorded about last Tuesday. */
    await pool.query(
      `DELETE FROM manual_attendance_assignments WHERE employee_id = $1 AND shift_id = $2`,
      [employeeId, shiftId]);
    res.json({ success: true, message: 'Removed from this shift' });
  } catch (err) { fail(res, err); }
});

// ── The marking board ─────────────────────────────────────────────────────
/** Holidays in a range, as a Set of ISO dates. */
async function holidaySet(from, to) {
  const { rows } = await pool.query(
    `SELECT DISTINCT TO_CHAR(date, 'YYYY-MM-DD') AS d FROM holidays WHERE date BETWEEN $1::date AND $2::date`,
    [from, to]);
  return new Set(rows.map(r => r.d));
}

router.get('/day', async (req, res) => {
  try {
    const date = isDate(req.query.date) ? req.query.date : new Date().toISOString().slice(0, 10);
    const holidays = await holidaySet(date, date);

    const { rows } = await pool.query(
      `SELECT e.id AS "employeeId", e.employee_id AS "code",
              TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) AS name,
              e.designation, e.photo_url AS "photoUrl",
              e.joining_date AS "joiningDate", e.status AS "employeeStatus",
              s.id AS "shiftId", s.name AS "shiftName",
              s.start_time AS "startTime", s.end_time AS "endTime",
              s.pay_mode AS "payMode", s.days_of_week AS "daysOfWeek",
              s.observes_holidays AS "observesHolidays",
              m.state, m.hours, m.note, m.marked_at AS "markedAt",
              TRIM(CONCAT(mb.first_name, ' ', COALESCE(mb.last_name, ''))) AS "markedBy"
         FROM manual_attendance_assignments a
         JOIN employees e ON e.id = a.employee_id AND e.deleted_at IS NULL
         JOIN shifts s ON s.id = a.shift_id
         LEFT JOIN manual_attendance_marks m
                ON m.employee_id = e.id AND m.shift_id = s.id AND m.date = $1::date
         LEFT JOIN employees mb ON mb.id = m.marked_by
        ORDER BY name, s.start_time`,
      [date]);

    const today = new Date().toISOString().slice(0, 10);
    const rowsOut = rows.map(r => {
      const scheduled =
        runsOn({ days_of_week: r.daysOfWeek }, date) &&
        !(r.observesHolidays && holidays.has(date)) &&
        (!r.joiningDate || new Date(r.joiningDate).toISOString().slice(0, 10) <= date);
      return {
        ...r,
        scheduled,
        spanHours: shiftSpanHours({ start_time: r.startTime, end_time: r.endTime }),
        /* What this day counts as right now. 'presumed' is only ever a display
         * — nothing is stored until somebody clicks. */
        effective: r.state ? r.state : (scheduled && date <= today ? 'presumed' : 'not-scheduled'),
      };
    });

    res.json({
      success: true,
      data: {
        date,
        isHoliday: holidays.has(date),
        rows: rowsOut,
        unmarkedScheduled: rowsOut.filter(r => !r.state && r.scheduled && date <= today).length,
      },
    });
  } catch (err) { fail(res, err); }
});

router.post('/mark', audit('UPDATE', 'manual_attendance_mark'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { employeeId, shiftId, date, state } = req.body || {};
    if (!isUuid(employeeId)) throw bad('Choose an employee');
    if (!isUuid(shiftId)) throw bad('Choose a shift');
    if (!isDate(date)) throw bad('Choose a date');
    if (date > new Date().toISOString().slice(0, 10)) throw bad('That day has not happened yet');
    if (!['present', 'absent', 'clear'].includes(state)) throw bad('State must be present, absent or clear');

    const assigned = (await client.query(
      `SELECT s.pay_mode, s.start_time, s.end_time
         FROM manual_attendance_assignments a JOIN shifts s ON s.id = a.shift_id
        WHERE a.employee_id = $1 AND a.shift_id = $2`, [employeeId, shiftId])).rows[0];
    if (!assigned) throw bad('That person is not on this shift');

    await client.query('BEGIN');

    if (state === 'clear') {
      await client.query(
        `DELETE FROM manual_attendance_marks WHERE employee_id = $1 AND shift_id = $2 AND date = $3::date`,
        [employeeId, shiftId, date]);
    } else {
      /* Hours are only accepted on an 'actual' shift. On a fixed shift they
       * are dropped rather than stored and ignored, so the stored row cannot
       * imply a number the pay mode says is meaningless. */
      let hours = null;
      if (assigned.pay_mode === 'actual' && state === 'present') {
        const h = req.body?.hours;
        if (h !== null && h !== undefined && h !== '') {
          const n = Number(h);
          if (!Number.isFinite(n) || n < 0) throw bad('Hours must be a number');
          const span = shiftSpanHours({ start_time: assigned.start_time, end_time: assigned.end_time });
          if (n > span) throw bad(`Hours cannot exceed the ${span}h shift`);
          hours = Math.round(n * 100) / 100;
        }
      }
      const note = String(req.body?.note ?? '').trim().slice(0, 255) || null;

      await client.query(
        `INSERT INTO manual_attendance_marks (employee_id, shift_id, date, state, hours, note, marked_by, marked_at)
         VALUES ($1, $2, $3::date, $4, $5, $6, $7, NOW())
         ON CONFLICT (employee_id, shift_id, date) DO UPDATE
            SET state = EXCLUDED.state, hours = EXCLUDED.hours, note = EXCLUDED.note,
                marked_by = EXCLUDED.marked_by, marked_at = NOW()`,
        [employeeId, shiftId, date, state, hours, note, req.user.id]);
    }

    const sync = await syncAttendanceDay(client, employeeId, date);
    await client.query('COMMIT');

    res.json({
      success: true,
      message: sync.action === 'skipped'
        ? 'Saved, but the attendance day was left alone — it has real punches on it.'
        : 'Saved',
      data: sync,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    fail(res, err);
  } finally { client.release(); }
});

/** Mark every unmarked scheduled row on a date — the ordinary day, one click. */
router.post('/mark-all', audit('UPDATE', 'manual_attendance_mark'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { date } = req.body || {};
    if (!isDate(date)) throw bad('Choose a date');
    if (date > new Date().toISOString().slice(0, 10)) throw bad('That day has not happened yet');

    const holidays = await holidaySet(date, date);
    const { rows } = await client.query(
      `SELECT a.employee_id, a.shift_id, s.days_of_week, s.observes_holidays
         FROM manual_attendance_assignments a
         JOIN shifts s ON s.id = a.shift_id
         JOIN employees e ON e.id = a.employee_id AND e.deleted_at IS NULL
        WHERE NOT EXISTS (
          SELECT 1 FROM manual_attendance_marks m
           WHERE m.employee_id = a.employee_id AND m.shift_id = a.shift_id AND m.date = $1::date)`,
      [date]);

    const due = rows.filter(r =>
      runsOn({ days_of_week: r.days_of_week }, date) && !(r.observes_holidays && holidays.has(date)));

    await client.query('BEGIN');
    for (const r of due) {
      await client.query(
        `INSERT INTO manual_attendance_marks (employee_id, shift_id, date, state, marked_by, marked_at)
         VALUES ($1, $2, $3::date, 'present', $4, NOW())
         ON CONFLICT (employee_id, shift_id, date) DO NOTHING`,
        [r.employee_id, r.shift_id, date, req.user.id]);
    }
    for (const id of new Set(due.map(r => r.employee_id))) {
      await syncAttendanceDay(client, id, date);
    }
    await client.query('COMMIT');

    res.json({ success: true, message: `${due.length} marked present`, data: { marked: due.length } });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    fail(res, err);
  } finally { client.release(); }
});

// ── The report ────────────────────────────────────────────────────────────
/* Where the presumption lives, and the only place it exists. Confirmed and
 * presumed are returned separately and always both — a single "present" figure
 * would hide exactly the thing HR needs to see at month end.
 *
 * PAYROLL-DECISION: if payroll ever consumes this, it has to pick one of these
 * two numbers, and that choice is the decision nobody has made yet. */
router.get('/summary', async (req, res) => {
  try {
    const to = isDate(req.query.to) ? req.query.to : new Date().toISOString().slice(0, 10);
    const from = isDate(req.query.from) ? req.query.from : to.slice(0, 8) + '01';
    if (from > to) throw bad('The start date is after the end date');

    const today = new Date().toISOString().slice(0, 10);
    const holidays = await holidaySet(from, to);

    const staff = (await pool.query(
      `SELECT a.employee_id, a.shift_id,
              e.employee_id AS code,
              TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) AS name,
              e.designation, e.joining_date,
              s.name AS shift_name, s.start_time, s.end_time, s.pay_mode,
              s.days_of_week, s.observes_holidays
         FROM manual_attendance_assignments a
         JOIN employees e ON e.id = a.employee_id AND e.deleted_at IS NULL
         JOIN shifts s ON s.id = a.shift_id
        ORDER BY name, s.start_time`)).rows;

    const marks = (await pool.query(
      `SELECT employee_id, shift_id, TO_CHAR(date, 'YYYY-MM-DD') AS d, state, hours
         FROM manual_attendance_marks WHERE date BETWEEN $1::date AND $2::date`,
      [from, to])).rows;
    const markAt = new Map(marks.map(m => [`${m.employee_id}|${m.shift_id}|${m.d}`, m]));

    const dates = [];
    for (let d = new Date(`${from}T00:00:00`); d <= new Date(`${to}T00:00:00`); d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().slice(0, 10));
    }

    const byEmployee = new Map();
    for (const row of staff) {
      const key = row.employee_id;
      if (!byEmployee.has(key)) {
        byEmployee.set(key, {
          employeeId: key, code: row.code, name: row.name, designation: row.designation,
          shifts: [], scheduled: 0, confirmedPresent: 0, presumedPresent: 0,
          absent: 0, hours: 0, unconfirmedDates: [],
        });
      }
      const agg = byEmployee.get(key);
      agg.shifts.push({ name: row.shift_name, startTime: row.start_time, endTime: row.end_time, payMode: row.pay_mode });

      const joined = row.joining_date ? new Date(row.joining_date).toISOString().slice(0, 10) : null;
      const span = shiftSpanHours({ start_time: row.start_time, end_time: row.end_time });

      for (const d of dates) {
        if (d > today) continue;
        if (joined && d < joined) continue;
        if (!runsOn({ days_of_week: row.days_of_week }, d)) continue;
        if (row.observes_holidays && holidays.has(d)) continue;

        agg.scheduled += 1;
        const mark = markAt.get(`${row.employee_id}|${row.shift_id}|${d}`);
        if (!mark) {
          // Nobody looked at this day. Counts as present, and is named.
          agg.presumedPresent += 1;
          agg.hours += span;
          agg.unconfirmedDates.push(d);
        } else if (mark.state === 'present') {
          agg.confirmedPresent += 1;
          agg.hours += creditedHours(
            { start_time: row.start_time, end_time: row.end_time, pay_mode: row.pay_mode }, mark);
        } else {
          agg.absent += 1;
        }
      }
    }

    const out = [...byEmployee.values()].map(a => ({
      ...a,
      hours: Math.round(a.hours * 100) / 100,
      totalPresent: a.confirmedPresent + a.presumedPresent,
      unconfirmedDates: a.unconfirmedDates.sort(),
    }));

    res.json({
      success: true,
      data: {
        from, to,
        rows: out,
        totals: {
          people: out.length,
          scheduled: out.reduce((n, r) => n + r.scheduled, 0),
          confirmedPresent: out.reduce((n, r) => n + r.confirmedPresent, 0),
          presumedPresent: out.reduce((n, r) => n + r.presumedPresent, 0),
          absent: out.reduce((n, r) => n + r.absent, 0),
          hours: Math.round(out.reduce((n, r) => n + r.hours, 0) * 100) / 100,
        },
      },
    });
  } catch (err) { fail(res, err); }
});

module.exports = router;
