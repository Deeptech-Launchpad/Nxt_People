#!/usr/bin/env node
/* Confirms the root cause of four reported defects, on live data.
 *
 * READ ONLY. Nothing here writes, updates or deletes.
 *
 *   1. Permission cannot be added from Operations → Leave Requests
 *   2. View on Leave Approvals shows no reporting person
 *   3. "Present 47" in the status pie vs "In 48" in the presence donut
 *   4. "Pending 13" on Organization vs "Total Pending 12" on Leave Approvals
 *
 *   node inspect_four_defects.js
 *   node inspect_four_defects.js 2026-09-09     (a specific date for check 3)
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
const pool = require('./db');

const DATE = process.argv[2] || new Date().toLocaleDateString('en-CA');
const h1 = (s) => console.log(`\n${'═'.repeat(74)}\n  ${s}\n${'═'.repeat(74)}`);
const h2 = (s) => console.log(`\n  ── ${s} ${'─'.repeat(Math.max(0, 66 - s.length))}`);

(async () => {

  /* ── 1. Permission requests ──────────────────────────────────────────────
   * The Ops "Add Request" form posts no startTime/endTime, and the endpoint
   * refuses permission without them. It also refuses ANY back-dated request,
   * including one an admin is filing on somebody's behalf. */
  h1('1. Permission requests — what the data says about the two blocks');

  const permShape = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE start_time IS NULL OR end_time IS NULL) AS "missingTimes",
            COUNT(*)                                                       AS "total"
       FROM leaves WHERE leave_type = 'permission'`);
  console.log(`\n  permission rows                 ${permShape.rows[0].total}`);
  console.log(`  ...with no start/end time       ${permShape.rows[0].missingTimes}`
    + `   ← these could not have come from the Ops form`);

  h2('Hema, Sept 8 — the reported case');
  const hema = await pool.query(
    `SELECT e.employee_id AS code, TRIM(e.first_name || ' ' || e.last_name) AS name,
            l.leave_type, l.start_date::text AS start, l.hours,
            l.start_time::text AS "from", l.end_time::text AS "to", l.status, l.created_at
       FROM leaves l JOIN employees e ON e.id = l.employee_id
      WHERE e.first_name ILIKE '%hema%'
        AND l.start_date BETWEEN '2026-09-01' AND '2026-09-30'
      ORDER BY l.start_date`);
  if (!hema.rows.length) {
    console.log('\n  No September leave on file for Hema in NxtPeople at all.');
    console.log('  That matches the report: it exists in Zoho and was never applied here.');
  } else {
    for (const r of hema.rows) {
      console.log(`  ${r.start}  ${String(r.leave_type).padEnd(11)} ${r.status.padEnd(9)}`
        + ` ${r.hours ? `${r.hours}h ${r.from || '?'}–${r.to || '?'}` : ''}`);
    }
  }

  h2('What the attendance row for Hema on 8 Sept actually says');
  const hemaAtt = await pool.query(
    `SELECT e.employee_id AS code, TRIM(e.first_name || ' ' || e.last_name) AS name,
            a.date::text AS date, a.status, a.check_in, a.check_out
       FROM attendance a JOIN employees e ON e.id = a.employee_id
      WHERE e.first_name ILIKE '%hema%' AND a.date = '2026-09-08'`);
  for (const r of hemaAtt.rows) {
    console.log(`  ${r.name} (${r.code})  status='${r.status}'  in=${r.check_in || '—'}  out=${r.check_out || '—'}`);
  }
  if (!hemaAtt.rows.length) console.log('  No attendance row for 8 Sept.');

  /* ── 2. Requests with no approval chain ──────────────────────────────────
   * The timeline renders `approval_levels`. A request with none shows the
   * bare "Request Submitted → Pending" fallback and can name no approver. */
  h1('2. Pending requests that have NO approval levels');

  const orphans = await pool.query(
    `SELECT l.id, e.employee_id AS code,
            TRIM(e.first_name || ' ' || e.last_name) AS name,
            l.leave_type, l.start_date::text AS start, l.status,
            l.created_at::date::text AS created,
            l.reason,
            e.reporting_manager_id IS NULL AS "noManager",
            (SELECT COUNT(*) FROM approval_levels x
              WHERE x.request_type = 'leave' AND x.request_id = l.id) AS levels
       FROM leaves l JOIN employees e ON e.id = l.employee_id
      WHERE l.status = 'pending'
      ORDER BY levels ASC, l.created_at DESC`);

  const withNone = orphans.rows.filter(r => Number(r.levels) === 0);
  console.log(`\n  pending leave/permission rows   ${orphans.rows.length}`);
  console.log(`  ...with NO approval levels      ${withNone.length}`
    + `   ← every one of these shows an empty timeline`);

  if (withNone.length) {
    console.log('');
    for (const r of withNone) {
      console.log(`  ${String(r.code || '—').padEnd(13)} ${String(r.name).padEnd(26)}`
        + ` ${String(r.leave_type).padEnd(11)} ${r.start}`
        + `  manager:${r.noManager ? 'NONE' : 'set'}`
        + `  created:${r.created}`);
      if (r.reason) console.log(`  ${' '.repeat(13)} reason: ${String(r.reason).slice(0, 60)}`);
    }
    console.log('\n  "Imported from Zoho" as the reason, or a created date matching the');
    console.log('  migration, means the row never went through the apply endpoint and so');
    console.log('  no approval chain was ever built for it.');
  }

  h2('Does the employee even have a reporting manager?');
  const noMgr = await pool.query(
    `SELECT e.employee_id AS code, TRIM(e.first_name || ' ' || e.last_name) AS name, e.role
       FROM employees e
      WHERE e.reporting_manager_id IS NULL
        AND e.deleted_at IS NULL AND e.status = 'active' AND e.is_user = true
      ORDER BY e.employee_id`);
  console.log(`\n  active users with no reporting manager: ${noMgr.rows.length}`);
  for (const r of noMgr.rows) console.log(`    ${String(r.code).padEnd(13)} ${String(r.name).padEnd(26)} ${r.role}`);

  /* ── 3. Status pie vs presence donut ─────────────────────────────────────
   * The pie counts what the DAY was (classifyAttendanceDay: an approved leave
   * beats a punch). The donut counts whether the person is AT THEIR DESK.
   * Somebody on leave who also punched in is 'paidLeave' in one and 'in' in
   * the other — a difference of exactly one, which is what was reported. */
  h1(`3. Present vs In — who is counted differently (${DATE})`);

  const both = await pool.query(
    `SELECT e.employee_id AS code, TRIM(e.first_name || ' ' || e.last_name) AS name,
            a.check_in, a.check_out, a.status AS att_status,
            l.leave_type, l.is_half_day AS "isHalfDay", l.hours,
            l.start_time::text AS "from", l.end_time::text AS "to"
       FROM attendance a
       JOIN employees e ON e.id = a.employee_id
       JOIN leaves l ON l.employee_id = a.employee_id
                    AND l.status = 'approved'
                    AND l.start_date <= a.date AND l.end_date >= a.date
      WHERE a.date = $1::date AND a.check_in IS NOT NULL
      ORDER BY e.employee_id`, [DATE]);

  console.log(`\n  people who BOTH punched in and hold an approved leave: ${both.rows.length}`);
  for (const r of both.rows) {
    console.log(`    ${String(r.code).padEnd(13)} ${String(r.name).padEnd(26)}`
      + ` ${String(r.leave_type).padEnd(11)}`
      + ` ${r.hours ? `${r.hours}h ${r.from || ''}–${r.to || ''}` : (r.isHalfDay ? 'half day' : 'full day')}`
      + `  punched ${String(r.check_in).slice(11, 16)}`);
  }
  console.log('\n  Each of these is counted once in the pie (as leave, because the leave');
  console.log('  classifies the day) and once in the donut (as In, because they punched).');
  console.log('  That is the whole of the Present-47 / In-48 gap.');

  /* ── 4. The two pending figures ──────────────────────────────────────────
   * Organization  : SELECT COUNT(*) FROM leaves WHERE status='pending'
   * Leave Approvals: the same, but joined to employees with deleted_at IS NULL,
   *                  and split across seven request types.
   */
  h1('4. Pending 13 vs Total Pending 12 — where the extra row is');

  const raw = await pool.query(`SELECT COUNT(*)::int AS n FROM leaves WHERE status = 'pending'`);
  const joined = await pool.query(
    `SELECT COUNT(*)::int AS n FROM leaves l JOIN employees e ON e.id = l.employee_id
      WHERE l.status = 'pending' AND e.deleted_at IS NULL`);
  const byType = await pool.query(
    `SELECT CASE WHEN l.leave_type = 'permission' THEN 'permission' ELSE 'leave' END AS bucket,
            COUNT(*)::int AS n
       FROM leaves l JOIN employees e ON e.id = l.employee_id
      WHERE l.status = 'pending' AND e.deleted_at IS NULL
      GROUP BY 1 ORDER BY 1`);

  console.log(`\n  Organization tile    (no join, no filter)      ${raw.rows[0].n}`);
  console.log(`  Leave Approvals      (live employees only)     ${joined.rows[0].n}`);
  for (const r of byType.rows) console.log(`      of which ${String(r.bucket).padEnd(12)} ${r.n}`);
  console.log(`\n  difference                                    ${raw.rows[0].n - joined.rows[0].n}`);

  h2('The rows the Organization tile counts and Approvals does not');
  const extra = await pool.query(
    `SELECT l.id, l.leave_type, l.start_date::text AS start, l.created_at::date::text AS created,
            e.employee_id AS code, TRIM(e.first_name || ' ' || e.last_name) AS name,
            e.deleted_at IS NOT NULL AS "softDeleted",
            e.status AS emp_status
       FROM leaves l LEFT JOIN employees e ON e.id = l.employee_id
      WHERE l.status = 'pending'
        AND (e.id IS NULL OR e.deleted_at IS NOT NULL)
      ORDER BY l.created_at DESC`);

  if (!extra.rows.length) {
    console.log('\n  None. The two figures differ for some other reason — compare the');
    console.log('  numbers printed above against what each screen shows.');
  } else {
    for (const r of extra.rows) {
      console.log(`  ${String(r.code || 'ORPHAN').padEnd(13)} ${String(r.name || '(employee row missing)').padEnd(28)}`
        + ` ${String(r.leave_type).padEnd(11)} ${r.start}`
        + `  ${r.softDeleted ? 'employee soft-deleted' : 'no employee row'}`);
    }
  }

  console.log('');
  await pool.end();
})().catch(async e => {
  console.error(e);
  try { await pool.end(); } catch {}
  process.exit(1);
});
