// Turning a Zoho day into a row here.
//
// Three separate traps live in this conversion, and all three are silent:
//
//   check_in and check_out are `timestamp without time zone` holding UTC.
//   Zoho reports Asia/Kolkata. Writing the IST clock straight in reads back
//   five and a half hours late — which looks like a real punch, and every
//   previous bug in this codebase has been exactly this.
//
//   Zoho's WorkingHours is the shift's LENGTH, not hours worked. The weekend
//   records carry WorkingHours 08:00 on days nobody was in. TotalHours is what
//   was worked. Reading the friendlier name makes every weekend a full day.
//
//   "08:39" is eight hours thirty-nine minutes. Read as a decimal it is 8.39,
//   an error of thirteen minutes a day that no report would ever show.
//
// Nothing here touches the database or Zoho.
require('dotenv').config();

const fs = require('fs');

const checks = [];
const check = (l, ok, x) => { checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '\n          ' + JSON.stringify(x).slice(0, 300)}`); };

// Lifted from the script by reading it, so the test cannot pass against a copy
// that the original has since moved away from.
const src = fs.readFileSync(require.resolve('./zoho_restage.js'), 'utf8');
const at = (name, start) => {
  const from = src.indexOf(start);
  if (from < 0) throw new Error(`${name} not found in zoho_restage.js`);
  return from;
};
// A one-liner ends at its own newline; a block ends at the first `};` after it.
const liftLine = (name, start) => {
  const from = at(name, start);
  return src.slice(from, src.indexOf('\n', from));
};
const liftBlock = (name, start) => {
  const from = at(name, start);
  return src.slice(from, src.indexOf('\n};', from) + 3);
};
const scope = new Function(`
  ${liftLine('p2', 'const p2 = n =>')}
  ${liftBlock('hhmmToHours', 'const hhmmToHours = (s) => {')}
  ${liftBlock('hhmmToMinutes', 'const hhmmToMinutes = (s) => {')}
  ${liftBlock('fromZohoStamp', 'const fromZohoStamp = (s) => {')}
  ${liftLine('notDash', 'const notDash = v =>')}
  ${liftBlock('clockMinutes', 'const clockMinutes = (s) => {')}
  ${liftBlock('latenessOf', 'const latenessOf = (r) => {')}
  ${liftBlock('cappedHours', 'const cappedHours = (reported, checkIn, checkOut) => {')}
  ${liftBlock('num', 'const num = (v) => {')}
  ${liftBlock('shapeOfDay', 'const shapeOfDay = (iso, r) => {')}
  return { hhmmToHours, hhmmToMinutes, fromZohoStamp, shapeOfDay, latenessOf, cappedHours };
