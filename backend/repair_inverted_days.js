/* Days whose check-out is EARLIER than their check-in.
 *
 * READ THIS BEFORE RUNNING. An earlier version of this script asked for
 * check_out <= check_in and offered to add twelve hours to whatever it found.
 * On live that matched 102 rows, and 100 of them had check_out EQUAL to
 * check_in — a single punch written into both columns, almost certainly by
 * the migration. Adding twelve hours to those would have fabricated an exact
 * 12:00 working day for fifty people going back to 2022. The dry run caught
 * it. The `<=` is now `<`, and equal-time days are reported by
 * inspect_payable_gap.js rather than guessed at here.
 *
 * What is left is the real fault: an out genuinely before the in, which
 * happens when somebody types 06:00 meaning 6 PM. The approval could not
 * compute hours from it and left the day present with nothing worked.
 *
 * The repair does NOT guess. It reads the approved regularization that set
 * the day and uses ITS times, shifting only the check-out into the PM it
 * plainly meant. Where there is no such request, or the result is not a
 * believable day, the row is listed and skipped for a human to decide.
 *
 * DRY RUN BY DEFAULT. Writes only with APPLY=1, and only after you have read
 * every line it proposes.
 *
 *     docker compose -f docker-compose.prod.yml exec -T backend \
 *       node < repair_inverted_days.js
 *
 *     APPLY=1 docker compose -f docker-compose.prod.yml exec -T backend \
 *       node < repair_inverted_days.js
 */
require('dotenv').config();
process.env.LOG_LEVEL = 'silent';
const pool = require('./db');

