// Adds the one address component the existing structured-address columns
// (added by migrate_fixes.js: address_line1/line2/city/state/pincode/country,
// and their permanent_address_* counterparts) don't already have: District.
// Additive and idempotent — safe to run multiple times, never touches
// existing data or any other column.
const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });

const stmts = [
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS address_district           VARCHAR(100)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS permanent_address_district VARCHAR(100)`,
];

(async () => {
  const c = await pool.connect();
  for (const s of stmts) {
    try {
      await c.query(s);
      console.log('✅', s.trim().substring(0, 75));
    } catch (e) {
      console.log('⚠️ (skip)', e.message.substring(0, 75));
    }
  }
  c.release();
  await pool.end();
  console.log('\n✅ Structured address District migration complete!');
})();
