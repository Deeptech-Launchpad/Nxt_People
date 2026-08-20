/* ── Recover arrivals from before sessions were recorded ───────────────────
 *  repair_first_checkin.js rebuilds an overwritten arrival from
 *  attendance_sessions. That only works for days where sessions exist — on
 *  live they begin around late July, so the fourteen rows it repaired were all
 *  24 July onwards, while 7 and 16 July survived untouched.
 *
 *  For those older rows there is still a witness: attendance.created_at. The
 *  row is created by the first check-in of the day and never re-created, so
 *  created_at is when the person actually arrived, even after check_in was
 *  overwritten by a later tap.
 *
 *  That is a claim, not a certainty, so it is proved per row before anything is
 *  written. If the arrival really was created_at, then
 *
 *      check_out - created_at  ==  working_hours
 *
 *  because working_hours was accumulated by the check-out that ran before the
 *  overwrite. Indhumathi on 7 July: created 09:44:59, checked out 18:18:18,
 *  stored 8.55h — and 09:44:59 to 18:18:18 is 8h 33m, which is 8.55h exactly.
 *  Rows where that arithmetic does not hold are listed and left alone.
 *
 *  Lateness is restored with it. Her row reads 528 minutes late because it was
 *  recomputed against the overwritten 18:18 arrival; against her real 09:44:59
 *  and a 09:30 shift she was fourteen minutes late. The rule is the one in
 *  routes/attendance.js: minutes past shift start, with a fifteen-minute grace
 *  deciding only whether the status flips to 'late'.
 *
 *    docker compose exec backend node repair_lost_checkin_legacy.js
 *    docker compose exec backend node repair_lost_checkin_legacy.js --apply
 * ────────────────────────────────────────────────────────────────────────── */
const pool = require('./db');

const APPLY = process.argv.includes('--apply');
const TOLERANCE_H = 0.05;      // the same tolerance reconcile_live.js uses
const GRACE_MINS = 15;

const TZ = 'Asia/Kolkata';
const clock = (v) => {
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d) ? String(v) : d.toLocaleTimeString('en-GB', { timeZone: TZ, hour12: false });
};
const minsOfDay = (v) => {
  const d = v instanceof Date ? v : new Date(v);
  const parts = d.toLocaleTimeString('en-GB', { timeZone: TZ, hour12: false }).split(':');
  return Number(parts[0]) * 60 + Number(parts[1]);
};

(async () => {
  console.log(`\n  Recover pre-session arrivals — ${APPLY ? 'APPLYING' : 'DRY RUN, nothing will be written'}\n`);

  const rows = (await pool.query(
    `SELECT a.id, e.employee_id AS code, TRIM(CONCAT(e.first_name,' ',e.last_name)) AS name,
            a.date::text AS d, a.check_in, a.check_out, a.working_hours,
            a.late_minutes, a.status, a.created_at,
            s.start_time AS shift_start,
            (SELECT COUNT(*) FROM attendance_sessions ss
              WHERE ss.employee_id = a.employee_id AND ss.date = a.date)::int AS sessions
       FROM attendance a
       JOIN employees e ON e.id = a.employee_id
       LEFT JOIN shifts s ON s.id = e.shift_id
      WHERE a.check_in IS NOT NULL AND a.check_out IS NOT NULL
        AND COALESCE(a.working_hours, 0) > 0.05
        AND EXTRACT(EPOCH FROM (a.check_out - a.check_in))/3600.0 < 0.05
      ORDER BY a.date`)).rows;

  if (!rows.length) {
    console.log('  No rows with hours stored against punches moments apart.\n');
    await pool.end();
    return;
  }

  const repairable = [], rejected = [];
  for (const r of rows) {
    if (r.sessions > 0) { rejected.push({ r, why: 'has sessions — use repair_first_checkin.js' }); continue; }
    const impliedH = (new Date(r.check_out) - new Date(r.created_at)) / 3600000;
    const diff = Math.abs(impliedH - Number(r.working_hours));
    if (!(impliedH > 0)) { rejected.push({ r, why: 'created_at is after check-out' }); continue; }
    if (diff > TOLERANCE_H) {
      rejected.push({ r, why: `created_at implies ${impliedH.toFixed(2)}h, stored is ${r.working_hours}h` });
      continue;
    }

    // Lateness against the real arrival, by the rule in routes/attendance.js.
    let lateMins = r.late_minutes, status = r.status;
    if (r.shift_start) {
      const [h, m] = String(r.shift_start).split(':').map(Number);
      const startMins = h * 60 + (m || 0);
      const arrived = minsOfDay(r.created_at);
      lateMins = arrived > startMins ? arrived - startMins : 0;
      if (Number(r.working_hours) > 0) {
        status = arrived > startMins + GRACE_MINS ? 'late' : (r.status === 'late' ? 'present' : r.status);
      }
    }
    repairable.push({ r, impliedH, lateMins, status });
  }

  if (repairable.length) {
    console.log(`  ${repairable.length} row(s) where created_at is corroborated by the stored hours:\n`);
    for (const { r, impliedH, lateMins, status } of repairable) {
      console.log(`    ${r.code.padEnd(14)} ${r.d}   arrival ${clock(r.check_in)} -> ${clock(r.created_at)}`);
      console.log(`    ${''.padEnd(14)} ${''.padEnd(10)}   ${impliedH.toFixed(2)}h implied vs ${r.working_hours}h stored`
                + `   late ${r.late_minutes} -> ${lateMins} min`
                + (status !== r.status ? `   status ${r.status} -> ${status}` : ''));
    }
  }

  if (rejected.length) {
    console.log(`\n  ${rejected.length} row(s) left alone, because the evidence does not support a repair:\n`);
    for (const { r, why } of rejected) {
      console.log(`    ${r.code.padEnd(14)} ${r.d}   ${why}`);
    }
  }

  if (!repairable.length) {
    console.log('\n  Nothing to repair.\n');
    await pool.end();
    return;
  }

  if (!APPLY) {
    console.log(`\n  Nothing was written. Re-run with --apply to make these changes.`);
    console.log(`  check_in, late_minutes and status move; check_out and working_hours do not.\n`);
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let n = 0;
    for (const { r, lateMins, status } of repairable) {
      const res = await client.query(
        `UPDATE attendance
            SET check_in = created_at, late_minutes = $2, status = $3, updated_at = NOW()
          WHERE id = $1`, [r.id, lateMins, status]);
      n += res.rowCount;
    }
    await client.query('COMMIT');
    console.log(`\n  ${n} row(s) repaired.`);
    console.log('  Hours and check-out times were not touched.\n');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\n  Repair failed and was rolled back:', err.message, '\n');
    process.exitCode = 1;
  } finally { client.release(); }

  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
