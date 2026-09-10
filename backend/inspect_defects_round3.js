#!/usr/bin/env node
/* Two loose ends. READ ONLY.
 *
 *   A. Manoj Subramaniam has a check-in AND status='absent'. Neither the
 *      check-in path (writes present/late) nor the checkout path (he has no
 *      checkout) can produce that. So what did?
 *
 *   B. Were the 9 chainless requests a bulk import? Nine identical minutes and
 *      58 leaves in one day with no chains says yes, but seconds-level
 *      timestamps settle it.
 *
 *   node inspect_defects_round3.js
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
const pool = require('./db');

const h1 = (s) => console.log(`\n${'═'.repeat(74)}\n  ${s}\n${'═'.repeat(74)}`);

(async () => {

  h1('A. The attendance row that is checked in and marked absent');

  const cols = (await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'attendance' AND column_name IN ('source','is_manual','work_mode_source')`
  )).rows.map(r => r.column_name);
  const sourceCol = cols.includes('source') ? ', a.source' : '';

  const manoj = await pool.query(
    `SELECT e.employee_id AS code, TRIM(e.first_name||' '||e.last_name) AS name,
            a.date::text AS date, a.status,
            to_char(a.check_in  AT TIME ZONE 'Asia/Kolkata', 'HH24:MI:SS') AS "inIst",
            to_char(a.check_out AT TIME ZONE 'Asia/Kolkata', 'HH24:MI:SS') AS "outIst",
            a.working_hours, a.late_minutes,
            to_char(a.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS') AS "createdIst",
            to_char(a.updated_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS') AS "updatedIst"
            ${sourceCol}
       FROM attendance a JOIN employees e ON e.id = a.employee_id
      WHERE e.employee_id = 'ANXT2500139'
        AND a.date >= CURRENT_DATE - 7
      ORDER BY a.date DESC`);

  console.log('');
  for (const r of manoj.rows) {
    console.log(`  ${r.date}  status='${r.status}'  in=${r.inIst || '—'}  out=${r.outIst || '—'}`
      + `  hrs=${r.working_hours ?? '—'}  late=${r.late_minutes ?? '—'}`);
    console.log(`              created ${r.createdIst}   updated ${r.updatedIst}`
      + (r.source !== undefined ? `   source=${r.source ?? '—'}` : ''));
  }

  console.log('\n  If created and updated match the restage run rather than his own punch,');
  console.log("  the row came from the import carrying Zoho's own verdict for a day that");
  console.log('  is not over yet.');

  console.log('\n  ── Everyone else in the same state today ──');
  const sameState = await pool.query(
    `SELECT e.employee_id AS code, TRIM(e.first_name||' '||e.last_name) AS name,
            a.status, a.working_hours,
            to_char(a.created_at AT TIME ZONE 'Asia/Kolkata', 'MM-DD HH24:MI') AS created
       FROM attendance a JOIN employees e ON e.id = a.employee_id
      WHERE a.date = CURRENT_DATE
        AND a.check_in IS NOT NULL
        AND a.status NOT IN ('present','late','half-day')
      ORDER BY e.employee_id`);
  if (!sameState.rows.length) console.log('    none besides the row above');
  for (const r of sameState.rows) {
    console.log(`    ${String(r.code).padEnd(13)} ${String(r.name).padEnd(28)} status='${r.status}'`
      + `  hrs=${r.working_hours ?? '—'}  created ${r.created}`);
  }

  h1('B. Were the chainless requests written by the import?');

  const clusters = await pool.query(
    `SELECT to_char(l.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS') AS ist,
            COUNT(*)::int AS n,
            COUNT(DISTINCT l.employee_id)::int AS people,
            COUNT(*) FILTER (WHERE EXISTS (
              SELECT 1 FROM approval_levels x
               WHERE x.request_type='leave' AND x.request_id = l.id))::int AS "withChain"
       FROM leaves l
      WHERE l.created_at >= NOW() - INTERVAL '20 days'
      GROUP BY 1
     HAVING COUNT(*) > 1
      ORDER BY 1`);

  console.log('\n  Timestamps shared by more than one request (to the second):\n');
  console.log('    when (IST)             requests  people  with a chain');
  for (const r of clusters.rows) {
    console.log(`    ${r.ist}   ${String(r.n).padStart(6)}  ${String(r.people).padStart(6)}`
      + `  ${String(r.withChain).padStart(12)}`);
  }
  console.log('\n  A dozen people applying in the same SECOND is a script, not a queue');
  console.log('  of employees. Nothing written by a script ever gets an approval chain,');
  console.log('  because the import inserts into `leaves` directly.');

  const soloRecent = await pool.query(
    `SELECT to_char(l.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS') AS ist,
            e.employee_id AS code, l.leave_type,
            EXISTS (SELECT 1 FROM approval_levels x
                     WHERE x.request_type='leave' AND x.request_id = l.id) AS "hasChain"
       FROM leaves l JOIN employees e ON e.id = l.employee_id
      WHERE l.created_at >= NOW() - INTERVAL '4 days'
      ORDER BY l.created_at DESC LIMIT 15`);
  console.log('\n  ── The most recent requests, and whether each got a chain ──\n');
  for (const r of soloRecent.rows) {
    console.log(`    ${r.ist}  ${String(r.code).padEnd(13)} ${String(r.leave_type).padEnd(11)}`
      + `  chain: ${r.hasChain ? 'yes' : 'NO'}`);
  }

  console.log('');
  await pool.end();
})().catch(async e => {
  console.error(e);
  try { await pool.end(); } catch {}
  process.exit(1);
});
