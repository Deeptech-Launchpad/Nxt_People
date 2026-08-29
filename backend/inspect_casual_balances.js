/* ── What casual leave actually looks like right now ────────────────────────
 *  Read before changing how casual is calculated, because the column it lives
 *  in has been behaving in three ways at once.
 *
 *  employees.casual_leave was written as an ENTITLEMENT — a fixed 12 that
 *  never moves — and the balance card still subtracts the year's bookings from
 *  it on that assumption. But utils/leaveBalance.js debits the same column on
 *  every approval. So an approved casual day is taken off twice on the card,
 *  while the check that refuses an application reads the column raw and gets a
 *  third answer. Nothing resets it in January either, so four years of leave
 *  have been coming out of one 12.
 *
 *  This script asks the database which of those is true of each person, and
 *  whether 12 can be reconstructed from what is left plus what was taken. If
 *  it can, moving casual onto a computed accrual changes nobody's number and
 *  is safe. Where it cannot, that person needs a decision rather than a
 *  migration.
 *
 *  Read-only. Writes nothing, sends nothing, starts no cron.
 *
 *    docker compose exec backend node inspect_casual_balances.js
 *    docker compose exec backend node inspect_casual_balances.js --csv
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
process.env.LOG_LEVEL = 'silent';
process.env.EMAIL_DISABLED = 'true';

const pool = require('./db');

const AS_CSV = process.argv.includes('--csv');
const ASSUMED_START = 12;               // the column default every row was created with
const pad = (s, n) => String(s ?? '').padEnd(n);
const lp = (s, n) => String(s ?? '').padStart(n);
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

(async () => {
  const year = new Date().getFullYear();

  const { rows } = await pool.query(`
    SELECT e.id,
           e.employee_id                                        AS code,
           TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS name,
           e.joining_date::date::text                           AS joining,
           COALESCE(e.casual_leave, 0)::float                   AS stored,
           COALESCE((SELECT SUM(l.total_days) FROM leaves l
                      WHERE l.employee_id = e.id AND l.leave_type = 'casual'
                        AND l.status = 'approved'), 0)::float   AS approved_ever,
           COALESCE((SELECT SUM(l.total_days) FROM leaves l
                      WHERE l.employee_id = e.id AND l.leave_type = 'casual'
                        AND l.status = 'approved'
                        AND EXTRACT(YEAR FROM l.start_date) = $1), 0)::float AS approved_year,
           COALESCE((SELECT SUM(l.total_days) FROM leaves l
                      WHERE l.employee_id = e.id AND l.leave_type = 'casual'
                        AND l.status = 'pending'
                        AND EXTRACT(YEAR FROM l.start_date) = $1), 0)::float AS pending_year,
           (SELECT lb.available::float FROM leave_balances lb
              JOIN leave_types lt ON lt.id = lb.leave_type_id
             WHERE lb.employee_id = e.id AND lt.code = 'casual' AND lb.year = $1) AS lb_available
      FROM employees e
     WHERE e.status = 'active' AND e.deleted_at IS NULL
     ORDER BY e.joining_date`, [year]);

  const people = rows.map(p => {
    const store = p.lb_available !== null ? 'leave_balances' : 'legacy';
    // The three numbers the system currently produces for the same person.
    const card = store === 'leave_balances'
      ? p.lb_available
      : Math.max(0, r2(p.stored - p.approved_year - p.pending_year));
    const enforced = store === 'leave_balances' ? p.lb_available : p.stored;
    // If the column began at 12 and only ever lost approved days, this is 12.
    const reconstructed = r2(p.stored + p.approved_ever);
    return { ...p, store, card, enforced, reconstructed,
             disagrees: r2(card) !== r2(enforced),
             reconcilable: r2(reconstructed) === ASSUMED_START };
  });

  if (AS_CSV) {
    console.log('Employee ID,Name,Joining,Stored casual_leave,Approved (all years),Approved (this year),Pending,Store,Card shows,Application check allows,Stored + approved,Reconstructs to 12');
    const cell = v => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
    for (const p of people) {
      console.log([p.code, p.name, p.joining, p.stored, p.approved_ever, p.approved_year,
        p.pending_year, p.store, p.card, p.enforced, p.reconstructed,
        p.reconcilable ? 'yes' : 'NO'].map(cell).join(','));
    }
    await pool.end();
    return;
  }

  const line = (c = '─') => console.log('  ' + c.repeat(96));
  console.log('\n════════════════════════════════════════════════════════════════════════');
  console.log(`  Casual leave, as the database actually holds it — ${year}`);
  console.log('════════════════════════════════════════════════════════════════════════\n');

  const legacy = people.filter(p => p.store === 'legacy');
  const viaTable = people.filter(p => p.store === 'leave_balances');
  console.log(`  ${people.length} active employees`);
  console.log(`    ${legacy.length} read from employees.casual_leave (the decrementing column)`);
  console.log(`    ${viaTable.length} read from leave_balances\n`);

  // ── 1. Does the card agree with the check that refuses an application? ────
  const split = people.filter(p => p.disagrees);
  console.log('  1. Where the balance card and the application check disagree');
  console.log('     Two separate causes, so they are shown apart:');
  console.log('       twice   approved days, already debited from the column at approval,');
  console.log('               subtracted again by the card. This one is a defect.');
  console.log('       unheld  pending days the card reserves but the application check');
  console.log('               does not, so two requests in flight can exceed the balance.\n');
  if (!split.length) {
    console.log('     None. Nobody has casual leave booked for the two to differ on.\n');
  } else {
    console.log(`  ${pad('Employee', 26)}${lp('card', 7)}${lp('allowed', 9)}${lp('twice', 7)}${lp('unheld', 8)}`);
    line();
    for (const p of split) {
      console.log(`  ${pad(p.name.slice(0, 25), 26)}${lp(p.card, 7)}${lp(p.enforced, 9)}${lp(p.approved_year, 7)}${lp(p.pending_year, 8)}`);
    }
    line();
    const doubled = split.filter(p => p.approved_year > 0);
    console.log(`     ${split.length} employee(s) see a different figure from the one they can spend.`);
    console.log(`     ${doubled.length} of those are the double-count; the rest is unreserved pending.\n`);
  }

  // ── 2. Can 12 be reconstructed? ──────────────────────────────────────────
  const odd = legacy.filter(p => !p.reconcilable);
  console.log(`  2. Whether the original ${ASSUMED_START} can be reconstructed`);
  console.log('     stored + every approved casual day should come back to 12 if the');
  console.log('     column started there and only ever lost approvals. Where it does,');
  console.log('     a computed accrual reproduces today\'s number exactly.\n');
  if (!odd.length) {
    console.log(`     All ${legacy.length} reconstruct to ${ASSUMED_START}. Migration is exact.\n`);
  } else {
    console.log(`  ${pad('Employee', 26)}${pad('joined', 13)}${lp('stored', 8)}${lp('approved', 10)}${lp('sum', 7)}`);
    line();
    for (const p of odd) {
      console.log(`  ${pad(p.name.slice(0, 25), 26)}${pad(p.joining, 13)}${lp(p.stored, 8)}${lp(p.approved_ever, 10)}${lp(p.reconstructed, 7)}`);
    }
    line();
    console.log(`     ${odd.length} employee(s) do NOT reconstruct to ${ASSUMED_START} — hand-edited, or`);
    console.log('     leave taken before the debit existed. These need a decision, not a');
    console.log('     migration: their stored figure is the only record of what they have.\n');
  }

  // ── 3. Leave carried across years out of one allowance ───────────────────
  const priorYears = legacy.filter(p => r2(p.approved_ever - p.approved_year) > 0);
  console.log('  3. Employees whose column was debited in earlier years');
  console.log(`     Nothing resets employees.casual_leave in January, so leave taken in`);
  console.log('     earlier years is still being subtracted from this year\'s allowance.\n');
  if (!priorYears.length) {
    console.log('     None. No approved casual leave predates this year.\n');
  } else {
    console.log(`  ${pad('Employee', 26)}${lp('stored', 8)}${lp('earlier', 9)}${lp('this yr', 9)}${lp('should be', 11)}`);
    line();
    for (const p of priorYears) {
      const earlier = r2(p.approved_ever - p.approved_year);
      console.log(`  ${pad(p.name.slice(0, 25), 26)}${lp(p.stored, 8)}${lp(earlier, 9)}${lp(p.approved_year, 9)}${lp(r2(ASSUMED_START - p.approved_year), 11)}`);
    }
    line();
    console.log(`     ${priorYears.length} employee(s) are carrying an earlier year's usage into this one.\n`);
  }

  console.log('════════════════════════════════════════════════════════════════════════');
  console.log('  Nothing was changed. Add --csv for a spreadsheet.');
  console.log('════════════════════════════════════════════════════════════════════════\n');

  await pool.end();
})().catch(async e => {
  console.error('\n  failed —', e.message, '\n');
  try { await pool.end(); } catch {}
  process.exit(1);
});
