/* ── Calendar feed tokens ──────────────────────────────────────────────────
 *  A calendar subscription cannot carry a login. Google and Outlook poll the
 *  URL on their own schedule with no session and no way to be prompted, so the
 *  URL itself has to be the credential.
 *
 *  That makes it a secret worth treating as one: it is per employee, random,
 *  and revocable. Revoking issues a new token, which breaks the old URL — that
 *  is the point of it rather than a side effect.
 *
 *  Deliberately NOT derived from the employee id or a shared secret. A derived
 *  token cannot be revoked without changing the thing it derives from, and one
 *  leaked URL would imply every other.
 * ────────────────────────────────────────────────────────────────────────── */
const pool = require('./db');

const migrations = [
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS calendar_token TEXT`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS calendar_token_issued_at TIMESTAMP`,
  // A partial unique index rather than a plain one: most rows hold NULL until
  // somebody asks for a feed, and NULLs must not collide.
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_calendar_token
     ON employees(calendar_token) WHERE calendar_token IS NOT NULL`,
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
  console.log(`calendar feed migration: ${ok}/${migrations.length} statements applied`);
  const r = await pool.query(
    `SELECT COUNT(*)::int total, COUNT(calendar_token)::int issued FROM employees WHERE deleted_at IS NULL`);
  console.log(`  ${r.rows[0].issued}/${r.rows[0].total} employees have a feed URL`);
  console.log('  Tokens are issued on request, not seeded — an unused feed is a URL nobody asked for.');
  await pool.end();
})();
