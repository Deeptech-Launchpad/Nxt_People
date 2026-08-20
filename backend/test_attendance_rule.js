// The day-classification engine.
//
// Two things have to hold at once: Zoho's presets must still behave exactly as
// Zoho documents them, and this org's own rule — a short day is absent, no
// tolerance — must behave as HR stated it. If one engine can do both, the
// Custom mode is worth having; if it cannot, it is not.
//
// Zoho's documentation gives two figures outright (7 hours and 5 hours against
// an 8-hour expectation) and states the result for each. Those two cases are
// the ones I did not invent, so they are what prove this is Zoho's rule.
const { classifyDay, expectedFor, resolvePolicy } = require('./utils/attendanceRule');

const checks = [];
const check = (label, ok, got) => {
  checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n          got ${JSON.stringify(got)}`}`);
};
const eq = (label, got, want) =>
  check(label, JSON.stringify(got) === JSON.stringify(want), got);
const split = (r) => ({ present: r.present, absent: r.absent, leave: r.leave });

const BASE = { expectedFullDay: 8, expectedHalfDay: 4, allowOvertimeAndDeviation: true };
const STRICT = { ...BASE, mode: 'strict' };
const LENIENT = { ...BASE, mode: 'lenient' };
// HR's rule: eight hours needed, no tolerance, a short day is absent outright.
const OURS = { ...BASE, mode: 'custom', shortDayBecomes: 'absent', toleranceMinutes: 0 };

const day = (h, cfg = STRICT, extra = {}) =>
  classifyDay({ workedHours: h, hasPunch: h > 0, cfg, ...extra });

console.log('\n════ Zoho Strict — the two documented examples ════\n');

// "if someone is present for 7 hours, the system marks it as half-day present
//  and half-day absent with 1 hour deficit"
eq('7h against 8h expected is half present and half absent',
  split(day(7)), { present: 0.5, absent: 0.5, leave: 0 });
check('and records a 1 hour deficit', day(7).deficit === 1, day(7).deficit);

// "If someone is present for 5 hours, it shows as half-day present and
//  half-day absent with a 3-hour deficit"
eq('5h is also half present and half absent',
  split(day(5)), { present: 0.5, absent: 0.5, leave: 0 });
check('and records a 3 hour deficit', day(5).deficit === 3, day(5).deficit);

check('exactly 8h is a full present day', day(8).present === 1, day(8));
check('exactly 4h is still half present', day(4).present === 0.5, day(4));
check('3.99h is fully absent under Zoho too', day(3.99).absent === 1, day(3.99));
check('8.5h is a full day and 0.5h of overtime',
  day(8.5).present === 1 && day(8.5).overtime === 0.5, day(8.5));

console.log('\n════ Zoho Lenient — the punch decides ════\n');

check('2h worked is still a full present day', day(2, LENIENT).present === 1, day(2, LENIENT));
check('but the shortfall is still reported', day(2, LENIENT).deficit === 6, day(2, LENIENT).deficit);
check('no punch at all is absent, in lenient mode too',
  classifyDay({ workedHours: 0, hasPunch: false, cfg: LENIENT }).absent === 1);
check('lenient never produces a half day',
  [0.5, 2, 4, 7, 7.99].every(h => day(h, LENIENT).present === 1));

console.log("\n════ This org's rule — 8h, no tolerance, short is absent ════\n");

check('8h exactly is present', day(8, OURS).present === 1, day(8, OURS));
check('7h55m is a lost day — absent, not a half day',
  day(7 + 55 / 60, OURS).absent === 1 && day(7 + 55 / 60, OURS).status === 'absent',
  day(7 + 55 / 60, OURS));
check('7h is absent, where Zoho would give half a day',
  day(7, OURS).absent === 1 && day(7, STRICT).present === 0.5, day(7, OURS));
check('no half day is ever produced from hours alone',
  [0.5, 2, 4, 5, 7, 7.99].every(h => day(h, OURS).present === 0), 'a half day appeared');
check('the shortfall is still reported', day(7, OURS).deficit === 1, day(7, OURS).deficit);

console.log('\n════ Permission reduces what is owed ════\n');

// HR: "2h permission + works 6h → Present"
const perm = day(6, OURS, { permissionHours: 2 });
check('2h permission and 6h worked is PRESENT', perm.present === 1 && perm.absent === 0, perm);
check('what they owed that day was 6h, not 8h', perm.owed === 6, perm.owed);
check('4h permission and 4h worked is present too',
  day(4, OURS, { permissionHours: 4 }).present === 1, day(4, OURS, { permissionHours: 4 }));
check('but 5h worked against 2h permission is still short',
  day(5, OURS, { permissionHours: 2 }).absent === 1, day(5, OURS, { permissionHours: 2 }));
check('without permission reducing the requirement, the same day is absent',
  day(6, { ...OURS, permissionReducesExpected: false }, { permissionHours: 2 }).absent === 1);

console.log('\n════ Half-day leave ════\n');

const halfLeave = day(4, OURS, { leavePortion: 0.5 });
check('half-day leave halves what is owed to 4h', halfLeave.owed === 4, halfLeave.owed);
eq('working the other half properly is half present, half leave',
  split(halfLeave), { present: 0.5, absent: 0, leave: 0.5 });

const halfLeaveShort = day(2, OURS, { leavePortion: 0.5 });
eq('working only 2h of the owed 4h makes the working half absent',
  split(halfLeaveShort), { present: 0, absent: 0.5, leave: 0.5 });

// The setting that decides where the leave half is counted.
const asAbsent = day(4, { ...OURS, halfDayLeaveOtherHalf: 'absent' }, { leavePortion: 0.5 });
eq('with the other-half setting on absent, the leave half is counted absent',
  split(asAbsent), { present: 0.5, absent: 0.5, leave: 0 });

