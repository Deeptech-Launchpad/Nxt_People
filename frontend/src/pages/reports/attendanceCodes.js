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
