/* ── Turning "HR clicked present" into an attendance day ────────────────────
 *  Marks are what HR asserted. Attendance is what the rest of the application
 *  reads. This is the one place that turns the first into the second, so that
 *  a marked day reaches the ordinary reports and exports without every report
 *  needing to know manual attendance exists.
 *
 *  Three things here are easy to get wrong and expensive to discover late.
 *
 *  THE HOURS TRAP. Expected hours is set globally to 08:00 and the short-day
 *  rule is `absent` with zero tolerance. Push a three-and-a-half hour cleaning
 *  shift through the ordinary classification and it comes back ABSENT — the
 *  exact opposite of the button that was pressed, and invisible until somebody
 *  reads the export a month later. So a marked day's status is asserted, not
 *  computed. HR said present; the row says present.
 *
 *  THE TIMEZONE TRAP. attendance.check_in and check_out are `timestamp without
 *  time zone` holding UTC wall clocks, rendered back through
 *  `AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata'`. A shift starting 06:00 IST
 *  must therefore be stored as 00:30. The conversion is done in SQL, as the
 *  exact inverse of how it is read, rather than in JavaScript where the
 *  container's clock would get a vote.
 *
 *  NEVER CLOBBER A PUNCH. If a row already exists with source 'punch', a real
 *  person really checked in. These functions refuse to touch it. Marking is
 *  for people who cannot punch; if one of them somehow did, the punch wins.
 *
 *  PAYROLL-DECISION: a marked day is written with the shift's span as its
 *  hours. Whether that span is payable, and whether a presumed-present day is
 *  payable at all, is not decided. Nothing here feeds payroll today.
 * ───────────────────────────────────────────────────────────────────────── */

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** 'HH:MM' or 'HH:MM:SS' → minutes since midnight. Null if unparseable. */
function clockMinutes(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * How long a shift is, in hours.
 * An end before the start is an overnight shift, not a negative one — 22:00 to
 * 02:00 is four hours. Housekeeping do not work nights today, but a security
 * guard on this same page would, and a negative span would silently subtract
 * hours from a month.
 */
function shiftSpanHours(shift) {
  const start = clockMinutes(shift?.start_time ?? shift?.startTime);
  const end = clockMinutes(shift?.end_time ?? shift?.endTime);
  if (start === null || end === null) return 0;
  const span = end > start ? end - start : (24 * 60) - start + end;
  return Math.round((span / 60) * 100) / 100;
}

/** Does this manual shift run on this date? Its own days, not the company's. */
function runsOn(shift, date) {
  const days = Array.isArray(shift?.days_of_week) ? shift.days_of_week
             : Array.isArray(shift?.daysOfWeek) ? shift.daysOfWeek
             : [];
  if (!days.length) return false;
  const d = date instanceof Date ? date : new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  return days.map(x => String(x).toLowerCase()).includes(DAY_KEYS[d.getDay()]);
}

/**
 * The hours a present mark is worth.
 * fixed  — the whole shift, and any hours typed are ignored rather than
 *          quietly honoured, so the pay mode means what it says.
 * actual — what HR typed, falling back to the span when they typed nothing.
 */
function creditedHours(shift, mark) {
  const span = shiftSpanHours(shift);
  if ((shift?.pay_mode ?? shift?.payMode) !== 'actual') return span;
  const typed = mark?.hours === null || mark?.hours === undefined ? null : Number(mark.hours);
  if (typed === null || !Number.isFinite(typed) || typed < 0) return span;
  return Math.round(typed * 100) / 100;
}

/* An IST wall clock on `date` at `time`, expressed as the UTC wall clock the
 * attendance columns hold. The exact inverse of how every read renders them.
 * Built from explicit parameter positions so the caller's argument list and
 * the expression cannot drift apart. */
const istToStored = (dateParam, timeParam) =>
  `((($${dateParam}::date + $${timeParam}::time) AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'UTC')`;

/**
 * Rebuild one person's attendance day from their marks for that day.
 *
 * Called after every mark, unmark and shift edit. Rebuilding rather than
 * patching means two shifts, a removed mark and a changed shift time all land
 * on the same code path, and the row can never drift from the marks.
 *
 * Returns what it did, for the caller to report.
 */
async function syncAttendanceDay(client, employeeId, date) {
  const { rows: marks } = await client.query(
    `SELECT m.id, m.state, m.hours, m.shift_id,
            s.start_time, s.end_time, s.pay_mode, s.name AS shift_name
       FROM manual_attendance_marks m
       JOIN shifts s ON s.id = m.shift_id
      WHERE m.employee_id = $1 AND m.date = $2::date
      ORDER BY s.start_time`,
    [employeeId, date]
  );

  const existing = (await client.query(
    `SELECT id, source FROM attendance WHERE employee_id = $1 AND date = $2::date`,
    [employeeId, date]
  )).rows[0];

  // A real punch outranks anything asserted about it.
  if (existing && existing.source === 'punch') {
    return { action: 'skipped', reason: 'a punched day already exists for this date' };
  }

  // Nothing asserted any more — remove the day we previously wrote.
  if (!marks.length) {
    if (existing) {
      await client.query(`DELETE FROM attendance_sessions WHERE attendance_id = $1`, [existing.id]);
      await client.query(`DELETE FROM attendance WHERE id = $1`, [existing.id]);
      return { action: 'removed' };
    }
    return { action: 'none' };
  }

  const present = marks.filter(m => m.state === 'present');
  const hours = present.reduce((sum, m) => sum + creditedHours(m, m), 0);

  /* Asserted, never classified. See THE HOURS TRAP above — running these hours
   * through classifyDay would return absent for every housekeeping day. */
  const status = present.length ? 'present' : 'absent';

  const firstStart = present.length ? present[0].start_time : marks[0].start_time;
  const lastEnd = present.length ? present[present.length - 1].end_time : marks[marks.length - 1].end_time;

  /* An all-absent day still gets a row — that is the difference between "she
   * did not come" and "nobody has looked", and it is the whole reason marks
   * have three states. It carries no times, because nothing happened. */
  const att = (await client.query(
    `INSERT INTO attendance (employee_id, date, check_in, check_out,
                             working_hours, status, source, check_in_location, late_minutes)
     VALUES ($1, $2::date,
             CASE WHEN $5::boolean THEN ${istToStored(2, 3)} END,
             CASE WHEN $5::boolean THEN ${istToStored(2, 4)} END,
             $6, $7, 'manual', 'Marked by HR', 0)
     ON CONFLICT (employee_id, date) DO UPDATE
        SET check_in      = EXCLUDED.check_in,
            check_out     = EXCLUDED.check_out,
            working_hours = EXCLUDED.working_hours,
            status        = EXCLUDED.status,
            source        = 'manual',
            updated_at    = NOW()
     RETURNING id`,
    [employeeId, date, firstStart, lastEnd, present.length > 0,
     Math.round(hours * 100) / 100, status]
  )).rows[0];

  // Sessions are rebuilt wholesale — one per present shift, which is how a
  // person with two shifts in a day gets two.
  await client.query(`DELETE FROM attendance_sessions WHERE attendance_id = $1`, [att.id]);
  for (const m of present) {
    await client.query(
      `INSERT INTO attendance_sessions (attendance_id, employee_id, date, check_in, check_out, session_hours)
       VALUES ($1, $2, $3::date, ${istToStored(3, 4)}, ${istToStored(3, 5)}, $6)`,
      [att.id, employeeId, date, m.start_time, m.end_time, creditedHours(m, m)]
    );
  }

  return {
    action: 'written',
    status,
    hours: Math.round(hours * 100) / 100,
    sessions: present.length,
  };
}

module.exports = {
  DAY_KEYS,
  clockMinutes,
  shiftSpanHours,
  runsOn,
  creditedHours,
  syncAttendanceDay,
};
