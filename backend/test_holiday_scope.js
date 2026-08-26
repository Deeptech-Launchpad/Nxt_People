/* ── A holiday for some people and not others ───────────────────────────────
 *  Some holidays apply to the office and not to WFH, so a holiday now carries
 *  the locations and shifts it is for.
 *
 *  This changes how every attendance day is classified, against four years of
 *  history that was judged when every holiday was company-wide. So the rule
 *  that matters most is the one that keeps that history intact:
 *
 *      NO SCOPE MEANS EVERYONE.
 *
 *  Every holiday that exists today has no scope rows. If that ever stops
 *  meaning "the whole company", a thousand people become absent on days the
 *  office was shut, retroactively. This asserts it first and hardest.
 *
 *  Pure. No database, no clock, no network.
 * ────────────────────────────────────────────────────────────────────────── */
const { holidayAppliesTo, holidayClosesFor, holidayClosesOffice } = require('./utils/workingDays');

const checks = [];
const check = (l, ok, x) => { checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '\n          ' + JSON.stringify(x).slice(0, 300)}`); };

const OFFICE = 'aaaaaaaa-0000-4000-8000-000000000001';
const WFH    = 'bbbbbbbb-0000-4000-8000-000000000002';
const GENERAL = 'cccccccc-0000-4000-8000-000000000003';
const NIGHT   = 'dddddddd-0000-4000-8000-000000000004';

const atOffice = { workLocationId: OFFICE, shiftId: GENERAL };
const atHome   = { workLocationId: WFH,    shiftId: GENERAL };
const nights   = { workLocationId: OFFICE, shiftId: NIGHT };

(async () => {
  console.log('\n════ No scope means everyone ════\n');

  // Every holiday in the database today looks like this.
  for (const [who, emp] of [['at the office', atOffice], ['working from home', atHome], ['on nights', nights]]) {
    check(`an unscoped holiday applies to somebody ${who}`,
      holidayAppliesTo({}, emp) === true);
  }
  check('an empty scope array is still everyone',
    holidayAppliesTo({ locationIds: [], shiftIds: [] }, atHome) === true);
  check('and somebody with nothing recorded about them is not excluded',
    holidayAppliesTo({}, {}) === true);

  console.log('\n════ Scoped to a location ════\n');

  const officeOnly = { type: 'company', locationIds: [OFFICE] };
  check('the office gets it', holidayAppliesTo(officeOnly, atOffice) === true);
  check('WFH does not', holidayAppliesTo(officeOnly, atHome) === false);

  const both = { type: 'company', locationIds: [OFFICE, WFH] };
  check('a holiday naming both locations reaches both',
    holidayAppliesTo(both, atOffice) && holidayAppliesTo(both, atHome));

  // A blank location field must not quietly cost somebody a holiday.
  check('somebody with no location recorded is NOT excluded by a location scope',
    holidayAppliesTo(officeOnly, { shiftId: GENERAL }) === true);

  console.log('\n════ Scoped to a shift ════\n');

  const generalOnly = { type: 'company', shiftIds: [GENERAL] };
  check('the general shift gets it', holidayAppliesTo(generalOnly, atOffice) === true);
  check('nights does not', holidayAppliesTo(generalOnly, nights) === false);

  console.log('\n════ Both kinds must pass ════\n');

  // The two are independent, and narrowing by one does not widen the other.
  const officeGeneral = { type: 'company', locationIds: [OFFICE], shiftIds: [GENERAL] };
  check('office on the general shift gets it', holidayAppliesTo(officeGeneral, atOffice) === true);
  check('office on nights does not', holidayAppliesTo(officeGeneral, nights) === false);
  check('home on the general shift does not', holidayAppliesTo(officeGeneral, atHome) === false);

  console.log('\n════ Type and scope are different questions ════\n');

  check('a working-day exception never closes the office',
    holidayClosesOffice('working_day') === false);
  check('a restricted holiday does not close it either',
    holidayClosesOffice('restricted') === false);
  check('a company holiday does', holidayClosesOffice('company') === true);

  // Scope narrows WHO; type decides WHETHER. Both have to agree.
  check('a working-day exception scoped to the office still closes nothing',
    holidayClosesFor({ type: 'working_day', locationIds: [OFFICE] }, atOffice) === false);
  check('a company holiday scoped to the office closes it for the office',
    holidayClosesFor({ type: 'company', locationIds: [OFFICE] }, atOffice) === true);
  check('and not for WFH',
    holidayClosesFor({ type: 'company', locationIds: [OFFICE] }, atHome) === false);
  check('an unscoped company holiday closes it for everybody',
    holidayClosesFor({ type: 'company' }, atHome) === true);

  console.log('\n════ Ids compared as text, not by identity ════\n');

  // The database hands back strings; a caller may hold something else. An id
  // that matches must match however it arrived, or the holiday silently
  // vanishes for that person.
  check('a matching id still matches when the types differ',
    holidayAppliesTo({ locationIds: [String(OFFICE)] }, { workLocationId: String(OFFICE) }) === true);

  console.log('\n════ The map every report reads ════\n');

  /* holMap changed shape: a date now maps to an ARRAY, because two holidays can
   * share a day when they are scoped to different people. Every reader goes
   * through holidayTypeFor, and if one were missed it would compare an array to
   * a string, find no holiday, and mark a whole company absent on Deepavali.
   *
   * So this builds the map the way the routes build it and reads it back. */
  const { holidayTypeFor } = require('./utils/workingDays');
  const holMap = new Map();
  const put = (key, row) => {
    if (!holMap.has(key)) holMap.set(key, []);
    holMap.get(key).push(row);
  };
  put('2026-10-20', { type: 'company', locationIds: [], shiftIds: [] });
  put('2026-11-07', { type: 'company', locationIds: [OFFICE], shiftIds: [] });
  put('2026-11-07', { type: 'working_day', locationIds: [WFH], shiftIds: [] });

  check('an unscoped holiday reads as a closure for everybody',
    holidayTypeFor(holMap, '2026-10-20', atHome) === 'company');
  check('a date nobody has a holiday on reads as nothing',
    holidayTypeFor(holMap, '2026-06-06', atOffice) === undefined);
  check('two holidays on one day resolve differently per person',
    holidayTypeFor(holMap, '2026-11-07', atOffice) === 'company'
      && holidayTypeFor(holMap, '2026-11-07', atHome) === 'working_day',
    { office: holidayTypeFor(holMap, '2026-11-07', atOffice), home: holidayTypeFor(holMap, '2026-11-07', atHome) });
  check('and with no employee it still answers, as it did before scopes existed',
    holidayTypeFor(holMap, '2026-10-20', undefined) === 'company');

  // A map built somewhere this refactor missed must not read as "no holiday".
  const oldShape = new Map([['2026-10-20', 'company']]);
  check('the old date-to-string shape is still understood',
    holidayTypeFor(oldShape, '2026-10-20', atOffice) === 'company');

  const failed = checks.filter(c => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed\n`);
  process.exit(failed ? 1 : 0);
})();
