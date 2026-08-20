// The day-classification rule, checked against Zoho's own worked examples.
//
// Zoho's documentation gives two figures outright — 7 hours against an 8-hour
// expectation, and 5 hours against the same — and states the result for each.
// Those are the two cases below that are not mine, so they are the ones that
// prove this is Zoho's rule and not my reading of it.
const { classifyDay, expectedFor } = require('./utils/attendanceRule');

const checks = [];
const check = (label, ok, got) => {
  checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n          got ${JSON.stringify(got)}`}`);
};
const eq = (label, got, want) =>
  check(label, JSON.stringify(got) === JSON.stringify(want), got);

const STRICT = { strictMode: true, expectedFullDay: 8, expectedHalfDay: 4, allowOvertimeAndDeviation: true };
const LENIENT = { ...STRICT, strictMode: false };
const day = (h, cfg = STRICT, extra = {}) =>
  classifyDay({ workedHours: h, hasPunch: h > 0, cfg, ...extra });

console.log('\n════ Strict — Zoho\'s two documented examples ════\n');

// "if someone is present for 7 hours, the system marks it as half-day present
//  and half-day absent with 1 hour deficit"
const seven = day(7);
eq('7h against 8h expected is half present and half absent',
  { present: seven.present, absent: seven.absent }, { present: 0.5, absent: 0.5 });
check('and records a 1 hour deficit', seven.deficit === 1, seven.deficit);

// "If someone is present for 5 hours, it shows as half-day present and
//  half-day absent with a 3-hour deficit"
const five = day(5);
eq('5h is also half present and half absent',
  { present: five.present, absent: five.absent }, { present: 0.5, absent: 0.5 });
check('and records a 3 hour deficit', five.deficit === 3, five.deficit);

console.log('\n════ Strict — the boundaries ════\n');

check('exactly 8h is a full present day', day(8).present === 1, day(8));
check('8.5h is a full day and 0.5h of overtime',
  day(8.5).present === 1 && day(8.5).overtime === 0.5, day(8.5));
check('a full day records no deficit', day(8).deficit === 0, day(8).deficit);
check('exactly 4h is still half present', day(4).present === 0.5, day(4));
check('3.99h is fully absent', day(3.99).absent === 1, day(3.99));
check('the split always adds up to one day',
  [0, 2, 4, 6, 7.99, 8, 12].every(h => day(h).present + day(h).absent === 1));

// This is the case that was wrong before: 7.6h passed our old 7.5h threshold
// and was called a full present day, while the payable report still expected 8.
const seventySix = day(7.6);
check('7.6h is a half day, not a full one — it is short of the expected 8h',
  seventySix.present === 0.5 && seventySix.status === 'half-day', seventySix);

console.log('\n════ Lenient — the punch decides ════\n');

check('2h worked is still a full present day', day(2, LENIENT).present === 1, day(2, LENIENT));
check('so is 30 minutes', day(0.5, LENIENT).present === 1, day(0.5, LENIENT));
check('but the shortfall is still reported', day(2, LENIENT).deficit === 6, day(2, LENIENT).deficit);
check('no punch at all is absent, in lenient mode too',
  classifyDay({ workedHours: 0, hasPunch: false, cfg: LENIENT }).absent === 1);
check('lenient never produces a half day',
  [0.5, 2, 4, 7, 7.99].every(h => day(h, LENIENT).status !== 'half-day'));

console.log('\n════ Deviation tracking is a choice, and off means unmeasured ════\n');

const untracked = day(6, { ...STRICT, allowOvertimeAndDeviation: false });
check('with the setting off, deficit is null — not zero',
  untracked.deficit === null && untracked.overtime === null, untracked);
check('but the day is still classified', untracked.present === 0.5, untracked);

console.log('\n════ Labels ════\n');

check('a full day past the grace period is late',
  day(9, STRICT, { lateMinutes: 20, graceMinutes: 15 }).status === 'late');
check('within grace it is simply present',
  day(9, STRICT, { lateMinutes: 10, graceMinutes: 15 }).status === 'present');
check('a short day is a half day whether or not it was late',
  day(5, STRICT, { lateMinutes: 90, graceMinutes: 15 }).status === 'half-day');

console.log('\n════ Expected hours per employee ════\n');

eq('manual mode uses the org figures',
  expectedFor(STRICT), { full: 8, half: 4 });
eq('shift mode takes the length of the employee\'s own shift',
  expectedFor({ ...STRICT, expectedMode: 'shift' }, 8.5), { full: 8.5, half: 4 });
eq('shift mode falls back to the org figure when the shift is unknown',
  expectedFor({ ...STRICT, expectedMode: 'shift' }, null), { full: 8, half: 4 });
check('a zero-length shift is treated as no shift, not a zero-hour day',
  expectedFor({ ...STRICT, expectedMode: 'shift' }, 0).full === 8, expectedFor({ ...STRICT, expectedMode: 'shift' }, 0));

eq('a half day longer than a full day cannot mark everyone absent',
  expectedFor({ expectedFullDay: 6, expectedHalfDay: 9 }), { full: 6, half: 6 });

console.log('\n════ Defaults are safe ════\n');

check('an unsaved policy classifies strictly rather than marking everyone present',
  classifyDay({ workedHours: 2, hasPunch: true, cfg: {} }).present !== 1,
  classifyDay({ workedHours: 2, hasPunch: true, cfg: {} }));
check('and falls back to 8h and 4h',
  classifyDay({ workedHours: 5, hasPunch: true, cfg: {} }).expected === 8);

const failed = checks.filter(c => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} passed\n`);
process.exit(failed ? 1 : 0);
