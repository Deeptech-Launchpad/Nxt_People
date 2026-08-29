/* ── Settled history is not announced ───────────────────────────────────────
 *  Live has neither EMAIL_DISABLED nor EMAIL_ALLOWLIST set, so approving a
 *  request emails the employee for real. The Zoho import brought years of
 *  unactioned requests across as pending; clearing that backlog by hand would
 *  have sent dozens of people mail about leave they took in 2022.
 *
 *  outcomeEmail now refuses to send for any request whose dates finished
 *  before the current month — the same rule the Backlog tab uses, so if it is
 *  in that tab, acting on it does not notify.
 *
 *  What has to hold:
 *
 *    a request from a past month never sends
 *    a request in the CURRENT month still sends — a late decision on this
 *      month's leave is news, and silencing it would be a regression
 *    a FUTURE request still sends
 *    every request type is covered, not just leave
 *    an unparseable or missing date sends, rather than silently going quiet —
 *      failing safe here means the person is told
 *
 *  Pure unit test. No database, no mail, no network.
 *
 *    node test_historic_no_mail.js
 * ────────────────────────────────────────────────────────────────────────── */
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'silent';

const { isHistoric } = require('./utils/approvalMessages');

const checks = [];
const check = (label, ok, extra) => {
  checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}` +
    (ok || extra === undefined ? '' : '   got ' + JSON.stringify(extra)));
};

const now = new Date();
/* Local parts, not toISOString. In IST, local midnight on the 1st is 18:30 UTC
 * on the LAST DAY OF THE PREVIOUS MONTH, so toISOString turned "the 1st of
 * this month" into "the 31st of last month" and this suite failed against
 * correct code. The same trap the attendance columns carry. */
const iso = d =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const thisMonth   = iso(new Date(now.getFullYear(), now.getMonth(), 15));
const monthStart  = iso(new Date(now.getFullYear(), now.getMonth(), 1));
const lastMonth   = iso(new Date(now.getFullYear(), now.getMonth(), 0));
const nextMonth   = iso(new Date(now.getFullYear(), now.getMonth() + 1, 10));
const longAgo     = '2022-08-26';

console.log('\n══════════════════════════════════════════════════════════');
console.log('  Approval notices — settled history stays quiet');
console.log('══════════════════════════════════════════════════════════\n');

console.log('  Leave\n');
check('a 2022 request is historic',            isHistoric('leave', { end_date: longAgo }) === true);
check('last month is historic',                isHistoric('leave', { end_date: lastMonth }) === true);
check('the 1st of this month is NOT historic', isHistoric('leave', { end_date: monthStart }) === false);
check('mid-month is NOT historic',             isHistoric('leave', { end_date: thisMonth }) === false);
check('next month is NOT historic',            isHistoric('leave', { end_date: nextMonth }) === false);
check('camelCase records work too',            isHistoric('leave', { endDate: longAgo }) === true);

console.log('\n  Every other request type\n');
check('regularization by its date',   isHistoric('regularization', { date: longAgo }) === true);
check('regularization this month',    isHistoric('regularization', { date: thisMonth }) === false);
check('wfh by its date',              isHistoric('wfh', { date: longAgo }) === true);
check('on duty by its end date',      isHistoric('on_duty', { end_date: longAgo }) === true);
check('comp-off by its comp-off date',isHistoric('comp_off', { comp_off_date: longAgo }) === true);
check('comp-off falls back to worked date',
  isHistoric('comp_off', { worked_date: longAgo }) === true);

console.log('\n  Failing safe — when in doubt, tell the person\n');
check('a missing date is not historic',       isHistoric('leave', {}) === false);
check('a null record is not historic',        isHistoric('leave', null) === false);
check('nonsense in the date is not historic', isHistoric('leave', { end_date: 'not a date' }) === false);
check('an unknown request type is not historic',
  isHistoric('something_else', { end_date: longAgo }) === false);

console.log('\n  outcomeEmail refuses before it does anything else\n');
const fs = require('fs');
const src = fs.readFileSync(require.resolve('./utils/approvalMessages.js'), 'utf8');
const body = src.slice(src.indexOf('async function outcomeEmail'));
const guardAt = body.indexOf('isHistoric(requestType, record)');
const configAt = body.indexOf('await messagesFor(');
check('the historic check runs before the template is loaded',
  guardAt > -1 && configAt > -1 && guardAt < configAt, { guardAt, configAt });
check('it returns send: false', /return \{ send: false, reason: 'historic' \}/.test(body));

const leaves = fs.readFileSync(require.resolve('./routes/leaves.js'), 'utf8');
check('both mail branches in leaves.js sit behind notice.send',
  (leaves.match(/if \(empRes\.rows\[0\]\?\.email && notice\.send\)/g) || []).length === 2,
  (leaves.match(/notice\.send/g) || []).length);

const passed = checks.filter(Boolean).length;
console.log('\n══════════════════════════════════════════════════════════');
console.log(`  ${passed}/${checks.length} passed`);
console.log('══════════════════════════════════════════════════════════\n');
process.exit(passed === checks.length ? 0 : 1);
