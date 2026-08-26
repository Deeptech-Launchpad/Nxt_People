/* ── Days that claim more hours than the punches allow ──────────────────────
 *  Hours worked cannot exceed the time between the first punch and the last.
 *  Zoho breaks that on a handful of days, and three of them are exactly
 *  doubled:
 *
 *      2022-08-12   28.77h   punches span 14.38h
 *      2022-08-24   18.03h   punches span  9.02h
 *      2022-12-29   23.33h   punches span 11.67h
 *
 *  It counted the same day twice — the same bug this system had in its own
 *  check-in code, except it happened inside Zoho years ago and there is nothing
 *  to fix at the source. Twenty-eight hours in a day is not a number anybody
 *  worked, and it inflates that person's totals and their overtime.
 *
 *  The importer caps this now, so no future import brings one in. This is for
 *  the rows already here.
 *
 *  It changes working_hours and nothing else. The punches are not touched,
 *  because the punches are the evidence — it is the total that disagrees with
 *  them. The status is not recomputed either: a day of ten hours and a day of
 *  twenty-three are both a full present day, so capping the figure does not
 *  change what the day was.
 *
 *  Read-only unless given --apply, and it names every row before and after.
 *
 *    docker compose exec backend node repair_impossible_hours.js
 *    docker compose exec backend node repair_impossible_hours.js --apply
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
const APPLY = process.argv.includes('--apply');
const pad = (s, n) => String(s ?? '').padEnd(n);

(async () => {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  Hours that exceed the punches${APPLY ? '   APPLYING' : '   READ ONLY'}`);
  console.log('══════════════════════════════════════════════════════════\n');

  /* A minute of slack, so rounding at either end is not treated as impossible.
   * Only rows with BOTH punches can be judged: without a punch out there is no
   * span, and a day somebody forgot to check out of is a different problem. */
  const rows = (await pool.query(
    `SELECT a.id, a.date::text AS day, a.working_hours::float AS stored,
            ROUND((EXTRACT(EPOCH FROM (a.check_out - a.check_in)) / 3600)::numeric, 2)::float AS span,
            e.employee_id AS code, TRIM(CONCAT(e.first_name,' ',e.last_name)) AS name
       FROM attendance a
       JOIN employees e ON e.id = a.employee_id
      WHERE a.check_in IS NOT NULL AND a.check_out IS NOT NULL
        AND a.check_out > a.check_in
        AND a.working_hours > (EXTRACT(EPOCH FROM (a.check_out - a.check_in)) / 3600) + (1.0 / 60)
      ORDER BY a.date`)).rows;

  if (!rows.length) {
    console.log('  No day claims more hours than its punches allow.\n');
    await pool.end();
    return;
  }

  console.log(`  ${rows.length} day(s).\n`);
  console.log(`  ${pad('code', 14)}${pad('who', 26)}${pad('day', 12)}${pad('stored', 10)}${pad('span', 10)}note`);
  for (const r of rows) {
    const doubled = Math.abs(r.stored - r.span * 2) < 0.05;
    console.log(`  ${pad(r.code, 14)}${pad(String(r.name).slice(0, 24), 26)}${pad(r.day, 12)}`
      + `${pad(r.stored.toFixed(2), 10)}${pad(r.span.toFixed(2), 10)}`
      + `${doubled ? 'exactly doubled' : `${(r.stored - r.span).toFixed(2)}h over`}`);
  }
  console.log('');

  const lost = rows.reduce((s, r) => s + (r.stored - r.span), 0);
  console.log(`  ${lost.toFixed(2)} hour(s) of overstatement across ${rows.length} day(s).\n`);

  if (!APPLY) {
    console.log('══════════════════════════════════════════════════════════');
    console.log('  Nothing was written. Re-run with --apply.');
    console.log('══════════════════════════════════════════════════════════\n');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  let fixed = 0;
  try {
    await client.query('BEGIN');
    for (const r of rows) {
      await client.query(
        'UPDATE attendance SET working_hours = $1, updated_at = NOW() WHERE id = $2',
        [r.span, r.id]);
      fixed++;
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.log(`\n  Nothing was written — ${e.message}\n`);
    client.release();
    await pool.end();
    process.exit(1);
  }
  client.release();

  const left = (await pool.query(
    `SELECT count(*)::int AS n FROM attendance
      WHERE check_in IS NOT NULL AND check_out IS NOT NULL AND check_out > check_in
        AND working_hours > (EXTRACT(EPOCH FROM (check_out - check_in)) / 3600) + (1.0 / 60)`)).rows[0].n;

  console.log('══════════════════════════════════════════════════════════');
  console.log(`  ${fixed} day(s) capped to their punch span.`);
  console.log(`  ${left} day(s) still exceed their punches${left ? ' — look at these' : '.'}`);
  console.log('══════════════════════════════════════════════════════════\n');

  await pool.end();
})().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
