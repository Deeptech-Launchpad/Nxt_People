/* ── Hours counted twice ───────────────────────────────────────────────────
 *  Some rows store more working_hours than the day is long. On live, two
 *  people on 15 July hold 11.47h and 10.65h against days only ~8.52h from
 *  first arrival to last exit. Nobody works eleven hours inside eight.
 *
 *  The cause is a double check-out. routes/attendance.js accumulates:
 *
 *      working_hours = previous + this session
 *
 *  and two concurrent check-outs both passed the "already checked out?" guard,
 *  so both added their session. The UPDATE now carries
 *  `WHERE id = $7 AND check_out IS NULL`, which stops it — its comment records
 *  that this "used to overstate the day". Rows written before that guard still
 *  carry the inflation.
 *
 *  This is the only finding on this database that overstates hours rather than
 *  mislabelling a time. Every other one left working_hours correct, so this is
 *  the only one that could change what somebody is owed — which is exactly why
 *  it is a separate script that says what it would write and waits.
 *
 *  Where the corrected figure comes from, in order of preference:
 *
 *    sessions   SUM(session_hours), gaps excluded — but only when the first
 *               session starts at the true arrival. Otherwise recording began
 *               partway through and their sum is a fraction of the work.
 *    span       last exit minus the TRUE arrival, which is the earlier of
 *               check_in and created_at. Measuring from check_in alone treats
 *               an overwritten arrival as if the person turned up mid-
 *               afternoon: a first draft did that and proposed taking Manoj
 *               from 9.58h to 0.63h, destroying nearly nine real hours.
 *
 *  A row is only repaired when the chosen figure is LOWER than what is stored.
 *  This script exists to remove inflation, never to add hours.
 *
 *    docker compose exec backend node repair_overstated_hours.js
 *    docker compose exec backend node repair_overstated_hours.js --apply
 * ────────────────────────────────────────────────────────────────────────── */
const pool = require('./db');

const APPLY = process.argv.includes('--apply');
const TOLERANCE_H = 0.05;

const TZ = 'Asia/Kolkata';
const clock = (v) => {
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d) ? String(v) : d.toLocaleTimeString('en-GB', { timeZone: TZ, hour12: false });
};
const h2 = (n) => Number(n).toFixed(2);

