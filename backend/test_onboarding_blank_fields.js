/* ── An untouched form field is "", and two columns will not take it ────────
 *  A candidate filled in the whole preboarding form and got "An internal
 *  server error occurred" — three times, across three re-sent invitations.
 *
 *  An HTML form sends a field nobody typed in as the empty string, never as
 *  null. Most columns on this path are text and take that happily. Two do not:
 *
 *      employees.date_of_birth            DATE
 *      employee_education.year_of_passing INT
 *
 *  Postgres answers "" for either with `invalid input syntax` (22P02), the
 *  transaction rolls back, and the whole submission is lost over one blank box.
 *
 *  Blank means "not given", and not given is null. These are the coercions
 *  that make that true, lifted out of the route so they cannot drift from it.
 *
 *  Pure. No database, no network, no mail.
 * ────────────────────────────────────────────────────────────────────────── */
const fs = require('fs');

const checks = [];
const check = (l, ok, x) => { checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '\n          ' + JSON.stringify(x).slice(0, 200)}`); };

const src = fs.readFileSync(require.resolve('./routes/registrations.js'), 'utf8');
const lift = (what, start, end) => {
  const from = src.indexOf(start);
  if (from < 0) throw new Error(`${what} not found in routes/registrations.js`);
  return src.slice(from, src.indexOf(end, from) + end.length);
};
const scope = new Function(`
  ${lift('blankToNull', 'const blankToNull = (v) => {', '\n};')}
  ${lift('dateOrNull', 'const dateOrNull = (v) => {', '\n};')}
  ${lift('yearOrNull', 'const yearOrNull = (v) => {', '\n};')}
  return { blankToNull, dateOrNull, yearOrNull };
`)();

const { blankToNull, dateOrNull, yearOrNull } = scope;

(async () => {
  console.log('\n════ Blank is not a value ════\n');

  check('an untouched field becomes null, not ""', blankToNull('') === null);
  check('so does a field holding only spaces', blankToNull('   ') === null);
  check('undefined is null', blankToNull(undefined) === null);
  check('null stays null', blankToNull(null) === null);
  check('a real answer survives, trimmed', blankToNull('  Coimbatore ') === 'Coimbatore');
  check('and a zero is a real answer, not a blank', blankToNull(0) === '0');

  console.log('\n════ The DATE column ════\n');

  // This is the one that killed the submission.
  check('a blank date of birth is null, never ""', dateOrNull('') === null);
  check('a real date passes through', dateOrNull('1998-04-17') === '1998-04-17');
  check('a datetime is trimmed to the date', dateOrNull('1998-04-17T00:00:00.000Z') === '1998-04-17');
  // Losing a whole submission because somebody typed a date oddly is a worse
  // outcome than storing no date at all.
  check('something that is not a date is treated as not given',
    dateOrNull('17/04/1998') === null, dateOrNull('17/04/1998'));
  check('and so is free text', dateOrNull('n/a') === null);

  console.log('\n════ The INT column ════\n');

  check('a blank year is null, never ""', yearOrNull('') === null);
  check('a year passes through as a number', yearOrNull('2019') === 2019);
  check('and as a number, not a string', typeof yearOrNull('2019') === 'number');
  // "2020-2024" in a box labelled "year of passing" is what people actually
  // type, and it is an integer column.
  check('a range takes the year it ended', yearOrNull('2020-2024') === 2024, yearOrNull('2020-2024'));
  check('a year with words around it is still found', yearOrNull('Passed 2021') === 2021);
  check('something with no year at all is not given', yearOrNull('pursuing') === null);
  check('and neither is a stray number that is not a year',
    yearOrNull('87') === null, yearOrNull('87'));

  console.log('\n════ The route uses them ════\n');

  /* The coercions are worthless if the insert still passes the raw value, and
   * that is invisible at the call site — which is how this got shipped. */
  const empParams = src.slice(src.indexOf('INSERT INTO employees ('), src.indexOf('const employeeId'));
  check('date of birth reaches the DATE column through dateOrNull',
    /dateOrNull\(dateOfBirth\)/.test(empParams));
  check('and no raw dateOfBirth is passed beside it',
    !/[^(]\bdateOfBirth\b\s*,/.test(empParams.split('VALUES')[1] || ''));

  // The whole education block, not just the INSERT — the skip-empty guard sits
  // above it and the first slicing of this missed it.
  const eduBlock = src.slice(src.indexOf('if (education) {'), src.indexOf('const FIELD_TO_TYPE'));
  check('year of passing reaches the INT column through yearOrNull',
    /yearOrNull\(ed\.yearOfPassing\)/.test(eduBlock));
  check('an education row with nothing in it is skipped, not stored',
    /hasAnything/.test(eduBlock));

  const catchBlock = src.slice(src.indexOf("'onboarding submission failed'"));
  check('and 22P02 is answered as a bad value rather than a server fault',
    /22P02/.test(catchBlock));

  const failed = checks.filter(c => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed\n`);
  process.exit(failed ? 1 : 0);
})();
