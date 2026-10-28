/* ── /team/leave-requests must show a request to every genuine approver on
 *    it, not only to the employee's direct reporting manager ──────────────
 *
 *  Bug: Level 1 is ALWAYS the employee's own reporting_manager_id, by
 *  deriveLevels' own definition — so a Level 1 approver's view was never
 *  actually broken by this, confirmed empirically below (case 2's L1
 *  assertions pass identically with or without the fix). The real,
 *  verified failure is Level 2/3: they're reached by walking further up the
 *  reporting chain and are NOT necessarily the employee's own
 *  reporting_manager_id/approving_authority_id. reportsScope() — which only
 *  checks those two direct-report fields — was the ONLY scope this route
 *  used, so a request a Level 2/3 approver legitimately approved
 *  (personally, or on someone else's behalf via "Approve All") was silently
 *  missing from THEIR OWN Approved/Rejected history here, even though
 *  approval_levels correctly recorded them as an approver. Confirmed with a
 *  standalone before/after query against this same synthetic chain: the old
 *  WHERE clause excludes L2's own approved-level-2 request; the fixed one
 *  includes it.
 *
 *  What has to hold, against the REAL approval engine (applyApproval /
 *  applyApproveAll from utils/leaveApproval.js — not reimplemented here):
 *
 *    1. L1 personally approves their own level — they see it.
 *    2. L2 approves on behalf of L1 (L1 never acts) via a normal approve —
 *       L1 still sees the request in their own Approved history.
 *    3. L2 completes L1+L2 via "Approve All" — both L1 and L2 see it.
 *    4. L3 completes L1+L2+L3 via "Approve All" — all three see it.
 *    5. The on-behalf approver (L2) is never confused with the person
 *       covered (L1) in the approver_id/acted_by distinction.
 *    6. A request is never double-counted (one row per request, even with
 *       multiple approval_levels rows).
 *    7. A rejected request is correctly classified as rejected, not approved,
 *       for the approver who rejected it.
 *    8. Someone with NO relationship to the request (not a direct manager,
 *       not in approval_levels) still does not see it — the fix must not
 *       widen visibility to everyone.
 *
 *  Runs the real approval-engine functions and the route's own (fixed) SQL
 *  against synthetic rows inside a transaction that is ALWAYS rolled back,
 *  so nothing is written. Needs a database. Sends no mail.
 *
 *    node test_team_leave_requests_scope.js
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'silent';

const fs = require('fs');
const pool = require('./db');
const { applyApproval, applyApproveAll, applyRejection } = require('./utils/leaveApproval');

// applyApproval/applyApproveAll only mutate approval_levels — they never
// touch leaves.status themselves. The real caller (routes/leaves.js's
// PUT /:id/action, when result.allApproved) does:
//   UPDATE leaves SET status='approved', approved_by=$1, approved_at=NOW() ...
// (plus a balance debit this test deliberately does not replicate — leave
// balances are out of scope for this bug). Mirrored here so this test
// exercises the same end state the real route produces.
async function settleIfFullyApproved(client, requestId, result, actorId) {
  if (result.ok && result.allApproved) {
    await client.query(
      `UPDATE leaves SET status='approved', approved_by=$1, approved_at=NOW() WHERE id=$2`,
      [actorId, requestId]);
  }
}

const checks = [];
const check = (label, ok, extra) => {
  checks.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}` +
    (ok || extra === undefined ? '' : '\n          ' + JSON.stringify(extra).slice(0, 300)));
};

// Lifted from the route by reading it, so this cannot pass against a copy
// the fix has moved away from.
const routeSrc = fs.readFileSync(require.resolve('./routes/team.js'), 'utf8');

/** The route's own fixed WHERE clause, parameterised the same way it is
 *  there: $1 = viewer id, $2 = direct-report id (reportsScope, 'manager'
 *  branch — these tests only use managers, never full-access, since
 *  full-access already saw everything before the fix and isn't the bug). */
const SCOPED_WHERE = `
  EXISTS (SELECT 1 FROM approval_levels x WHERE x.request_type = 'leave' AND x.request_id = l.id AND x.approver_id = $1)
  OR (TRUE AND (e.reporting_manager_id = $1 OR e.approving_authority_id = $1))
`;