check('the portions always add up to one day',
  [0, 2, 4, 6, 8].every(h => [0, 0.5].every(l => {
    const r = day(h, OURS, { leavePortion: l });
    return Math.abs(r.present + r.absent + r.leave - 1) < 0.001;
  })));

console.log('\n════ The status stays inside the vocabulary the reports know ════\n');

// Reports map 'present'/'late' to P and 'half-day' to HD, and read anything
// they do not recognise as absent. A status this engine invented would
// therefore be silently wrong everywhere it appeared.
const KNOWN = ['present', 'late', 'half-day', 'absent', 'leave'];
const everyShape = [];
for (const cfg of [STRICT, LENIENT, OURS]) {
  for (const h of [0, 1, 3.99, 4, 5, 7, 7.99, 8, 9]) {
    for (const lv of [0, 0.5, 1]) {
      for (const perm of [0, 2]) {
        for (const od of [false, true]) {
          everyShape.push(classifyDay({ workedHours: h, hasPunch: h > 0,
            leavePortion: lv, permissionHours: perm, onDuty: od, cfg }).status);
        }
      }
    }
  }
}
const unknown = [...new Set(everyShape)].filter(x => !KNOWN.includes(x));
check(`every combination returns a known status (${everyShape.length} checked)`,
  unknown.length === 0, unknown);
check('half-day leave worked properly reads as a half day, not a full one',
  day(4, OURS, { leavePortion: 0.5 }).status === 'half-day',
  day(4, OURS, { leavePortion: 0.5 }));

console.log('\n════ A full day of leave is not judged ════\n');

const onLeave = day(0, OURS, { leavePortion: 1 });
eq('a full-day leave is leave, not absence',
  split(onLeave), { present: 0, absent: 0, leave: 1 });
check('and nothing is owed, so no deficit is invented', onLeave.owed === 0 && onLeave.deficit === null, onLeave);

console.log('\n════ On duty ════\n');

// HR: the 8-hour rule applies to on-duty and WFH.
const onDutyShort = classifyDay({ workedHours: 5, hasPunch: true, onDuty: true, cfg: OURS });
check('an on-duty day short of 8h is absent, as HR asked',
  onDutyShort.absent === 1, onDutyShort);
check('unless the exemption is switched on',
  classifyDay({ workedHours: 5, hasPunch: true, onDuty: true,
    cfg: { ...OURS, exemptOnDuty: true } }).present === 1);
check('an on-duty day with no punch at all is not automatically absent when exempt',
  classifyDay({ workedHours: 0, hasPunch: false, onDuty: true,
    cfg: { ...OURS, exemptOnDuty: true } }).present === 1);

console.log('\n════ Tolerance ════\n');

check('with 10 minutes tolerance, 7h55m becomes present',
  day(7 + 55 / 60, { ...OURS, toleranceMinutes: 10 }).present === 1);
check('but 7h45m still is not',
  day(7.75, { ...OURS, toleranceMinutes: 10 }).absent === 1);
check('tolerance cannot be negative',
  resolvePolicy({ mode: 'custom', toleranceMinutes: -30 }).toleranceMinutes === 0);

console.log('\n════ Deviation tracking is a choice ════\n');

const untracked = day(6, { ...OURS, allowOvertimeAndDeviation: false });
check('with the setting off, deficit is null — not zero',
  untracked.deficit === null && untracked.overtime === null, untracked);
check('but the day is still classified', untracked.absent === 1, untracked);

console.log('\n════ Presets and defaults ════\n');

check('an unsaved policy is Strict, not Lenient',
  resolvePolicy({}).mode === 'strict' && resolvePolicy({}).punchIsEnough === false);
check('the older strictMode:false flag still selects Lenient',
  resolvePolicy({ strictMode: false }).mode === 'lenient');
check('an unknown mode falls back rather than throwing',
  resolvePolicy({ mode: 'nonsense' }).mode === 'strict');
check('custom defaults to absent, which is this org\'s rule',
  resolvePolicy({ mode: 'custom' }).shortDayBecomes === 'absent');
check('a day with no punch and no leave is absent under every preset',
  [STRICT, LENIENT, OURS].every(c =>
    classifyDay({ workedHours: 0, hasPunch: false, cfg: c }).absent === 1));

console.log('\n════ Expected hours per employee ════\n');

eq('manual mode uses the org figures', expectedFor(BASE), { full: 8, half: 4 });
// The reference states both: "Full day: Duration of the shift" and
// "Half day: Half of the shift duration". Keeping the org's 4h half day against
// an 8.5h shift would let somebody clear the half-day bar far too easily.
eq("shift mode takes the length of the employee's own shift",
  expectedFor({ ...BASE, expectedMode: 'shift' }, 8.5), { full: 8.5, half: 4.25 });
eq('and halves that shift for the half day, not the org figure',
  expectedFor({ ...BASE, expectedMode: 'shift' }, 9), { full: 9, half: 4.5 });
eq('shift mode falls back to the org figure when the shift is unknown',
  expectedFor({ ...BASE, expectedMode: 'shift' }, null), { full: 8, half: 4 });
check('a zero-length shift is treated as no shift, not a zero-hour day',
  expectedFor({ ...BASE, expectedMode: 'shift' }, 0).full === 8);
eq('a half day longer than a full day cannot mark everyone absent',
  expectedFor({ expectedFullDay: 6, expectedHalfDay: 9 }), { full: 6, half: 6 });

const failed = checks.filter(c => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} passed\n`);
process.exit(failed ? 1 : 0);