(async () => {
  console.log(`\n  Hours counted twice — ${APPLY ? 'APPLYING' : 'DRY RUN, nothing will be written'}\n`);

  const rows = (await pool.query(
    `SELECT a.id, e.employee_id AS code, TRIM(CONCAT(e.first_name,' ',e.last_name)) AS name,
            a.date::text AS d, a.check_in, a.check_out, a.working_hours, a.status,
            LEAST(a.check_in, a.created_at) AS true_arrival,
            EXTRACT(EPOCH FROM (a.check_out - LEAST(a.check_in, a.created_at)))/3600.0 AS span_h,
            (SELECT COUNT(*) FROM attendance_sessions ss
              WHERE ss.employee_id = a.employee_id AND ss.date = a.date)::int AS sessions,
            (SELECT MIN(ss.check_in) FROM attendance_sessions ss
              WHERE ss.employee_id = a.employee_id AND ss.date = a.date) AS first_session,
            (SELECT COALESCE(SUM(ss.session_hours), 0) FROM attendance_sessions ss
              WHERE ss.employee_id = a.employee_id AND ss.date = a.date) AS session_total
       FROM attendance a
       JOIN employees e ON e.id = a.employee_id
      WHERE a.check_in IS NOT NULL AND a.check_out IS NOT NULL
        -- More hours than the day can account for, where the day runs from the
        -- TRUE arrival — the earlier of check_in and created_at — to the last
        -- exit. Measuring from check_in alone treats an overwritten arrival as
        -- if the person turned up mid-afternoon.
        AND COALESCE(a.working_hours, 0)
            - EXTRACT(EPOCH FROM (a.check_out - LEAST(a.check_in, a.created_at)))/3600.0 > $1
      ORDER BY a.date`, [TOLERANCE_H])).rows;

  if (!rows.length) {
    console.log('  No row stores more hours than its day is long.\n');
    await pool.end();
    return;
  }

  const fixable = [], skipped = [];
  for (const r of rows) {
    const stored = Number(r.working_hours);
    const span = Number(r.span_h);
    const sessionSum = Number(r.session_total);

    // Sessions win when they exist and are themselves credible: their sum
    // cannot exceed the span either, or they carry the same double count.
    let corrected, source;
    // Sessions are only the whole story when the first of them starts at the
    // true arrival. Otherwise recording began partway through the day and
    // their sum is a fraction of what was worked.
    const sessionsCoverDay = r.sessions > 0 && r.first_session
      && Math.abs(new Date(r.first_session) - new Date(r.true_arrival)) / 60000 <= 2;
    if (sessionsCoverDay && sessionSum > 0 && sessionSum - span <= TOLERANCE_H) {
      corrected = sessionSum; source = `${r.sessions} session(s)`;
    } else if (sessionsCoverDay && sessionSum - span > TOLERANCE_H) {
      skipped.push({ r, why: `sessions total ${h2(sessionSum)}h, which also exceeds the ${h2(span)}h day` });
      continue;
    } else {
      corrected = span; source = 'the span between the punches';
    }

    if (!(corrected > 0)) { skipped.push({ r, why: 'no credible figure to fall back on' }); continue; }
    if (corrected >= stored - TOLERANCE_H) {
      skipped.push({ r, why: `corrected figure ${h2(corrected)}h is not lower than the stored ${h2(stored)}h` });
      continue;
    }
    fixable.push({ r, stored, corrected, source });
  }

  if (fixable.length) {
    console.log(`  ${fixable.length} row(s) to bring back down:\n`);
    let removed = 0;
    for (const { r, stored, corrected, source } of fixable) {
      removed += stored - corrected;
      console.log(`    ${r.code.padEnd(14)} ${r.d}   day runs ${clock(r.true_arrival)} - ${clock(r.check_out)}`
                + (String(r.true_arrival) !== String(r.check_in) ? `   (check_in says ${clock(r.check_in)})` : ''));
      console.log(`    ${''.padEnd(14)} ${''.padEnd(10)}   ${h2(stored)}h  ->  ${h2(corrected)}h`
                + `   (from ${source}; ${h2(stored - corrected)}h of double count removed)`);
    }
    console.log(`\n    ${h2(removed)} hour(s) of inflation in total.`);
  }

  if (skipped.length) {
    console.log(`\n  ${skipped.length} row(s) left alone:\n`);
    for (const { r, why } of skipped) console.log(`    ${r.code.padEnd(14)} ${r.d}   ${why}`);
  }

  if (!fixable.length) { console.log('\n  Nothing to repair.\n'); await pool.end(); return; }

  if (!APPLY) {
    console.log(`\n  Nothing was written. Re-run with --apply to make these changes.`);
    console.log(`  Only working_hours moves, and only downwards. Punches and status stay.\n`);
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let n = 0;
    for (const { r, corrected } of fixable) {
      // Guarded again inside the transaction: if anything changed the row
      // between the preview and now, this writes nothing rather than
      // overwriting a figure somebody has since corrected by hand.
      const res = await client.query(
        `UPDATE attendance SET working_hours = $2, updated_at = NOW()
          WHERE id = $1 AND working_hours = $3`,
        [r.id, corrected, r.working_hours]);
      n += res.rowCount;
    }
    await client.query('COMMIT');
    console.log(`\n  ${n} of ${fixable.length} row(s) repaired.`);
    if (n !== fixable.length) {
      console.log('  The rest changed since the preview and were left untouched.');
    }
    console.log('  Punches and statuses were not modified.\n');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\n  Repair failed and was rolled back:', err.message, '\n');
    process.exitCode = 1;
  } finally { client.release(); }

  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
