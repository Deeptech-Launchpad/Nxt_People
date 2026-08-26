/* ── The balance a screen shows has to be the balance they can take ─────────
 *  Customize Balance showed each leave type's ANNUAL MAXIMUM whenever nobody
 *  had stored a figure — so a hundred and fifty people all read "12" and the
 *  column meant nothing. A balance is not a constant: it is what the policy has
 *  granted by today minus what has been taken, and for a monthly accrual it
 *  moves every month and depends on the joining date.
 *
 *  Two screens now share one calculation, and Customize Policy shows its
 *  working as a ledger. What has to hold:
 *
 *    an annual grant arrives whole; a monthly one only up to the month reached
 *    the joining month is prorated by the day, as Zoho does
 *    permission is counted in hours, everything else in days
 *    the running balance is arithmetic, not a per-row guess
 *    a stored figure is an OVERRIDE and wins - it exists because somebody
 *      corrected something, and recomputing over it would undo that silently
 *
 *  Pure arithmetic. No database, no clock, no network.
 * ────────────────────────────────────────────────────────────────────────── */
const { ledgerFor } = require('./utils/leaveLedger');

const checks = [];
const check = (l, ok, x) => { checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '\n          ' + JSON.stringify(x).slice(0, 300)}`); };

const annual  = { code: 'casual', name: 'Casual Leave', unit: 'days', payType: 'paid', accrualMode: 'annual', accrualAmount: 12 };
const monthly = { code: 'permission', name: 'Permission', unit: 'hours', payType: 'paid', accrualMode: 'monthly', accrualAmount: 4 };
const none    = { code: 'unpaid', name: 'Leave Without Pay', unit: 'days', payType: 'unpaid', accrualMode: 'none', accrualAmount: 0 };
const earned  = { code: 'comp_off', name: 'Compensatory Off', unit: 'days', payType: 'comp_off', accrualMode: 'earned', accrualAmount: 0 };

const OLD = { joiningDate: '2022-05-01' };   // here well before the year
const NEW = { joiningDate: '2026-03-10' };   // joined mid-year

const day = (d, days, reason) => ({ startDate: d, totalDays: days, hours: null, reason });
const hrs = (d, h, reason) => ({ startDate: d, totalDays: 0, hours: h, reason });

(async () => {
  console.log('\n════ An annual grant ════\n');

  const a = ledgerFor(annual, OLD, [day('2026-01-13', 1), day('2026-03-02', 1)], { year: 2026, upToMonth: 8 });
  check('the whole year is granted at once, not month by month', a.granted === 12, a.granted);
  check('two days taken', a.used === 2, a.used);
  check('so ten remain', a.balance === 10, a.balance);
  check('the ledger holds one accrual and two leaves', a.events.length === 3, a.events.map(e => e.type));
  check('and the running balance walks 12, 11, 10',
    a.events.map(e => e.balance).join(',') === '12,11,10', a.events.map(e => e.balance));
  check('the accrual comes first, before leave taken on a later date',
    a.events[0].type === 'accrual', a.events[0]);

  console.log('\n════ A monthly accrual ════\n');

  // Eight months reached, four hours a month, nothing taken.
  const m = ledgerFor(monthly, OLD, [], { year: 2026, upToMonth: 8 });
  check('only the months reached are granted', m.granted === 32, m.granted);
  check('not the whole year', m.granted !== 48, m.granted);
  check('one accrual row per month', m.events.length === 8, m.events.length);

  // The bug this whole file exists for: a constant instead of a calculation.
  const wholeYear = ledgerFor(monthly, OLD, [], { year: 2026, upToMonth: 12 });
  check('and December is a different figure from August',
    wholeYear.granted !== m.granted, { august: m.granted, december: wholeYear.granted });

  console.log('\n════ Joining part-way through ════\n');

  // Joined 10 March: March is charged for 22 of its 31 days, then April to
  // August whole. 4 x 22/31 = 2.84, plus five whole months = 22.84.
  const j = ledgerFor(monthly, NEW, [], { year: 2026, upToMonth: 8 });
  check('nothing accrues before they joined',
    j.events.every(e => e.date >= '2026-03-01'), j.events.map(e => e.date));
  check('the joining month is prorated by the day, not granted whole',
    j.events[0].added < 4 && j.events[0].added > 0, j.events[0]);
  check('and every later month is whole',
    j.events.slice(1).every(e => e.added === 4), j.events.map(e => e.added));
  check('somebody who joined in March has less than somebody who was here all year',
    j.granted < m.granted, { joinedMarch: j.granted, hereAllYear: m.granted });

  console.log('\n════ Hours are not days ════\n');

  const p = ledgerFor(monthly, OLD, [hrs('2026-02-11', 2), hrs('2026-04-02', 1.5)], { year: 2026, upToMonth: 8 });
  check('permission is counted in its own unit', p.used === 3.5, p.used);
  check('and the unit says so', p.unit === 'hours', p.unit);
  check('balance is granted minus used', p.balance === 28.5, p.balance);

  console.log('\n════ Types with no entitlement ════\n');

  const u = ledgerFor(none, OLD, [day('2026-02-17', 1)], { year: 2026, upToMonth: 8 });
  check('Loss of Pay grants nothing', u.granted === 0, u.granted);
  check('but what was taken is still counted', u.used === 1, u.used);
  // The old screen printed 999 here — the type's max_days_per_year — which
  // reads as an allowance nobody has.
  check('and the balance is not a made-up allowance', u.balance === -1, u.balance);

  const e = ledgerFor(earned, OLD, [], { year: 2026, upToMonth: 8, earnedAmount: 2 });
  check('an earned type is credited by its own events', e.granted === 2, e.granted);
  const e0 = ledgerFor(earned, OLD, [], { year: 2026, upToMonth: 8, earnedAmount: 0 });
  check('and shows nothing when nothing was earned', e0.granted === 0 && e0.events.length === 0, e0);

  console.log('\n════ A stored figure is an override ════\n');

  const o = ledgerFor(annual, OLD, [day('2026-01-13', 1)], { year: 2026, upToMonth: 8, stored: 5 });
  check('the stored figure is what they may take', o.balance === 5, o.balance);
  check('the calculation is still reported beside it', o.computed === 11, o.computed);
  check('and the screen can tell they were corrected', o.overridden === true, o);

  const n = ledgerFor(annual, OLD, [day('2026-01-13', 1)], { year: 2026, upToMonth: 8 });
  check('without one, nothing claims to be an override', n.overridden === false, n);
  check('and the balance is the calculation', n.balance === n.computed, n);

  // Zero is a real override and must not be mistaken for "nothing stored".
  const z = ledgerFor(annual, OLD, [], { year: 2026, upToMonth: 8, stored: 0 });
  check('a stored ZERO is an override, not an absence',
    z.balance === 0 && z.overridden === true, z);

  console.log('\n════ A year before they existed ════\n');

  const before = ledgerFor(monthly, NEW, [], { year: 2025, upToMonth: 12 });
  check('somebody who had not joined accrues nothing', before.granted === 0, before.granted);

  const failed = checks.filter(c => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed\n`);
  process.exit(failed ? 1 : 0);
})();
