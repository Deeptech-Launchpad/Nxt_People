/* ── Undo a restage ─────────────────────────────────────────────────────────
 *  zoho_restage.js deletes real history and puts Zoho's in its place. That is
 *  only an acceptable thing to do because this exists, so this is written to be
 *  boring and total:
 *
 *    It reads the manifest the restage wrote — who, which tables, which dates —
 *    rather than inferring the range from the surviving rows. A person who had
 *    no leave to begin with backs up nothing, and inference would leave the
 *    imported rows sitting there looking original.
 *
 *    It clears that exact range and puts the stored rows back with their
 *    original ids, through jsonb_populate_record, so nothing has to be kept in
 *    step with the columns the table happens to have today.
 *
 *    It counts what went back against what was stored, inside the transaction.
 *
 *    Dry run by default. A batch already restored says so and stops.
 *
 *    docker compose exec backend node restore_import_backup.js
 *    docker compose exec backend node restore_import_backup.js <batch>
 *    docker compose exec backend node restore_import_backup.js <batch> --apply
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
process.env.EMAIL_DISABLED = 'true';
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({
  sendMail: async () => { throw new Error('restore_import_backup.js does not send mail'); },
  verify: async () => { throw new Error('restore_import_backup.js does not send mail'); },
});

const pool = require('./db');

const BATCH = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const APPLY = process.argv.includes('--apply');

const pad = (s, n) => String(s).padEnd(n);

// Which column holds the date each table is ranged by. Anything not named here
// cannot be restored, and saying so beats guessing at a column name.
const DATE_COLUMN = { leaves: 'start_date', attendance: 'date' };

(async () => {
  if (!(await pool.query(`SELECT to_regclass('import_backups') AS t`)).rows[0].t) {
    console.log('\n  import_backups does not exist — there is nothing to restore.\n');
    await pool.end();
    return;
  }

  // ── No batch named: list what is there ───────────────────────────────────
  if (!BATCH) {
    const batches = (await pool.query(
      `SELECT batch,
              MIN(created_at) AS taken,
              COUNT(*) FILTER (WHERE table_name <> '_manifest')::int AS rows,
              COUNT(*) FILTER (WHERE table_name = '_manifest')::int AS people,
              COUNT(*) FILTER (WHERE restored_at IS NOT NULL)::int AS restored
         FROM import_backups GROUP BY batch ORDER BY MIN(created_at) DESC`)).rows;

    console.log('\n══════════════════════════════════════════════════════════');
    console.log('  Backups held');
    console.log('══════════════════════════════════════════════════════════\n');
    if (!batches.length) console.log('  None.\n');
    for (const b of batches) {
      console.log(`  ${pad(b.batch, 26)}${pad(`${b.people} people`, 12)}`
        + `${pad(`${b.rows} rows`, 12)}${b.restored ? 'ALREADY RESTORED' : ''}`);
    }
    console.log('\n  node restore_import_backup.js <batch>            to see what it would do');
    console.log('  node restore_import_backup.js <batch> --apply    to put it back\n');
    await pool.end();
    return;
  }

  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  Restore ${BATCH} — ${APPLY ? 'APPLYING' : 'DRY RUN, nothing will be written'}`);
  console.log('══════════════════════════════════════════════════════════\n');

  const manifests = (await pool.query(
    `SELECT employee_id, row_data, restored_at FROM import_backups
      WHERE batch = $1 AND table_name = '_manifest' ORDER BY created_at`, [BATCH])).rows;

  if (!manifests.length) {
    console.log('  No such batch.\n');
    await pool.end();
    process.exit(1);
  }
  if (manifests.some(m => m.restored_at)) {
    console.log('  This batch has already been restored. Restoring it twice would');
    console.log('  clear whatever has happened since and put the same rows back.\n');
    await pool.end();
    process.exit(1);
  }

  // ── What is held, and what is in its place now ───────────────────────────
  const work = [];
  for (const m of manifests) {
    const d = m.row_data;
    const tables = [];
    for (const table of d.tables || []) {
      const col = DATE_COLUMN[table];
      if (!col) {
        console.log(`  ${table} has no date column named here — cannot restore this batch.\n`);
        await pool.end();
        process.exit(1);
      }
      const held = (await pool.query(
        `SELECT COUNT(*)::int n FROM import_backups
          WHERE batch = $1 AND table_name = $2 AND employee_id = $3`,
        [BATCH, table, m.employee_id])).rows[0].n;
      const now = (await pool.query(
        `SELECT COUNT(*)::int n FROM ${table}
          WHERE employee_id = $1 AND ${col} BETWEEN $2::date AND $3::date`,
        [m.employee_id, d.start, d.end])).rows[0].n;
      tables.push({ table, col, held, now });
    }
    work.push({ employeeId: m.employee_id, d, tables });
  }

  for (const w of work) {
    console.log(`  ${w.d.name}   ${w.d.code}   ${w.d.start} to ${w.d.end}\n`);
    for (const t of w.tables) {
      console.log(`    ${pad(t.table, 14)}${pad(`${t.now} row(s) there now`, 24)}`
        + `→ ${t.held} row(s) put back`);
    }
    console.log('');
  }

  if (!APPLY) {
    console.log('  Nothing was written. Re-run with --apply.\n');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const w of work) {
      for (const t of w.tables) {
        await client.query(
          `DELETE FROM ${t.table}
            WHERE employee_id = $1 AND ${t.col} BETWEEN $2::date AND $3::date`,
          [w.employeeId, w.d.start, w.d.end]);

        // jsonb_populate_record rebuilds the row against whatever columns the
        // table has now, so this keeps working when the schema moves on.
        const back = await client.query(
          `INSERT INTO ${t.table}
           SELECT (jsonb_populate_record(NULL::${t.table}, row_data)).*
             FROM import_backups
            WHERE batch = $1 AND table_name = $2 AND employee_id = $3`,
          [BATCH, t.table, w.employeeId]);

        if (back.rowCount !== t.held) {
          throw new Error(`${t.table}: put back ${back.rowCount} of ${t.held} rows`);
        }
        console.log(`    ${pad(w.d.name, 24)}${pad(t.table, 14)}${back.rowCount} row(s) restored`);
      }
    }

    await client.query(
      `UPDATE import_backups SET restored_at = NOW() WHERE batch = $1`, [BATCH]);
    await client.query('COMMIT');

    console.log('\n══════════════════════════════════════════════════════════');
    console.log('  Restored. The rows carry their original ids, so anything');
    console.log('  pointing at them still points at them.');
    console.log('══════════════════════════════════════════════════════════\n');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.log(`\n  Stopped and rolled back: ${err.message}`);
    console.log('  Nothing was changed.\n');
    process.exitCode = 1;
  } finally { client.release(); }

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
