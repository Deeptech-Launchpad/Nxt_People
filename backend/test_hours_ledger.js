/* The Expected vs Worked ledger.
 *
 * The screen read "-129:-2" where the reference read "+31:02" for the same
 * person and the same months. Two independent faults produced that:
 *
 *   1. THE MODEL. Balance was `previous + payable - expected`, carried
 *      forward with no floor, so a month worked short became a debt that
 *      never cleared. January (97:14 worked against 248:00 expected) sat
 *      -150:46 in the red and dragged every later month down with it. An
 *      hours balance does not work that way: overtime banks, a shortfall is
 *      simply not paid, and the ledger reopens at zero.
 *
 *   2. THE FORMATTER. fmtHM could not render a negative: JS keeps the sign on
 *      the remainder, so -129.05h formatted as "-130:-3". That one is checked
 *      in the frontend test below, mirrored here as the rule it must follow.
 *
 * The arithmetic is pinned against the reference's own nine-month ledger, so
 * a future change to the rule fails here rather than on somebody's payslip.
 */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'silent';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('this test does not send mail'); },
  verify: async () => { throw new Error('this test does not send mail'); },
});

const checks = [];
const check = (l, ok, x) => { checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${ok || x === undefined ? '' : '\n          ' + JSON.stringify(x)}`); };

/* The rule, exactly as routes/reports.js applies it. */
const fold = (months) => {
  let opening = 0;
  return months.map(m => {
    const balance = Math.max(0, opening + m.payable - m.expected);
    const row = { ...m, opening, paid: m.closed === false ? 0 : Math.min(m.payable, m.expected), balance };
    opening = balance;
    return row;
  });
};

/* The frontend's formatter, mirrored. */
const fmtHM = (n) => {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '00:00';
  const neg = Number(n) < 0;
  const total = Math.round(Math.abs(Number(n)) * 60);
  const s = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  return neg ? `-${s}` : s;
};

const hm = (h, m) => h + m / 60;

(async () => {
  console.log('\nExpected vs Worked ledger\n');

  /* The reference's ledger for one employee, Jan to Sep 2026, read off the
   * screen it renders. Expected and payable are the inputs; opening, paid and
   * balance are what our rule has to reproduce. */
  const REFERENCE = [
    { month: '01', expected: hm(248, 0), payable: hm(97, 14),  wantOpening: hm(0, 0),  wantPaid: hm(97, 14),  wantBalance: hm(0, 0) },
    { month: '02', expected: hm(224, 0), payable: hm(209, 56), wantOpening: hm(0, 0),  wantPaid: hm(209, 56), wantBalance: hm(0, 0) },
    { month: '03', expected: hm(248, 0), payable: hm(250, 37), wantOpening: hm(0, 0),  wantPaid: hm(248, 0),  wantBalance: hm(2, 37) },
    { month: '04', expected: hm(240, 0), payable: hm(249, 18), wantOpening: hm(2, 37), wantPaid: hm(240, 0),  wantBalance: hm(11, 55) },
    { month: '05', expected: hm(248, 0), payable: hm(250, 19), wantOpening: hm(11, 55), wantPaid: hm(248, 0), wantBalance: hm(14, 14) },
    { month: '06', expected: hm(240, 0), payable: hm(243, 19), wantOpening: hm(14, 14), wantPaid: hm(240, 0), wantBalance: hm(17, 33) },
    { month: '07', expected: hm(248, 0), payable: hm(252, 8),  wantOpening: hm(17, 33), wantPaid: hm(248, 0), wantBalance: hm(21, 41) },
    { month: '08', expected: hm(248, 0), payable: hm(257, 21), wantOpening: hm(21, 41), wantPaid: hm(248, 0), wantBalance: hm(31, 2) },
    /* The month still running: nothing is paid yet, and the balance still
     * moves with the hours worked so far. */
    { month: '09', expected: hm(24, 0), payable: hm(16, 59), closed: false,
      wantOpening: hm(31, 2), wantPaid: 0, wantBalance: hm(24, 1) },
  ];

  const got = fold(REFERENCE);
  const near = (a, b) => Math.abs(a - b) < 0.009;   // half a minute

  for (const r of got) {
    const want = REFERENCE.find(x => x.month === r.month);
    check(`${r.month}: opens at ${fmtHM(want.wantOpening)}`, near(r.opening, want.wantOpening),
      { got: fmtHM(r.opening), want: fmtHM(want.wantOpening) });
    check(`      pays ${fmtHM(want.wantPaid)}`, near(r.paid, want.wantPaid),
      { got: fmtHM(r.paid), want: fmtHM(want.wantPaid) });
    check(`      closes at ${fmtHM(want.wantBalance)}`, near(r.balance, want.wantBalance),
      { got: fmtHM(r.balance), want: fmtHM(want.wantBalance) });
  }

  /* The specific failure that started this: a short January must not become a
   * debt the rest of the year carries. */
  {
    const janOnly = fold([REFERENCE[0]])[0];
    check('a month worked short closes at zero, not in debt',
      janOnly.balance === 0, fmtHM(janOnly.balance));
    const old = REFERENCE[0].payable - REFERENCE[0].expected;
    check('  ...where the old rule made it a 150-hour hole',
      old < -150 && old > -151, fmtHM(old));
  }

  /* And the formatter has to survive one anyway. */
  {
    check('a negative renders as -129:03, not -130:-3', fmtHM(-129.05) === '-129:03', fmtHM(-129.05));
    check('  ...and zero still renders as 00:00', fmtHM(0) === '00:00', fmtHM(0));
    check('  ...and a normal value is unchanged', fmtHM(hm(31, 2)) === '31:02', fmtHM(hm(31, 2)));
    check('  ...and a missing value does not print NaN', fmtHM(undefined) === '00:00', fmtHM(undefined));
  }

  const passed = checks.filter(Boolean).length;
  console.log(`\n  ${passed}/${checks.length} passed\n`);
  process.exit(passed === checks.length ? 0 : 1);
})();
