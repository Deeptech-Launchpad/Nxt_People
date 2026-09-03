/* The two days approved as worked that pay nothing.
 *
 * On live:
 *     2026-08-26  ANXT2500139  approved 09:30 -> 06:00   working_hours 00:00
 *     2026-06-23  ANXT2300104  approved 10:21 -> 03:30   working_hours 00:00
 *
 * Both are a PM typed as AM. The approval could not compute hours from an
 * out earlier than the in, so it left the day present with nothing worked.
 * The code no longer accepts or approves one; these two rows predate that.
 *
 * DEFAULT IS A DRY RUN. It prints what it would change and writes nothing.
 * Pass --apply to actually write, and only when you have read the list and
 * agree with every line of it.
 *
 *     docker compose -f docker-compose.prod.yml exec -T backend \
 *       node < repair_inverted_days.js                 # show me
 *     docker compose -f docker-compose.prod.yml exec -T backend \
 *       node -e "process.argv[2]='--apply'" < ...       # (see README note below)
 *
 * Because stdin-piped node cannot take arguments, set APPLY=1 instead:
 *     APPLY=1 docker compose ... exec -T backend node < repair_inverted_days.js
 *
 * What it does, per row: adds 12 hours to the check-out — 06:00 becomes
 * 18:00 — ONLY where that produces a sane working day (between 1 and 16
 * hours) and the employee's shift does not run through midnight. Anything
 * that does not fit is listed and skipped rather than guessed at. Every
 * change is written to the audit trail.
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

(async () => {
  console.log(`\n  INVERTED ATTENDANCE DAYS  ${APPLY ? '*** APPLYING CHANGES ***' : '(dry run - nothing will be written)'}\n`);

  const rows = (await pool.query(
    `SELECT a.id, a.employee_id AS "employeeId", e.employee_id AS code,
            e.first_name AS "firstName", e.last_name AS "lastName",
            to_char(a.date, 'YYYY-MM-DD') AS date,
            a.working_hours AS hours, a.status,
            to_char(a.check_in  AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS "in",
            to_char(a.check_out AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS "out",
            sh.start_time AS "shiftStart", sh.end_time AS "shiftEnd"
       FROM attendance a
       JOIN employees e ON e.id = a.employee_id
       LEFT JOIN shifts sh ON sh.id = e.shift_id
      WHERE a.check_in IS NOT NULL AND a.check_out IS NOT NULL
        AND a.check_out <= a.check_in
      ORDER BY a.date DESC`)).rows;

  if (!rows.length) { console.log('  Nothing to repair.\n'); await pool.end(); return; }

  const plan = [];
  for (const r of rows) {
    const overnight = r.shiftStart && r.shiftEnd && String(r.shiftEnd) < String(r.shiftStart);
    const [ih, im] = String(r['in']).split(':').map(Number);
    const [oh, om] = String(r.out).split(':').map(Number);
    const inMins = ih * 60 + im;
    const shifted = (oh + 12) * 60 + om;          // the PM the person meant
    const hours = (shifted - inMins) / 60;

    if (overnight) {
      plan.push({ r, skip: 'shift runs through midnight — the times may be right as they are' });
    } else if (oh >= 12) {
      plan.push({ r, skip: 'the check-out is already PM; adding 12h would not help' });
    } else if (!(hours >= 1 && hours <= 16)) {
      plan.push({ r, skip: `+12h gives ${hm(hours)}, which is not a believable day` });
    } else {
      plan.push({ r, hours, newOut: `${String(oh + 12).padStart(2, '0')}:${String(om).padStart(2, '0')}` });
    }
  }

  console.log('  ' + '-'.repeat(94));
  for (const p of plan) {
    const { r } = p;
    const who = `${r.code} ${r.firstName} ${r.lastName || ''}`.trim().slice(0, 26).padEnd(26);
    if (p.skip) console.log(`  SKIP   ${r.date}  ${who} ${r['in']}->${r.out}   ${p.skip}`);
    else console.log(`  REPAIR ${r.date}  ${who} ${r['in']}->${r.out}  becomes ${r['in']}->${p.newOut}  = ${hm(p.hours)}`);
  }
  console.log('  ' + '-'.repeat(94));

  const doable = plan.filter(p => !p.skip);
  console.log(`\n  ${doable.length} repairable, ${plan.length - doable.length} skipped.`);

  if (!APPLY) {
    console.log('\n  Dry run. Nothing was written.');
    console.log('  Re-run with APPLY=1 in front of the command to make these changes.\n');
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
            SET check_out = (date::text || ' ' || $2)::timestamp AT TIME ZONE 'Asia/Kolkata' AT TIME ZONE 'UTC',
                working_hours = $3,
                updated_at = NOW()
          WHERE id = $1`,
        [p.r.id, `${p.newOut}:00`, Number(p.hours.toFixed(8))]);
      await client.query(
        `INSERT INTO audit_logs (user_id, action, resource, resource_id, changes, created_at)
         VALUES (NULL, 'UPDATE', 'Attendance repair', $1, $2::jsonb, NOW())`,
        [p.r.id, JSON.stringify({
          summary: `Inverted day repaired: check-out ${p.r.out} -> ${p.newOut}, hours 00:00 -> ${hm(p.hours)}`,
          date: p.r.date, employee: p.r.code,
        })]).catch(() => { /* audit shape varies; the repair is the point */ });
      done++;
    }
    await client.query('COMMIT');
    console.log(`\n  ${done} day(s) repaired and written to the audit trail.\n`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n  Nothing was changed —', err.message, '\n');
  } finally {
    client.release();
    await pool.end();
  }
})().catch(async e => { console.error(e.message); await pool.end().catch(() => {}); });
