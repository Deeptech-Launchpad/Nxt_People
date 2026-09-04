/* ── Stop overriding casual leave with dead history ───────────────────────────
 *  Confirmed policy: casual leave does not carry forward. 12 granted, minus
 *  what was taken, is the whole answer every year — nothing rolls into the
 *  next one.
 *
 *  Zoho's own live report agrees: "Casual Leave" (the current type) shows
 *  Opening Balance 0 for everyone. The .75 / .5 / .25 / 1 extra sitting in
 *  this system's numbers came from import_zoho_balances.js summing that
 *  current balance together with SEPARATE, closed-out archive types —
 *  "Casual Leave 2023", "Casual Leave 2024" — that Zoho itself never adds
 *  back in. Traced for one person against a static, years-old, zero-activity
 *  archive row (Opening -0.25, Granted 0, Booked 0, Closing -0.25, unchanged
 *  since 2023) — dead weight, not unspent balance.
 *
 *  With the policy confirmed, the override in leave_balances is not just
 *  wrong, it is unnecessary: availableFor() already computes the correct
 *  number — grantedToDate() minus this year's approved+pending leave — the
 *  moment no override row exists. Removing the row is the whole fix.
 *
 *  Every row removed is copied into import_backups first, counted against
 *  what is about to go — a mismatch aborts before anything is deleted.
 *  Dry run by default.
 *
 *    docker compose exec backend node remove_casual_leave_overrides.js
 *    docker compose exec backend node remove_casual_leave_overrides.js --apply
 *    docker compose exec backend node remove_casual_leave_overrides.js --restore BATCH_NAME
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
const pool = require('./db');

const APPLY = process.argv.includes('--apply');
const RESTORE_BATCH = (process.argv.find((a, i) => process.argv[i - 1] === '--restore'));
const YEAR = parseInt((process.argv.find(a => /^--year=/.test(a)) || '').split('=')[1], 10)
  || new Date().getFullYear();

const pad = (s, n) => String(s ?? '').padEnd(n);

async function restore(batch) {
  const rows = (await pool.query(
    `SELECT employee_id, row_data FROM import_backups
      WHERE batch = $1 AND table_name = 'leave_balances' AND restored_at IS NULL`,
    [batch])).rows;
  if (!rows.length) { console.log(`\n  No unrestored rows under batch ${batch}.\n`); return; }

  console.log(`\n  Restoring ${rows.length} row(s) from batch ${batch}...\n`);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of rows) {
      await client.query(
        `INSERT INTO leave_balances SELECT (jsonb_populate_record(NULL::leave_balances, $1::jsonb)).*`,
        [JSON.stringify(r.row_data)]);
    }
    await client.query(
      `UPDATE import_backups SET restored_at = NOW() WHERE batch = $1 AND table_name = 'leave_balances'`,
      [batch]);
    await client.query('COMMIT');
    console.log(`  Put back ${rows.length} row(s).\n`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.log(`\n  Stopped and rolled back: ${err.message}\n`);
    process.exitCode = 1;
  } finally { client.release(); }
  await pool.end();
}

(async () => {
  if (RESTORE_BATCH) { await restore(RESTORE_BATCH); return; }

  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  Remove casual leave overrides for ${YEAR} — ${APPLY ? 'APPLYING' : 'DRY RUN, nothing will be written'}`);
  console.log('══════════════════════════════════════════════════════════\n');

  const rows = (await pool.query(
    `SELECT lb.id, lb.employee_id, lb.available, lb.booked,
            e.employee_id AS code, e.first_name || ' ' || COALESCE(e.last_name,'') AS name
       FROM leave_balances lb
       JOIN leave_types lt ON lb.leave_type_id = lt.id
       JOIN employees e ON e.id = lb.employee_id
      WHERE lt.code = 'casual' AND lb.year = $1
      ORDER BY e.employee_id`,
    [YEAR]));

  if (!rows.rows.length) {
    console.log(`  No casual leave_balances rows for ${YEAR}. Nothing to remove.\n`);
    await pool.end();
    return;
  }

  console.log(`  ${rows.rows.length} row(s) will fall back to the policy calculation:\n`);
  for (const r of rows.rows) {
    console.log(`    ${pad(r.code, 14)}${pad(r.name.trim().slice(0, 28), 30)}`
      + `available=${pad(r.available, 8)}booked=${r.booked}`);
  }

  if (!APPLY) {
    console.log('\n  Nothing was written. Re-run with --apply.\n');
    await pool.end();
    return;
  }

  const batch = `remove-casual-override-${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const r of rows.rows) {
      await client.query(
        `INSERT INTO import_backups (batch, table_name, employee_id, row_data)
         SELECT $1, 'leave_balances', $2, to_jsonb(lb.*) FROM leave_balances lb WHERE lb.id = $3`,
        [batch, r.employee_id, r.id]);
    }

    const backedUp = (await client.query(
      `SELECT COUNT(*)::int n FROM import_backups WHERE batch = $1 AND table_name = 'leave_balances'`,
      [batch])).rows[0].n;
    if (backedUp !== rows.rows.length) {
      throw new Error(`backed up ${backedUp} of ${rows.rows.length} rows — refusing to delete`);
    }

    const del = await client.query(
      `DELETE FROM leave_balances WHERE id = ANY($1::uuid[])`,
      [rows.rows.map(r => r.id)]);
    if (del.rowCount !== rows.rows.length) {
      throw new Error(`deleted ${del.rowCount} of ${rows.rows.length} rows`);
    }

    await client.query('COMMIT');
    console.log(`\n  Removed ${del.rowCount} row(s), backed up under batch: ${batch}`);
    console.log(`  To undo: node remove_casual_leave_overrides.js --restore ${batch}\n`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.log(`\n  Stopped and rolled back: ${err.message}\n`);
    process.exitCode = 1;
  } finally { client.release(); }

  await pool.end();
})().catch(async e => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
