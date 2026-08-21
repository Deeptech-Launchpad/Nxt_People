// Loss of pay carried between pay periods.
//
// The arithmetic is the whole feature, and it decides what somebody is paid, so
// this drives it with a stubbed source of raw LOP rather than seeded leave —
// every case is then exact and there is no argument about what the input was.
//
// The first thing proved is that with carry-over OFF the behaviour is byte for
// byte what it is today. This is a pay figure; "off" has to mean off.
require('dotenv').config();
const pool = require('./db');
const { lopForPeriod, resolve } = require('./utils/lopCarryOver');

const checks = [];
const check = (l, ok, x) => { checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '\n          ' + JSON.stringify(x)}`); };

// A calendar month, so the periods in these cases are obvious.
const MONTHLY = { startDay: 1, endDay: 32 };

// Raw LOP per month, keyed by the month a range starts in.
const source = (byMonth) => async (start) => byMonth[String(start).slice(0, 7)] || 0;

const cfg = (extra) => ({ lossOfPay: { unpaidLeave: 'carry_over', maxPerPeriod: 3, ...extra } });

const run = (byMonth, c, on = '2019-03-15') =>
  lopForPeriod(pool, { employeeId: 'x', on, cfg: c, rawFor: source(byMonth), period: MONTHLY });

(async () => {
  console.log('\n════ Off behaves exactly as it does today ════\n');

  let r = await run({ '2019-03': 5 }, { lossOfPay: { unpaidLeave: 'lop', maxPerPeriod: 3 } });
  check('five unpaid days against a cap of three charges three',
    r.charged === 3, r);
  check('the other two are waived, not carried',
    r.waived === 2 && r.carriedOut === 0, r);

  r = await run({ '2019-03': 5 }, { lossOfPay: { unpaidLeave: 'lop', maxPerPeriod: null } });
  check('a blank cap charges everything', r.charged === 5 && r.waived === 0, r);

  r = await run({ '2019-03': 5 }, { lossOfPay: { unpaidLeave: 'lop', maxPerPeriod: 0 } });
  check('a cap of zero is a real cap, not a blank one',
    r.charged === 0 && r.waived === 5, r);

  console.log('\n════ On, the excess moves instead of evaporating ════\n');

  r = await run({ '2019-03': 5 }, cfg());
  check('three of the five are charged this period', r.charged === 3, r);
  check('two carry to the next period, none are waived',
    r.carriedOut === 2 && r.waived === 0, r);

  r = await run({ '2019-02': 5, '2019-03': 0 }, cfg());
  check('the two carried in are charged the following period', r.charged === 2, r);
  check('and the period had no unpaid leave of its own', r.raw === 0, r);
  check('with the balance opening at two', r.carriedIn === 2, r);
  check('and nothing left over', r.carriedOut === 0, r);

  console.log('\n════ The busy month and the spread month now cost the same ════\n');

  const busy = await run({ '2019-01': 5, '2019-02': 0, '2019-03': 0 }, cfg({ carryExpiry: 'never' }), '2019-03-15');
  const spreadA = await run({ '2019-01': 3, '2019-02': 2, '2019-03': 0 }, cfg({ carryExpiry: 'never' }), '2019-01-15');
  const spreadB = await run({ '2019-01': 3, '2019-02': 2, '2019-03': 0 }, cfg({ carryExpiry: 'never' }), '2019-02-15');
  // Five days taken at once: 3 charged in January, 2 in February, 0 by March.
  check('the whole five are eventually charged either way',
    busy.carriedOut === 0 && spreadA.charged + spreadB.charged === 5,
    { busy, spreadA: spreadA.charged, spreadB: spreadB.charged });

  console.log('\n════ Oldest days are charged first ════\n');

  // 4 in January (3 charged, 1 carried), then 2 in February. February should
  // charge the January leftover before its own days.
  r = await run({ '2019-01': 4, '2019-02': 2 }, cfg({ carryExpiry: 'never' }), '2019-02-15');
  check('the carried day is charged before the new ones',
    r.carriedIn === 1 && r.charged === 3, r);
  check('leaving the newer day to carry', r.carriedOut === 0, r);

  console.log('\n════ Expiry ════\n');

  // 9 days in January against a cap of 3: 3 charged, 6 carried. With expiry
  // after one period, whatever is still uncharged the period after is dropped.
  const expiring = await run({ '2019-01': 9 }, cfg({ carryExpiry: 'one_period' }), '2019-02-15');
  check('a carried day still uncharged next period expires',
    expiring.expired > 0, expiring);

  const forever = await run({ '2019-01': 9 }, cfg({ carryExpiry: 'never' }), '2019-02-15');
  check('with no expiry it keeps moving instead',
    forever.expired === 0 && forever.carriedOut === 3, forever);

  const later = await run({ '2019-01': 9 }, cfg({ carryExpiry: 'never' }), '2019-03-15');
  check('and is finally cleared once there is room', later.carriedOut === 0, later);

  console.log('\n════ No cap means nothing to carry ════\n');

  r = await run({ '2019-03': 12 }, cfg({ maxPerPeriod: null }));
  check('every day is charged in the period it happened',
    r.charged === 12 && r.carriedOut === 0, r);

  console.log('\n════ Fractions survive ════\n');

  r = await run({ '2019-03': 3.5 }, cfg());
  check('half days carry as half days', r.charged === 3 && r.carriedOut === 0.5, r);

  console.log('\n════ Reading the settings ════\n');

  check('an unsaved policy does not carry anything',
    resolve({}).carryOver === false);
  check('a blank cap reads as no cap, not as zero',
    resolve({ lossOfPay: { maxPerPeriod: '' } }).maxPerPeriod === null);
  check('a cap of zero survives as zero',
    resolve({ lossOfPay: { maxPerPeriod: 0 } }).maxPerPeriod === 0);
  check('expiry defaults to one period rather than forever',
    resolve({ lossOfPay: {} }).expiry === 'one_period');

  const failed = checks.filter(c => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed\n`);
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch(async e => { console.error(e); process.exit(1); });
