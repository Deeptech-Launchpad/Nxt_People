/**
 * migrate_zoho_features.js
 * Adds all tables and columns needed for the full Zoho People feature set.
 * Safe to run multiple times — all statements use IF NOT EXISTS guards.
 * Run: node migrate_zoho_features.js
 */
const pool = require('./db');

const migrations = [

  // ── DEPARTMENTS (hierarchical) ──────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    parent_id UUID REFERENCES departments(id),
    head_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ── EMPLOYEES: add department_id foreign key ────────────────────────────────
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS birth_date DATE`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS gender VARCHAR(20)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS photo_url VARCHAR(1000)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS reporting_manager_id UUID REFERENCES employees(id)`,

  // ── ATTENDANCE: late detection + GPS ────────────────────────────────────────
  `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS late_minutes INTEGER DEFAULT 0`,
  `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS shift_id UUID`,
  `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS check_in_latitude DOUBLE PRECISION`,
  `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS check_in_longitude DOUBLE PRECISION`,
  `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS check_out_latitude DOUBLE PRECISION`,
  `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS check_out_longitude DOUBLE PRECISION`,

  // ── LEAVE TYPES ─────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS leave_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    code VARCHAR(30) UNIQUE NOT NULL,
    icon VARCHAR(10) DEFAULT '📅',
    color VARCHAR(20) DEFAULT '#1a73e8',
    max_days_per_year NUMERIC(5,1) DEFAULT 12,
    carry_forward BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // Seed default leave types
  `INSERT INTO leave_types (name, code, icon, color, max_days_per_year, carry_forward)
   VALUES
     ('Casual Leave',           'casual',  '🏖', '#1a73e8', 12, false),
     ('Sick Leave',             'sick',    '🤒', '#e53935', 10, false),
     ('Earned Leave',           'earned',  '⭐', '#34a853', 15, true),
     ('Leave Without Pay',      'unpaid',  '💼', '#f5a623', 999, false),
     ('Compensatory Off',       'compoff', '⚖', '#8b5cf6', 0,  false),
     ('Permission',             'permission','🕐','#0097a7',0,  false)
   ON CONFLICT (code) DO NOTHING`,

  // ── LEAVE BALANCES ──────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS leave_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    leave_type_id UUID NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
    year INTEGER NOT NULL DEFAULT EXTRACT(YEAR FROM CURRENT_DATE),
    available NUMERIC(6,2) DEFAULT 0,
    booked NUMERIC(6,2) DEFAULT 0,
    UNIQUE(employee_id, leave_type_id, year)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_leave_balances_emp ON leave_balances(employee_id, year)`,

  // ── TIME LOGS ───────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS time_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    job_id UUID,
    description TEXT,
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    hours NUMERIC(8,4) DEFAULT 0,
    billable BOOLEAN DEFAULT TRUE,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_time_logs_emp_date ON time_logs(employee_id, date)`,

  // ── JOBS ────────────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(30) DEFAULT 'in_progress',
    estimated_hours NUMERIC(8,2),
    billable BOOLEAN DEFAULT TRUE,
    assignee_id UUID REFERENCES employees(id),
    due_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_project ON jobs(project_id)`,

  // ── PAYSLIPS ────────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS payslips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    gross_pay NUMERIC(12,2) DEFAULT 0,
    reimbursements NUMERIC(12,2) DEFAULT 0,
    deductions NUMERIC(12,2) DEFAULT 0,
    take_home NUMERIC(12,2) DEFAULT 0,
    payslip_url VARCHAR(1000),
    tax_worksheet_url VARCHAR(1000),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(employee_id, month, year)
  )`,

  // ── FEEDBACK ────────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    to_employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    type VARCHAR(30) DEFAULT 'positive',
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_feedback_to ON feedback(to_employee_id)`,
  `CREATE INDEX IF NOT EXISTS idx_feedback_from ON feedback(from_employee_id)`,

  // ── REPORT FAVORITES ─────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS report_favorites (
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    report_key VARCHAR(100) NOT NULL,
    PRIMARY KEY(employee_id, report_key)
  )`,

  // ── FEEDS (event-driven activity stream) ────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS feeds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    type VARCHAR(50) DEFAULT 'info',
    title VARCHAR(255),
    body TEXT,
    icon VARCHAR(10) DEFAULT '📌',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_feeds_emp ON feeds(employee_id, created_at DESC)`,

  // ── ASSETS ──────────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    asset_name VARCHAR(255) NOT NULL,
    asset_tag VARCHAR(100),
    category VARCHAR(100),
    assigned_date DATE,
    return_date DATE,
    status VARCHAR(30) DEFAULT 'assigned',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ── BENEFITS ────────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS benefits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    benefit_type VARCHAR(100) NOT NULL,
    value NUMERIC(12,2),
    effective_date DATE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ── TRAVEL REQUESTS ──────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS travel_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    from_date DATE NOT NULL,
    to_date DATE NOT NULL,
    destination VARCHAR(255),
    purpose TEXT,
    status VARCHAR(30) DEFAULT 'pending',
    approved_by UUID REFERENCES employees(id),
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ── TRAVEL EXPENSES ──────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS travel_expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    travel_request_id UUID REFERENCES travel_requests(id) ON DELETE SET NULL,
    amount NUMERIC(12,2) NOT NULL,
    description TEXT,
    date DATE,
    receipt_url VARCHAR(1000),
    status VARCHAR(30) DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ── NOTIFICATIONS: ensure is_read default ────────────────────────────────────
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link VARCHAR(500)`,
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT FALSE`,

  // ── JOB SCHEDULE entries ─────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS job_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    scheduled_date DATE NOT NULL,
    start_hour INTEGER,
    end_hour INTEGER,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
];

async function runMigrations() {
  console.log('🚀 Starting Zoho Features migration...\n');
  let ok = 0, fail = 0;
  for (const sql of migrations) {
    const preview = sql.trim().substring(0, 80).replace(/\s+/g, ' ');
    try {
      await pool.query(sql);
      console.log(`  ✅ ${preview}...`);
      ok++;
    } catch (err) {
      console.error(`  ❌ FAILED: ${preview}`);
      console.error(`     ${err.message}`);
      fail++;
    }
  }
  console.log(`\n📊 ${ok} succeeded, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}


runMigrations().catch(err => { console.error(err); process.exit(1); });
