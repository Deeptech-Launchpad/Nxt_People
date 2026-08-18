// Shared cell codes for the attendance calendar grids (Employee Present/
// Absent Status and Muster Roll) so both read identically. Codes are produced
// by classifyAttendanceDay() on the backend.
export const CODE_STYLE = {
  P: 'bg-emerald-100 text-emerald-700',
  HD: 'bg-teal-100 text-teal-700',
  A: 'bg-red-100 text-red-700',
  W: 'bg-amber-100 text-amber-700',
  H: 'bg-sky-100 text-sky-700',
  CL: 'bg-blue-100 text-blue-700',
  CO: 'bg-purple-100 text-purple-700',
  LWP: 'bg-rose-100 text-rose-700',
  PM: 'bg-cyan-100 text-cyan-700',
  OD: 'bg-violet-100 text-violet-700',
  L: 'bg-violet-100 text-violet-700',
};

export const LEGEND = [
  ['P', 'Present'],
  ['HD', 'Half Day'],
  ['A', 'Absent'],
  ['W', 'Weekend'],
  ['H', 'Holiday'],
  ['CL', 'Casual Leave'],
  ['CO', 'Comp-Off'],
  ['OD', 'On Duty'],
  ['PM', 'Permission'],
  ['LWP', 'Leave Without Pay'],
];

// A cell can be a split day like "0.5CL/0.5P" — style it by its leading code.
export const codeStyle = (code) => {
  if (!code || code === '-') return '';
  const base = String(code).replace(/^[\d.]+/, '').split('/')[0];
  return CODE_STYLE[base] || 'bg-slate-100 text-slate-600';
};

// Which columns are weekends comes from the data — the server stamps 'W' on
// the days its weekend rules match. Deriving it from the weekday instead would
// be wrong here: the work week is Mon-Sat with only the 1st and 3rd Saturday
// off, so a [0,6] test would mark four working Saturdays a month as weekend.
// A day is a bare code on the Present/Absent grid and a {shift, code} pair on
// Muster Roll, so both shapes are read rather than duplicating the helper.
export const weekendColumns = (rows) => {
  const set = new Set();
  for (const emp of rows || []) {
    (emp.days || []).forEach((day, i) => {
      const code = day && typeof day === 'object' ? day.code : day;
      if (String(code || '').split('/')[0].replace(/^[\d.]+/, '') === 'W') set.add(i);
    });
  }
  return set;
};

// Weekends are striped rather than flat-tinted, matching the reference. A
// diagonal hatch reads as "not a working day" without competing with the
// status pills the column still has to carry.
export const WEEKEND_HATCH = {
  backgroundImage:
    'repeating-linear-gradient(45deg, rgba(148,163,184,0.16) 0 4px, transparent 4px 8px)',
  backgroundColor: 'rgba(241,245,249,0.7)',
};

// ── Roll-up weighting ──────────────────────────────────────────────────────
// A cell is either one code ('P', 'W') or a split that must add up to a single
// day ('0.06PM/0.94P', '0.5CL/0.5P'). Muster Roll's roll-up columns are
// fractional in the reference — a 30-minute permission on an 8-hour shift
// reads 6.94 worked and 8.06 paid off, not 6 and 9 — so a cell is *weighed*
// rather than counted.
//
// Counting was wrong in both directions at once: a split day contributed
// nothing to Worked Days (the code is not literally 'P') and a whole day to
// Paid Off, so an employee who took thirty minutes off lost a full day from
// one column and gained a full day in another.
//
// The property that matters is conservation: worked + paidOff + unpayable is
// exactly 1.0 for any day that happened, so Payable Days can never exceed the
// number of days in the period.
const BUCKET = {
  P:   { worked: 1 },
  OD:  { worked: 1 },
  W:   { weekend: 1, paidOff: 1 },
  H:   { holiday: 1, paidOff: 1 },
  CL:  { paidOff: 1 },
  CO:  { paidOff: 1 },
  // Permission is paid time off inside a working day, so its fraction leaves
  // Worked and lands in Paid Off. The day still pays in full.
  PM:  { paidOff: 1 },
  L:   { paidOff: 1 },
  LWP: { unpayable: 1 },
  A:   { unpayable: 1 },
  // Half a day present with no leave record covering the remainder: the worked
  // half pays and the other half is covered by nothing, so it is not payable.
  HD:  { worked: 0.5, unpayable: 0.5 },
};

const EMPTY = () => ({ worked: 0, weekend: 0, holiday: 0, paidOff: 0, unpayable: 0 });

export const dayWeights = (code) => {
  const out = EMPTY();
  if (!code || code === '-') return out;
  String(code).split('/').forEach(part => {
    const m = /^([\d.]*)([A-Za-z]+)$/.exec(part.trim());
    if (!m) return;
    // A leading number is the fraction of the day; a bare code is the whole of it.
    const frac = m[1] === '' ? 1 : parseFloat(m[1]);
    const bucket = BUCKET[m[2].toUpperCase()];
    if (!bucket || !Number.isFinite(frac)) return;
    Object.entries(bucket).forEach(([k, v]) => { out[k] += v * frac; });
  });
  return out;
};

// A day is a bare code on the Present/Absent grid and a {shift, code} pair on
// Muster Roll, so both shapes are accepted here rather than at each call site.
export const sumDays = (days) => (days || []).reduce((acc, d) => {
  const w = dayWeights(d && typeof d === 'object' ? d.code : d);
  Object.keys(acc).forEach(k => { acc[k] += w[k]; });
  return acc;
}, EMPTY());

// Fractions accumulated in binary drift — 6.94 + 8.06 lands on 15.000000000002
// often enough that the sheet has to be rounded on the way out.
export const round2 = n => Math.round(n * 100) / 100;
