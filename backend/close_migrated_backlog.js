/* ── Close the approval backlog inherited from Zoho ─────────────────────────
 *  The Zoho import brought every leave, regularization and comp-off across
 *  with the status it had at the time, so requests nobody ever actioned came
 *  over as pending. Years of them sat above this week's work in the approval
 *  queue. They are now separated into a Backlog tab; this clears that tab.
 *
 *  IT DOES NOT APPROVE THEM THE WAY THE BUTTON DOES, AND MUST NOT.
 *
 *  Approving a leave through the API also debits the person's balance and
 *  emails them. Both are wrong for these:
 *
 *    · The balances came across from Zoho as FINAL figures — 171 of them,
 *      checked against Zoho record by record. They already account for these
 *      days. Debiting again would deduct every one of them twice.
 *
 *    · The attendance for these days was imported too. Regularization approval
 *      rewrites attendance; doing that now would overwrite real imported days
 *      with a recalculation from a 2022 request form.
 *
 *    · And it would email dozens of people about leave they took years ago.
 *      Mail is hard-disabled here, and nothing in this script can send any.
 *
 *  So this writes the status and the audit trail, and nothing else. It is a
 *  filing exercise: these requests are settled, the record should say so, and
 *  no figure anywhere should move as a result.
 *
 *  The cutoff is a date, not a guess — everything whose dates FINISHED on or
 *  before it. Defaults to the end of last month, so it can never touch a
 *  request from the current month that somebody is still working through.
 *
 *  Dry run by default.
 *
 *    docker compose exec backend node close_migrated_backlog.js
 *    docker compose exec backend node close_migrated_backlog.js --until 2026-07-31
 *    docker compose exec backend node close_migrated_backlog.js --until 2026-07-31 --apply
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
process.env.LOG_LEVEL = 'silent';

/* Belt and braces. Nothing in here calls the mailer, and if some future edit
 * does, it fails loudly rather than quietly writing to somebody's inbox. */
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('close_migrated_backlog.js must never send mail'); },
  verify: async () => { throw new Error('close_migrated_backlog.js must never send mail'); },
});

const pool = require('./db');

const APPLY = process.argv.includes('--apply');
const untilArg = (() => {
  const i = process.argv.indexOf('--until');
  return i > -1 ? process.argv[i + 1] : null;
})();
const pad = (s, n) => String(s ?? '').padEnd(n);

/* Each pending queue, and the column that says when its work finished.
 * `type` is the approval_levels request_type, so the chain can be closed too
 * and nothing is left half-approved behind a settled request. */
const QUEUES = [
  { label: 'Leaves',          table: 'leaves',                     end: 'end_date',        pending: "status = 'pending'",   type: 'leave' },
  { label: 'Regularizations', table: 'attendance_regularizations', end: 'date',            pending: "status = 'pending'",   type: 'regularization' },
  { label: 'WFH requests',    table: 'wfh_requests',               end: 'date',            pending: "status = 'pending'",   type: 'wfh' },
  { label: 'On duty',         table: 'on_duty_requests',           end: 'end_date',        pending: "status = 'pending'",   type: 'on_duty' },
  { label: 'Comp-off',        table: 'comp_offs',                  end: 'GREATEST(worked_date, COALESCE(comp_off_date, worked_date))', pending: "status = 'pending'", type: 'comp_off' },
  { label: 'Timesheets',      table: 'timesheets',                 end: 'week_end_date',   pending: "status = 'submitted'", type: null },
];