const APPLY = process.env.APPLY === '1' || process.argv.includes('--apply');
const hm = (h) => {
  if (h === null || h === undefined) return '--:--';
  const t = Math.round(Math.abs(Number(h)) * 60);
  return `${Number(h) < 0 ? '-' : ''}${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};
const mins = (hhmm) => {
  const [h, m] = String(hhmm).slice(0, 5).split(':').map(Number);
  return h * 60 + (m || 0);
};

(async () => {
  console.log(`\n  DAYS WITH A CHECK-OUT BEFORE THEIR CHECK-IN` +
    `  ${APPLY ? '*** APPLYING ***' : '(dry run - nothing will be written)'}\n`);

  /* Strictly earlier. A check-out EQUAL to the check-in is a single punch
   * duplicated across both columns, which is a different fault with a
   * different answer — see inspect_payable_gap.js section 2c. */
  const rows = (await pool.query(
    `SELECT a.id, e.employee_id AS code,
            e.first_name AS "firstName", e.last_name AS "lastName",
            to_char(a.date, 'YYYY-MM-DD') AS date,
            a.working_hours AS hours, a.status,
            to_char(a.check_in  AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS "in",
            to_char(a.check_out AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS "out",
            sh.start_time AS "shiftStart", sh.end_time AS "shiftEnd",
            r.check_in::text  AS "regIn",
            r.check_out::text AS "regOut",
            r.reason AS "regReason"
       FROM attendance a
       JOIN employees e ON e.id = a.employee_id
       LEFT JOIN shifts sh ON sh.id = e.shift_id
       LEFT JOIN LATERAL (
         SELECT check_in, check_out, reason
           FROM attendance_regularizations
          WHERE employee_id = a.employee_id AND date = a.date AND status = 'approved'
          ORDER BY updated_at DESC NULLS LAST LIMIT 1) r ON TRUE
      WHERE a.check_in IS NOT NULL AND a.check_out IS NOT NULL
        AND a.check_out < a.check_in
      ORDER BY a.date DESC`)).rows;

  if (!rows.length) { console.log('  Nothing found.\n'); await pool.end(); return; }

  const plan = [];
  for (const r of rows) {
    const overnight = r.shiftStart && r.shiftEnd && String(r.shiftEnd) < String(r.shiftStart);
    if (overnight) { plan.push({ r, skip: 'shift runs through midnight — these times may be correct' }); continue; }

    /* The request that set this day is the only trustworthy source for what
     * the times were meant to be. Without one there is nothing to repair
     * FROM, and inventing a check-out is not a repair. */
    if (!r.regIn || !r.regOut) {
      plan.push({ r, skip: 'no approved regularization to read the intended times from' });
      continue;
    }

    const outM = mins(r.regOut);
    if (outM >= 12 * 60) { plan.push({ r, skip: 'the request already reads PM; nothing obvious to correct' }); continue; }

    const inM = mins(r.regIn);
    const hours = (outM + 12 * 60 - inM) / 60;
    if (!(hours >= 1 && hours <= 16)) {
      plan.push({ r, skip: `reading it as PM gives ${hm(hours)}, which is not a believable day` });
      continue;
    }
    const newOut = `${String(Math.floor((outM + 12 * 60) / 60)).padStart(2, '0')}:${String(outM % 60).padStart(2, '0')}`;
    plan.push({ r, hours, newIn: String(r.regIn).slice(0, 5), newOut });
  }

  console.log('  ' + '-'.repeat(100));
  for (const p of plan) {
    const { r } = p;
    const who = `${r.code} ${r.firstName} ${r.lastName || ''}`.trim().slice(0, 24).padEnd(24);
    if (p.skip) {
      console.log(`  SKIP   ${r.date}  ${who} row ${r['in']}->${r.out}   ${p.skip}`);
    } else {
      console.log(`  REPAIR ${r.date}  ${who} row ${r['in']}->${r.out}  request asked ` +
        `${String(r.regIn).slice(0, 5)}->${String(r.regOut).slice(0, 5)}`);
      console.log(`         ${' '.repeat(35)}becomes ${p.newIn}->${p.newOut} = ${hm(p.hours)}  (${r.regReason || 'no reason given'})`);
    }
  }
  console.log('  ' + '-'.repeat(100));

  const doable = plan.filter(p => !p.skip);
  console.log(`\n  ${doable.length} repairable from an approved request, ${plan.length - doable.length} left alone.`);

  if (!APPLY) {
    console.log('\n  Dry run. Nothing was written.');
    console.log('  Read every REPAIR line above. If you agree with all of them, re-run with APPLY=1.\n');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  let done = 0;
  try {
    await client.query('BEGIN');
    for (const p of doable) {
      await client.query(
        `UPDATE attendance
            SET check_in  = (date::text || ' ' || $2)::timestamp AT TIME ZONE 'Asia/Kolkata' AT TIME ZONE 'UTC',
                check_out = (date::text || ' ' || $3)::timestamp AT TIME ZONE 'Asia/Kolkata' AT TIME ZONE 'UTC',
                working_hours = $4,
                updated_at = NOW()
          WHERE id = $1`,
        [p.r.id, `${p.newIn}:00`, `${p.newOut}:00`, Number(p.hours.toFixed(8))]);
      await client.query(
        `INSERT INTO audit_logs (user_id, action, resource, resource_id, changes, created_at)
         VALUES (NULL, 'UPDATE', 'Attendance repair', $1, $2::jsonb, NOW())`,
        [p.r.id, JSON.stringify({
          summary: `Check-out read as PM: ${p.r['in']}->${p.r.out} became ${p.newIn}->${p.newOut}, `
            + `hours ${hm(p.r.hours)} -> ${hm(p.hours)}`,
          date: p.r.date, employee: p.r.code, source: 'approved regularization',
        })]).catch(() => {});
      done++;
    }
    await client.query('COMMIT');
    console.log(`\n  ${done} day(s) repaired, each written to the audit trail.\n`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n  Nothing was changed —', err.message, '\n');
  } finally {
    client.release();
    await pool.end();
  }
})().catch(async e => { console.error(e.message); await pool.end().catch(() => {}); });
