/* ── The Approvals page can actually read what the API sends ────────────────
 *  `npm run build` passing is not proof the code runs. Removing a Backlog tab
 *  took two `const` lines with it, leaving the response handler referring to
 *  `approved` and `rejected` — identifiers that no longer existed. Bundlers do
 *  not flag that, because an unknown name could legitimately be a global. It
 *  built cleanly, shipped, and then threw ReferenceError on every page load.
 *
 *  The symptom was misleading too: the throw happened INSIDE .then(), so it
 *  landed in .catch(), where `err.response` is undefined — so the page showed
 *  "Failed to load approvals", which reads like the request failed. It had
 *  succeeded.
 *
 *  So this lifts the real handler out of the page and runs it against a
 *  realistic payload. A missing identifier throws here, in a test, instead of
 *  in production.
 *
 *    node test_approvals_payload.js
 * ────────────────────────────────────────────────────────────────────────── */
process.env.LOG_LEVEL = 'silent';

const fs = require('fs');
const path = require('path');

const checks = [];
const check = (label, ok, extra) => {
  checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}` +
    (ok || extra === undefined ? '' : '\n          ' + JSON.stringify(extra).slice(0, 240)));
};

const PAGE = path.join(__dirname, '..', 'frontend', 'src', 'pages', 'Approvals.jsx');
const src = fs.readFileSync(PAGE, 'utf8');

/* The body of the .then() — from the first line of the callback to the closing
 * of setData. Lifted from the file so it cannot pass against a copy the page
 * has since moved away from. */
const from = src.indexOf('      .then(res => {');
const to = src.indexOf('      .catch(err =>', from);
if (from < 0 || to < 0) throw new Error('could not find the response handler in Approvals.jsx');
const body = src.slice(src.indexOf('{', from) + 1, src.lastIndexOf('})', to));

let captured = null;
const setData = (v) => { captured = v; };

const handler = new Function('res', 'setData', `${body}`);

// What the API really returns, in the shape it really returns it.
const payload = {
  data: {
    data: {
      leaves: [
        { _id: 'a', leaveType: 'casual',     status: 'pending' },
        { _id: 'b', leaveType: 'permission', status: 'pending' },
      ],
      approvedLeaves: [
        { _id: 'c', leaveType: 'casual', status: 'approved' },
        { _id: 'd', leaveType: 'sick',   status: 'rejected' },
        { _id: 'e', leaveType: 'casual', status: 'approved' },
      ],
      timesheets: [{ _id: 'f' }],
      regularizations: [{ _id: 'g' }, { _id: 'h' }],
      wfhRequests: [{ _id: 'i' }],
      compOffs: [],
      onDuty: [{ _id: 'j' }],
      total: 7,
    },
  },
};

console.log('\n══════════════════════════════════════════════════════════');
console.log('  Approvals — the response handler');
console.log('══════════════════════════════════════════════════════════\n');

let threw = null;
try { handler(payload, setData); } catch (e) { threw = e; }

check('it runs without throwing — a missing identifier fails here, not in the browser',
  threw === null, threw && threw.message);

if (threw) {
  console.log(`\n  ${checks.filter(Boolean).length}/${checks.length} passed\n`);
  process.exit(1);
}

check('setData was called', captured !== null);
check('permissions are split out of leaves',
  captured.permissions.length === 1 && captured.permissions[0]._id === 'b', captured.permissions);
check('and removed from the leaves tab',
  captured.leaves.length === 1 && captured.leaves[0]._id === 'a', captured.leaves);
check('approved and rejected are split by status',
  captured.approvedLeaves.length === 2 && captured.rejectedLeaves.length === 1,
  { approved: captured.approvedLeaves.length, rejected: captured.rejectedLeaves.length });
check('every tab the page renders has a list',
  ['leaves', 'permissions', 'timesheets', 'regularizations', 'wfhRequests', 'compOffs', 'onDuty',
   'approvedLeaves', 'rejectedLeaves'].every(k => Array.isArray(captured[k])),
  Object.keys(captured));

console.log('\n  An empty or partial response must not throw\n');

for (const [label, res] of [
  ['a completely empty body',   { data: {} }],
  ['data present but empty',    { data: { data: {} } }],
  ['leaves missing',            { data: { data: { approvedLeaves: [] } } }],
  ['approvedLeaves missing',    { data: { data: { leaves: [] } } }],
]) {
  let e = null;
  try { handler(res, setData); } catch (err) { e = err; }
  check(label, e === null, e && e.message);
}

const passed = checks.filter(Boolean).length;
console.log('\n══════════════════════════════════════════════════════════');
console.log(`  ${passed}/${checks.length} passed`);
console.log('══════════════════════════════════════════════════════════\n');
process.exit(passed === checks.length ? 0 : 1);
