// Regression test for Update 4 — Team -> Approvals' summary count cards.
//
// The bug was entirely frontend-side: Approvals.jsx fetched
// GET /approvals/summary only on mount and on month change, never after a
// successful approve/reject/approve-all action, so an approved-count card
// stayed stale until a full page reload. The fix (frontend/src/pages/
// Approvals.jsx) re-fetches that same endpoint right after every action
// succeeds instead of incrementing anything client-side.
//
// What this test actually exercises: the data contract the fix now surfaces
// promptly — that routes/approvals.js's /summary endpoint (left completely
// unmodified) only counts a request once every required approval level has
// settled, exactly matching "do not count a request as fully approved until
// all required approval levels are completed." If the frontend fix is doing
// its job, the UI reflects these exact transitions the instant an action
// completes rather than on the next reload.
//
// House pattern: everything happens inside one transaction that is always
// rolled back, so this never leaves data behind even if an assertion throws.
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'error';

const pool = require('./db');
const { DEFAULT_TZ } = require('./utils/timezone');

// Literal copy of the casual-leave slice of routes/approvals.js's
// GET /summary query — same convention as the other test_*.js files here.
const CASUAL_SUMMARY_SQL = `
  SELECT COUNT(*)::int AS casual FROM leaves l JOIN employees e ON l.employee_id = e.id
   WHERE l.leave_type = 'casual'
     AND l.status = 'approved'
     AND l.approved_at >= (make_date($1::int, $2::int, 1)::timestamp AT TIME ZONE $3::text)
     AND l.approved_at <  ((make_date($1::int, $2::int, 1) + INTERVAL '1 month')::timestamp AT TIME ZONE $3::text)
     AND e.deleted_at IS NULL AND (e.status = 'active' OR e.exit_date >= make_date($1::int, $2::int, 1))
     AND l.id = $4`;

let passed = 0, total = 0;
function check(label, ok, extra) {
  total++;
  if (ok) { passed++; console.log(`PASS - ${label}`); }
  else { console.log(`FAIL - ${label}${extra ? ' :: ' + JSON.stringify(extra) : ''}`); }
}

async function summaryCasualCount(client, leaveId, year, month) {
  const r = await client.query(CASUAL_SUMMARY_SQL, [year, month, DEFAULT_TZ, leaveId]);
  return r.rows[0].casual;
}

async function main() {
  const client = await pool.connect();
  const stamp = Date.now();
  try {
    await client.query('BEGIN');

    const mkEmployee = async (email) => {
      const r = await client.query(
        `INSERT INTO employees (first_name, last_name, email, password, role, status)
         VALUES ('Test', 'Employee', $1, 'x', 'team_member', 'active') RETURNING id`,
        [email]
      );
      return r.rows[0].id;
    };
    const l1Approver = await mkEmployee(`l1-${stamp}@test.local`);
    const l2Approver = await mkEmployee(`l2-${stamp}@test.local`);
    const applicant  = await mkEmployee(`applicant-${stamp}@test.local`);

    const now = new Date();
    const year = now.getFullYear(), month = now.getMonth() + 1;

    const leaveRes = await client.query(
      `INSERT INTO leaves (employee_id, leave_type, start_date, end_date, total_days, reason, status)
       VALUES ($1, 'casual', CURRENT_DATE, CURRENT_DATE, 1, 'test', 'pending') RETURNING id`,
      [applicant]
    );
    const leaveId = leaveRes.rows[0].id;

    await client.query(
      `INSERT INTO approval_levels (request_type, request_id, level, approver_id, status)
       VALUES ('leave', $1, 1, $2, 'pending'), ('leave', $1, 2, $3, 'pending')`,
      [leaveId, l1Approver, l2Approver]
    );

    // --- Before any approval: not counted ---
    check('pending request (no levels approved) is not counted in the summary',
      await summaryCasualCount(client, leaveId, year, month) === 0);

    // --- Level 1 approved, level 2 still pending: still not counted ---
    await client.query(
      `UPDATE approval_levels SET status = 'approved', acted_by = $2, acted_at = NOW()
        WHERE request_type = 'leave' AND request_id = $1 AND level = 1`,
      [leaveId, l1Approver]
    );
    // leaves.status only flips once every level is done (routes/leaves.js's
    // own rule, replicated here rather than re-deriving it) — level 2 is
    // still pending, so the request itself stays 'pending'.
    check('one of two levels approved: request still NOT counted (matches "all levels required")',
      await summaryCasualCount(client, leaveId, year, month) === 0);

    // --- Level 2 (final) approved: request settles, now counted ---
    await client.query(
      `UPDATE approval_levels SET status = 'approved', acted_by = $2, acted_at = NOW()
        WHERE request_type = 'leave' AND request_id = $1 AND level = 2`,
      [leaveId, l2Approver]
    );
    await client.query(
      `UPDATE leaves SET status = 'approved', approved_by = $2, approved_at = NOW() WHERE id = $1`,
      [leaveId, l2Approver]
    );
    check('both levels approved: request IS counted the moment the final level settles',
      await summaryCasualCount(client, leaveId, year, month) === 1);

    // --- Rejecting after the fact never re-adds it to an approved count ---
    // (simulates the "ensure counts remain correct after ... reject" case:
    // a rejection on a DIFFERENT, still-pending request must not affect this
    // one's already-settled count)
    const leave2Res = await client.query(
      `INSERT INTO leaves (employee_id, leave_type, start_date, end_date, total_days, reason, status)
       VALUES ($1, 'casual', CURRENT_DATE, CURRENT_DATE, 1, 'test2', 'rejected') RETURNING id`,
      [applicant]
    );
    check('a rejected request (even same leave type, same month) is never counted',
      await summaryCasualCount(client, leave2Res.rows[0].id, year, month) === 0);
    check('the earlier approved request is still correctly counted after an unrelated rejection',
      await summaryCasualCount(client, leaveId, year, month) === 1);

    // --- Confirm nothing was actually written ---
    const inTxn = await client.query(`SELECT COUNT(*)::int AS n FROM employees WHERE email LIKE $1`, [`%-${stamp}@test.local`]);
    check('all 3 synthetic employees exist inside this (about to be rolled back) transaction', inTxn.rows[0].n === 3);

  } catch (err) {
    console.error('ERROR during test run:', err);
  } finally {
    await client.query('ROLLBACK');
    const postRollback = await pool.query(`SELECT COUNT(*)::int AS n FROM employees WHERE email LIKE $1`, [`%-${stamp}@test.local`]);
    check('rollback confirmed - no synthetic employees persisted', postRollback.rows[0].n === 0);
    client.release();
    await pool.end();
  }

  console.log(`\n${passed}/${total} checks passed`);
  process.exit(passed === total ? 0 : 1);
}

main();
