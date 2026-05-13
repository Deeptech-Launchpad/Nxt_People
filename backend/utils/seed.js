/**
 * Loads backend/seed.sql and executes it against the configured database.
 * Idempotent — seed.sql uses INSERT ... ON CONFLICT DO NOTHING.
 */
const fs = require('fs');
const path = require('path');
const pool = require('../db');

(async () => {
  const seedPath = path.join(__dirname, '..', 'seed.sql');
  if (!fs.existsSync(seedPath)) {
    console.error(`❌ seed.sql not found at ${seedPath}`);
    process.exit(1);
  }
  const sql = fs.readFileSync(seedPath, 'utf8');

  try {
    await pool.query(sql);
    console.log('✅ Seed data applied from seed.sql');
  } catch (err) {
    console.error('❌ Seed failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
