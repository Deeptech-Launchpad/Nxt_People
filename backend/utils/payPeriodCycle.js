/**
 * utils/payPeriodCycle.js
 *
 * Turns a pay period's recurrence rule into concrete dates.
 *
 * Day numbers use 32 as a sentinel for "last day", so a rule can say "the last
 * day of the month" without knowing which month it will be applied to. Every
 * function here resolves that against a real month before using it.
 */
const LAST_DAY = 32;

const daysInMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

// Resolves a rule day (1..31, or 32 = last) against a specific month. A day
// past the end of a short month clamps to its last day, so "the 31st" is a
// usable rule in February rather than an error.
function resolveDay(day, year, month) {
  const last = daysInMonth(year, month);
  return Math.min(day === LAST_DAY ? last : day, last);
}

const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

// The cycle containing `on` (a Date). Returns ISO start/end strings.
//
// A period that starts mid-month runs into the following month — "16th to the
// 15th" is a real payroll cycle — so the start month is whichever side of the
// boundary `on` falls on, not simply its own month.
function cycleFor(period, on) {
  const y = on.getUTCFullYear();
  const m = on.getUTCMonth();
  const d = on.getUTCDate();
  const startDay = Number(period.startDay ?? period.start_day ?? 1);
  const endDay = Number(period.endDay ?? period.end_day ?? LAST_DAY);

  // Wrapping cycle: the start day is later in the month than the end day.
  const wraps = startDay !== LAST_DAY && endDay !== LAST_DAY && startDay > endDay;

  let sy = y, sm = m;
  if (wraps && d < resolveDay(startDay, y, m)) {
    // Before this month's start day, so the live cycle began last month.
    sm = m - 1;
    if (sm < 0) { sm = 11; sy = y - 1; }
  }

  const s = resolveDay(startDay, sy, sm);
  let ey = sy, em = sm;
  if (wraps) {
    em = sm + 1;
    if (em > 11) { em = 0; ey = sy + 1; }
  }
  const e = resolveDay(endDay, ey, em);
  return { startDate: iso(sy, sm, s), endDate: iso(ey, em, e) };
}

// The cycle that follows the one containing `on`.
function nextCycle(period, on) {
  const { endDate } = cycleFor(period, on);
  const [y, m, d] = endDate.split('-').map(Number);
  const dayAfter = new Date(Date.UTC(y, m - 1, d + 1));
  return cycleFor(period, dayAfter);
}

// Resolves a rule day against the month of `ref` (an ISO date string). Used for
// the processing and report-generation dates, which are expressed the same way
// as the cycle bounds but land relative to the cycle's end.
function dayInMonthOf(day, isoDate, monthOffset = 0) {
  const [y, m] = isoDate.split('-').map(Number);
  let yy = y, mm = m - 1 + monthOffset;
  while (mm > 11) { mm -= 12; yy += 1; }
  while (mm < 0) { mm += 12; yy -= 1; }
  return iso(yy, mm, resolveDay(Number(day), yy, mm));
}

const DAY_LABELS = { [LAST_DAY]: 'Last day' };
function dayLabel(day) {
  const n = Number(day);
  if (DAY_LABELS[n]) return DAY_LABELS[n];
  const suffix = n % 10 === 1 && n !== 11 ? 'st'
    : n % 10 === 2 && n !== 12 ? 'nd'
    : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
  return `${n}${suffix}`;
}

// "1st of current month - Last day of current month", as the list column shows.
// A wrapping cycle ends in the following month, and says so.
function cycleLabel(period) {
  const startDay = Number(period.startDay ?? period.start_day ?? 1);
  const endDay = Number(period.endDay ?? period.end_day ?? LAST_DAY);
  const wraps = startDay !== LAST_DAY && endDay !== LAST_DAY && startDay > endDay;
  return `${dayLabel(startDay)} of current month - ${dayLabel(endDay)} of ${wraps ? 'next' : 'current'} month`;
}

module.exports = { LAST_DAY, cycleFor, nextCycle, dayInMonthOf, dayLabel, cycleLabel, resolveDay };
