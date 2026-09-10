#!/usr/bin/env node
/* Round two. The first pass disproved three of my four explanations, so this
 * asks the questions the data actually raised.
 *
 * READ ONLY. Nothing here writes.
 *
 *   A. Why do live requests end up with NO approval chain? (9 of them, all
 *      with a reporting manager set, all applied through the app on 7 Sept)
 *   B. Who is counted 'In' on the presence donut but not 'Present' on the
 *      status pie? Recomputes both, per person, and diffs them.
 *   C. Are the two pending figures really different right now, or were the
 *      screenshots taken at different moments?
 *
 *   node inspect_defects_round2.js
 *   node inspect_defects_round2.js 2026-09-10
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
const pool = require('./db');

const DATE = process.argv[2] || new Date().toLocaleDateString('en-CA');
const h1 = (s) => console.log(`\n${'═'.repeat(74)}\n  ${s}\n${'═'.repeat(74)}`);
const h2 = (s) => console.log(`\n  ── ${s} ${'─'.repeat(Math.max(0, 64 - s.length))}`);

(async () => {

  /* ══ A. The approval chain that resolves to nobody ═══════════════════════ */
  h1('A. Why 9 live requests have no approval chain');

  h2('Approval rules configured for leave');
  const rules = await pool.query(
    `SELECT id, name, request_type, is_active, sort_order, decision, levels, criteria
       FROM approval_rules
      WHERE request_type = 'leave'
      ORDER BY sort_order, created_at`);

  if (!rules.rows.length) {
    console.log('\n  NONE. So deriveLevels falls through to the built-in parent chain,');
    console.log('  and an empty result would mean the employee has no ancestors at all.');
  } else {
    for (const r of rules.rows) {
      console.log(`\n  "${r.name}"  active=${r.is_active}  order=${r.sort_order}  decision=${r.decision}`);
      const lv = Array.isArray(r.levels) ? r.levels : (r.levels ? JSON.parse(r.levels) : []);
      console.log(`    levels (${lv.length}): ${lv.length ? JSON.stringify(lv) : '‹EMPTY — this resolves to nobody›'}`);
      const cr = Array.isArray(r.criteria) ? r.criteria : (r.criteria ? JSON.parse(r.criteria) : []);
      console.log(`    criteria: ${cr.length ? JSON.stringify(cr) : '(none — matches everything)'}`);
    }
  }

  h2('The 9 employees: do they really have an ancestor chain?');
  const codes = ['ANXT2600162','ANXT2600161','ANXT2600156','ANXT2600141',
                 'ANXT2400134','ANXT2400120','ANXT230098','ANXT220008','ANXT220007'];
  const chain = await pool.query(
    `WITH RECURSIVE walk AS (
       SELECT e.id AS root, e.id, e.reporting_manager_id, 0 AS depth
         FROM employees e WHERE e.employee_id = ANY($1)
       UNION ALL
       SELECT w.root, m.id, m.reporting_manager_id, w.depth + 1
         FROM employees m JOIN walk w ON m.id = w.reporting_manager_id
        WHERE w.depth < 20
     )
     SELECT e.employee_id AS code, TRIM(e.first_name||' '||e.last_name) AS name,
            (SELECT COUNT(*) FROM walk w WHERE w.root = e.id AND w.depth > 0) AS ancestors,
            TRIM(m.first_name||' '||m.last_name) AS manager,
            m.designation AS manager_designation
       FROM employees e
       LEFT JOIN employees m ON m.id = e.reporting_manager_id
      WHERE e.employee_id = ANY($1)
      ORDER BY e.employee_id`, [codes]);

  console.log('');
  for (const r of chain.rows) {
    console.log(`  ${String(r.code).padEnd(13)} ${String(r.name).padEnd(28)}`
      + ` ancestors:${String(r.ancestors).padEnd(3)}`
      + ` manager: ${r.manager || '—'}`
      + (r.manager_designation ? `  (${r.manager_designation})` : ''));
  }
  console.log('\n  ancestors:0 would explain an empty chain on its own. Anything above 0');
  console.log('  means the chain existed and a RULE threw it away.');

  h2('Do OTHER request types have levels, or is this leave-only?');
  const perType = await pool.query(
    `SELECT request_type, COUNT(*)::int AS levels FROM approval_levels GROUP BY 1 ORDER BY 1`);
  for (const r of perType.rows) console.log(`    ${String(r.request_type).padEnd(16)} ${r.levels} level rows`);

  h2('When did leave approval levels stop being written?');
  const lastLevels = await pool.query(
    `SELECT l.created_at::date::text AS day,
            COUNT(*)::int AS leaves,
            COUNT(*) FILTER (WHERE EXISTS (
              SELECT 1 FROM approval_levels x
               WHERE x.request_type='leave' AND x.request_id = l.id))::int AS "withLevels"
       FROM leaves l
      WHERE l.created_at >= NOW() - INTERVAL '30 days'
      GROUP BY 1 ORDER BY 1`);
  console.log('\n    date         applied  with a chain');
  for (const r of lastLevels.rows) {
    const flag = r.withLevels === 0 && r.leaves > 0 ? '   ← none' : '';
    console.log(`    ${r.day}   ${String(r.leaves).padStart(5)}  ${String(r.withLevels).padStart(11)}${flag}`);
  }

  /* ══ B. Present vs In, recomputed per person ═════════════════════════════ */
  h1(`B. Present vs In — the actual difference (${DATE})`);

  /* The pie's 'present' comes from the attendance STATUS; the donut's 'in'
   * comes from the presence of a check-in. Anything with a punch whose status
   * is not present/late/half-day falls to 'absent' → on today that becomes
   * 'pending' and drops OUT of the pie, while the donut still counts it. */
  const punched = await pool.query(
    `SELECT e.employee_id AS code, TRIM(e.first_name||' '||e.last_name) AS name,
            a.status, a.check_in, a.check_out,
            EXISTS (SELECT 1 FROM leaves l
                     WHERE l.employee_id = e.id AND l.status='approved'
                       AND l.start_date <= a.date AND l.end_date >= a.date
                       AND l.leave_type <> 'permission') AS "onLeave",
            EXISTS (SELECT 1 FROM manual_attendance_assignments m
                     WHERE m.employee_id = e.id) AS "markedForThem"
       FROM attendance a JOIN employees e ON e.id = a.employee_id
      WHERE a.date = $1::date AND a.check_in IS NOT NULL
      ORDER BY a.status, e.employee_id`, [DATE]);

  const byStatus = {};
  for (const r of punched.rows) byStatus[r.status || '(null)'] = (byStatus[r.status || '(null)'] || 0) + 1;
  console.log('\n  attendance rows WITH a check-in today, by status:');
  for (const [k, v] of Object.entries(byStatus)) console.log(`    ${String(k).padEnd(14)} ${v}`);

  const COUNTS_AS_PRESENT = new Set(['present', 'late', 'half-day']);
  const oddities = punched.rows.filter(r => !COUNTS_AS_PRESENT.has(r.status) && !r.onLeave && !r.markedForThem);
  console.log(`\n  punched in, but the status does NOT classify as present: ${oddities.length}`);
  for (const r of oddities) {
    console.log(`    ${String(r.code).padEnd(13)} ${String(r.name).padEnd(28)}`
      + ` status='${r.status}'  in=${String(r.check_in).slice(11, 16)}`
      + `  out=${r.check_out ? String(r.check_out).slice(11, 16) : '—'}`);
  }
  console.log('\n  Each of these is In on the donut and in NO slice of the pie.');

  const stillIn = punched.rows.filter(r => !r.check_out && !r.markedForThem).length;
  const presentish = punched.rows.filter(r => COUNTS_AS_PRESENT.has(r.status) && !r.onLeave && !r.markedForThem).length;
  console.log(`\n  donut 'In'  (punched, not checked out, tracked)   ${stillIn}`);
  console.log(`  pie 'Present' (status present/late/half-day)      ${presentish}`);
  console.log(`  difference                                        ${stillIn - presentish}`);

  h2('Anybody on approved leave who also punched in');
  const both = punched.rows.filter(r => r.onLeave);
  console.log(`\n  ${both.length} — this was my first explanation, and it was wrong.`);
  for (const r of both) console.log(`    ${r.code}  ${r.name}  status='${r.status}'`);

  /* ══ C. The two pending figures, right now ═══════════════════════════════ */
  h1('C. The two pending figures at this exact moment');

  const now = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM leaves WHERE status='pending')                       AS "orgTile",
       (SELECT COUNT(*)::int FROM leaves l JOIN employees e ON e.id=l.employee_id
         WHERE l.status='pending' AND e.deleted_at IS NULL)                            AS "approvals",
       (SELECT COUNT(*)::int FROM leaves l JOIN employees e ON e.id=l.employee_id
         WHERE l.status='pending' AND e.deleted_at IS NULL AND l.leave_type='permission') AS "permissions",
       (SELECT COUNT(*)::int FROM leaves l JOIN employees e ON e.id=l.employee_id
         WHERE l.status='pending' AND e.deleted_at IS NULL AND l.leave_type<>'permission') AS "leaves"`);
  const n = now.rows[0];
  console.log(`\n  Organization tile   ${n.orgTile}`);
  console.log(`  Leave Approvals     ${n.approvals}   (leaves ${n.leaves} + permissions ${n.permissions})`);
  console.log(`  difference          ${n.orgTile - n.approvals}`);

  h2('When each pending request arrived');
  const when = await pool.query(
    `SELECT l.created_at AT TIME ZONE 'Asia/Kolkata' AS ist, l.leave_type,
            e.employee_id AS code, TRIM(e.first_name||' '||e.last_name) AS name
       FROM leaves l JOIN employees e ON e.id = l.employee_id
      WHERE l.status='pending' AND e.deleted_at IS NULL
      ORDER BY l.created_at`);
  console.log('');
  for (const r of when.rows) {
    console.log(`    ${new Date(r.ist).toISOString().slice(0, 16).replace('T', ' ')}`
      + `  ${String(r.leave_type).padEnd(11)} ${String(r.code).padEnd(13)} ${r.name}`);
  }
  console.log('\n  If the newest arrived between the two screenshots, 12 vs 13 was timing,');
  console.log('  not a counting bug.');

  console.log('');
  await pool.end();
})().catch(async e => {
  console.error(e);
  try { await pool.end(); } catch {}
  process.exit(1);
});
