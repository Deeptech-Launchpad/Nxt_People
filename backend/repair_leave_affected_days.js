/* ── Repair days whose leave was approved after the punch ───────────────────
 *  A day's status is stamped at check-out, from what the company had approved
 *  AT THAT MOMENT. Approvals normally land afterwards, so a permission granted
 *  the next morning never reached the day it covered: the day was measured
 *  against a full shift it was never expected to work and kept saying
 *  "Half Day" for good.
 *
 *  That cause is fixed going forward — approving or cancelling a leave now
 *  re-asks the question for the days it covers. This is the other half: the
 *  days that were already stamped wrong before that existed.
 *
 *  Deliberately NARROWER than the org-wide sweep behind
 *  POST /attendance-config/policy/reprocess. That one re-judges every day for
 *  everybody and would quietly pick up unrelated policy drift. This only
 *  visits days that actually carry an approved leave or permission — the only
 *  days this bug could have touched.
 *
 *      node repair_leave_affected_days.js                    dry run
 *      node repair_leave_affected_days.js --from 2026-08-01  narrow the window
 *      node repair_leave_affected_days.js --apply            write it
 *
 *  THIS MOVES PAY-AFFECTING FIGURES. A day going half-day → present is a half
 *  day of pay. Read the dry run before applying, and keep its output: nothing
 *  writes an audit row for a status re-stamp, so that printout is the only
 *  record of what moved.
 * ────────────────────────────────────────────────────────────────────────── */

require('dotenv').config();
const pool = require('./db');
const { reclassifyRange } = require('./utils/attendanceReprocess');

const APPLY = process.argv.includes('--apply');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const FROM = arg('--from', '2026-01-01');
const TO = arg('--to', new Date().toLocaleDateString('en-CA'));

async function main() {
  const cfg = (await pool.query(`SELECT attendance_policy_config AS p FROM settings LIMIT 1`)).rows[0]?.p || {};

  /* Only people who actually have an approved leave or permission in the
   * window. Everybody else's days cannot have been affected by this. */
  const people = (await pool.query(
    `SELECT DISTINCT e.id, e.employee_id AS code,
            TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS name
       FROM employees e
       JOIN leaves l ON l.employee_id = e.id
      WHERE e.deleted_at IS NULL
        AND l.status = 'approved'
        AND l.end_date >= $1::date AND l.start_date <= $2::date
      ORDER BY e.employee_id`,
    [FROM, TO]
  )).rows;

  console.log(`\n  window            ${FROM} .. ${TO}`);
  console.log(`  policy            mode=${cfg.mode || 'strict'} permissionReducesExpected=${cfg.permissionReducesExpected !== false}`);
  if (cfg.ruleEffectiveFrom) console.log(`  ruleEffectiveFrom ${cfg.ruleEffectiveFrom}  (earlier days are never touched)`);
  console.log(`  people with approved leave in window: ${people.length}`);
  console.log(APPLY ? '\n  APPLYING — statuses will be written.\n' : '\n  DRY RUN — nothing will be written. Add --apply to write.\n');

  const all = [];
  for (const p of people) {
    const out = await reclassifyRange(pool, {
      employeeId: p.id, from: FROM, to: TO, cfg, apply: APPLY,
    });
    out.changes.forEach(c => all.push({ ...c, code: p.code, name: p.name }));
  }

  if (!all.length) {
    console.log('  No day disagrees with the policy. Nothing to repair.\n');
    return;
  }

  const moves = new Map();
  all.forEach(c => {
    const k = `${c.from} → ${c.to}`;
    moves.set(k, (moves.get(k) || 0) + 1);
  });

  console.log('  transitions');
  [...moves.entries()].sort((a, b) => b[1] - a[1])
    .forEach(([k, n]) => console.log(`    ${String(n).padStart(5)}  ${k}`));

  console.log(`\n  ${all.length} day(s) ${APPLY ? 'rewritten' : 'would change'}:\n`);
  all.slice(0, 40).forEach(c =>
    console.log(`    ${c.date}  ${String(c.code).padEnd(14)} ${String(c.name).slice(0, 26).padEnd(28)} ${c.from} → ${c.to}`));
  if (all.length > 40) console.log(`    … and ${all.length - 40} more`);

  if (!APPLY) {
    console.log('\n  Re-run with --apply to write these. Keep this output.\n');
  } else {
    console.log('\n  Written. This output is the only record — nothing audit-logs a status re-stamp.\n');
  }
}

main()
  .catch(err => { console.error(`\n  Fatal: ${err.message}\n`); process.exitCode = 1; })
  .finally(() => pool.end());
