/* ── Shared plumbing for the two Shift schedule grids ─────────────────────
 *  User-specific Operations (one person, days down the side) and Employee
 *  Shift Mapping (many people, days across the top) draw the same chips from
 *  the same payload, so the arithmetic lives here once rather than in both.
 *
 *  Weeks run SUNDAY-first throughout this module, which is what the reference
 *  does and what the existing /shift-roster screen does NOT — that one starts
 *  on Monday. They are not merged for exactly that reason: quietly moving the
 *  old screen's week boundary would shift every column under people already
 *  using it.
 * ────────────────────────────────────────────────────────────────────────── */

export const ymd = (d) => d.toLocaleDateString('en-CA');

export const LEAVE_LABEL = {
  casual: 'Casual Leave', comp_off: 'Compensatory Off',
  unpaid: 'Leave Without Pay', permission: 'Permission',
};

/** The Sunday on or before `date`. */
export function weekStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

/** The seven dates of the week containing `date`, Sunday first. */
export function weekDates(date) {
  const s = weekStart(date);
  return Array.from({ length: 7 }, (_, i) => addDays(s, i));
}

/**
 * Every cell of the month grid containing `date` — including the leading and
 * trailing blanks, so the caller can render a 7-wide grid without counting.
 * A blank is null rather than a Date from the neighbouring month: the
 * reference leaves those cells empty rather than greying out the 31st of
 * August, and a Date there would invite drawing a shift on it.
 */
export function monthCells(date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const cells = Array.from({ length: first.getDay() }, () => null);
  for (let day = 1; day <= last.getDate(); day++) {
    cells.push(new Date(date.getFullYear(), date.getMonth(), day));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** "09:30:00" or "09:30" → minutes since midnight. */
export function toMinutes(time) {
  if (!time) return null;
  const [h, m] = String(time).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** "09:30:00" → "9:30 AM". */
export function to12(time) {
  const mins = toMinutes(time);
  if (mins === null) return '';
  const h = Math.floor(mins / 60), m = mins % 60;
  const period = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${period}`;
}

export const shiftLabel = (s) => (s ? `${to12(s.startTime)} - ${to12(s.endTime)}` : '');

/**
 * Which shift applies to one employee on one date.
 *
 * A rostered row wins over the employee's standing shift — the same precedence
 * attendance.js resolves check-ins against, so this grid shows what the
 * attendance engine will actually measure against rather than a second opinion
 * about it.
 */
export function shiftFor(date, employeeId, rosterByKey, employee) {
  const rostered = rosterByKey.get(`${employeeId}|${ymd(date)}`);
  if (rostered) return { ...rostered.shift, rosterId: rostered._id, rostered: true, reason: rostered.reason };
  if (!employee?.shiftId) return null;
  return {
    id: employee.shiftId, name: employee.shiftName,
    startTime: employee.startTime, endTime: employee.endTime, rostered: false,
  };
}

/** Approved leave and permission touching one employee on one date. */
export function leavesFor(date, employeeId, leaves) {
  const iso = ymd(date);
  return leaves.filter(l => String(l.employeeId) === String(employeeId)
    && iso >= String(l.startDate).slice(0, 10) && iso <= String(l.endDate).slice(0, 10));
}

export function leaveChipText(l) {
  const label = LEAVE_LABEL[l.leaveType] || l.leaveType;
  if (l.leaveType === 'permission' && l.startTime) {
    return `${label} ${to12(l.startTime)} - ${to12(l.endTime)}`;
  }
  if (l.isHalfDay) return `${label} (${l.halfDayType === 'second_half' ? '2nd' : '1st'} half)`;
  return label;
}

/* The hour band every time-grid is drawn across. Wide enough for a 9-6 shift
 * with an hour either side, which is what the reference shows; a shift outside
 * it is not hidden — placeOnBand clamps to the edge and the chip still carries
 * its real times as text. */
export const BAND_START = 8 * 60;
export const BAND_END = 19 * 60;
export const BAND_HOURS = Array.from(
  { length: (BAND_END - BAND_START) / 60 }, (_, i) => BAND_START + i * 60);

/** left/width percentages for a start/end pair laid on the hour band. */
export function placeOnBand(startTime, endTime) {
  const span = BAND_END - BAND_START;
  let from = toMinutes(startTime) ?? BAND_START;
  let to = toMinutes(endTime) ?? BAND_END;
  // An overnight shift ends "before" it starts by the clock. Run it to the
  // edge of the band rather than rendering a negative width.
  if (to <= from) to = BAND_END;
  from = Math.max(BAND_START, Math.min(from, BAND_END));
  to = Math.max(BAND_START, Math.min(to, BAND_END));
  return {
    left: `${((from - BAND_START) / span) * 100}%`,
    width: `${Math.max(((to - from) / span) * 100, 2)}%`,
  };
}

export const isWeekendDay = (d) => d.getDay() === 0 || d.getDay() === 6;
export const isToday = (d) => ymd(d) === ymd(new Date());
