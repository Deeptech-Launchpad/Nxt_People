/* ── A designated approver sees their own decision, not the whole chain's ──
 *  Bug: the Approved Requests tab ("GET /approvals/pending" -> approvedLeaves)
 *  required the WHOLE leave to be finally settled (l.status IN
 *  ('approved','rejected')) before it would show to ANYONE, including the
 *  Level 1 approver whose own level was already decided (personally, or on
 *  behalf of them). A request still waiting on Level 2/3 stayed invisible to
 *  Level 1 indefinitely, even though their own part of the job was done.
 *
 *  Fix: routes/approvals.js's approved/rejected leaves query now also
 *  includes a row when the VIEWER's own approval_levels row (ml) is decided
 *  this month, even if the overall request (l.status) is still pending — see
 *  the `ml` LATERAL join and the WHERE clause there. The overall
 *  leaves.status is never touched; the route returns it as-is ("myLevelStatus"
 *  is a separate field). The frontend (Approvals.jsx) picks approved/rejected
 *  using myLevelStatus as a fallback when the row itself is still 'pending'.
 *
 *  What has to hold:
 *
 *    Level 1, approved on their behalf, Level 2 approved, Level 3 pending
 *      -> the request appears to Level 1 this month, with myLevelStatus
 *         'approved' and the overall status still 'pending'
 *    Level 2 (who acted directly) sees the same thing
 *    Level 3 (still pending) does NOT see it in the approved list
 *    an unrelated employee, not in this chain at all, does not see it
 *    once Level 3 also approves, the request still appears to Level 1
 *      (now via the pre-existing "whole request settled" path)
 *    a rejection still appears to Level 1 (rejection always settles the
 *      whole request immediately, so this is the pre-existing path, not the
 *      new one — verifies the fix didn't disturb it)
 *    a mid-chain own-level approval from two months ago is invisible on the
 *      CURRENT month and only appears once the month switcher matches the
 *      month it was actually decided in
 *
 *  Runs the real SQL from the route against synthetic rows inside a
 *  transaction that is ALWAYS rolled back, so nothing is written. Needs a
 *  database. Sends no mail.
 *
 *    node test_approvals_own_level_history.js
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'silent';

const fs = require('fs');
const pool = require('./db');
const { DEFAULT_TZ } = require('./utils/timezone');

const checks = [];
const check = (label, ok, extra) => {
  checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}` +
    (ok || extra === undefined ? '' : '\n          ' + JSON.stringify(extra).slice(0, 300)));
};

/* Lifted from the route by reading it, so a future edit that drops the fix
 * fails this test even before the DB assertions run. */
const routeSrc = fs.readFileSync(require.resolve('./routes/approvals.js'), 'utf8');

/* Mirrors Approvals.jsx's load() classification exactly — if that function's
 * logic ever changes, update this copy alongside it. */
const effectiveStatus = (x) => (x.status === 'approved' || x.status === 'rejected') ? x.status : x.myLevelStatus;

// The query itself, copied from routes/approvals.js's approved/rejected
// leaves query, parameterised the same way: [userId, histYear, histMonth, histTz].
const APPROVED_REJECTED_SQL = `
  SELECT l.id as "_id", l.status, l.approved_at as "approvedAt",
         ml.status as "myLevelStatus"
    FROM leaves l
    JOIN employees e ON l.employee_id = e.id
    LEFT JOIN LATERAL (
      SELECT al.status, al.acted_at
        FROM approval_levels al
       WHERE al.request_type = 'leave' AND al.request_id = l.id AND al.approver_id = $1
       LIMIT 1
    ) ml ON TRUE
   WHERE (EXISTS (SELECT 1 FROM approval_levels x WHERE x.request_type = 'leave' AND x.request_id = l.id AND x.approver_id = $1))
     AND (
       (l.status IN ('approved', 'rejected')
         AND l.approved_at >= (make_date($2::int, $3::int, 1)::timestamp AT TIME ZONE $4::text)
         AND l.approved_at <  ((make_date($2::int, $3::int, 1) + INTERVAL '1 month')::timestamp AT TIME ZONE $4::text))
       OR
       (ml.status IN ('approved', 'rejected')
         AND ml.acted_at >= (make_date($2::int, $3::int, 1)::timestamp AT TIME ZONE $4::text)
         AND ml.acted_at <  ((make_date($2::int, $3::int, 1) + INTERVAL '1 month')::timestamp AT TIME ZONE $4::text))
     )
     AND e.deleted_at IS NULL
     AND l.id = $5
`;

