/* ── Who is mid-day right now, and would still be charged twice ─────────────
 *  The handler is fixed and the closed days are repaired. Neither of those
 *  helps somebody who is checked in at this moment, because two things can
 *  already be wrong on an open row:
 *
 *  1. session_started_at points at the wrong instant.
 *     The migration backfilled it as check_in for every open day, which is
 *     right for somebody on their first stretch and WRONG for anybody who
 *     re-checked in earlier today, before the deploy. Their next check-out
 *     would measure from this morning and double count exactly as before.
 *     attendance_sessions holds the truth: the open session row's check_in is
 *     when the current stretch actually began.
 *
 *  2. working_hours is already inflated.
 *     A check-out earlier today wrote the bad sum, and it stays banked. The
 *     next check-out adds to it, so the fault compounds rather than clears.
 *
 *  Read-only by default. --apply corrects the session clock from the open
 *  session row and lowers a banked figure to what the closed stretches
 *  actually add up to. It never raises one, and it never touches check_in.
 *
 *    docker compose exec backend node check_open_days_now.js
 *    docker compose exec backend node check_open_days_now.js --apply
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'silent';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('this script does not send mail'); },
  verify: async () => { throw new Error('this script does not send mail'); },
});

const pool = require('./db');
const { DEFAULT_TZ } = require('./utils/timezone');

const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');
const pad = (s, n) => String(s ?? '').padEnd(n);
const hhmm = (h) => {
  const t = Math.round((Number(h) || 0) * 60);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

(async () => {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: DEFAULT_TZ });

  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  Open days right now — ${APPLY ? 'APPLYING' : 'READ ONLY'}`);
  console.log(`  ${ALL ? 'every open day' : today}`);
  console.log('══════════════════════════════════════════════════════════\n');

  const rows = (await pool.query(
    `SELECT a.id, a.date::text AS d,
            e.employee_id AS code, TRIM(CONCAT(e.first_name,' ',e.last_name)) AS name,
            a.working_hours::float AS banked,
            to_char(a.check_in           AT TIME ZONE 'UTC' AT TIME ZONE $1, 'HH24:MI') AS arrived,
            to_char(a.session_started_at AT TIME ZONE 'UTC' AT TIME ZONE $1, 'HH24:MI') AS clock_from,
            to_char(s.open_in            AT TIME ZONE 'UTC' AT TIME ZONE $1, 'HH24:MI') AS stretch_from,
            s.open_in,
            a.session_started_at,
            COALESCE(s.closed_hours, 0)::float AS closed_hours,
            COALESCE(s.n_closed, 0)::int      AS n_closed
       FROM attendance a
       JOIN employees e ON e.id = a.employee_id
       LEFT JOIN (
         SELECT attendance_id,
                MAX(check_in) FILTER (WHERE check_out IS NULL) AS open_in,
                COUNT(*) FILTER (WHERE check_out IS NOT NULL)::int AS n_closed,
                SUM(EXTRACT(EPOCH FROM (check_out - check_in))/3600.0)
                  FILTER (WHERE check_out IS NOT NULL) AS closed_hours
           FROM attendance_sessions GROUP BY attendance_id) s
         ON s.attendance_id = a.id
      WHERE a.check_out IS NULL AND a.check_in IS NOT NULL
        ${ALL ? '' : 'AND a.date = $2::date'}
      ORDER BY a.date DESC, e.employee_id`,
    ALL ? [DEFAULT_TZ] : [DEFAULT_TZ, today])).rows;

  console.log(`  ${rows.length} person(s) checked in and not yet out.\n`);
  if (!rows.length) { await pool.end(); return; }

  // A day is only at risk if somebody has already been in and out of it today.
  const risky = rows.filter(r => r.n_closed > 0);
  const clockWrong = risky.filter(r =>
    r.open_in && r.session_started_at && +r.open_in !== +r.session_started_at);
  const inflated = risky.filter(r => Number(r.banked) - Number(r.closed_hours) > 0.02);

  console.log(`  ${risky.length} of them have already finished a stretch today,`);
  console.log('  which is the only way either fault can be present.\n');

  if (!risky.length) {
    console.log('  Everybody open is on their first stretch, so nothing here can');
    console.log('  double count. Nothing to do.\n');
    await pool.end();
    return;
  }

  console.log(`  ${pad('date', 12)}${pad('who', 20)}${pad('arrived', 9)}`
    + `${pad('clock from', 12)}${pad('stretch began', 15)}${pad('banked', 9)}${pad('really', 9)}note`);
  console.log('');
  for (const r of risky) {
    const wrongClock = clockWrong.includes(r);
    const over = inflated.includes(r);
    console.log(`  ${pad(r.d, 12)}${pad(r.name.slice(0, 18), 20)}${pad(r.arrived, 9)}`
      + `${pad(r.clock_from || '—', 12)}${pad(r.stretch_from || '—', 15)}`
      + `${pad(hhmm(r.banked), 9)}${pad(hhmm(r.closed_hours), 9)}`
      + `${[wrongClock ? 'clock would double count' : '', over ? 'already inflated' : '']
          .filter(Boolean).join(', ') || 'fine'}`);
  }

  console.log('');
  console.log(`  ${clockWrong.length} would double count on their next check-out.`);
  console.log(`  ${inflated.length} already carry hours nobody worked.\n`);

  if (!clockWrong.length && !inflated.length) {
    console.log('══════════════════════════════════════════════════════════');
    console.log('  Nothing to correct.');
    console.log('══════════════════════════════════════════════════════════\n');
    await pool.end();
    return;
  }

  if (!APPLY) {
    console.log('══════════════════════════════════════════════════════════');
    console.log('  Nothing was written. Re-run with --apply.');
    console.log('  Worth doing before these people check out this evening.');
    console.log('══════════════════════════════════════════════════════════\n');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of clockWrong) {
      // The open session row is when this stretch actually began. check_in is
      // left exactly as it is — it is the arrival, and lateness reads it.
      await client.query(
        `UPDATE attendance SET session_started_at = $2, updated_at = NOW() WHERE id = $1`,
        [r.id, r.open_in]);
    }
    for (const r of inflated) {
      await client.query(
        `UPDATE attendance SET working_hours = $2, updated_at = NOW()
          WHERE id = $1 AND working_hours > $2`,
        [r.id, Number(Number(r.closed_hours).toFixed(2))]);
    }
    // The per-stretch figures carried the same bad sum.
    const s = await client.query(
      `UPDATE attendance_sessions
          SET session_hours = ROUND((EXTRACT(EPOCH FROM (check_out - check_in))/3600.0)::numeric, 2)
        WHERE attendance_id = ANY($1::uuid[]) AND check_out IS NOT NULL`,
      [[...new Set([...clockWrong, ...inflated].map(r => r.id))]]);
    await client.query('COMMIT');
    console.log(`  ${clockWrong.length} session clock(s) corrected,`
      + ` ${inflated.length} banked figure(s) lowered, ${s.rowCount} stretch(es) recomputed.`);
    console.log('  Their check-out this evening will now be right.\n');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.log(`\n  Stopped and rolled back: ${err.message}\n`);
    process.exitCode = 1;
  } finally { client.release(); }

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
