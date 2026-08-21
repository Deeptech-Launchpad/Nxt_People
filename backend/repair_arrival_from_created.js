/* ── The last rows whose arrival is still wrong ────────────────────────────
 *  A handful of days survived both earlier repairs. Their sessions only cover
 *  the afternoon, so there is no earlier punch to restore, and the hours are
 *  right so the proof the legacy repair demanded — check_out minus created_at
 *  equalling working_hours — can never hold on a multi-session day.
 *
 *  What is left as evidence is `created_at`: the row was created by the
 *  check-in that made it, so its timestamp IS the arrival.
 *
 *  Except when it is not. The absent scheduler inserts a row for anybody who
 *  has not checked in by its configured time, and a later check-in UPDATES
 *  that row rather than creating one — leaving created_at holding the cron's
 *  time, which is earlier than the real arrival and would invent one.
 *
 *  So this proves it before proposing anything. A cron write lands on many
 *  people at once, within the same minute; a check-in does not. Any row whose
 *  created_at shares its minute with other rows the same day is treated as
 *  cron-written and left alone, however tempting the figure looks.
 *
 *  created_at is a timezone-free column holding a UTC wall clock, exactly as
 *  check_in is, so it has to be converted the same way. Reading it straight
 *  into IST turns an 09:41 arrival into 04:11.
 *
 *  Read-only unless given --apply, and only check_in, late_minutes and status
 *  move. Hours are correct on these rows and are not touched.
 *
 *    docker compose exec backend node repair_arrival_from_created.js
 *    docker compose exec backend node repair_arrival_from_created.js --apply
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();

const pool = require('./db');
const APPLY = process.argv.includes('--apply');
const TZ = 'Asia/Kolkata';

const pad = (s, n) => String(s).padEnd(n);

(async () => {
  console.log(`\n  Arrivals recoverable from created_at — ${APPLY ? 'APPLYING' : 'DRY RUN, nothing will be written'}\n`);

  // Whether the absent scheduler is even switched on, and when it runs. If it
  // has never run, created_at cannot have been written by it.
  try {
    const auto = (await pool.query(
      `SELECT attendance_automation_config AS c FROM settings LIMIT 1`)).rows[0]?.c || {};
    const sch = auto.scheduler || {};
    console.log(`  Absent scheduler: ${sch.enabled ? `ON, runs at ${sch.runAt || '?'}` : 'off'}`);
    console.log(sch.enabled
      ? '  Rows it created carry its time, not an arrival — those are excluded below.\n'
      : '  It has never written a row, so created_at can only have come from a check-in.\n');
  } catch { console.log('  Absent scheduler: could not be read\n'); }

  const { rows } = await pool.query(`
    WITH candidate AS (
      SELECT a.id, a.date::text AS d, a.employee_id,
             e.employee_id AS code,
             TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS name,
             a.working_hours, a.late_minutes, a.status,
             to_char(a.check_in   AT TIME ZONE 'UTC' AT TIME ZONE $1, 'HH24:MI:SS') AS stored_in,
             to_char(a.check_out  AT TIME ZONE 'UTC' AT TIME ZONE $1, 'HH24:MI:SS') AS stored_out,
             to_char(a.created_at AT TIME ZONE 'UTC' AT TIME ZONE $1, 'HH24:MI:SS') AS made_at,
             (a.created_at AT TIME ZONE 'UTC' AT TIME ZONE $1)::date AS made_on,
             date_trunc('minute', a.created_at) AS made_minute,
             COALESCE(s.start_time::text, '09:30:00') AS shift_start,
             COALESCE(s.grace_minutes, 15) AS grace,
             (SELECT half_day_hours FROM settings LIMIT 1) AS half_day,
             (SELECT full_day_hours FROM settings LIMIT 1) AS full_day
        FROM attendance a
        JOIN employees e ON e.id = a.employee_id
        LEFT JOIN shifts s ON s.id = e.shift_id
       WHERE a.check_in IS NOT NULL
         AND a.created_at IS NOT NULL
         AND e.deleted_at IS NULL
         -- Only where the row was made BEFORE the punch it holds: that gap is
         -- the whole symptom.
         AND a.created_at < a.check_in
         -- And only when both fall on the same day, or created_at is not an
         -- arrival at all.
         AND (a.created_at AT TIME ZONE 'UTC' AT TIME ZONE $1)::date = a.date
    )
    SELECT c.*,
           -- How many OTHER rows were written in the same minute. A check-in
           -- is one person; the scheduler is everybody at once.
           (SELECT COUNT(*) FROM attendance x
             WHERE x.date = c.d::date
               AND date_trunc('minute', x.created_at) = c.made_minute
               AND x.id <> c.id) AS same_minute
      FROM candidate c
     ORDER BY c.d, c.code`, [TZ]);

  if (!rows.length) {
    console.log('  Nothing matches. Every arrival is at or before the row that holds it.\n');
    await pool.end();
    return;
  }

  const safe = rows.filter(r => Number(r.same_minute) === 0);
  const bulk = rows.filter(r => Number(r.same_minute) > 0);

  console.log(`  ${safe.length} row(s) where created_at is an arrival and nothing else:\n`);

  let repaired = 0;
  for (const r of safe) {
    const arrival = r.made_at;
    const [sh, sm] = String(r.shift_start).split(':').map(Number);
    const [ih, im] = arrival.split(':').map(Number);
    const late = Math.max(0, (ih * 60 + im) - (sh * 60 + (sm || 0)));

    const hours = Number(r.working_hours) || 0;
    const half = Number(r.half_day) || 4, full = Number(r.full_day) || 7.5;
    const status = hours < half ? 'absent' : hours < full ? 'half-day'
      : (late > Number(r.grace) ? 'late' : 'present');

    console.log(`    ${pad(r.code, 14)} ${r.d}   arrival ${r.stored_in} -> ${arrival}`);
    const bits = [];
    if (Number(r.late_minutes) !== late) bits.push(`late ${r.late_minutes} -> ${late} min`);
    if (r.status !== status) bits.push(`status ${r.status} -> ${status}`);
    bits.push(`hours ${hours} unchanged`);
    console.log(`${' '.repeat(20)}${bits.join('   ')}`);

    if (APPLY) {
      await pool.query(
        `UPDATE attendance
            SET check_in = (($2::date + $3::time) AT TIME ZONE $5 AT TIME ZONE 'UTC'),
                late_minutes = $4,
                status = $6,
                updated_at = NOW()
          WHERE id = $1`,
        [r.id, r.d, arrival, late, TZ, status]);
      repaired++;
    }
  }

  if (bulk.length) {
    console.log(`\n  ${bulk.length} row(s) left alone — created_at is shared with other rows`);
    console.log('  the same minute, so it was written in bulk and is not an arrival:\n');
    for (const r of bulk) {
      console.log(`    ${pad(r.code, 14)} ${r.d}   made at ${r.made_at} alongside ${r.same_minute} other row(s)`);
    }
  }

  console.log(APPLY
    ? `\n  ${repaired} row(s) repaired. Hours were not touched.\n`
    : '\n  Nothing was written. Re-run with --apply to make these changes.\n');

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