const run = async () => {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  Approved Requests — own level decided mid-chain');
  console.log('══════════════════════════════════════════════════════════\n');

  console.log('  The route still carries the fix\n');
  check('the viewer\'s own level is joined separately from the aggregate one',
    /SELECT al\.status, al\.acted_at[\s\S]{0,300}\) ml ON TRUE/.test(routeSrc));
  check('the WHERE clause accepts a decided own-level even when the request is still pending',
    /ml\.status IN \('approved', 'rejected'\)/.test(routeSrc));
  check('the overall leave status itself is never written to make this work (no new UPDATE leaves)',
    (routeSrc.match(/UPDATE leaves/g) || []).length === 0);

  const client = await pool.connect();
  let rolledBack = false;
  try {
    await client.query('BEGIN');

    const TAG = 'ZZ Approvals Own-Level Test';
    const mkEmp = async (name, reportsTo) => {
      const r = await client.query(
        `INSERT INTO employees (first_name, last_name, email, department, status, reporting_manager_id, employee_id)
         VALUES ($1, 'Test', $2, $3, 'active', $4, $5)
         RETURNING id`,
        [name, `zz.${name}.${Date.now()}@approvals.test`, TAG, reportsTo || null,
         'ZZOL' + Math.floor(Math.random() * 1e6)]);
      return r.rows[0].id;
    };

    const l3 = await mkEmp('L3Root', null);
    const l2 = await mkEmp('L2Mid', l3);
    const l1 = await mkEmp('L1Near', l2);
    const emp = await mkEmp('Applicant', l1);
    const stranger = await mkEmp('Unrelated', null);

    const mkLeave = async () => {
      const r = await client.query(
        `INSERT INTO leaves (employee_id, leave_type, start_date, end_date, total_days, reason, status)
         VALUES ($1, 'unpaid', CURRENT_DATE, CURRENT_DATE, 1, 'own-level history test', 'pending')
         RETURNING id`,
        [emp]);
      return r.rows[0].id;
    };

    const mkLevel = (client2, leaveId, level, approverId, status, actedBy, onBehalf, actedAt) =>
      client2.query(
        `INSERT INTO approval_levels (request_type, request_id, level, approver_id, status, acted_by, acted_at, on_behalf)
         VALUES ('leave', $1, $2, $3, $4, $5, $6, $7)`,
        [leaveId, level, approverId, status, actedBy,
         status === 'pending' ? null : (actedAt || new Date()), !!onBehalf]);

    const now = new Date();
    const Q = (userId, requestId, year = now.getFullYear(), month = now.getMonth() + 1) =>
      client.query(APPROVED_REJECTED_SQL, [userId, year, month, DEFAULT_TZ, requestId]);

    console.log('\n  Case 1 — Level 1 approved on L2\'s behalf, Level 2 approved, Level 3 pending\n');

    const midChainLeave = await mkLeave();
    await mkLevel(client, midChainLeave, 1, l1, 'approved', l2, true);  // L2 covered L1
    await mkLevel(client, midChainLeave, 2, l2, 'approved', l2, false); // L2's own level
    await mkLevel(client, midChainLeave, 3, l3, 'pending', null, false);
    // leaves.status is left untouched at 'pending', exactly as applyApproval/
    // applyApproveAll would leave it with one level still pending (confirmed
    // in utils/leaveApproval.js: allApproved is only true once every level is
    // 'approved').

    const l1View = await Q(l1, midChainLeave);
    check('Level 1 sees the request this month', l1View.rows.length === 1, l1View.rows);
    if (l1View.rows.length === 1) {
      const row = l1View.rows[0];
      check('their own level reads approved', row.myLevelStatus === 'approved', row);
      check('the OVERALL request status is still pending — not faked to approved', row.status === 'pending', row);
      check('the frontend\'s effectiveStatus() places it in the Approved tab', effectiveStatus(row) === 'approved', row);
    }

    const l2View = await Q(l2, midChainLeave);
    check('Level 2, who acted directly, also sees it', l2View.rows.length === 1 && l2View.rows[0].myLevelStatus === 'approved', l2View.rows);

    const l3View = await Q(l3, midChainLeave);
    check('Level 3, still pending, does not see it in the approved/rejected list', l3View.rows.length === 0, l3View.rows);

    const strangerView = await Q(stranger, midChainLeave);
    check('an unrelated employee, not in this chain, does not see it', strangerView.rows.length === 0, strangerView.rows);

    console.log('\n  Case 2 — regression: once every level clears, Level 1 still sees it\n');

    const fullyApprovedLeave = await mkLeave();
    await mkLevel(client, fullyApprovedLeave, 1, l1, 'approved', l1, false);
    await mkLevel(client, fullyApprovedLeave, 2, l2, 'approved', l2, false);
    await mkLevel(client, fullyApprovedLeave, 3, l3, 'approved', l3, false);
    await client.query(`UPDATE leaves SET status='approved', approved_at=NOW() WHERE id=$1`, [fullyApprovedLeave]);

    const fullyApprovedView = await Q(l1, fullyApprovedLeave);
    check('a fully-settled request still appears (pre-existing path untouched)',
      fullyApprovedView.rows.length === 1 && fullyApprovedView.rows[0].status === 'approved', fullyApprovedView.rows);

    console.log('\n  Case 3 — regression: a rejection (always settles the whole request) still appears\n');

    const rejectedLeave = await mkLeave();
    await mkLevel(client, rejectedLeave, 1, l1, 'rejected', l1, false);
    await mkLevel(client, rejectedLeave, 2, l2, 'pending', null, false);
    await mkLevel(client, rejectedLeave, 3, l3, 'pending', null, false);
    await client.query(`UPDATE leaves SET status='rejected', approved_at=NOW() WHERE id=$1`, [rejectedLeave]);

    const rejectedView = await Q(l1, rejectedLeave);
    check('a rejected request still appears to the approver who rejected it',
      rejectedView.rows.length === 1 && rejectedView.rows[0].status === 'rejected'
        && effectiveStatus(rejectedView.rows[0]) === 'rejected', rejectedView.rows);

    console.log('\n  Case 4 — a mid-chain own-level approval from a PAST month is a historical row, not a current one\n');

    const pastDate = new Date(now.getFullYear(), now.getMonth() - 2, 15, 10, 0, 0);
    const pastYear = pastDate.getFullYear();
    const pastMonth = pastDate.getMonth() + 1;

    const historicalLeave = await mkLeave();
    await mkLevel(client, historicalLeave, 1, l1, 'approved', l2, true, pastDate);  // on L1's behalf, 2 months ago
    await mkLevel(client, historicalLeave, 2, l2, 'approved', l2, false, pastDate);
    await mkLevel(client, historicalLeave, 3, l3, 'pending', null, false);

    const historicalCurrentMonthView = await Q(l1, historicalLeave); // defaults to the current month/year
    check('it does NOT appear when viewing the CURRENT month (it belongs to a different one)',
      historicalCurrentMonthView.rows.length === 0, historicalCurrentMonthView.rows);

    const historicalPastMonthView = await Q(l1, historicalLeave, pastYear, pastMonth);
    check('it DOES appear once the month switcher is moved to the month it was actually decided in',
      historicalPastMonthView.rows.length === 1
        && historicalPastMonthView.rows[0].myLevelStatus === 'approved'
        && historicalPastMonthView.rows[0].status === 'pending',
      historicalPastMonthView.rows);

    await client.query('ROLLBACK');
    rolledBack = true;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    rolledBack = true;
    console.log('\n  FAILED —', e.message, '\n');
    checks.push(false);
  } finally {
    client.release();
  }

  const left = (await pool.query(
    `SELECT count(*)::int AS n FROM employees WHERE department = 'ZZ Approvals Own-Level Test'`)).rows[0].n;
  check('the transaction was rolled back — nothing was written', rolledBack && left === 0, { left });

  const passed = checks.filter(Boolean).length;
  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  ${passed}/${checks.length} passed`);
  console.log('══════════════════════════════════════════════════════════\n');
  await pool.end();
  process.exit(passed === checks.length ? 0 : 1);
};

run().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
