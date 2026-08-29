// How much leave a policy has granted by now.
//
// Shivanie's permission balance read 20.5 hours in NxtPeople and 36.5 in Zoho,
// for the same employee, the same policy and the same 11.5 hours taken. Two
// differences, both in the granting:
//
//   We counted only the months that had happened — January to August, 8 × 4 =
//   32 — on the reasoning that September's allowance is not spendable in
//   August. The reference grants all twelve up front: 48.
//
//   Zoho charges a joining month by the days actually worked. Balaji joined on
//   3 January and Zoho granted him 3.74 hours for it: 4 × 29/31.
//
// The first was matched. The second was matched and then deliberately undone:
// pro-rating is what made a balance read 29.74 where 30 was expected, and the
// decision was that a month is a month whichever day of it somebody starts on.
// So the year is Zoho's and the joining month is not, and these assert both
// exactly — a joining month is 4, not "about four".
require('dotenv').config();

const { accrualEvents, grantedToDate } = require('./utils/leavePolicy');

const checks = [];
const check = (l, ok, x) => { checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '   got ' + JSON.stringify(x)}`); };

const monthly = (amount) => ({ accrualMode: 'monthly', accrualAmount: amount });
const annual = (amount) => ({ accrualMode: 'annual', accrualAmount: amount });
const total = (policy, opts) => grantedToDate(policy, { year: 2026, ...opts });

console.log('\n════ The whole year, not the year so far ════\n');

check('twelve monthly accruals of 4 hours is 48, whatever month it is today',
  total(monthly(4), {}) === 48, total(monthly(4), {}));
check('and not 32, which is what stopping at August gave',
  total(monthly(4), {}) !== 32);
check('a caller that asks for a cut-off still gets one',
  total(monthly(4), { upToMonth: 8 }) === 32, total(monthly(4), { upToMonth: 8 }));

console.log('\n════ The joining month is granted whole ════\n');

// Balaji: joined 3 January 2026, 4 hours a month.
const balaji = total(monthly(4), { joiningDate: '2026-01-03' });
check('joining on 3 January grants the full 48 hours', balaji === 48, balaji);
check('and not 47.74, which is what charging January by the day gave',
  balaji !== 47.74);

const events = accrualEvents(monthly(4), { year: 2026, joiningDate: '2026-01-03' });
check('twelve accruals, one per month', events.length === 12, events.length);
check('January is a whole 4, not 3.74', events[0].amount === 4, events[0]);
check('February is whole too', events[1].amount === 4, events[1]);
check('and January is still dated the joining day, not the 1st',
  events[0].date === '2026-01-03', events[0].date);

check('joining on the 1st grants the same as joining on the 3rd',
  total(monthly(4), { joiningDate: '2026-01-01' }) === balaji,
  total(monthly(4), { joiningDate: '2026-01-01' }));

// February 2026 has 28 days. Under the old rule a join on the 15th gave
// 4 × 14/28 = 2; the month is now whole however short the month is.
const feb = accrualEvents(monthly(4), { year: 2026, joiningDate: '2026-02-15' });
check('February the 15th grants a whole 4, not 2', feb[0].amount === 4, feb[0]);
check('and the year then runs February to December — eleven accruals',
  feb.length === 11, feb.length);
check('so a February joiner has 44, not 42',
  total(monthly(4), { joiningDate: '2026-02-15' }) === 44,
  total(monthly(4), { joiningDate: '2026-02-15' }));

console.log('\n════ Joining mid-year ════\n');

const july = total(monthly(4), { joiningDate: '2026-07-01' });
check('joining 1 July grants six whole months', july === 24, july);

const nextYear = total(monthly(4), { joiningDate: '2027-03-01' });
check('somebody who has not joined yet is granted nothing', nextYear === 0, nextYear);

const earlier = total(monthly(4), { joiningDate: '2023-11-01' });
check('somebody who joined years ago gets the full year',
  earlier === 48, earlier);

console.log('\n════ Nothing else moved ════\n');

check('an annual allocation is still granted whole',
  total(annual(12), { joiningDate: '2026-01-03' }) === 12,
  total(annual(12), { joiningDate: '2026-01-03' }));
check('an annual allocation is not prorated by joining day either',
  total(annual(12), { joiningDate: '2026-06-20' }) === 12);
check('a per-employee amount still overrides the policy',
  total(annual(12), { annualAmount: 18 }) === 18, total(annual(12), { annualAmount: 18 }));
check('a type with no entitlement still reports null, not zero',
  total({ accrualMode: 'none' }, {}) === null);
check('an earned type still counts its own events',
  total({ accrualMode: 'earned' }, { earnedAmount: 2.5 }) === 2.5);

console.log('\n════ Shivanie and Balaji, the two who were checked by hand ════\n');

check('Shivanie: 48 granted − 11.5 taken = 36.5',
  Math.round((total(monthly(4), { joiningDate: '2023-11-01' }) - 11.5) * 100) / 100 === 36.5);
check('Balaji: 48 granted − 2 taken = 46, where the card read 29.74',
  Math.round((total(monthly(4), { joiningDate: '2026-01-03' }) - 2) * 100) / 100 === 46);

const failed = checks.filter(c => !c).length;
console.log(`\n${checks.length - failed}/${checks.length} passed\n`);
process.exit(failed ? 1 : 0);
