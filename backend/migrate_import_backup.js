/* ── Somewhere to put what an import replaces ───────────────────────────────
 *  Restaging an employee onto Zoho's history means deleting the history this
 *  system holds for them. That is fine only if the deletion is reversible, so
 *  every row removed is copied here first.
 *
 *  Whole rows, as JSONB, under one batch name.
 *
 *  A mirror table with real columns has to be migrated in step with the table
 *  it copies, and the first time it drifts the backup silently stops holding
 *  everything — which nobody discovers until they need it. JSONB keeps whatever
 *  the row had, whatever shape that was.
 *
 *    docker compose exec backend node migrate_import_backup.js
 * ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
const pool = require('./db');

const STEPS = [
  `CREATE TABLE IF NOT EXISTS import_backups (
     id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     batch        VARCHAR(80) NOT NULL,
     table_name   VARCHAR(80) NOT NULL,
     employee_id  UUID,
     row_data     JSONB NOT NULL,
     restored_at  TIMESTAMPTZ,
     created_at   TIMESTAMPTZ DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_import_backups_batch ON import_backups(batch)`,
  `CREATE INDEX IF NOT EXISTS idx_import_backups_employee ON import_backups(employee_id)`,
  /* Not everything imported belongs to a person. Departments and designations
   * are reference rows the whole company shares, and putting their id in a
   * column called employee_id would make the table lie about what it holds. */
  `ALTER TABLE import_backups ADD COLUMN IF NOT EXISTS target_id UUID`,
  `ALTER TABLE import_backups ADD COLUMN IF NOT EXISTS created BOOLEAN NOT NULL DEFAULT FALSE`,
];

(async () => {
  console.log('');
  for (const sql of STEPS) {
    const name = (sql.match(/ADD COLUMN IF NOT EXISTS ([a-z_]+)/)
      || sql.match(/(?:TABLE|INDEX) IF NOT EXISTS ([a-z_]+)/) || [])[1] || 'step';
    try {
      await pool.query(sql);
      console.log(`  ok    ${name}`);
    } catch (err) {
      console.log(`  FAIL  ${name}: ${err.message}`);
      process.exitCode = 1;
    }
  }

  const cols = (await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'import_backups' ORDER BY ordinal_position`)).rows.map(r => r.column_name);
  console.log(`\n  import_backups(${cols.join(', ')})\n`);

  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
