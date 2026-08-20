// Approved regularizations that landed 5h30m late.
//
// attendance.check_in is a naive TIMESTAMP holding a UTC wall clock. The
// regularization approval handler wrote the IST clock the employee typed
// straight into it, so every approved regularization reads back 5h30m later
// than it was meant to — and the late_minutes backfill then stamped the person
// late for a time they never claimed.
//
// The handler is fixed. This repairs the rows it already wrote.
//
// A row is only touched when the shift is EXACTLY 5h30m against what the
// regularization asked for. That is the fingerprint of this bug and nothing
// else produces it; anything off by a different amount is a different problem
// and gets reported rather than guessed at.
//
// Dry run by default. Nothing is written without --apply.
require('dotenv').config();

const pool = require('./db');
const APPLY = process.argv.includes('--apply');
const OFFSET_MIN = 330; // IST

const hhmm = t => String(t).slice(0, 5);
const pad = (s, n) => String(s).padEnd(n);

(async () => {
  console.log(`\n  Regularized punches stored 5h30m late — ${APPLY ? 'APPLYING' : 'DRY RUN, nothing will be written'}\n`);

  const { rows } = await pool.query(`
    SELECT a.id, a.date, a.working_hours, a.late_minutes, a.status,
           e.employee_id AS code,
           r.check_in  AS want_in,
           r.check_out AS want_out,
           to_char(a.check_in  AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS') AS have_in,
           to_char(a.check_out AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS') AS have_out,
           EXTRACT(EPOCH FROM (
             (a.check_in AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')
             - (a.date::timestamp + r.check_in::time)))/60.0 AS in_drift_min,
           CASE WHEN a.check_out IS NOT NULL AND r.check_out IS NOT NULL THEN
             EXTRACT(EPOCH FROM (
               (a.check_out AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')
               - (a.date::timestamp + r.check_out::time)))/60.0 END AS out_drift_min,
           COALESCE(s.start_time::text, '09:30:00')::time AS shift_start,
           COALESCE(s.grace_minutes, 15) AS grace,
           (SELECT half_day_hours FROM settings LIMIT 1) AS half_day,
           (SELECT full_day_hours FROM settings LIMIT 1) AS full_day
      FROM attendance_regularizations r
      JOIN attendance a ON a.employee_id = r.employee_id AND a.date = r.date
      JOIN employees e  ON e.id = r.employee_id
      LEFT JOIN shifts s ON s.id = e.shift_id
     WHERE r.status = 'approved' AND r.check_in IS NOT NULL AND a.check_in IS NOT NULL
     ORDER BY a.date, e.employee_id`);

  const near = (v, t) => v !== null && v !== undefined && Math.abs(Number(v) - t) < 1;

  const shifted = [], other = [];
  for (const r of rows) {
    const inShifted = near(r.in_drift_min, OFFSET_MIN);
    const outOk = r.out_drift_min === null || near(r.out_drift_min, OFFSET_MIN);
    if (inShifted && outOk) shifted.push(r); else other.push(r);
  }

  if (!shifted.length) {
    console.log('  Nothing carries the 5h30m fingerprint. Nothing to repair.\n');
  } else {
    console.log(`  ${shifted.length} row(s) to move back to the time that was asked for:\n`);
  }

  let repaired = 0;
  for (const r of shifted) {
    const day = String(r.date.toISOString ? r.date.toISOString().slice(0, 10) : r.date).slice(0, 10);
    const wantIn = hhmm(r.want_in), wantOut = r.want_out ? hhmm(r.want_out) : null;

    // Recompute what the day should say, from the times the employee asked for.
    const [sh, sm] = String(r.shift_start).split(':').map(Number);
    const startMins = sh * 60 + (sm || 0);
    const [ih, im] = wantIn.split(':').map(Number);
    const lateMins = Math.max(0, (ih * 60 + im) - startMins);

    let hours = r.working_hours === null ? null : Number(r.working_hours);
    let status = r.status;
    if (wantOut) {
      const [oh, om] = wantOut.split(':').map(Number);
      const span = ((oh * 60 + om) - (ih * 60 + im)) / 60;
      if (span > 0) {
        hours = parseFloat(span.toFixed(8));
        const half = Number(r.half_day) || 4, full = Number(r.full_day) || 7.5;
        status = span < half ? 'absent' : span < full ? 'half-day'
               : (lateMins > Number(r.grace) ? 'late' : 'present');
      }
    }

    console.log(`    ${pad(r.code, 14)} ${day}   arrival ${hhmm(r.have_in.slice(11))} -> ${wantIn}`
      + (wantOut ? `   exit ${r.have_out ? r.have_out.slice(11, 16) : '--:--'} -> ${wantOut}` : ''));
    const bits = [];
    if (Number(r.late_minutes) !== lateMins) bits.push(`late ${r.late_minutes} -> ${lateMins} min`);
    if (hours !== null && Number(r.working_hours) !== hours) bits.push(`hours ${Number(r.working_hours)} -> ${hours}`);
    if (status !== r.status) bits.push(`status ${r.status} -> ${status}`);
    if (bits.length) console.log(`${' '.repeat(32)}${bits.join('   ')}`);

    if (APPLY) {
      await pool.query(`
        UPDATE attendance
           SET check_in  = (($2::date + $3::time) AT TIME ZONE 'Asia/Kolkata' AT TIME ZONE 'UTC'),
               check_out = CASE WHEN $4::time IS NOT NULL
                 THEN (($2::date + $4::time) AT TIME ZONE 'Asia/Kolkata' AT TIME ZONE 'UTC')
                 ELSE check_out END,
               working_hours = COALESCE($5, working_hours),
               late_minutes = $6,
               status = $7,
               updated_at = NOW()
         WHERE id = $1`,
        [r.id, day, wantIn, wantOut, hours, lateMins, status]);
      repaired++;
    }
  }

  if (other.length) {
    console.log(`\n  ${other.length} row(s) left alone — the stored punch is not a clean 5h30m`);
    console.log('  from the request, so it is not this bug:\n');
    for (const r of other) {
      const day = String(r.date.toISOString ? r.date.toISOString().slice(0, 10) : r.date).slice(0, 10);
      console.log(`    ${pad(r.code, 14)} ${day}   asked ${hhmm(r.want_in)}, stored ${r.have_in.slice(11, 16)} `
        + `(${Number(r.in_drift_min).toFixed(0)} min apart)`);
    }
  }

  console.log(APPLY
    ? `\n  ${repaired} row(s) repaired.\n`
    : '\n  Nothing was written. Re-run with --apply to make these changes.\n');
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
