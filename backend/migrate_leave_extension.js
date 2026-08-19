/* ── Leave extension and partial cancellation ──────────────────────────────
 *  Two settings on Leave Tracker > Configuration > Leave Request that were
 *  stored and never read. Extending moves a request's end date later; partial
 *  cancellation removes part of a range and, when the part removed is in the
 *  middle, splits the request in two.
 *
 *  Columns, and why each exists:
 *    extension_reason / extended_by / extended_at
 *        who stretched a request and why. Without them an approved leave could
 *        silently grow between approval and payroll with nothing on the record.
 *    cancelled_days
 *        how many working days a partial cancellation removed. total_days is
 *        rewritten in place, so the original figure would otherwise be lost.
 *    split_from
 *        the request a remainder was cut from, when a cancellation in the
 *        middle of a range leaves two pieces. Nullable and self-referencing;
 *        a whole-range cancellation never sets it.
 * ────────────────────────────────────────────────────────────────────────── */
const pool = require('./db');

const migrations = [
  `ALTER TABLE leaves ADD COLUMN IF NOT EXISTS extension_reason TEXT`,
  `ALTER TABLE leaves ADD COLUMN IF NOT EXISTS extended_by UUID REFERENCES employees(id)`,
  `ALTER TABLE leaves ADD COLUMN IF NOT EXISTS extended_at TIMESTAMPTZ`,
  `ALTER TABLE leaves ADD COLUMN IF NOT EXISTS cancelled_days NUMERIC(5,2)`,
  `ALTER TABLE leaves ADD COLUMN IF NOT EXISTS split_from UUID REFERENCES leaves(id) ON DELETE SET NULL`,
  `CREATE INDEX IF NOT EXISTS idx_leaves_split_from ON leaves(split_from) WHERE split_from IS NOT NULL`,
];

(async () => {
  let ok = 0;
  for (const sql of migrations) {
    try { await pool.query(sql); ok++; }
    catch (err) {
      if (err.code === '42710' || err.code === '42P07') { ok++; continue; }
      console.error('FAILED:', sql.split('\n')[0].trim(), '\n  ', err.message);
    }
  }
  console.log(`leave extension migration: ${ok}/${migrations.length} statements applied`);
  const r = await pool.query(
    `SELECT COUNT(*)::int total,
            COUNT(extended_at)::int extended,
            COUNT(split_from)::int split
       FROM leaves`);
  const { total, extended, split } = r.rows[0];
  console.log(`  ${total} leave(s) on file — ${extended} extended, ${split} created by a split`);
  await pool.end();
})();