(async () => {
  // Default: the last day of last month. Never the current month.
  const until = untilArg || (await pool.query(
    `SELECT (date_trunc('month', CURRENT_DATE) - INTERVAL '1 day')::date::text AS d`)).rows[0].d;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) {
    console.log('\n  --until must be a date like 2026-07-31\n');
    await pool.end();
    process.exit(1);
  }

  const guard = (await pool.query(
    `SELECT $1::date >= date_trunc('month', CURRENT_DATE)::date AS reaches_this_month`, [until])).rows[0];
  if (guard.reaches_this_month) {
    console.log(`\n  Refusing: ${until} is inside the current month.`);
    console.log('  This is for settling history. Requests from this month are live work.\n');
    await pool.end();
    process.exit(1);
  }

  const actor = (await pool.query(
    `SELECT id, email FROM employees
      WHERE role IN ('admin','director') AND status = 'active' AND deleted_at IS NULL
      ORDER BY CASE WHEN role = 'admin' THEN 0 ELSE 1 END LIMIT 1`)).rows[0];
  if (!actor) {
    console.log('\n  No active admin to record as the approver.\n');
    await pool.end();
    process.exit(1);
  }

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  Closing the migrated approval backlog');
  console.log(`  Everything finishing on or before ${until}`);
  console.log(`  ${APPLY ? 'APPLYING' : 'DRY RUN, nothing will be written'}`);
  console.log('══════════════════════════════════════════════════════════\n');
  console.log(`  Recorded as approved by ${actor.email}`);
  console.log('  No balances are debited. No attendance is rewritten. No mail is sent.\n');

  const plan = [];
  for (const q of QUEUES) {
    const r = await pool.query(
      `SELECT count(*)::int AS n,
              min(${q.end})::text AS oldest,
              max(${q.end})::text AS newest
         FROM ${q.table} WHERE ${q.pending} AND ${q.end} <= $1::date`, [until]);
    plan.push({ ...q, ...r.rows[0] });
  }

  const total = plan.reduce((n, p) => n + p.n, 0);
  console.log(`  ${pad('Queue', 20)}${pad('Count', 8)}Range`);
  console.log(`  ${'─'.repeat(54)}`);
  for (const p of plan) {
    console.log(`  ${pad(p.label, 20)}${pad(p.n, 8)}${p.n ? `${p.oldest} → ${p.newest}` : '—'}`);
  }
  console.log(`  ${'─'.repeat(54)}`);
  console.log(`  ${pad('Total', 20)}${total}\n`);

  if (!total) {
    console.log('  Nothing outstanding before that date. The backlog is already clear.\n');
    await pool.end();
    return;
  }

  /* A regularization is a request to CORRECT an attendance record. Marking one
   * approved without applying the correction leaves the person believing their
   * day was fixed when it was not — worse than leaving it pending.
   *
   * For leave inherited from Zoho that problem does not arise: the attendance
   * and balances came across already reflecting those days. But the Zoho import
   * never created a regularization or a WFH request, so any of those here were
   * raised in this system by somebody who wants something changed. */
  const corrections = plan.filter(p => ['Regularizations', 'WFH requests'].includes(p.label) && p.n);
  if (corrections.length) {
    console.log('  ⚠  These are not migration leftovers\n');
    for (const c of corrections) {
      console.log(`     ${c.n} ${c.label.toLowerCase()} (${c.oldest} → ${c.newest})`);
    }
    console.log('');
    console.log('     The Zoho import never created either kind, so these were raised here');
    console.log('     by somebody asking for a correction. This script records the decision');
    console.log('     but does NOT apply it — attendance would stay exactly as it is.');
    console.log('');
    console.log('     Action those through the screen instead, where approving actually');
    console.log('     makes the correction. Approving a past-month request sends no mail.');
    console.log('     To leave them alone, pass a cutoff before they were raised, e.g.');
    console.log(`     --until ${plan.find(p => p.label === 'Leaves')?.newest || '2026-05-31'}\n`);
  }

  // What stays behind, so the number on screen afterwards is not a surprise.
  const remaining = [];
  for (const q of QUEUES) {
    const r = await pool.query(
      `SELECT count(*)::int AS n FROM ${q.table} WHERE ${q.pending} AND ${q.end} > $1::date`, [until]);
    if (r.rows[0].n) remaining.push(`${r.rows[0].n} ${q.label.toLowerCase()}`);
  }
  console.log(`  Left pending afterwards: ${remaining.length ? remaining.join(', ') : 'nothing'}\n`);

  if (!APPLY) {
    console.log('══════════════════════════════════════════════════════════');
    console.log('  Nothing was written. Re-run with --apply.');
    console.log('══════════════════════════════════════════════════════════\n');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  let done = 0;
  try {
    /* Which columns each table actually has, rather than which ones it ought
     * to. wfh_requests and comp_offs have no updated_at, and naming it made
     * Postgres reject the statement even for a queue with nothing in it — it
     * validates the column before it counts the rows. Deployments drift; the
     * statement is built from what is there. */
    const columnsOf = async (table) => {
      const r = await client.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [table]);
      return new Set(r.rows.map(x => x.column_name));
    };

    await client.query('BEGIN');
    for (const q of QUEUES) {
      // Nothing to do, nothing to risk.
      if (!plan.find(p => p.table === q.table)?.n) continue;

      const cols = await columnsOf(q.table);
      const sets = ['status = $2'];
      if (cols.has('approved_by')) sets.push('approved_by = $3');
      if (cols.has('approved_at')) sets.push('approved_at = NOW()');
      if (cols.has('updated_at')) sets.push('updated_at = NOW()');

      const r = await client.query(
        `UPDATE ${q.table}
            SET ${sets.join(', ')}
          WHERE ${q.pending} AND ${q.end} <= $1::date
        RETURNING id`, [until, 'approved', actor.id]);
      done += r.rowCount;

      /* Close the approval chain too. A settled request with levels still
       * marked pending would show as awaiting somebody for ever. */
      if (q.type && r.rowCount) {
        await client.query(
          `UPDATE approval_levels
              SET status = 'approved', acted_at = NOW()
            WHERE request_type = $1 AND status = 'pending' AND request_id = ANY($2::uuid[])`,
          [q.type, r.rows.map(x => x.id)]);
      }
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

  let left = 0;
  for (const q of QUEUES) {
    left += (await pool.query(
      `SELECT count(*)::int AS n FROM ${q.table} WHERE ${q.pending}`)).rows[0].n;
  }

  console.log('══════════════════════════════════════════════════════════');
  console.log(`  ${done} request(s) closed. ${left} still pending, all after ${until}.`);
  console.log('  No balance, attendance figure or inbox was touched.');
  console.log('══════════════════════════════════════════════════════════\n');

  await pool.end();
})().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
