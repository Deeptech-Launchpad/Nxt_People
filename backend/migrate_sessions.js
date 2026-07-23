const pool = require('./db');

(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS attendance_sessions (
        id SERIAL PRIMARY KEY,
        attendance_id INTEGER NOT NULL REFERENCES attendance(id) ON DELETE CASCADE,
        employee_id INTEGER NOT NULL,
        date DATE NOT NULL,
        check_in TIMESTAMP NOT NULL,
        check_out TIMESTAMP,
        session_hours NUMERIC DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_att_sessions_att_id ON attendance_sessions(attendance_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_att_sessions_emp_date ON attendance_sessions(employee_id, date)`);
    console.log('  attendance_sessions created (or already exists)');
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err.message);
    await pool.end();
    process.exit(1);
  }
})();
