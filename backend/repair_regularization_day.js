/* ── Undo the regularizations on one person's day ───────────────────────────
 *  For a request approved against the WRONG DATE. It removes the requests, the
 *  stints their approval created, and the hours those stints put on the day —
 *  leaving the real punches exactly as they are, so the person can file again
 *  against the right date.
 *
 *  Why it is needed: entry mode is 'create', so each approved request added a
 *  stint. Two requests for 2026-09-18 left that day holding 17.72 hours.
 *  routes/regularizations.js no longer double-counts, but a fix in the code
 *  does not undo a day already written.
 *
 *  DRY RUN BY DEFAULT. It prints what it would remove and changes nothing.
 *
 *    EMP=ANXT220002 DATE=2026-09-18 node repair_regularization_day.js
 *    EMP=ANXT220002 DATE=2026-09-18 APPLY=1 node repair_regularization_day.js
 *
 *  A stint is treated as approval-made only when BOTH its times match a
 *  request on that day exactly. A punch the person actually made is never
 *  touched, and neither is any other date.
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
process.env.LOG_LEVEL = 'silent';
const pool = require('./db');
const { DEFAULT_TZ } = require('./utils/timezone');

const APPLY = process.env.APPLY === '1' || process.argv.includes('--apply');
const EMP = process.env.EMP;
const DATE = process.env.DATE;
const hhmm = t => String(t || '').slice(0, 5) || '—';

(async () => {
  console.log(`\n  UNDO REGULARIZATIONS ON ONE DAY  [undo-reg v1]  ${APPLY ? '*** APPLYING ***' : '(dry run — nothing will change)'}\n`);
  if (!EMP || !DATE) {
    console.log('  Needs EMP=<employee id> and DATE=<yyyy-mm-dd>.\n');
    await pool.end(); return;
  }

  const emp = (await pool.query(
    `SELECT id, employee_id, first_name, last_name FROM employees WHERE employee_id = $1`, [EMP])).rows[0];
  if (!emp) { console.log(`  No employee with ID "${EMP}".\n`); await pool.end(); return; }
  console.log(`  ${emp.employee_id}  ${emp.first_name} ${emp.last_name}   ${DATE}\n`);

  const regs = (await pool.query(
    `SELECT id, check_in, check_out, reason, status
       FROM attendance_regularizations
      WHERE employee_id = $1 AND date = $2::date
      ORDER BY created_at`, [emp.id, DATE])).rows;
  if (!regs.length) { console.log('  No regularization on that date. Nothing to undo.\n'); await pool.end(); return; }

  console.log('  REQUESTS TO REMOVE');
  regs.forEach(r => console.log(`    ${hhmm(r.check_in)} – ${hhmm(r.check_out)}   ${r.status.padEnd(9)} ${r.reason}`));

  const day = (await pool.query(
    `SELECT id, working_hours::float AS hours, status,
            TO_CHAR(check_in  AT TIME ZONE 'UTC' AT TIME ZONE '${DEFAULT_TZ}', 'HH24:MI') AS cin,
            TO_CHAR(check_out AT TIME ZONE 'UTC' AT TIME ZONE '${DEFAULT_TZ}', 'HH24:MI') AS cout
       FROM attendance WHERE employee_id = $1 AND date = $2::date`, [emp.id, DATE])).rows[0];
  if (!day) { console.log('\n  No attendance row for that date — only the requests would be removed.'); }

  const sessions = (await pool.query(
    `SELECT id, session_hours::float AS hours,
            TO_CHAR(check_in  AT TIME ZONE 'UTC' AT TIME ZONE '${DEFAULT_TZ}', 'HH24:MI:SS') AS in_local,
            TO_CHAR(check_out AT TIME ZONE 'UTC' AT TIME ZONE '${DEFAULT_TZ}', 'HH24:MI:SS') AS out_local
       FROM attendance_sessions WHERE employee_id = $1 AND date = $2::date ORDER BY check_in`,
    [emp.id, DATE])).rows;

  const madeByApproval = (s) => !!s.out_local && regs.some(
    r => String(r.check_in) === s.in_local && String(r.check_out) === s.out_local);
  const toDelete = sessions.filter(madeByApproval);
  const keep = sessions.filter(s => !madeByApproval(s));

  console.log('\n  STINTS ON THE DAY');
  sessions.forEach(s => console.log(
    `    ${hhmm(s.in_local)} – ${hhmm(s.out_local)}   ${String(s.hours).padEnd(12)} ${madeByApproval(s) ? 'REMOVE (made by an approval)' : 'keep (a real punch)'}`));

  const keptHours = parseFloat(keep.reduce((n, s) => n + (s.hours || 0), 0).toFixed(8));
  const stillOpen = keep.some(s => !s.out_local);
  const firstIn = keep.length ? keep[0].in_local : null;
  const lastOut = stillOpen ? null : (keep.filter(s => s.out_local).slice(-1)[0]?.out_local || null);

  console.log('\n  THE DAY');
  console.log(`    now        ${day ? `${day.cin || '—'} – ${day.cout || 'still open'}   ${day.hours} hours   ${day.status}` : 'no row'}`);
  console.log(`    afterwards ${firstIn ? hhmm(firstIn) : '—'} – ${stillOpen ? 'still open' : (lastOut ? hhmm(lastOut) : '—')}   ${keptHours} hours   ${day ? day.status : '—'} (unchanged)`);
  console.log('\n    The status is left alone: a day still in progress is judged when the person checks out.');

  if (!APPLY) {
    console.log('\n  Dry run. Nothing was removed.\n');
    await pool.end(); return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (toDelete.length) {
      await client.query('DELETE FROM attendance_sessions WHERE id = ANY($1::uuid[])', [toDelete.map(s => s.id)]);
    }
    await client.query(
      `DELETE FROM approval_levels WHERE request_type = 'regularization' AND request_id = ANY($1::uuid[])`,
      [regs.map(r => r.id)]);
    await client.query('DELETE FROM attendance_regularizations WHERE id = ANY($1::uuid[])', [regs.map(r => r.id)]);
    if (day) {
      await client.query(
        `UPDATE attendance
            SET working_hours = $1,
                check_in = CASE WHEN $2::text IS NULL THEN check_in
                                ELSE (($3::date + $2::time) AT TIME ZONE '${DEFAULT_TZ}' AT TIME ZONE 'UTC') END,
                check_out = CASE WHEN $4::boolean THEN NULL
                                 WHEN $5::text IS NULL THEN check_out
                                 ELSE (($3::date + $5::time) AT TIME ZONE '${DEFAULT_TZ}' AT TIME ZONE 'UTC') END,
                updated_at = NOW()
          WHERE id = $6`,
        [keptHours, firstIn, DATE, stillOpen, lastOut, day.id]);
    }
    await client.query('COMMIT');
    console.log(`\n  Removed ${regs.length} request(s) and ${toDelete.length} stint(s). The day now holds ${keptHours} hours.`);
    console.log('  The real punches were left as they were.\n');
  } catch (err) {
    await client.query('ROLLBACK');
    console.log(`\n  Nothing was changed — ${err.message}\n`);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})().catch(async (e) => { console.error(`\n  Fatal: ${e.message}\n`); process.exitCode = 1; await pool.end().catch(() => {}); });
