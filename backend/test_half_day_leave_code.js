// What the grid says about a day that was half leave.
//
// Half a day of leave says nothing about the other half. The code was built
// from the leave record alone — `0.5CL/0.5P` for every half-day leave — so
// somebody who took the morning off and then did not come in at all was
// credited half a day present they never worked.
//
// It survived because seeded attendance always has somebody working the other
// half. Eight months of real data produced one day that did not: Shivanie's
// 2026-06-01, half a day of casual leave and no punch. Zoho's own status for
// that day reads "Casual Leave(Second Half), 0.5 day Absent" — the reference
// distinguishes, and this did not.
//
// classifyAttendanceDay is shared by the muster roll, present/absent status and
// the hours breakup, so this exercises the function directly rather than one
// screen's reading of it.
require('dotenv').config();

const fs = require('fs');

const checks = [];
const check = (l, ok, x) => { checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '   got ' + JSON.stringify(x)}`); };

// Lifted from the route by reading it, so the test cannot pass against a copy
// the original has moved away from.
const src = fs.readFileSync(require.resolve('./routes/reports.js'), 'utf8');
const from = src.indexOf('function classifyAttendanceDay(');
if (from < 0) throw new Error('classifyAttendanceDay not found');
const body = src.slice(from, src.indexOf('\n}', from) + 2);
/* Every free name the lifted function reaches for has to be supplied here.
 * holidayTypeFor was added to it when holidays gained location and shift
 * scoping, and this harness was not updated — so the suite threw
 * "holidayTypeFor is not defined" on its first assertion and had been failing
 * ever since. A test that always fails hides the regressions it exists to
 * catch, which is worse than not having it.
 *
 * The stubs answer "no holiday, no weekend", so these cases turn purely on
 * the leave and attendance status they are actually about. */
const classify = new Function(`
  const ATT_LEAVE_CODE = { casual: 'CL', sick: 'SL', unpaid: 'LOP', earned: 'EL', comp_off: 'CO' };
  const holidayClosesOffice = () => false;
  const ruleMatchesDate = () => false;
  const holidayTypeFor = () => null;
  ${body}
  return classifyAttendanceDay;
`)();

const DAY = new Date('2026-06-01T00:00:00Z');
const base = { date: DAY, holMap: new Map(), rules: [], onDuty: false, isFuture: false };
const halfCasual = { leaveType: 'casual', isHalfDay: true };
const fullCasual = { leaveType: 'casual', isHalfDay: false };

console.log('\n════ Half a day of leave, and the other half worked ════\n');

for (const status of ['present', 'late', 'half-day']) {
  const r = classify({ ...base, leave: halfCasual, attStatus: status });
  check(`row says ${status.padEnd(9)} → 0.5CL/0.5P`, r.code === '0.5CL/0.5P', r.code);
}

console.log('\n════ Half a day of leave, and they never came in ════\n');

// The failure this test exists for.
const absent = classify({ ...base, leave: halfCasual, attStatus: 'absent' });
check('row says absent    → 0.5CL/0.5A, not 0.5CL/0.5P', absent.code === '0.5CL/0.5A', absent.code);

const noRow = classify({ ...base, leave: halfCasual, attStatus: undefined });
check('no row at all      → 0.5CL/0.5A', noRow.code === '0.5CL/0.5A', noRow.code);

const nullRow = classify({ ...base, leave: halfCasual, attStatus: null });
check('null status        → 0.5CL/0.5A', nullRow.code === '0.5CL/0.5A', nullRow.code);

check('and it is still counted as leave, not turned into an absence',
  absent.kind === 'paidLeave' && noRow.kind === 'paidLeave', [absent.kind, noRow.kind]);

console.log('\n════ Nothing else moved ════\n');

const full = classify({ ...base, leave: fullCasual, attStatus: 'absent' });
check('a whole day of leave is still CL, with no half in it', full.code === 'CL', full.code);

const unpaidHalf = classify({
  ...base, leave: { leaveType: 'unpaid', isHalfDay: true }, attStatus: 'present' });
check('an unpaid half day still reads LOP', unpaidHalf.code === '0.5LOP/0.5P', unpaidHalf.code);
check('and is still unpaid leave', unpaidHalf.kind === 'unpaidLeave', unpaidHalf.kind);

const unknownType = classify({
  ...base, leave: { leaveType: 'sabbatical', isHalfDay: true }, attStatus: 'absent' });
check('a leave type with no code falls back to L', unknownType.code === '0.5L/0.5A', unknownType.code);

check('a plain present day is unaffected',
  classify({ ...base, leave: null, attStatus: 'present' }).code === 'P');
check('a plain absent day is unaffected',
  classify({ ...base, leave: null, attStatus: 'absent' }).code === 'A');
check('a future day is still blank',
  classify({ ...base, leave: halfCasual, attStatus: null, isFuture: true }).code === '-');
check('on duty still wins over leave',
  classify({ ...base, leave: halfCasual, attStatus: null, onDuty: true }).code === 'OD');

console.log('\n════ What the day is then worth ════\n');

/* The code is a label, but the sheet totals are computed from it. dayWeights in
 * the frontend splits on "/" and weighs each part, so the old 0.5CL/0.5P was
 * not merely mislabelled — it added half a WORKED day to the column totals for
 * a day nobody worked. This is the consequence worth asserting. */
const fw = fs.readFileSync(
  require.resolve('../frontend/src/pages/reports/attendanceCodes.js'), 'utf8');
const wFrom = fw.indexOf('const BUCKET');
const wTo = fw.indexOf('\n};', fw.indexOf('export const dayWeights')) + 3;
const dayWeights = new Function(`${fw.slice(wFrom, wTo).replace(/export /g, '')}
  return dayWeights;`)();

const worked = dayWeights('0.5CL/0.5P');
check('worked the other half → half worked, half paid off',
  worked.worked === 0.5 && worked.paidOff === 0.5 && worked.unpayable === 0, worked);

const notWorked = dayWeights('0.5CL/0.5A');
check('did not come in → half paid off, half unpayable, and NOTHING worked',
  notWorked.worked === 0 && notWorked.paidOff === 0.5 && notWorked.unpayable === 0.5, notWorked);

check('every day still adds up to one whole day',
  worked.worked + worked.paidOff === 1
  && notWorked.paidOff + notWorked.unpayable === 1, [worked, notWorked]);

const failed = checks.filter(c => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} passed\n`);
process.exit(failed ? 1 : 0);
