/* ── leaves.balance_source ─────────────────────────────────────────────────
 *  Leave balances live in three stores (leave_balances, the legacy
 *  employees.<x>_leave columns, and the comp_offs ledger). Approval takes the
 *  days out of whichever one holds the balance; until now every refund path
 *  wrote to leave_balances regardless, so a debit and its refund could land in
 *  different places.
 *
 *  That was invisible only because an approved leave could not be cancelled.
 *  Now that it can, the store used at approval is recorded here and replayed
 *  on refund, so the days go back exactly where they came from — even if
 *  balances are provisioned in between.
 *
 *  Existing rows are left NULL on purpose. NULL means "approved before this
 *  was recorded", and refundApproved() resolves the store live for those. It
 *  does not mean "no store", which is a different thing and would send a
 *  refund nowhere.
 * ────────────────────────────────────────────────────────────────────────── */
const pool = require('./db');

const migrations = [
  `ALTER TABLE leaves ADD COLUMN IF NOT EXISTS balance_source TEXT`,
];

(async () => {
  let ok = 0;
  for (const entry of migrations) {
    const [sql, params] = Array.isArray(entry) ? entry : [entry, []];
    try { await pool.query(sql, params); ok++; }
    catch (err) {
      if (err.code === '42710' || err.code === '42P07') { ok++; continue; }
      console.error('FAILED:', sql.split('\n')[0].trim(), '\n  ', err.message);
    }
  }
  console.log(`leave balance source migration: ${ok}/${migrations.length} statements applied`);
  const r = await pool.query(
    `SELECT COUNT(*)::int total,
            COUNT(balance_source)::int recorded,
            COUNT(*) FILTER (WHERE status = 'approved')::int approved
       FROM leaves`);
  const { total, recorded, approved } = r.rows[0];
  console.log(`  ${recorded}/${total} leaves carry a balance source (${approved} approved)`);
  console.log('  existing rows stay NULL — the store is resolved live for those');
  await pool.end();
})();
