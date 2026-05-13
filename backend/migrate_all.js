/**
 * Final Migration — Nxt-People Phase 1-6
 * Adds all new tables and columns safely with IF NOT EXISTS / DO NOTHING guards
 * Safe to run multiple times.
 */

const pool = require('./db');

const migrations = [
  // ── EMPLOYEES: payroll + CTC ──────────────────────────────────────────────
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS monthly_ctc NUMERIC(12,2)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS basic_salary NUMERIC(12,2)`,

  // ── ATTENDANCE: GPS coordinates ───────────────────────────────────────────
  `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS check_in_latitude DOUBLE PRECISION`,
  `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS check_in_longitude DOUBLE PRECISION`,
  `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS check_out_latitude DOUBLE PRECISION`,
  `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS check_out_longitude DOUBLE PRECISION`,

  // ── SETTINGS: GPS + Accrual fields ───────────────────────────────────────
  `ALTER TABLE settings ADD COLUMN IF NOT EXISTS office_latitude DOUBLE PRECISION`,
  `ALTER TABLE settings ADD COLUMN IF NOT EXISTS office_longitude DOUBLE PRECISION`,
  `ALTER TABLE settings ADD COLUMN IF NOT EXISTS gps_radius_meters INTEGER DEFAULT 200`,
  `ALTER TABLE settings ADD COLUMN IF NOT EXISTS require_gps BOOLEAN DEFAULT FALSE`,
  `ALTER TABLE settings ADD COLUMN IF NOT EXISTS leave_accrual_enabled BOOLEAN DEFAULT FALSE`,
  `ALTER TABLE settings ADD COLUMN IF NOT EXISTS casual_accrual_per_month NUMERIC(4,2) DEFAULT 1`,
  `ALTER TABLE settings ADD COLUMN IF NOT EXISTS sick_accrual_per_month NUMERIC(4,2) DEFAULT 0.83`,
  `ALTER TABLE settings ADD COLUMN IF NOT EXISTS earned_accrual_per_month NUMERIC(4,2) DEFAULT 1.25`,
  `ALTER TABLE settings ADD COLUMN IF NOT EXISTS timezone VARCHAR(64) DEFAULT 'Asia/Kolkata'`,
  `ALTER TABLE settings ADD COLUMN IF NOT EXISTS working_days JSONB DEFAULT '["Mon","Tue","Wed","Thu","Fri"]'`,
  `ALTER TABLE settings ADD COLUMN IF NOT EXISTS allow_remote_check_in BOOLEAN DEFAULT TRUE`,

  // ── ATTENDANCE REGULARIZATIONS ────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS attendance_regularizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    check_in TIME,
    check_out TIME,
    reason TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    approved_by UUID REFERENCES employees(id),
    approved_at TIMESTAMPTZ,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ── WFH REQUESTS ─────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS wfh_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    reason TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    approved_by UUID REFERENCES employees(id),
    approved_at TIMESTAMPTZ,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_wfh_emp_date ON wfh_requests(employee_id, date)`,

  // ── COMP-OFF REQUESTS ─────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS comp_off_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    worked_date DATE NOT NULL,
    reason TEXT NOT NULL,
    days_earned NUMERIC(3,1) DEFAULT 1,
    status VARCHAR(20) DEFAULT 'pending',
    approved_by UUID REFERENCES employees(id),
    approved_at TIMESTAMPTZ,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ── NOTIFICATIONS ─────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    type VARCHAR(50) DEFAULT 'info',
    title VARCHAR(255) NOT NULL,
    message TEXT,
    link VARCHAR(255),
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ── ANNOUNCEMENTS ─────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    priority VARCHAR(20) DEFAULT 'normal',
    is_active BOOLEAN DEFAULT TRUE,
    expires_at DATE,
    created_by UUID REFERENCES employees(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ── PERFORMANCE REVIEWS ───────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS performance_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    reviewer_id UUID REFERENCES employees(id),
    cycle_name VARCHAR(255) NOT NULL,
    period_start DATE,
    period_end DATE,
    status VARCHAR(30) DEFAULT 'draft',
    overall_rating SMALLINT CHECK (overall_rating BETWEEN 1 AND 5),
    reviewer_comments TEXT,
    employee_comments TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS performance_goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id UUID NOT NULL REFERENCES performance_reviews(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    target VARCHAR(500),
    achievement TEXT,
    rating SMALLINT CHECK (rating BETWEEN 1 AND 5),
    weight SMALLINT DEFAULT 1,
    status VARCHAR(30) DEFAULT 'in_progress',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ── EMPLOYEE DOCUMENTS ────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS employee_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) DEFAULT 'other',
    file_url VARCHAR(1000) NOT NULL,
    file_size INTEGER,
    uploaded_by UUID REFERENCES employees(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ── EXIT REQUESTS ─────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS exit_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    resignation_date DATE NOT NULL,
    last_working_date DATE,
    reason TEXT NOT NULL,
    status VARCHAR(30) DEFAULT 'pending',
    approved_by UUID REFERENCES employees(id),
    approved_at TIMESTAMPTZ,
    rejection_reason TEXT,
    it_clearance BOOLEAN DEFAULT FALSE,
    hr_clearance BOOLEAN DEFAULT FALSE,
    finance_clearance BOOLEAN DEFAULT FALSE,
    manager_clearance BOOLEAN DEFAULT FALSE,
    exit_interview_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ── SHIFTS TABLE (ensure exists) ──────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ── SHIFT ROSTER ──────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS shift_roster (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    created_by UUID REFERENCES employees(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(employee_id, date)
  )`,

  // ── LEAVE ACCRUAL LOG ─────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS leave_accrual_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    leave_type VARCHAR(30) NOT NULL,
    days_added NUMERIC(4,2) NOT NULL,
    reason VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ── SHIFT_ID on employees ─────────────────────────────────────────────────
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES shifts(id)`,

  // ── HOLIDAYS TABLE (ensure exists) ────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS holidays (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    date DATE NOT NULL UNIQUE,
    type VARCHAR(30) DEFAULT 'national',
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ── EMPLOYEE: profile fields ──────────────────────────────────────────────
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS date_of_birth DATE`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS address TEXT`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_contact_name VARCHAR(255)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_contact_phone VARCHAR(50)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS photo_url VARCHAR(1000)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS bank_account VARCHAR(50)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS bank_ifsc VARCHAR(20)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS pan_number VARCHAR(20)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'active'`,
];

async function runMigrations() {
  console.log('🚀 Starting Nxt-People database migration...\n');
  let success = 0, failed = 0;

  for (const sql of migrations) {
    const preview = sql.trim().substring(0, 70).replace(/\s+/g, ' ');
    try {
      await pool.query(sql);
      console.log(`  ✅ ${preview}...`);
      success++;
    } catch (err) {
      console.error(`  ❌ FAILED: ${preview}`);
      console.error(`     Error: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n📊 Migration complete: ${success} succeeded, ${failed} failed`);
  if (failed === 0) console.log('🎉 All migrations applied successfully!');
  else console.log('⚠️  Some migrations failed — check errors above');

  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

runMigrations().catch(err => {
  console.error('Fatal migration error:', err);
  process.exit(1);
});
