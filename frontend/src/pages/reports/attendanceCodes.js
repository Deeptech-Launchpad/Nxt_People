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
  ['PM', 'Permission'],
  ['LWP', 'Leave Without Pay'],
];

// A cell can be a split day like "0.5CL/0.5P" — style it by its leading code.
export const codeStyle = (code) => {
  if (!code || code === '-') return '';
  const base = String(code).replace(/^[\d.]+/, '').split('/')[0];
  return CODE_STYLE[base] || 'bg-slate-100 text-slate-600';
};
