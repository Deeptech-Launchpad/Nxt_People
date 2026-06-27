const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });

const stmts = [
  // Phase 2: Attendance Regularization
  `CREATE TABLE IF NOT EXISTS attendance_regularizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    check_in TIME,
    check_out TIME,
    reason TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    approved_by UUID REFERENCES employees(id),
    approved_at TIMESTAMP,
    rejection_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP
  )`,
  // Phase 3: WFH Requests
  `CREATE TABLE IF NOT EXISTS wfh_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    reason TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    approved_by UUID REFERENCES employees(id),
    approved_at TIMESTAMP,
    rejection_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  // Phase 5: Documents
  `CREATE TABLE IF NOT EXISTS employee_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(100) DEFAULT 'other',
    file_url TEXT,
    file_size INTEGER,
    uploaded_by UUID REFERENCES employees(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  // Phase 4: Leave accrual log
  `CREATE TABLE IF NOT EXISTS leave_accrual_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    leave_type VARCHAR(50) NOT NULL,
    days_added NUMERIC NOT NULL,
    balance_after NUMERIC,
    reason VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  // Indexes
  `CREATE INDEX IF NOT EXISTS idx_regularizations_emp ON attendance_regularizations(employee_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_wfh_emp ON wfh_requests(employee_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_docs_emp ON employee_documents(employee_id)`
];

(async () => {
  const c = await pool.connect();
  for (const s of stmts) {
    try { await c.query(s); console.log('✅', s.trim().substring(0, 60)); }
    catch (e) { console.log('⚠️', e.message.substring(0, 70)); }
  }
  c.release(); await pool.end();
  console.log('\n✅ All phases migration complete!');
})();
