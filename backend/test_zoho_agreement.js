// Deciding whether Zoho and this system actually disagree about a day.
//
// This is the comparison the whole import exists to produce, so a false
// positive in it is worse than useless — it sends somebody to investigate a
// day that was never wrong, and a page of noise is how the real disagreement
// gets skipped over.
//
// One had already slipped through. Zoho writes the verdict at the END of the
// status, after whatever was granted on the day:
//
//     "Casual Leave(Second Half), 0.5 day Absent"
//
// Reading the front of that finds the word "Half" and expects our "half-day",
// when Zoho is saying half a day of leave plus half a day absent — which is
// exactly what this system recorded. The verdict is the tail; the fraction in
// front of it says whether it covers the whole day.
const fs = require('fs');

const checks = [];
const check = (l, ok, x) => { checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '   got ' + JSON.stringify(x)}`); };

// Lifted from the script rather than copied, so it cannot pass against a
// version the original has moved away from.
const src = fs.readFileSync(require.resolve('./zoho_restage.js'), 'utf8');
const from = src.indexOf('const agrees = (zoho, our) => {');
if (from < 0) throw new Error('agrees() not found in zoho_restage.js');
const body = src.slice(from, src.indexOf('\n      };', from) + 9);
const agrees = new Function(`${body}\n return agrees;`)();

// Every status string these two people's eight months actually produced.
const CASES = [
  ['Present',                                        'present',  true],
  ['Present',                                        'late',     true],
  ['Present',                                        'absent',   false],
  ['Present',                                        'half-day', false],
  ['Absent',                                         'absent',   true],
  ['Absent',                                         'present',  false],

  // The one that was being reported as a disagreement and is not.
  ['Casual Leave(Second Half), 0.5 day Absent',      'absent',   true],
  ['Casual Leave(Second Half), 0.5 day Absent',      'half-day', true],
  ['Casual Leave(First Half), 0.5 day Absent',       'leave',    true],
  ['Casual Leave(Second Half), 0.5 day Absent',      'present',  false],

  ['Permission(02:00 hours), 0.75 day Present',      'present',  true],
  ['Permission(02:00 hours), 0.75 day Present',      'late',     true],
  ['Permission(02:00 hours), 0.75 day Present',      'half-day', true],
  ['Permission(02:00 hours), 0.75 day Present',      'absent',   false],
];

console.log('\n════ The verdict is the tail of the string ════\n');
for (const [zoho, our, want] of CASES) {
  const got = agrees(zoho, our);
  check(`${zoho.padEnd(44)} vs ${our.padEnd(9)} → ${want ? 'agree' : 'DISAGREE'}`, got === want, got);
}

console.log('\n════ Days with no verdict to compare ════\n');

// Weekends, holidays and leave-only days say nothing about present or absent.
// null means "no opinion", which must not be mistaken for "disagrees" — false
// would put all 47 weekends on the disagreement list.
for (const s of ['Weekend', 'Happy New Year 2026(Holiday)', 'Casual Leave', '']) {
  const got = agrees(s, 'present');
  check(`${(s || '(empty)').padEnd(44)} has no opinion`, got === null, got);
}

// The filter in the script keeps `=== false`, so null never counts as a clash.
const noisy = ['Weekend', 'Casual Leave', 'Pongal Thirunal 2026(Holiday)']
  .filter(s => agrees(s, 'present') === false);
check('none of those would land on the disagreement list', noisy.length === 0, noisy);

const failed = checks.filter(c => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} passed\n`);
process.exit(failed ? 1 : 0);