`)();

// Balaji's 2026-07-27, exactly as Zoho returned it.
const REAL_DAY = {
  FirstIn_Building: '-', OverTime: '00:30', CreatedTime: '27/07/2026 09:39 AM',
  entryTimezone: 'Asia/Kolkata', FirstIn_Latitude: 11.026046738240684,
  responseTimezone: 'Asia/Kolkata', FirstIn: '27/07/2026 09:39 AM',
  LastOut_Latitude: 11.026046738240684, TotalHours: '08:39',
  LastOut: '27/07/2026 06:18 PM', Shift_Core_Hours: '-',
  ShiftEndTime: '06:00 PM', ShiftStartTime: '09:30 AM', Status: 'Present',
  LastOut_Location: 'NSR Road, Saibaba Colony, Coimbatore, Tamil Nadu, 641001, India',
  ShiftName: 'General Shift', FirstIn_Longitude: 76.943207,
  FirstIn_Location: 'NSR Road, Saibaba Colony, Coimbatore, Tamil Nadu, 641001, India',
  LastOut_Longitude: 76.943207, Late_In: '00:09', WorkingHours: '08:00', Late_Out: '00:18',
};

// And a weekend, where every field is a dash but WorkingHours still says 08:00.
const REAL_WEEKEND = {
  ShiftStartTime: '09:30 AM', Status: 'Weekend', FirstIn: '-', LastOut: '-',
  OverTime: '00:00', TotalHours: '00:00', WorkingHours: '08:00',
  FirstIn_Latitude: '-', FirstIn_Longitude: '-', FirstIn_Location: '-',
  LastOut_Latitude: '-', LastOut_Longitude: '-', LastOut_Location: '-',
  entryTimezone: '', responseTimezone: 'Asia/Kolkata', ShiftEndTime: '06:00 PM',
};

(async () => {
  console.log('\n════ "08:39" is not 8.39 ════\n');

  check('08:39 is 8.65 hours', Math.abs(scope.hhmmToHours('08:39') - 8.65) < 1e-9, scope.hhmmToHours('08:39'));
  check('08:00 is exactly 8', scope.hhmmToHours('08:00') === 8, scope.hhmmToHours('08:00'));
  check('00:00 is zero, not null', scope.hhmmToHours('00:00') === 0, scope.hhmmToHours('00:00'));
  check('a dash is not a number', scope.hhmmToHours('-') === null, scope.hhmmToHours('-'));
  check('00:09 is nine minutes', scope.hhmmToMinutes('00:09') === 9, scope.hhmmToMinutes('00:09'));
  check('a missing Late_In is zero, not NaN', scope.hhmmToMinutes(undefined) === 0, scope.hhmmToMinutes(undefined));

  console.log('\n════ IST in, UTC out ════\n');

  check('09:39 AM in Kolkata is 04:09 UTC',
    scope.fromZohoStamp('27/07/2026 09:39 AM') === '2026-07-27 04:09:00',
    scope.fromZohoStamp('27/07/2026 09:39 AM'));
  check('06:18 PM in Kolkata is 12:48 UTC',
    scope.fromZohoStamp('27/07/2026 06:18 PM') === '2026-07-27 12:48:00',
    scope.fromZohoStamp('27/07/2026 06:18 PM'));
  check('12:00 AM is midnight, not noon — and lands on the day before in UTC',
    scope.fromZohoStamp('27/07/2026 12:00 AM') === '2026-07-26 18:30:00',
    scope.fromZohoStamp('27/07/2026 12:00 AM'));
  check('12:30 PM is half past noon',
    scope.fromZohoStamp('27/07/2026 12:30 PM') === '2026-07-27 07:00:00',
    scope.fromZohoStamp('27/07/2026 12:30 PM'));
  check('an early punch rolls back across midnight',
    scope.fromZohoStamp('01/03/2026 05:00 AM') === '2026-02-28 23:30:00',
    scope.fromZohoStamp('01/03/2026 05:00 AM'));
  check('a dash is not a time', scope.fromZohoStamp('-') === null, scope.fromZohoStamp('-'));

  // The failure this whole file exists for, stated directly.
  check('the stored time is NOT the IST clock',
    scope.fromZohoStamp('27/07/2026 09:39 AM') !== '2026-07-27 09:39:00');

  console.log('\n════ A real day of Balaji\'s ════\n');

  const d = scope.shapeOfDay('2026-07-27', REAL_DAY);
  check('check_in is the UTC of 09:39 IST', d.checkIn === '2026-07-27 04:09:00', d.checkIn);
  check('check_out is the UTC of 06:18 PM IST', d.checkOut === '2026-07-27 12:48:00', d.checkOut);
  check('hours worked come from TotalHours', Math.abs(d.hours - 8.65) < 1e-9, d.hours);
  check('the shift length comes from WorkingHours', d.shiftHours === 8, d.shiftHours);
  check('hours worked and shift length are NOT the same field', d.hours !== d.shiftHours);
  check('lateness is nine minutes — 09:39 against a 09:30 shift',
    d.lateMinutes === 9, d.lateMinutes);

  /* Zoho's own Late_In cannot be trusted across the whole history. In the
   * older years it holds the CLOCK TIME rather than the lateness: 09:05 comes
   * back as 545, and 9x60+5 is 545. Imported verbatim it made people who
   * arrived EARLY read as nine hours late, for years. */
  const early = { ...REAL_DAY, FirstIn: '02/08/2022 09:05 AM', Late_In: '09:05' };
  check('somebody arriving at 09:05 for a 09:30 shift is not late at all',
    scope.latenessOf(early) === 0, scope.latenessOf(early));
  check('and Zoho saying 545 minutes does not change that',
    scope.shapeOfDay('2022-08-02', early).lateMinutes === 0,
    scope.shapeOfDay('2022-08-02', early).lateMinutes);
  const late = { ...REAL_DAY, FirstIn: '02/08/2022 10:14 AM', Late_In: '10:14' };
  check('and 10:14 for a 09:30 shift is 44 minutes',
    scope.latenessOf(late) === 44, scope.latenessOf(late));
  check('a day with no shift has nothing to be late against',
    scope.latenessOf({ ...REAL_DAY, ShiftStartTime: '-' }) === 0);
  check('the location is kept', /NSR Road/.test(d.inLoc), d.inLoc);
  check('coordinates are numbers', d.inLat === 11.026046738240684 && d.inLng === 76.943207, [d.inLat, d.inLng]);
  check('it counts as a punch', d.hasPunch === true);

  // 08:39 out at 12:48 UTC minus 04:09 UTC is 8h39m. If the conversion had
  // shifted only one end, this is where it would show.
  const span = (new Date(d.checkOut + 'Z') - new Date(d.checkIn + 'Z')) / 3600000;
  check('check-out minus check-in equals the hours Zoho reported',
    Math.abs(span - d.hours) < 1e-9, { span, hours: d.hours });

  console.log('\n════ Hours cannot exceed the punches ════\n');

  /* Zoho reports more hours than the punches allow on five days, three of them
   * exactly doubled. Twenty-eight hours in a day is not a number anybody worked
   * and it inflates that person's totals and their overtime. */
  const IN = '2022-12-29 04:12:00';    // 09:42 IST
  const OUT = '2022-12-29 15:52:00';   // 09:22 PM IST — 11h40m apart
  check('an honest figure is left exactly as Zoho reported it',
    scope.cappedHours(8.65, IN, OUT) === 8.65, scope.cappedHours(8.65, IN, OUT));
  check('23.33 hours across an 11.67-hour span is capped to the span',
    scope.cappedHours(23.33, IN, OUT) === 11.67, scope.cappedHours(23.33, IN, OUT));
  check('and the cap is the span, not half the reported number',
    scope.cappedHours(23.33, IN, OUT) !== 23.33 / 2);
  check('a figure equal to the span is not treated as impossible',
    scope.cappedHours(11.67, IN, OUT) === 11.67);
  check('a minute over the span is slack, not a violation',
    scope.cappedHours(11.68, IN, OUT) === 11.68, scope.cappedHours(11.68, IN, OUT));
  check('a day with no punch out is left alone — there is no span to judge it by',
    scope.cappedHours(9.5, IN, null) === 9.5);
  check('and a day with neither punch is left alone too',
    scope.cappedHours(9.5, null, null) === 9.5);

  const impossible = { ...REAL_DAY,
    FirstIn: '29/12/2022 09:42 AM', LastOut: '29/12/2022 09:22 PM', TotalHours: '23:20' };
  const fixed = scope.shapeOfDay('2022-12-29', impossible);
  check('the impossible day imports as its span, not as 23.33 hours',
    Math.abs(fixed.hours - 11.67) < 0.02, fixed.hours);
  check('and what Zoho claimed is kept beside it, so the correction is visible',
    Math.abs(fixed.reportedHours - 23.33) < 0.02, fixed.reportedHours);

  console.log('\n════ A weekend ════\n');

  const w = scope.shapeOfDay('2026-07-05', REAL_WEEKEND);
  check('no punch', w.hasPunch === false, w);
  check('no check_in', w.checkIn === null, w.checkIn);
  check('zero hours worked', w.hours === 0, w.hours);
  check('WorkingHours still says 8 — which is why it cannot mean hours worked',
    w.shiftHours === 8 && w.hours === 0, { shiftHours: w.shiftHours, hours: w.hours });
  // NaN prints as null in a JSON dump, so assert it is not a number at all —
  // the first version of this check passed a NaN latitude straight through.
  check('the dashes did not become numbers',
    w.inLat === null && w.inLng === null && w.inLoc === null,
    [String(w.inLat), String(w.inLng), String(w.inLoc)]);
  check('and specifically are not NaN',
    !Number.isNaN(w.inLat) && !Number.isNaN(w.outLat), [String(w.inLat), String(w.outLat)]);

  const failed = checks.filter(c => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed\n`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
