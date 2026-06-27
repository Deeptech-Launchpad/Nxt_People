const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });

const stmts = [
  // Phase 3: Comp-Off
  `CREATE TABLE IF NOT EXISTS comp_offs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    worked_date DATE NOT NULL,
    reason TEXT,
    days_earned NUMERIC DEFAULT 1,
    days_used NUMERIC DEFAULT 0,
    status VARCHAR(50) DEFAULT 'pending',
    approved_by UUID REFERENCES employees(id),
    approved_at TIMESTAMP,
    rejection_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  // Phase 3: Payroll config
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS basic_salary NUMERIC DEFAULT 0`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS monthly_ctc NUMERIC DEFAULT 0`,
  // Phase 4: Leave accrual config in settings
  `ALTER TABLE settings ADD COLUMN IF NOT EXISTS leave_accrual_enabled BOOLEAN DEFAULT false`,
  `ALTER TABLE settings ADD COLUMN IF NOT EXISTS casual_accrual_per_month NUMERIC DEFAULT 1`,
  `ALTER TABLE settings ADD COLUMN IF NOT EXISTS sick_accrual_per_month NUMERIC DEFAULT 0.83`,
  `ALTER TABLE settings ADD COLUMN IF NOT EXISTS earned_accrual_per_month NUMERIC DEFAULT 1.25`,
  // Phase 5: Performance Reviews
  `CREATE TABLE IF NOT EXISTS performance_reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    reviewer_id UUID REFERENCES employees(id),
    cycle_name VARCHAR(255) NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    overall_rating NUMERIC,
    status VARCHAR(50) DEFAULT 'draft',
    employee_comments TEXT,
    reviewer_comments TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS performance_goals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    review_id UUID REFERENCES performance_reviews(id) ON DELETE CASCADE,
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    target TEXT,
    achievement TEXT,
    rating NUMERIC,
    weight NUMERIC DEFAULT 1,
    status VARCHAR(50) DEFAULT 'in_progress',
    due_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  // Phase 5: Exit Management
  `CREATE TABLE IF NOT EXISTS exit_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    resignation_date DATE NOT NULL,
    last_working_date DATE,
    reason TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    approved_by UUID REFERENCES employees(id),
    approved_at TIMESTAMP,
    rejection_reason TEXT,
    exit_interview_notes TEXT,
    it_clearance BOOLEAN DEFAULT false,
    hr_clearance BOOLEAN DEFAULT false,
    finance_clearance BOOLEAN DEFAULT false,
    manager_clearance BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  // Phase 6: Shift Roster
  `CREATE TABLE IF NOT EXISTS shift_roster (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    shift_id UUID REFERENCES shifts(id),
    date DATE NOT NULL,
    created_by UUID REFERENCES employees(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(employee_id, date)
  )`,
  // Phase 6: GPS config in settings
  `ALTER TABLE settings ADD COLUMN IF NOT EXISTS office_latitude NUMERIC`,
  `ALTER TABLE settings ADD COLUMN IF NOT EXISTS office_longitude NUMERIC`,
  `ALTER TABLE settings ADD COLUMN IF NOT EXISTS gps_radius_meters INT DEFAULT 200`,
  `ALTER TABLE settings ADD COLUMN IF NOT EXISTS require_gps BOOLEAN DEFAULT false`,
  // Attendance: add GPS columns
  `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS check_in_latitude NUMERIC`,
  `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS check_in_longitude NUMERIC`,
  `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS check_out_latitude NUMERIC`,
  `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS check_out_longitude NUMERIC`,
  // Indexes
  `CREATE INDEX IF NOT EXISTS idx_comp_offs_emp ON comp_offs(employee_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_perf_reviews_emp ON performance_reviews(employee_id)`,
  `CREATE INDEX IF NOT EXISTS idx_exit_emp ON exit_requests(employee_id)`,
  `CREATE INDEX IF NOT EXISTS idx_roster_date ON shift_roster(date, employee_id)`
];

(async () => {
  const c = await pool.connect();
  let ok = 0, skip = 0;
  for (const s of stmts) {
    try { await c.query(s); ok++; process.stdout.write('✅ '); }
    catch (e) { skip++; process.stdout.write(`⚠️(${e.message.substring(0,40)}) `); }
  }
  c.release(); await pool.end();
  console.log(`\n\n✅ Migration complete: ${ok} ok, ${skip} skipped`);
})();
