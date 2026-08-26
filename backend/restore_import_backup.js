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

/* How each table is put back.
 *
 *   'range'  clear the employee's rows between two dates and reinsert the
 *            stored ones. Right for attendance and leave, where the backup is
 *            every row in a window and rows may have been added since.
 *
 *   'row'    update the existing row back to its stored values. Right for a
 *            profile: the row is one somebody logs in as and that half the
 *            database points at by id, so deleting and reinserting it would
 *            take the foreign keys with it. Nothing was ever added or removed,
 *            only edited, so editing it back is the exact reverse.
 *
 * Anything not named here cannot be restored, and saying so beats guessing. */
const STRATEGY = {
  leaves:     { how: 'range', dateColumn: 'start_date' },
  attendance: { how: 'range', dateColumn: 'date' },
  employees:  { how: 'row',   key: 'id' },
};

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

  /* Reference rows — departments and designations — are not keyed to a person
   * and have no manifest. They are recorded one at a time, each saying whether
   * the import created the row or only filled empty fields in it, so undoing
   * means removing the first kind and putting the second kind back. */
  /* target_id arrived with department support, and a database that has not had
   * that migration run does not have the column. Asking for it unconditionally
   * made the restore fail on a batch that contains no reference rows at all —
   * so a missing migration blocked a RECOVERY, which is the one thing a restore
   * must never do. Look before asking. */
  const hasTargetId = (await pool.query(
    `SELECT COUNT(*)::int n FROM information_schema.columns
      WHERE table_name = 'import_backups' AND column_name = 'target_id'`)).rows[0].n > 0;

  const refs = hasTargetId ? (await pool.query(
    `SELECT id, table_name, target_id, created, row_data, restored_at
       FROM import_backups
      WHERE batch = $1 AND target_id IS NOT NULL ORDER BY created DESC, created_at`,
    [BATCH])).rows : [];

  if (refs.length) {
    const made = refs.filter(r => r.created);
    const edited = refs.filter(r => !r.created);
    console.log(`  ${made.length} row(s) were created and would be removed`);
    console.log(`  ${edited.length} row(s) had empty fields filled and would be put back\n`);

    if (refs.some(r => r.restored_at)) {
      console.log('  This batch has already been restored.\n');
      await pool.end();
      process.exit(1);
    }

    if (!APPLY) {
      console.log('  Nothing was written. Re-run with --apply.\n');
      await pool.end();
      return;
    }

    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      for (const r of edited) {
        const fields = r.row_data?.fields || [];
        if (!fields.length) continue;
        const sets = fields.map(f => `${f} = (src.r).${f}`).join(', ');
        await c.query(
          `UPDATE ${r.table_name} t SET ${sets}, updated_at = NOW()
             FROM (SELECT jsonb_populate_record(NULL::${r.table_name}, $2::jsonb) AS r) src
            WHERE t.id = $1`,
          [r.target_id, JSON.stringify(r.row_data?.row || {})]);
      }
      /* Created rows go last, and their links to each other are cut first.
       *
       * An import can create a department and then create its child pointing at
       * it. Deleting the parent while the child still references it violates
       * departments_parent_id_fkey and rolls the whole restore back — the child
       * is about to be deleted too, but the database has no way to know that.
       * Cutting the links between rows that are all leaving is safe precisely
       * because none of them will exist in a moment. */
      const madeIds = made.map(r => r.target_id);
      if (madeIds.length) {
        await c.query(
          `UPDATE departments SET parent_id = NULL
            WHERE id = ANY($1::uuid[]) AND parent_id = ANY($1::uuid[])`, [madeIds]);
      }
      for (const r of made) {
        await c.query(`DELETE FROM ${r.table_name} WHERE id = $1`, [r.target_id]);
      }
      await c.query(`UPDATE import_backups SET restored_at = NOW() WHERE batch = $1`, [BATCH]);
      await c.query('COMMIT');
      console.log(`  Removed ${made.length}, put back ${edited.length}.\n`);
    } catch (err) {
      await c.query('ROLLBACK').catch(() => {});
      console.log(`\n  Stopped and rolled back: ${err.message}`);
      console.log('  A created row is probably still referenced by somebody.\n');
      process.exitCode = 1;
    } finally { c.release(); }

    await pool.end();
    return;
  }

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
      const strategy = STRATEGY[table];
      if (!strategy) {
        console.log(`  ${table} has no restore strategy here — cannot restore this batch.\n`);
        await pool.end();
        process.exit(1);
      }
      const held = (await pool.query(
        `SELECT COUNT(*)::int n FROM import_backups
          WHERE batch = $1 AND table_name = $2 AND employee_id = $3`,
        [BATCH, table, m.employee_id])).rows[0].n;
      const now = strategy.how === 'range'
        ? (await pool.query(
            `SELECT COUNT(*)::int n FROM ${table}
              WHERE employee_id = $1 AND ${strategy.dateColumn} BETWEEN $2::date AND $3::date`,
            [m.employee_id, d.start, d.end])).rows[0].n
        : held;
      tables.push({ table, strategy, held, now });
    }
    work.push({ employeeId: m.employee_id, d, tables });
  }

  for (const w of work) {
    console.log(`  ${w.d.name}   ${w.d.code}`
      + `${w.d.start ? `   ${w.d.start} to ${w.d.end}` : ''}\n`);
    for (const t of w.tables) {
      console.log(`    ${pad(t.table, 14)}${t.strategy.how === 'range'
        ? `${pad(`${t.now} row(s) there now`, 24)}→ ${t.held} row(s) put back`
        : `${pad(`${(w.d.fields || []).length} field(s) changed`, 24)}→ put back as it was`}`);
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
        if (t.strategy.how === 'range') {
          await client.query(
            `DELETE FROM ${t.table}
              WHERE employee_id = $1 AND ${t.strategy.dateColumn} BETWEEN $2::date AND $3::date`,
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
          continue;
        }

        /* Edited in place, so put it back in place — and only the columns the
         * import actually wrote. Restoring the whole row would revert anything
         * a person legitimately changed in the meantime, which is not undoing
         * the import, it is undoing them as well. */
        const fields = w.d.fields || [];
        if (!fields.length) {
          console.log(`    ${pad(w.d.name, 24)}${t.table}   nothing to put back`);
          continue;
        }
        const sets = fields.map(f => `${f} = (src.r).${f}`).join(', ');
        const back = await client.query(
          `UPDATE ${t.table} t SET ${sets}, updated_at = NOW()
             FROM (SELECT jsonb_populate_record(NULL::${t.table}, row_data) AS r
                     FROM import_backups
                    WHERE batch = $1 AND table_name = $2 AND employee_id = $3
                    LIMIT 1) src
            WHERE t.${t.strategy.key} = $3`,
          [BATCH, t.table, w.employeeId]);
        if (back.rowCount !== 1) {
          throw new Error(`${t.table}: updated ${back.rowCount} row(s), expected exactly 1`);
        }
        console.log(`    ${pad(w.d.name, 24)}${pad(t.table, 14)}${fields.length} field(s) put back`);
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
