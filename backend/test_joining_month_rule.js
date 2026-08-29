/* The joining month rule.
 *
 * Casual used to be granted whole to anybody, whenever they arrived — someone
 * starting on 20 December got the same twelve days as someone there since
 * January, and could book them. It now accrues by the month, and the month
 * somebody joined in counts only if enough of it was left.
 *
 * Two things this asserts that are easy to get wrong:
 *
 *   The exclusion window is a fixed number of DAYS, not a day of the month.
 *   "After the 24th" is seven days in August and four in February; the rule
 *   would quietly narrow through the year and nobody would notice.
 *
 *   Grandfathering is per leave type. Casual was an annual twelve, so anybody
 *   already on the books keeps twelve for their joining year. Permission has
 *   always accrued monthly, so its figures must not move at all — a change
 *   there would be a change nobody asked for.
 *
 * Pure arithmetic. No database, no clock, no network.
 */
require('dotenv').config();

const { accrualEvents, grantedToDate } = require('./utils/leavePolicy');

const checks = [];
const check = (l, ok, x) => { checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '   got ' + JSON.stringify(x)}`); };

const casual = { code: 'casual', accrualMode: 'monthly', accrualAmount: 1 };
const perm   = { code: 'permission', accrualMode: 'monthly', accrualAmount: 4 };

const RULE = {
  skipWhenShortMonth: true,
  minDaysRemaining: 7,
  appliesToJoinersFrom: '2026-08-25',
  grandfatherFullYear: ['casual'],
};

/* A rule everybody is subject to, for isolating the cut-off from the
   grandfather. Under the real rule an August joiner is grandfathered, so every
   day of the month would look excluded and the window test below would pass
   for entirely the wrong reason. */
const ALL_SUBJECT = { ...RULE, appliesToJoinersFrom: '2026-01-01', grandfatherFullYear: [] };

const got = (policy, joiningDate, rule = RULE) =>
  grantedToDate(policy, { year: 2026, joiningDate, joiningRule: rule });
const firstMonth = (policy, joiningDate, rule = RULE) => {
  const e = accrualEvents(policy, { year: 2026, joiningDate, joiningRule: rule });
  return e.length ? e[0].month : null;
};

console.log('\n════ The boundary, on the day it was set for ════\n');

// Logasundar T joined 25 August and was given 4 days by hand before this
// existed. The rule has to arrive at the same number on its own.
check('joined 25 Aug — 7 days remain — August does not count, so 4 days',
  got(casual, '2026-08-25') === 4, got(casual, '2026-08-25'));
// The 24th is measured with the grandfather out of the way. Under the real
// rule somebody joining 24 August is already on the books and keeps the whole
// twelve — asserted further down, and the two are not the same statement.
check('joined 24 Aug — 8 days remain — August counts, so 5 days',
  got(casual, '2026-08-24', ALL_SUBJECT) === 5, got(casual, '2026-08-24', ALL_SUBJECT));
check('and the first accrual moves from August to September across that line',
  firstMonth(casual, '2026-08-24', ALL_SUBJECT) === 8
    && firstMonth(casual, '2026-08-25', ALL_SUBJECT) === 9,
  [firstMonth(casual, '2026-08-24', ALL_SUBJECT), firstMonth(casual, '2026-08-25', ALL_SUBJECT)]);

console.log('\n════ The window is 7 days wide in every month ════\n');

// A day-of-the-month cut-off would be seven days in a 31-day month and four in
// February. Counting days remaining keeps it the same rule all year.
for (const [month, days] of [[2, 28], [4, 30], [8, 31]]) {
  const excluded = [];
  for (let d = 1; d <= days; d++) {
    const j = `2026-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (firstMonth(casual, j, ALL_SUBJECT) !== month) excluded.push(d);
  }
  check(`month ${month} (${days} days): excludes ${excluded.length} days, ${excluded[0]}–${excluded[excluded.length - 1]}`,
    excluded.length === 7, excluded);
}

console.log('\n════ Grandfathering, which is per type ════\n');

// Joined before the rule's start date.
check('casual keeps the whole twelve for a February joiner already on the books',
  got(casual, '2026-02-03') === 12, got(casual, '2026-02-03'));
check('and for one who joined the day before the rule starts',
  got(casual, '2026-08-24') === 12, got(casual, '2026-08-24'));
check('permission is NOT grandfathered — a February joiner keeps 44h, unchanged',
  got(perm, '2026-02-03') === 44, got(perm, '2026-02-03'));
check('permission for an August joiner already on the books stays 20h',
  got(perm, '2026-08-04') === 20, got(perm, '2026-08-04'));

// On or after the start date the rule applies to both.
check('a September joiner gets 4 casual days',
  got(casual, '2026-09-01') === 4, got(casual, '2026-09-01'));
check('and 16 permission hours',
  got(perm, '2026-09-01') === 16, got(perm, '2026-09-01'));

console.log('\n════ Nobody already here loses anything ════\n');

check('a full-year employee still has twelve',
  got(casual, '2023-04-01') === 12, got(casual, '2023-04-01'));
check('and forty-eight hours of permission',
  got(perm, '2023-04-01') === 48, got(perm, '2023-04-01'));
check('somebody who has not joined yet is granted nothing',
  got(casual, '2027-01-05') === 0, got(casual, '2027-01-05'));

// The year after joining, everybody is a full-year employee and the
// grandfather has nothing left to do.
const nextYear = grantedToDate(casual, { year: 2027, joiningDate: '2026-09-01', joiningRule: RULE });
check('a pro-rated joiner gets the full twelve the following year',
  nextYear === 12, nextYear);

console.log('\n════ Joining late in December ════\n');

check('joined 24 Dec — 8 days remain — one day earned',
  got(casual, '2026-12-24') === 1, got(casual, '2026-12-24'));
check('joined 25 Dec — 7 days remain — nothing earned this year',
  got(casual, '2026-12-25') === 0, got(casual, '2026-12-25'));

console.log('\n════ With the rule off, or missing ════\n');

const OFF = { skipWhenShortMonth: false, minDaysRemaining: 0, appliesToJoinersFrom: '2026-01-01', grandfatherFullYear: [] };
check('switching it off gives a 25 Aug joiner their August back',
  got(casual, '2026-08-25', OFF) === 5, got(casual, '2026-08-25', OFF));
check('no rule at all behaves the same — the joining month always counts',
  grantedToDate(casual, { year: 2026, joiningDate: '2026-08-25' }) === 5,
  grantedToDate(casual, { year: 2026, joiningDate: '2026-08-25' }));
// No start date means nobody is subject to the cut-off, so everybody falls
// under the grandfather instead and keeps the full year. Erring toward too
// much leave rather than too little is deliberate: an unexpectedly large
// balance is a conversation, an unexpectedly small one is somebody unable to
// book a day they were promised.
check('a rule with no start date binds nobody, so everyone keeps the full year',
  got(casual, '2026-08-25', { ...RULE, appliesToJoinersFrom: null }) === 12,
  got(casual, '2026-08-25', { ...RULE, appliesToJoinersFrom: null }));

const failed = checks.filter(c => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} passed\n`);
process.exit(failed ? 1 : 0);
