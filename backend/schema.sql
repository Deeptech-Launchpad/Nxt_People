CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Companies
CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) UNIQUE NOT NULL,
  code VARCHAR(50),
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Settings
CREATE TABLE IF NOT EXISTS settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_name VARCHAR(255) DEFAULT 'Nxt People Corp',
  company_email VARCHAR(255),
  work_start_time VARCHAR(10) DEFAULT '09:00',
  work_end_time VARCHAR(10) DEFAULT '18:00',
  -- late_after_minutes = minutes since midnight (e.g., 570 = 09:30 AM)
  late_after_minutes INT DEFAULT 570,
  half_day_hours INT DEFAULT 4,
  -- JSONB list of role strings ("admin","director","manager","team_incharge","team_member") for whom
  -- MFA is mandatory. Empty array = optional for everyone.
  mfa_required_roles JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Shifts — Bug #5 fix: includes working_days column
CREATE TABLE IF NOT EXISTS shifts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  start_time VARCHAR(10) NOT NULL,
  end_time VARCHAR(10) NOT NULL,
  grace_minutes INT DEFAULT 15,
  working_days JSONB DEFAULT '["Mon","Tue","Wed","Thu","Fri"]',
  color VARCHAR(20) DEFAULT '#4F46E5',
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Employees — Bug #14 fix: includes manager_id, status, approved_by, accepted_at, etc.
CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id VARCHAR(50) UNIQUE,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255),
  phone VARCHAR(50),
  role VARCHAR(50) DEFAULT 'team_member',
  department VARCHAR(100),
  designation VARCHAR(100),
  company VARCHAR(255),
  division VARCHAR(255),
  status VARCHAR(50) DEFAULT 'active',
  registration_status VARCHAR(50) DEFAULT 'active',
  shift_id UUID REFERENCES shifts(id),
  manager_id UUID REFERENCES employees(id),
  reporting_manager_id UUID REFERENCES employees(id),
  approving_authority_id UUID REFERENCES employees(id),
  joining_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  casual_leave INT DEFAULT 12,
  sick_leave INT DEFAULT 10,
  earned_leave INT DEFAULT 15,
  unpaid_leave INT DEFAULT 999,
  has_accepted BOOLEAN DEFAULT false,
  accepted_at TIMESTAMP,
  approved_by UUID REFERENCES employees(id),
  approved_at TIMESTAMP,
  rejection_reason TEXT,
  -- Soft-delete tombstone. NULL = active employee. When HR "deletes" an
  -- employee we set this to NOW() so the row (and all its CASCADE-linked
  -- attendance/leaves/payslips) stays intact for audit.
  deleted_at TIMESTAMPTZ,
  -- Bumped by the logout-everywhere endpoint. Any refresh-token whose iat
  -- is earlier than this is rejected at use — kills every active device
  -- in one update without needing per-device session enumeration.
  tokens_revoked_at TIMESTAMPTZ,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Attendance — includes location and updated_at
CREATE TABLE IF NOT EXISTS attendance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  check_in TIMESTAMP,
  check_out TIMESTAMP,
  check_in_location VARCHAR(255) DEFAULT 'Office',
  check_out_location VARCHAR(255),
  working_hours NUMERIC DEFAULT 0,
  status VARCHAR(50) DEFAULT 'absent',
  late_minutes INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(employee_id, date)
);

-- Leaves — Bug #23 fix: includes is_half_day, half_day_type, updated_at, approved_at
CREATE TABLE IF NOT EXISTS leaves (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  leave_type VARCHAR(50) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  total_days NUMERIC,
  reason TEXT NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  is_half_day BOOLEAN DEFAULT false,
  half_day_type VARCHAR(20),
  approved_by UUID REFERENCES employees(id),
  approved_at TIMESTAMP,
  rejection_reason TEXT,
  updated_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Generic hierarchy approval levels — the 3-level approval chain derived from
-- the Employee Tree (employees.reporting_manager_id) at submission time, shared
-- by every request type (leave, regularization, …). One row per level
-- (1 = immediate parent … up to 3 = top-most ancestor). request_id is
-- polymorphic (points at leaves.id, attendance_regularizations.id, …) so no FK.
CREATE TABLE IF NOT EXISTS approval_levels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_type VARCHAR(30) NOT NULL DEFAULT 'leave',    -- leave | regularization | …
  request_id   UUID NOT NULL,                           -- the request this chain belongs to
  level        INT  NOT NULL,                           -- 1..3
  approver_id  UUID REFERENCES employees(id),           -- assigned approver for this level
  status       VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  acted_by     UUID REFERENCES employees(id),           -- who actually acted (self / higher / HR)
  acted_at     TIMESTAMPTZ,
  on_behalf    BOOLEAN NOT NULL DEFAULT false,           -- covered by a higher level or HR
  by_hr        BOOLEAN NOT NULL DEFAULT false,           -- acted via HR/Super-Admin override
  UNIQUE (request_type, request_id, level)
);
CREATE INDEX IF NOT EXISTS idx_apl_request  ON approval_levels(request_type, request_id);
CREATE INDEX IF NOT EXISTS idx_apl_approver ON approval_levels(approver_id, status);

-- Holidays — includes description and updated_at
CREATE TABLE IF NOT EXISTS holidays (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  date DATE NOT NULL,
  type VARCHAR(50) DEFAULT 'company',
  year INT,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP
);

-- Timesheets
CREATE TABLE IF NOT EXISTS timesheets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  week_start_date DATE NOT NULL,
  week_end_date DATE NOT NULL,
  total_hours NUMERIC DEFAULT 0,
  status VARCHAR(50) DEFAULT 'draft',
  notes TEXT,
  rejection_reason TEXT,
  approved_by UUID REFERENCES employees(id),
  approved_at TIMESTAMP,
  updated_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
