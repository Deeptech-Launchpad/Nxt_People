#!/usr/bin/env node
/* Why does /approvals/pending show nothing for this Team Incharge?
 *
 * READ ONLY. Nothing here writes.
 *
 * "Total Pending: 0" and "No approved leave requests found" are only a bug
 * if this person SHOULD be seeing something. This prints, for one employee:
 *   - who reports to them (reporting_manager_id OR approving_authority_id —
 *     the same OR the pending-leaves query uses)
 *   - every approval_levels row that ever names them as approver, any
 *     request_type, any status, with the underlying request's date
 *   - which of those the live Approved/Rejected tab's month window would
 *     actually include (start_date/end_date overlapping the current month)
 *   - the exact same three queries /approvals/pending runs (pending leaves,
 *     approved+rejected leaves scoped to this month), so a mismatch between
 *     this script and the UI points at something other than scope
 *
 * A Team Incharge with no direct reports, or whose reports have filed
 * nothing this month, is SUPPOSED to see all zeroes — this tells you which
 * one it is instead of guessing.
 *
 *   node inspect_approver_scope.js ANXT2600149
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('this script does not send mail'); },
  verify: async () => { throw new Error('this script does not send mail'); },
});

const pool = require('./db');

const CODE = process.argv[2];
if (!CODE) {
  console.log('\n  usage: node inspect_approver_scope.js <CODE>\n');
  process.exit(1);
}

const pad = (s, n) => String(s ?? '').padEnd(n);
const show = v => (v === null || v === undefined || v === '') ? '—' : String(v);

(async () => {
  const emp = (await pool.query(
    `SELECT id, employee_id AS code, TRIM(first_name||' '||COALESCE(last_name,'')) AS name, role
       FROM employees WHERE employee_id = $1`, [CODE])).rows[0];
  if (!emp) { console.log(`  No employee ${CODE}.\n`); await pool.end(); process.exit(1); }

  console.log(`\n  ${emp.name}  ${emp.code}  role=${emp.role}\n`);

  console.log('─'.repeat(76));
  console.log('  Direct reports (reporting_manager_id OR approving_authority_id = them)');
  console.log('─'.repeat(76));
  const reports = (await pool.query(
    `SELECT employee_id AS code, TRIM(first_name||' '||COALESCE(last_name,'')) AS name, status, deleted_at
       FROM employees WHERE (reporting_manager_id = $1 OR approving_authority_id = $1)
       ORDER BY employee_id`, [emp.id])).rows;
  if (!reports.length) {
    console.log('\n  NONE. Nobody has this person as their reporting manager or approving');
    console.log('  authority — every "direct reports" scoped query returns nothing for');
    console.log('  them by construction, and that is the whole explanation if so.\n');
  } else {
    for (const r of reports) {
      console.log(`  ${pad(r.code, 14)}${pad(r.name, 26)}status=${pad(r.status, 10)}`
        + `${r.deleted_at ? 'DELETED' : ''}`);
    }
    console.log('');
  }

  console.log('─'.repeat(76));
  console.log('  Every approval_levels row naming them as approver — any type, any status');
  console.log('─'.repeat(76));
  const levels = (await pool.query(
    `SELECT al.request_type, al.level, al.status AS level_status, al.acted_at,
            CASE al.request_type
              WHEN 'leave' THEN (SELECT to_char(l.start_date,'YYYY-MM-DD')||' -> '||to_char(l.end_date,'YYYY-MM-DD')||'  '||l.status||'  '||l.leave_type
                                   FROM leaves l WHERE l.id = al.request_id)
              WHEN 'regularization' THEN (SELECT to_char(r.date,'YYYY-MM-DD')||'  '||r.status FROM attendance_regularizations r WHERE r.id = al.request_id)
              WHEN 'wfh' THEN (SELECT to_char(w.date,'YYYY-MM-DD')||'  '||w.status FROM wfh_requests w WHERE w.id = al.request_id)
              WHEN 'comp_off' THEN (SELECT to_char(c.worked_date,'YYYY-MM-DD')||'  '||c.status FROM comp_offs c WHERE c.id = al.request_id)
              WHEN 'on_duty' THEN (SELECT to_char(o.start_date,'YYYY-MM-DD')||'  '||o.status FROM on_duty_requests o WHERE o.id = al.request_id)
              ELSE NULL
            END AS request_summary
       FROM approval_levels al
      WHERE al.approver_id = $1
      ORDER BY al.acted_at DESC NULLS FIRST`, [emp.id])).rows;
  if (!levels.length) {
    console.log('\n  NONE. This person has never been named an approver on anything, at any');
    console.log('  level, ever. Being reachable at /team/approvals does not mean an approval');
    console.log('  chain has ever actually assigned them a request.\n');
  } else {
    for (const l of levels) {
      console.log(`  ${pad(l.request_type, 16)}L${l.level}  ${pad(l.level_status, 10)}`
        + `${pad(l.acted_at ? l.acted_at.toISOString().slice(0, 16) : '—', 18)}${l.request_summary || '(request deleted)'}`);
    }
    console.log('');
  }

  const monthStart = (await pool.query(`SELECT date_trunc('month', CURRENT_DATE)::date AS d`)).rows[0].d;
  const monthEnd = (await pool.query(`SELECT (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::date AS d`)).rows[0].d;
  console.log('─'.repeat(76));
  console.log(`  What /approvals/pending actually returns right now (this month = ${monthStart} .. ${monthEnd})`);
  console.log('─'.repeat(76));

  const pending = (await pool.query(
    `SELECT l.id, l.leave_type, l.start_date::text, l.status
       FROM leaves l WHERE l.status = 'pending'
        AND EXISTS (SELECT 1 FROM approval_levels x WHERE x.request_type='leave' AND x.request_id=l.id AND x.approver_id=$1 AND x.status='pending')`,
    [emp.id])).rows;
  console.log(`\n  pending leaves awaiting THEIR action right now: ${pending.length}`);
  for (const p of pending) console.log(`    ${p.leave_type}  ${p.start_date}`);

  const approved = (await pool.query(
    `SELECT l.id, l.leave_type, l.start_date::text, l.end_date::text, l.status
       FROM leaves l
      WHERE EXISTS (SELECT 1 FROM approval_levels x WHERE x.request_type='leave' AND x.request_id=l.id AND x.approver_id=$1)
        AND l.status IN ('approved','rejected')
        AND l.start_date <= $3::date AND l.end_date >= $2::date`,
    [emp.id, monthStart, monthEnd])).rows;
  console.log(`\n  approved/rejected leaves in this month's window, them ever an approver: ${approved.length}`);
  for (const a of approved) console.log(`    ${a.leave_type}  ${a.start_date} -> ${a.end_date}  ${a.status}`);

  // The same chain, WITHOUT the month filter, so a real approval sitting in
  // a different month (last month, or scheduled ahead) is visible instead
  // of silently excluded by the window that only the Approved/Rejected tab
  // applies.
  const approvedAnyMonth = (await pool.query(
    `SELECT l.leave_type, l.start_date::text, l.end_date::text, l.status
       FROM leaves l
      WHERE EXISTS (SELECT 1 FROM approval_levels x WHERE x.request_type='leave' AND x.request_id=l.id AND x.approver_id=$1)
        AND l.status IN ('approved','rejected')
      ORDER BY l.start_date DESC LIMIT 20`, [emp.id])).rows;
  console.log(`\n  approved/rejected leaves ever, THIS MONTH'S WINDOW OR NOT (most recent 20): ${approvedAnyMonth.length}`);
  for (const a of approvedAnyMonth) console.log(`    ${a.leave_type}  ${a.start_date} -> ${a.end_date}  ${a.status}`);
  if (approvedAnyMonth.length && !approved.length) {
    console.log('\n  ^ THIS is the answer if the two lines above differ: real approved/rejected');
    console.log('    history exists for this approver, but none of it overlaps the current');
    console.log('    calendar month, so the tab\'s month filter hides all of it. That is the');
    console.log('    tab working as designed (it says "this month" for a reason) — but it is');
    console.log('    worth knowing if the person expected to see last month\'s history here.');
  }

  console.log('');
  await pool.end();
})().catch(async e => {
  console.error(e);
  try { await pool.end(); } catch {}
  process.exit(1);
});