const run = async () => {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  GET /team/leave-requests — on-behalf approval visibility');
  console.log('══════════════════════════════════════════════════════════\n');

  console.log('  The route still carries the fix\n');
  check('scopes by approval_levels.approver_id, not only reportsScope()',
    /EXISTS \(SELECT 1 FROM approval_levels x WHERE x\.request_type = 'leave' AND x\.request_id = l\.id AND x\.approver_id = \$1\)/.test(routeSrc));
  check('still falls back to reportsScope() via OR (direct-report visibility preserved)',
    /OR \(TRUE\$\{scope\}\)/.test(routeSrc));

  const client = await pool.connect();
  let rolledBack = false;
  try {
    await client.query('BEGIN');

    const TAG = 'ZZ-OnBehalf-' + Date.now();
    const mkEmp = async (name, reportsTo) => {
      const r = await client.query(
        `INSERT INTO employees (first_name, last_name, email, department, status, role, reporting_manager_id, employee_id)
         VALUES ($1, 'Test', $2, $3, 'active', 'manager', $4, $5)
         RETURNING id`,
        [name, `${TAG}.${name}.${Date.now()}@scope.test`, TAG, reportsTo || null,
         'ZZ' + Math.floor(Math.random() * 1e6)]);
      return r.rows[0].id;
    };

    // emp reports only to L1 — L2 and L3 are NOT emp's reporting_manager_id
    // or approving_authority_id, so reportsScope() alone would never show
    // either of them this request. That gap is exactly the bug.
    const l3 = await mkEmp('L3Root', null);
    const l2 = await mkEmp('L2Approver', l3);
    const l1 = await mkEmp('L1Approver', l2);
    const emp = await mkEmp('Applicant', l1);
    // Nobody in this chain at all — proves the fix doesn't widen visibility.
    const stranger = await mkEmp('Stranger', null);

    const mkLeave = async () => {
      const r = await client.query(
        `INSERT INTO leaves (employee_id, leave_type, start_date, end_date, total_days, reason, status)
         VALUES ($1, 'casual', CURRENT_DATE, CURRENT_DATE, 1, 'on-behalf scope test', 'pending')
         RETURNING id`,
        [emp]);
      return r.rows[0].id;
    };
    // Bypasses deriveLevels on purpose — its HR-injection/Business-Unit-Head
    // rules depend on real org data this test shouldn't need. The mutation
    // functions under test (applyApproval/applyApproveAll) only read/write
    // existing approval_levels rows; they never call deriveLevels themselves.
    const mkLevels = async (requestId, approvers) => {
      for (const [level, approverId] of approvers.entries()) {
        await client.query(
          `INSERT INTO approval_levels (request_type, request_id, level, approver_id, status)
           VALUES ('leave', $1, $2, $3, 'pending')`,
          [requestId, level + 1, approverId]);
      }
    };

    const sees = async (viewerId, requestId, status) => {
      const r = await client.query(
        `SELECT l.id FROM leaves l JOIN employees e ON e.id = l.employee_id
          WHERE e.deleted_at IS NULL AND (${SCOPED_WHERE}) AND l.status = $2 AND l.id = $3`,
        [viewerId, status, requestId]);
      return r.rows.length;
    };

    console.log('\n  Against synthetic rows in a rolled-back transaction\n');

    /* 1 — L1 personally approves their own level only. */
    {
      const reqId = await mkLeave();
      await mkLevels(reqId, [l1, l2]); // 2-level chain, no L3 needed for this case
      const result = await applyApproval(client, 'leave', reqId, { _id: l1, role: 'manager' });
      check('1. L1 personally approving their own level succeeds', result.ok && !result.allApproved, result);
      const al = (await client.query(
        `SELECT level, status, acted_by, on_behalf FROM approval_levels WHERE request_type='leave' AND request_id=$1 ORDER BY level`,
        [reqId])).rows;
      check('   ...L1\'s level is approved, directly (not on_behalf)',
        al[0].status === 'approved' && String(al[0].acted_by) === String(l1) && al[0].on_behalf === false, al);
      check('   ...L2\'s level is still pending (not auto-covered upward)', al[1].status === 'pending', al);
    }

    /* 2 — L2 approves on behalf of L1 via a normal approve (L1 never acts). */
    let case2ReqId;
    {
      case2ReqId = await mkLeave();
      await mkLevels(case2ReqId, [l1, l2]);
      const result = await applyApproval(client, 'leave', case2ReqId, { _id: l2, role: 'manager' });
      await settleIfFullyApproved(client, case2ReqId, result, l2);
      check('2. L2 approving covers L1 on their behalf', result.ok, result);
      const al = (await client.query(
        `SELECT level, status, acted_by, on_behalf FROM approval_levels WHERE request_type='leave' AND request_id=$1 ORDER BY level`,
        [case2ReqId])).rows;
      check('   ...L1\'s row shows on_behalf=true, acted_by=L2, approver_id unchanged (still L1)',
        al[0].status === 'approved' && al[0].on_behalf === true && String(al[0].acted_by) === String(l2), al);
      const l1Row = (await client.query(
        `SELECT approver_id FROM approval_levels WHERE request_type='leave' AND request_id=$1 AND level=1`, [case2ReqId])).rows[0];
      check('   ...L1 is still the recorded approver_id for level 1 (never overwritten)',
        String(l1Row.approver_id) === String(l1), l1Row);
      check('   ...L1 sees it (was never actually broken — L1 is always a direct report)',
        (await sees(l1, case2ReqId, 'approved')) === 1);
      check('   *** THE BUG: L2 now sees their own approved level in their own history — failed before the fix ***',
        (await sees(l2, case2ReqId, 'approved')) === 1);
    }

    /* 3 — L2 completes L1+L2 via "Approve All". */
    let case3ReqId;
    {
      case3ReqId = await mkLeave();
      await mkLevels(case3ReqId, [l1, l2]);
      const result = await applyApproveAll(client, 'leave', case3ReqId, { _id: l2, role: 'manager' });
      await settleIfFullyApproved(client, case3ReqId, result, l2);
      check('3. L2 using Approve All completes L1+L2', result.ok && result.allApproved, result);
      check('   ...L1 sees it in Approved Requests', (await sees(l1, case3ReqId, 'approved')) === 1);
      check('   ...L2 sees it in Approved Requests', (await sees(l2, case3ReqId, 'approved')) === 1);
    }

    /* 4 — L3 completes L1+L2+L3 via "Approve All". */
    let case4ReqId;
    {
      case4ReqId = await mkLeave();
      await mkLevels(case4ReqId, [l1, l2, l3]);
      const result = await applyApproveAll(client, 'leave', case4ReqId, { _id: l3, role: 'manager' });
      await settleIfFullyApproved(client, case4ReqId, result, l3);
      check('4. L3 using Approve All completes L1+L2+L3', result.ok && result.allApproved, result);
      check('   ...L1 sees it', (await sees(l1, case4ReqId, 'approved')) === 1);
      check('   ...L2 sees it', (await sees(l2, case4ReqId, 'approved')) === 1);
      check('   ...L3 sees it', (await sees(l3, case4ReqId, 'approved')) === 1);
    }

    /* 6 — never double-counted, even with 3 approval_levels rows for one request. */
    {
      const r = await client.query(
        `SELECT count(*)::int AS n FROM leaves l JOIN employees e ON e.id = l.employee_id
          WHERE e.deleted_at IS NULL AND (${SCOPED_WHERE}) AND l.status = 'approved' AND l.id = $2`,
        [l3, case4ReqId]);
      check('6. a 3-level-approved request still counts as exactly one row', r.rows[0].n === 1, r.rows[0]);
    }

    /* 7 — a rejection is classified as rejected, not approved, for the rejector. */
    {
      const reqId = await mkLeave();
      await mkLevels(reqId, [l1, l2]);
      const result = await applyRejection(client, 'leave', reqId, { _id: l1, role: 'manager' });
      check('7. L1 can reject their own level', result.ok, result);
      const row = (await client.query(`SELECT status FROM leaves WHERE id=$1`, [reqId])).rows[0];
      // applyRejection only mutates approval_levels; the caller (the real
      // route) sets leaves.status — mirror that here so the visibility
      // query (which reads l.status) has something real to classify.
      await client.query(`UPDATE leaves SET status='rejected', rejection_reason='test' WHERE id=$1`, [reqId]);
      check('   ...shows under rejected for L1, not approved',
        (await sees(l1, reqId, 'rejected')) === 1 && (await sees(l1, reqId, 'approved')) === 0);
    }

    /* 8 — someone with no relationship to the request sees nothing (fix does not widen access). */
    {
      check('8. an unrelated employee does not see case 2\'s now-approved request',
        (await sees(stranger, case2ReqId, 'approved')) === 0);
    }

    await client.query('ROLLBACK');
    rolledBack = true;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    rolledBack = true;
    console.log('\n  FAILED —', e.message, '\n', e.stack, '\n');
    checks.push(false);
  } finally {
    client.release();
  }

  const left = (await pool.query(
    `SELECT count(*)::int AS n FROM employees WHERE department LIKE 'ZZ-OnBehalf-%'`)).rows[0].n;
  check('the transaction was rolled back — nothing was written', rolledBack && left === 0, { left });

  const passed = checks.filter(Boolean).length;
  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  ${passed}/${checks.length} passed`);
  console.log('══════════════════════════════════════════════════════════\n');
  await pool.end();
  process.exit(passed === checks.length ? 0 : 1);
};

run().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
