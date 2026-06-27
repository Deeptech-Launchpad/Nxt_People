const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     parseInt(process.env.DB_PORT) || 5432,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,

  // ── Pool tuning ─────────────────────────────────────────────────────────────
  max:                    20,     // max open connections in pool
  min:                     2,     // keep at least 2 warm connections ready
  idleTimeoutMillis:   30000,     // close connections idle > 30 s
  connectionTimeoutMillis: 5000,  // fail fast if no connection within 5 s

  // Kill queries running longer than 30 s (prevents slow queries from blocking)
  statement_timeout:   30000,
});

pool.on('error', (err) => {
  console.error('❌ Unexpected PostgreSQL pool error:', err.message);
  // Don't exit — let the pool recover by creating a new connection
});

pool.on('connect', () => {
  if (process.env.NODE_ENV !== 'production') {
    console.log('🔗 New DB client connected');
  }
});

// Export the Pool instance directly. Both call patterns work:
//   const pool = require('./db');             pool.query(...)
//   const { pool } = require('./db');         pool.query(...)   ← back-compat for tests
module.exports = pool;
module.exports.pool = pool;
