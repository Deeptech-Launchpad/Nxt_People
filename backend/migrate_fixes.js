/**
 * migrate_fixes.js — Nxt-People Bug-Fix Migration
 * Fixes:
 *   B1: comp_off_requests → comp_offs table rename
 *   B2: announcements schema column mismatch (content/created_by vs body/posted_by)
 *   B3: holidays UNIQUE(date) constraint removed — allows multi-year import
 *   + Missing columns: leave_policy, emergency_contact_relation, settings fields
 * Safe to run multiple times (idempotent).
 */

const pool = require('./db');

const steps = [
  // ── B1: Rename comp_off_requests → comp_offs ──────────────────────────────
  // If the old table exists, rename it. If comp_offs already exists, skip.
  `DO $$
   BEGIN
     IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'comp_off_requests')
        AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'comp_offs') THEN
       ALTER TABLE comp_off_requests RENAME TO comp_offs;
     END IF;
   END$$`,

  // Ensure comp_offs exists with correct schema (for fresh installs)
  `CREATE TABLE IF NOT EXISTS comp_offs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    worked_date DATE NOT NULL,
    reason TEXT,
    days_earned NUMERIC(3,1) DEFAULT 1,
    days_used NUMERIC(3,1) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'pending',
    approved_by UUID REFERENCES employees(id),
    approved_at TIMESTAMPTZ,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // Ensure days_used column exists (may be missing on renamed table)
  `ALTER TABLE comp_offs ADD COLUMN IF NOT EXISTS days_used NUMERIC(3,1) DEFAULT 0`,
  `ALTER TABLE comp_offs ADD COLUMN IF NOT EXISTS rejection_reason TEXT`,
  `ALTER TABLE comp_offs ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES employees(id)`,
  `ALTER TABLE comp_offs ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ`,

  // ── B2: Fix announcements schema mismatch ─────────────────────────────────
  // Migration created: content, created_by
  // Route uses:        body,    posted_by, is_pinned, type
  // Add missing columns so both old and new columns coexist (safe patch)
  `ALTER TABLE announcements ADD COLUMN IF NOT EXISTS body TEXT`,
  `ALTER TABLE announcements ADD COLUMN IF NOT EXISTS posted_by UUID REFERENCES employees(id)`,
  `ALTER TABLE announcements ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE`,
  `ALTER TABLE announcements ADD COLUMN IF NOT EXISTS type VARCHAR(50) DEFAULT 'general'`,
  // pinned_until lets HR set an auto-unpin date when creating/editing an
  // announcement. The auto-unpin cron in server.js flips is_pinned to FALSE
  // once this passes. NULL means "pin indefinitely".
  `ALTER TABLE announcements ADD COLUMN IF NOT EXISTS pinned_until TIMESTAMPTZ`,

  // Copy data from old columns to new columns if body is null but content is not
  `UPDATE announcements SET body = content WHERE body IS NULL AND content IS NOT NULL`,
  `UPDATE announcements SET posted_by = created_by WHERE posted_by IS NULL AND created_by IS NOT NULL`,
  // Backfill: the original API conflated is_active and is_pinned. After this
  // migration the API reads is_pinned directly, so existing pinned-and-live
  // rows need their is_pinned set to TRUE to keep showing the pin badge.
  `UPDATE announcements SET is_pinned = TRUE
     WHERE is_pinned = FALSE AND is_active = TRUE
       AND created_at > NOW() - INTERVAL '30 days'`,

  // ── B3: Remove UNIQUE(date) constraint from holidays ──────────────────────
  // Allows importing holidays for multiple years on the same calendar date
  `DO $$
   DECLARE
     con_name TEXT;
   BEGIN
     SELECT constraint_name INTO con_name
     FROM information_schema.table_constraints
     WHERE table_name = 'holidays'
       AND constraint_type = 'UNIQUE'
       AND constraint_name LIKE '%date%';
     IF con_name IS NOT NULL THEN
       EXECUTE format('ALTER TABLE holidays DROP CONSTRAINT %I', con_name);
     END IF;
   END$$`,

  // Add year column if missing (needed by route)
  `ALTER TABLE holidays ADD COLUMN IF NOT EXISTS year INTEGER`,
  // Backfill year from date
  `UPDATE holidays SET year = EXTRACT(YEAR FROM date)::INTEGER WHERE year IS NULL`,

  // ── Missing: leave_policy column in settings ───────────────────────────────
  `ALTER TABLE settings ADD COLUMN IF NOT EXISTS leave_policy JSONB DEFAULT '{"casualLeave":12,"sickLeave":10,"earnedLeave":15}'`,

  // ── Missing: emergency_contact_relation ───────────────────────────────────
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_contact_relation VARCHAR(100)`,

  // ── Ensure all settings GPS + accrual columns exist ───────────────────────
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

  // ── Ensure employees payroll columns exist ────────────────────────────────
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS monthly_ctc NUMERIC(12,2)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS basic_salary NUMERIC(12,2)`,

  // ── Ensure attendance GPS columns exist ──────────────────────────────────
  `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS check_in_latitude DOUBLE PRECISION`,
  `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS check_in_longitude DOUBLE PRECISION`,
  `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS check_out_latitude DOUBLE PRECISION`,
  `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS check_out_longitude DOUBLE PRECISION`,
  `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`,

  // ── Ensure employee profile columns exist ─────────────────────────────────
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS date_of_birth DATE`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS address TEXT`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_contact_name VARCHAR(255)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_contact_phone VARCHAR(50)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS photo_url VARCHAR(1000)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS bank_account VARCHAR(50)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS bank_ifsc VARCHAR(20)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS pan_number VARCHAR(20)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'active'`,

  // ── Ensure shift_roster table exists ─────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS shift_roster (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    created_by UUID REFERENCES employees(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(employee_id, date)
  )`,

  // ── Ensure leave_accrual_log table exists ─────────────────────────────────
  `CREATE TABLE IF NOT EXISTS leave_accrual_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    leave_type VARCHAR(30) NOT NULL,
    days_added NUMERIC(4,2) NOT NULL,
    reason VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ── Ensure notifications table exists ─────────────────────────────────────
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

  // ── Ensure wfh_requests table exists ──────────────────────────────────────
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

  // ── Ensure attendance_regularizations table exists ────────────────────────
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

  // ── Ensure performance tables exist ───────────────────────────────────────
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
    employee_id UUID REFERENCES employees(id),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    target VARCHAR(500),
    achievement TEXT,
    rating SMALLINT CHECK (rating BETWEEN 1 AND 5),
    weight SMALLINT DEFAULT 1,
    status VARCHAR(30) DEFAULT 'in_progress',
    due_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ── Ensure employee_documents table exists ────────────────────────────────
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

  // ── Document schema reconciliation ────────────────────────────────────────
  // The table was originally created by migrate_docs.js with old column names
  // (document_type, file_path, original_name, mime_type, size, uploaded_at).
  // The newer routes/documents.js uses (name, type, file_url, file_size,
  // uploaded_by, created_at). The CREATE TABLE IF NOT EXISTS above is a no-op
  // when the old table exists, so we have to ADD the new columns explicitly
  // here, drop NOT NULL on the legacy columns (so new INSERTs don't violate
  // the old constraints), and backfill old → new for existing rows.
  `ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS name          VARCHAR(255)`,
  `ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS type          VARCHAR(50)  DEFAULT 'other'`,
  `ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS file_url      VARCHAR(1000)`,
  `ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS file_size     INTEGER`,
  `ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS uploaded_by   UUID REFERENCES employees(id) ON DELETE SET NULL`,
  `ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS created_at    TIMESTAMPTZ DEFAULT NOW()`,
  // Drop NOT NULL on the legacy columns (only meaningful if they exist).
  `DO $$ BEGIN
     IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='employee_documents' AND column_name='document_type')
     THEN ALTER TABLE employee_documents ALTER COLUMN document_type DROP NOT NULL;
     END IF;
     IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='employee_documents' AND column_name='file_path')
     THEN ALTER TABLE employee_documents ALTER COLUMN file_path DROP NOT NULL;
     END IF;
     IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='employee_documents' AND column_name='original_name')
     THEN ALTER TABLE employee_documents ALTER COLUMN original_name DROP NOT NULL;
     END IF;
   END $$`,
  // Backfill: copy data from legacy columns into new columns where missing.
  // Each UPDATE is guarded so it only runs when the legacy column exists.
  `DO $$ BEGIN
     IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='employee_documents' AND column_name='original_name')
     THEN UPDATE employee_documents SET name = original_name
            WHERE name IS NULL AND original_name IS NOT NULL;
     END IF;
     IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='employee_documents' AND column_name='document_type')
     THEN UPDATE employee_documents SET type = document_type
            WHERE type IS NULL AND document_type IS NOT NULL;
     END IF;
     IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='employee_documents' AND column_name='size')
     THEN UPDATE employee_documents SET file_size = size
            WHERE file_size IS NULL AND size IS NOT NULL;
     END IF;
     IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='employee_documents' AND column_name='file_path')
     THEN UPDATE employee_documents SET file_url = CASE
              WHEN file_path LIKE '/uploads/%' THEN file_path
              ELSE '/uploads/' || file_path
            END
            WHERE file_url IS NULL AND file_path IS NOT NULL;
     END IF;
     IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='employee_documents' AND column_name='uploaded_at')
     THEN UPDATE employee_documents SET created_at = uploaded_at
            WHERE created_at IS NULL AND uploaded_at IS NOT NULL;
     END IF;
     UPDATE employee_documents SET uploaded_by = employee_id
       WHERE uploaded_by IS NULL;
   END $$`,

  // ── Employment status workflow (post-meeting feature) ────────────────────
  // Adds the fields needed by the new "Update Employment Status" popup:
  //   • notice_period_end_date — last working day for status='notice_period'
  //   • status_reason          — why the status change happened
  //   • rehire_eligibility     — 'yes' | 'no' | 'maybe' (for ex-employees)
  //   • is_blacklisted         — never rehire / flag during onboarding
  //   • status_applied_at      — when the current status took effect
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS notice_period_end_date DATE`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS status_reason         TEXT`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS rehire_eligibility    VARCHAR(20)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_blacklisted        BOOLEAN DEFAULT FALSE`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS status_applied_at     TIMESTAMPTZ`,

  // ── Weekend rule: future compensation flag ────────────────────────────────
  // When TRUE, this recurring weekend rule will later be made up for by a
  // Working Day Exception. The exception's "Select Compensated Holiday"
  // dropdown then includes this rule as an option (alongside holidays).
  `ALTER TABLE weekend_rules ADD COLUMN IF NOT EXISTS is_compensatory BOOLEAN DEFAULT FALSE`,

  // ── Holiday metadata (post-meeting feature) ───────────────────────────────
  // Adds the fields needed by the enhanced Holiday popup:
  //   • category         — Election / No Workload / General Maintenance / etc.
  //   • is_compensatory  — true = employees must work another day to compensate
  //   • mail_body        — text used by /api/holidays/:id/notify to email everyone
  //   • compensation_type        — 'future' | 'past' (for working-day exceptions)
  //   • compensated_holiday_id   — link from a working day to the holiday it makes up for
  `ALTER TABLE holidays ADD COLUMN IF NOT EXISTS category                VARCHAR(50)`,
  `ALTER TABLE holidays ADD COLUMN IF NOT EXISTS is_compensatory         BOOLEAN DEFAULT FALSE`,
  `ALTER TABLE holidays ADD COLUMN IF NOT EXISTS mail_body               TEXT`,
  `ALTER TABLE holidays ADD COLUMN IF NOT EXISTS compensation_type       VARCHAR(30)`,
  `ALTER TABLE holidays ADD COLUMN IF NOT EXISTS compensated_holiday_id  UUID REFERENCES holidays(id) ON DELETE SET NULL`,
  // When the working-day exception compensates a recurring weekend rule
  // (not a one-off holiday), we store the rule's id here instead.
  `ALTER TABLE holidays ADD COLUMN IF NOT EXISTS compensated_rule_id     UUID REFERENCES weekend_rules(id) ON DELETE SET NULL`,
  `ALTER TABLE holidays ADD COLUMN IF NOT EXISTS notified_at             TIMESTAMPTZ`,

  // ── Previous employment history from Zoho tabularSections.SS_EMP_HISTORY ─
  `CREATE TABLE IF NOT EXISTS employee_previous_employment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    company        VARCHAR(255),
    designation    VARCHAR(255),
    from_date      DATE,
    to_date        DATE,
    job_description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_prev_emp_employee ON employee_previous_employment(employee_id)`,

  // ── Zoho-synced extras: exit date, experience, expertise ──────────────────
  // Sourced from Zoho People fields: Dateofexit, total_experience.displayValue,
  // Expertise. exit_date powers the "Left on" column in the Ex Employees tab.
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS exit_date DATE`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS total_experience VARCHAR(100)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS expertise TEXT`,

  // ── Backfill legacy duplicate columns ─────────────────────────────────────
  // The schema accumulated overlapping column pairs over its migration history
  // (birth_date / date_of_birth, manager_id / reporting_manager_id, etc.).
  // The codebase uses the right-hand "new" name everywhere; the left-hand
  // "legacy" columns stay as NULL after Zoho sync. Mirror data both ways so
  // any code path that still references the old name keeps working, and the
  // Edit modal shows the same data regardless of which side was filled.
  // Each guarded by EXISTS so the migration is safe on DBs missing either col.
  `DO $$ BEGIN
     IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='employees' AND column_name='birth_date')
        AND EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name='employees' AND column_name='date_of_birth')
     THEN
       UPDATE employees SET birth_date    = date_of_birth WHERE birth_date    IS NULL AND date_of_birth IS NOT NULL;
       UPDATE employees SET date_of_birth = birth_date    WHERE date_of_birth IS NULL AND birth_date    IS NOT NULL;
     END IF;
   END $$`,
  `DO $$ BEGIN
     IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='employees' AND column_name='date_of_joining')
        AND EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name='employees' AND column_name='joining_date')
     THEN
       UPDATE employees SET date_of_joining = joining_date    WHERE date_of_joining IS NULL AND joining_date    IS NOT NULL;
       UPDATE employees SET joining_date    = date_of_joining WHERE joining_date    IS NULL AND date_of_joining IS NOT NULL;
     END IF;
   END $$`,
  `DO $$ BEGIN
     IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='employees' AND column_name='manager_id')
        AND EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name='employees' AND column_name='reporting_manager_id')
     THEN
       UPDATE employees SET manager_id           = reporting_manager_id WHERE manager_id           IS NULL AND reporting_manager_id IS NOT NULL;
       UPDATE employees SET reporting_manager_id = manager_id           WHERE reporting_manager_id IS NULL AND manager_id           IS NOT NULL;
     END IF;
   END $$`,
  `DO $$ BEGIN
     IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='employees' AND column_name='current_address')
        AND EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name='employees' AND column_name='address')
     THEN
       UPDATE employees SET current_address = address         WHERE current_address IS NULL AND address         IS NOT NULL;
       UPDATE employees SET address         = current_address WHERE address         IS NULL AND current_address IS NOT NULL;
     END IF;
   END $$`,
  `DO $$ BEGIN
     IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='employees' AND column_name='emergency_contact_number')
        AND EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name='employees' AND column_name='emergency_contact_phone')
     THEN
       UPDATE employees SET emergency_contact_number = emergency_contact_phone  WHERE emergency_contact_number IS NULL AND emergency_contact_phone  IS NOT NULL;
       UPDATE employees SET emergency_contact_phone  = emergency_contact_number WHERE emergency_contact_phone  IS NULL AND emergency_contact_number IS NOT NULL;
     END IF;
   END $$`,
  `DO $$ BEGIN
     IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='employees' AND column_name='emergency_contact_relationship')
        AND EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name='employees' AND column_name='emergency_contact_relation')
     THEN
       UPDATE employees SET emergency_contact_relationship = emergency_contact_relation     WHERE emergency_contact_relationship IS NULL AND emergency_contact_relation     IS NOT NULL;
       UPDATE employees SET emergency_contact_relation     = emergency_contact_relationship WHERE emergency_contact_relation     IS NULL AND emergency_contact_relationship IS NOT NULL;
     END IF;
   END $$`,
  `DO $$ BEGIN
     IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='employees' AND column_name='avatar')
        AND EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name='employees' AND column_name='photo_url')
     THEN
       UPDATE employees SET avatar    = photo_url WHERE avatar    IS NULL AND photo_url IS NOT NULL;
       UPDATE employees SET photo_url = avatar    WHERE photo_url IS NULL AND avatar    IS NOT NULL;
     END IF;
   END $$`,

  // ── Backfill company for legacy Zoho-synced rows ──────────────────────────
  // Earlier Zoho imports stored company as NULL when Zoho didn't return it.
  // Default any NULL company to 'AltiusNxt' so the per-company Employee ID
  // suggestion and company-aware reports work for the historical data.
  // Idempotent: only fills NULLs, never overwrites an admin-set company.
  `UPDATE employees SET company = 'AltiusNxt' WHERE company IS NULL OR company = ''`,

  // ── Employee ID uniqueness ────────────────────────────────────────────────
  // Belt-and-suspenders for the application-level uniqueness check in
  // routes/employees.js + routes/registrations.js. Partial index so multiple
  // pre-confirmation rows with NULL employee_id don't collide.
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_employees_employee_id
     ON employees (employee_id) WHERE employee_id IS NOT NULL`,

  // ── Education: add degree + course/specialization ─────────────────────────
  // The onboarding form collects "Degree" (e.g. B.Tech) and we're adding
  // "Course / Specialization" (e.g. Artificial Intelligence & Data Science).
  // The original schema only had highest_qualification — degree was being
  // silently dropped on the backend INSERT.
  `ALTER TABLE employee_education ADD COLUMN IF NOT EXISTS degree VARCHAR(255)`,
  `ALTER TABLE employee_education ADD COLUMN IF NOT EXISTS course VARCHAR(255)`,

  // ── Backfill document type mapping ────────────────────────────────────────
  // Onboarding form uploads were originally stored with the raw form
  // fieldname (aadhaarCard, tenthCertificate, ...) in the `type` column.
  // The self-service Documents page groups by a canonical taxonomy
  // (id_proof / educational / experience / resume / photo / ...).
  // Remap existing rows so historical onboarding uploads show up grouped
  // under the right category. Idempotent — the WHERE clause only matches
  // the legacy field names, not the canonical values, so re-running is safe.
  `UPDATE employee_documents
      SET type = CASE type
            WHEN 'aadhaarCard'        THEN 'id_proof'
            WHEN 'panCard'            THEN 'id_proof'
            WHEN 'tenthCertificate'   THEN 'educational'
            WHEN 'twelfthCertificate' THEN 'educational'
            WHEN 'ugCertificate'      THEN 'educational'
            WHEN 'pgCertificate'      THEN 'educational'
            WHEN 'experienceLetters'  THEN 'experience'
            WHEN 'resume'             THEN 'resume'
            WHEN 'passportPhoto'      THEN 'photo'
            WHEN 'addressProof'       THEN 'address_proof'
            WHEN 'offerLetter'        THEN 'offer_letter'
            ELSE type
          END
    WHERE type IN ('aadhaarCard', 'panCard', 'tenthCertificate', 'twelfthCertificate',
                   'ugCertificate', 'pgCertificate', 'experienceLetters',
                   'resume', 'passportPhoto', 'addressProof', 'offerLetter')`,

  // ── Travel: add transport mode + rejection_reason ─────────────────────────
  `ALTER TABLE travel_requests ADD COLUMN IF NOT EXISTS transport VARCHAR(50)`,
  `ALTER TABLE travel_requests ADD COLUMN IF NOT EXISTS rejection_reason TEXT`,

  // ── Compensation claims ───────────────────────────────────────────────────
  // Employee submits, manager approves. receipt_url is /uploads/<file>.
  `CREATE TABLE IF NOT EXISTS compensation_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    claim_type VARCHAR(50) NOT NULL,
    amount NUMERIC(12,2) NOT NULL,
    claim_date DATE NOT NULL,
    description TEXT,
    receipt_url VARCHAR(1000),
    status VARCHAR(30) DEFAULT 'pending',
    approved_by UUID REFERENCES employees(id),
    approved_at TIMESTAMPTZ,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_comp_claims_emp ON compensation_claims(employee_id, status)`,

  // ── HR letter requests ────────────────────────────────────────────────────
  // Employee requests a letter type; HR sets status. letter_url is the
  // (optional) PDF the HR team uploads as the final issued letter.
  `CREATE TABLE IF NOT EXISTS hr_letter_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    letter_type VARCHAR(50) NOT NULL,
    purpose TEXT,
    status VARCHAR(30) DEFAULT 'requested',
    processed_by UUID REFERENCES employees(id),
    processed_at TIMESTAMPTZ,
    letter_url VARCHAR(1000),
    rejection_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_letters_emp ON hr_letter_requests(employee_id, status)`,

  // ── Performance goals: allow standalone (employee-set) goals ──────────────
  // The original schema required review_id. To support employees adding their
  // own personal goals from /performance/goals, relax the constraint.
  `ALTER TABLE performance_goals ALTER COLUMN review_id DROP NOT NULL`,

  // ── Ensure exit_requests table exists ─────────────────────────────────────
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

  // ── Ensure api_connections table exists ───────────────────────────────────
  `CREATE TABLE IF NOT EXISTS api_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    website_url VARCHAR(500),
    description TEXT,
    api_key VARCHAR(255) UNIQUE NOT NULL,
    company VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE,
    allowed_data_types JSONB DEFAULT '["employees"]',
    last_sync_at TIMESTAMPTZ,
    created_by_id UUID REFERENCES employees(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ── Hash API keys at rest (SHA-256). Existing plaintext keys are migrated
  //    in-place: the hash column is populated from any plaintext that's still
  //    present, then the api_key column is wiped. After this runs, the raw
  //    key only exists in the consumer's records — server only stores the hash.
  `CREATE EXTENSION IF NOT EXISTS pgcrypto`,
  `ALTER TABLE api_connections ADD COLUMN IF NOT EXISTS api_key_hash CHAR(64) UNIQUE`,
  `ALTER TABLE api_connections ADD COLUMN IF NOT EXISTS api_key_prefix VARCHAR(12)`,
  `UPDATE api_connections
     SET api_key_hash = encode(digest(api_key, 'sha256'), 'hex'),
         api_key_prefix = SUBSTRING(api_key, 1, 8)
     WHERE api_key_hash IS NULL AND api_key IS NOT NULL`,
  `ALTER TABLE api_connections ALTER COLUMN api_key DROP NOT NULL`,
  `UPDATE api_connections SET api_key = NULL WHERE api_key_hash IS NOT NULL`,

  // ── Ensure announcements has all required columns ─────────────────────────
  `ALTER TABLE announcements ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`,
  `ALTER TABLE announcements ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP`,

  // ── Per-user read state for announcements (so the Activities card can
  //    surface only the items each employee has not yet seen).
  `CREATE TABLE IF NOT EXISTS announcement_reads (
    employee_id     UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    announcement_id UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
    read_at         TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (employee_id, announcement_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_announcement_reads_employee ON announcement_reads(employee_id)`,

  // ── Configurable weekend rules — Google-Calendar-style recurrence so HR
  //    can declare which days/weeks count as weekends without touching code.
  //    Each rule is OR'd together: a date is a weekend if ANY active rule matches.
  `CREATE TABLE IF NOT EXISTS weekend_rules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,
    -- ['sun','mon','tue','wed','thu','fri','sat'] — which weekdays the rule applies to.
    days_of_week    JSONB NOT NULL DEFAULT '[]',
    -- [] or null = every week; otherwise only those weeks of the month, where
    -- 1 = first occurrence of the weekday in the month, ..., 5 = fifth.
    weeks_of_month  JSONB DEFAULT '[]',
    -- How many weeks between repetitions (1 = every week, 2 = every other, etc.).
    interval_weeks  INTEGER NOT NULL DEFAULT 1,
    start_date      DATE NOT NULL DEFAULT CURRENT_DATE,
    -- 'never' | 'on' | 'after' — matches the Google-Calendar UI options.
    end_type        VARCHAR(10) NOT NULL DEFAULT 'never',
    end_date        DATE,
    end_count       INTEGER,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_by      UUID REFERENCES employees(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_weekend_rules_active ON weekend_rules(is_active)`,

  // ── MFA (TOTP) — opt-in per user. Stored as base32 secret + bcrypt-hashed
  //    backup codes so a DB leak doesn't expose either. mfa_enabled flips to
  //    true only after the user confirms a valid 6-digit code at setup.
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS mfa_enabled      BOOLEAN  NOT NULL DEFAULT FALSE`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS mfa_secret       TEXT`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS mfa_backup_codes JSONB    DEFAULT '[]'`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS mfa_enabled_at   TIMESTAMPTZ`,

  // ── Columns populated by the Zoho People sync. Most are nullable so we
  //    don't break existing rows. aadhaar / uan / pan are PII — mask them
  //    at the UI layer and gate full visibility behind HR/admin role.
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS nick_name            VARCHAR(100)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS work_location        VARCHAR(255)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS employment_type      VARCHAR(50)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS source_of_hire       VARCHAR(100)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS secondary_manager_id UUID REFERENCES employees(id)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS gender               VARCHAR(20)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS marital_status       VARCHAR(30)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS blood_group          VARCHAR(10)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS nationality          VARCHAR(100)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS about_me             TEXT`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS work_phone           VARCHAR(50)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS extension            VARCHAR(20)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS personal_email       VARCHAR(255)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS permanent_address    TEXT`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS aadhaar_number       VARCHAR(20)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS uan_number           VARCHAR(20)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS bank_name            VARCHAR(100)`,
  // Structured address parts from Zoho *.childValues. Flat `address` /
  // `permanent_address` columns stay for display; these enable querying
  // by city/state/pincode for compliance reports + state-based PT.
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS address_line1   VARCHAR(255)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS address_line2   VARCHAR(255)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS address_city    VARCHAR(100)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS address_state   VARCHAR(100)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS address_pincode VARCHAR(20)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS address_country VARCHAR(100)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS permanent_address_line1   VARCHAR(255)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS permanent_address_line2   VARCHAR(255)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS permanent_address_city    VARCHAR(100)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS permanent_address_state   VARCHAR(100)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS permanent_address_pincode VARCHAR(20)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS permanent_address_country VARCHAR(100)`,
  // Family member DOB — currently dropped from Zoho's Dependent Details
  // section. Lets the org track dependents for insurance / fee schemes.
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_contact_dob DATE`,

  // Seed default rules. Each is name-scoped so deleting one and re-running
  // migrations safely recreates just the missing one (and never duplicates
  // a rule the admin has renamed/customised).
  //
  // start_date is intentionally far in the past so the rule applies to historical
  // dates too. (Without this, a Sunday before the seed date renders as "Absent"
  // because the rule evaluator skips dates that fall before start_date.)
  `INSERT INTO weekend_rules (name, days_of_week, weeks_of_month, interval_weeks, start_date)
   SELECT 'Sundays',                '["sun"]'::jsonb, '[]'::jsonb,         1, DATE '2020-01-01'
   WHERE NOT EXISTS (SELECT 1 FROM weekend_rules WHERE name = 'Sundays')`,
  `INSERT INTO weekend_rules (name, days_of_week, weeks_of_month, interval_weeks, start_date)
   SELECT '1st & 3rd Saturdays',    '["sat"]'::jsonb, '[1,3]'::jsonb,      1, DATE '2020-01-01'
   WHERE NOT EXISTS (SELECT 1 FROM weekend_rules WHERE name = '1st & 3rd Saturdays')`,
  // Repair: if either rule got captured with a recent CURRENT_DATE as
  // start_date (legacy bug), or with is_active=false after an accidental
  // toggle, restore it. Without this, days before that start_date render as
  // "Absent" instead of "Weekend".
  `UPDATE weekend_rules SET start_date = DATE '2020-01-01'
     WHERE name IN ('Sundays', '1st & 3rd Saturdays')
       AND start_date > DATE '2020-01-02'`,
  `UPDATE weekend_rules SET is_active = TRUE
     WHERE name IN ('Sundays', '1st & 3rd Saturdays')
       AND is_active = FALSE`,
  // Also change the column default so any future row inserted without an
  // explicit start_date is retroactive by default (matches admin expectation
  // when creating a "Sundays are weekends" rule via the UI).
  `ALTER TABLE weekend_rules ALTER COLUMN start_date SET DEFAULT DATE '2020-01-01'`,

  // ── attendance.shift_id was originally added as a raw UUID with no FK,
  //    so deleting a shift left orphan attendance rows pointing at a vanished
  //    shifts(id). Step 1: null out any orphans (the rows themselves stay,
  //    they just lose their shift reference). Step 2: add the FK constraint
  //    if it doesn't exist yet — guarded so re-running this migration is safe.
  `UPDATE attendance
      SET shift_id = NULL
    WHERE shift_id IS NOT NULL
      AND shift_id NOT IN (SELECT id FROM shifts)`,
  `DO $$
   BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'attendance'
          AND constraint_name = 'attendance_shift_id_fkey'
     ) THEN
       ALTER TABLE attendance
         ADD CONSTRAINT attendance_shift_id_fkey
         FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE SET NULL;
     END IF;
   END $$`,

  // ── Attendance: separate "GPS required" from "geofence enforced" ─────────
  // Previously `require_gps = TRUE` meant both. WFH / field / late-commute
  // employees got blocked even though HR wanted to allow them. The new flag
  // defaults FALSE so geofence becomes a soft warning unless explicitly
  // turned on. require_gps still controls whether browsers must send lat/lng.
  `ALTER TABLE settings ADD COLUMN IF NOT EXISTS enforce_geofence BOOLEAN DEFAULT FALSE`,

  // ── Settings table must be a singleton ───────────────────────────────────
  // The app reads `SELECT * FROM settings LIMIT 1`, but nothing was stopping
  // two concurrent admins from creating duplicate rows via INSERT. Collapse
  // any existing duplicates to the oldest row, then add a partial unique
  // index so future INSERTs fail noisily instead of silently splintering.
  `DELETE FROM settings WHERE id NOT IN (SELECT id FROM settings ORDER BY id LIMIT 1)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_settings_singleton ON settings ((1))`,

  // ── Payroll Phase 1: salary_structures (versioned per employee) ──────────
  // One row per (employee, period). Each component is a monthly amount.
  // When admin edits, we close the previous row (set effective_to = today-1)
  // and INSERT a new row — that way every historical change is preserved
  // and we can answer "what was their CTC in March 2026?" at audit time.
  // PF/ESI/PT are stored separately so the eventual payroll-run code can
  // pull them straight out without re-doing statutory math each time.
  `CREATE TABLE IF NOT EXISTS salary_structures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    effective_from DATE NOT NULL,
    effective_to   DATE,
    -- Monthly earnings
    basic              NUMERIC(12,2) DEFAULT 0,
    hra                NUMERIC(12,2) DEFAULT 0,
    conveyance         NUMERIC(12,2) DEFAULT 0,
    medical            NUMERIC(12,2) DEFAULT 0,
    special_allowance  NUMERIC(12,2) DEFAULT 0,
    other_allowances   NUMERIC(12,2) DEFAULT 0,
    -- Monthly deductions (employee-borne)
    pf_employee        NUMERIC(12,2) DEFAULT 0,
    esi_employee       NUMERIC(12,2) DEFAULT 0,
    professional_tax   NUMERIC(12,2) DEFAULT 0,
    -- Employer contribution (tracked for CTC math, not deducted)
    pf_employer        NUMERIC(12,2) DEFAULT 0,
    -- Eligibility flags
    pf_applicable      BOOLEAN DEFAULT TRUE,
    esi_applicable     BOOLEAN DEFAULT FALSE,
    -- Audit
    notes              TEXT,
    created_by         UUID REFERENCES employees(id),
    created_at         TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Fast lookup of "current row for employee X" — primary access pattern.
  `CREATE INDEX IF NOT EXISTS idx_salary_struct_employee_effective
     ON salary_structures (employee_id, effective_from DESC)`,
  // Only one OPEN row (effective_to IS NULL) per employee — the "current"
  // structure. Versioned history rows have effective_to set.
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_salary_struct_current
     ON salary_structures (employee_id) WHERE effective_to IS NULL`,

  // ── Payroll Phase 2: payslips ─────────────────────────────────────────
  // Generated by the admin "Run month" action. One row per (employee,
  // month, year). All numeric fields are stored as NUMERIC(12,2) so we
  // never accumulate floating-point drift. Status: draft -> locked -> paid.
  // Earnings columns are SNAPSHOTS of the structure at run time, so a
  // later salary edit doesn't retroactively change a finalised payslip.
  `CREATE TABLE IF NOT EXISTS payroll_payslips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    pay_month INTEGER NOT NULL CHECK (pay_month BETWEEN 1 AND 12),
    pay_year  INTEGER NOT NULL CHECK (pay_year >= 2020),

    -- Snapshot of earnings at time of generation (after LOP proration)
    basic              NUMERIC(12,2) DEFAULT 0,
    hra                NUMERIC(12,2) DEFAULT 0,
    conveyance         NUMERIC(12,2) DEFAULT 0,
    medical            NUMERIC(12,2) DEFAULT 0,
    special_allowance  NUMERIC(12,2) DEFAULT 0,
    other_allowances   NUMERIC(12,2) DEFAULT 0,

    -- Attendance summary used to compute LOP
    working_days       NUMERIC(5,2) DEFAULT 0,
    present_days       NUMERIC(5,2) DEFAULT 0,
    lop_days           NUMERIC(5,2) DEFAULT 0,
    lop_amount         NUMERIC(12,2) DEFAULT 0,

    -- Deductions
    pf_employee        NUMERIC(12,2) DEFAULT 0,
    esi_employee       NUMERIC(12,2) DEFAULT 0,
    professional_tax   NUMERIC(12,2) DEFAULT 0,
    tds                NUMERIC(12,2) DEFAULT 0,

    -- Totals (denormalised for fast list rendering)
    gross_earnings     NUMERIC(12,2) DEFAULT 0,
    total_deductions   NUMERIC(12,2) DEFAULT 0,
    net_pay            NUMERIC(12,2) DEFAULT 0,

    -- Workflow + lifecycle
    status        VARCHAR(20) DEFAULT 'draft',  -- draft | locked | paid
    pdf_url       VARCHAR(500),
    generated_at  TIMESTAMPTZ DEFAULT NOW(),
    generated_by  UUID REFERENCES employees(id),
    locked_at     TIMESTAMPTZ,
    paid_at       TIMESTAMPTZ,
    notes         TEXT,

    UNIQUE (employee_id, pay_month, pay_year)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_payslips_period ON payroll_payslips (pay_year, pay_month, status)`,
  `CREATE INDEX IF NOT EXISTS idx_payslips_employee_period ON payroll_payslips (employee_id, pay_year DESC, pay_month DESC)`,

  // ── Payroll Phase 4: tax declarations ─────────────────────────────────
  // Employee submits investment proofs once per financial year. Admin
  // approves before payroll uses them for TDS computation in Phase 5.
  `CREATE TABLE IF NOT EXISTS payroll_tax_declarations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    financial_year VARCHAR(9) NOT NULL,                       -- e.g. '2026-27'
    regime VARCHAR(10) DEFAULT 'new' CHECK (regime IN ('old','new')),

    -- Old-regime line items (zeros when new regime is chosen — the new
    -- regime in India has no exemptions other than standard deduction)
    hra_annual_rent     NUMERIC(12,2) DEFAULT 0,
    section_80c         NUMERIC(12,2) DEFAULT 0,
    section_80d         NUMERIC(12,2) DEFAULT 0,
    section_80e         NUMERIC(12,2) DEFAULT 0,
    home_loan_interest  NUMERIC(12,2) DEFAULT 0,
    other_deductions    NUMERIC(12,2) DEFAULT 0,

    status VARCHAR(20) DEFAULT 'submitted',  -- submitted | approved | rejected
    rejection_reason TEXT,
    reviewed_by  UUID REFERENCES employees(id),
    reviewed_at  TIMESTAMPTZ,
    notes        TEXT,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (employee_id, financial_year)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tax_decl_status ON payroll_tax_declarations (status, financial_year DESC)`,

  // ── Payroll Phase 6: tax_slabs ────────────────────────────────────────
  // Per-FY + regime slab tables. Each row is one rung of the slab:
  //   "Above X up to Y, tax rate is R%". Cess and surcharge stay outside
  //   this table — computed as flat percentages in code. Seed rows are
  //   inserted below for FY 2026-27 (India), both regimes.
  `CREATE TABLE IF NOT EXISTS payroll_tax_slabs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    financial_year VARCHAR(9) NOT NULL,
    regime VARCHAR(10) NOT NULL CHECK (regime IN ('old','new')),
    threshold_from  NUMERIC(14,2) NOT NULL,
    threshold_to    NUMERIC(14,2),                -- NULL = no upper limit
    rate_percent    NUMERIC(5,2) NOT NULL,
    seq             INTEGER NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tax_slabs_lookup ON payroll_tax_slabs (financial_year, regime, seq)`,

  // Seed FY 2026-27 slabs. INSERT ... WHERE NOT EXISTS so re-running is safe.
  `INSERT INTO payroll_tax_slabs (financial_year, regime, threshold_from, threshold_to, rate_percent, seq)
   SELECT * FROM (VALUES
     ('2026-27','new',       0::numeric,  400000::numeric, 0,  1),
     ('2026-27','new',  400000::numeric,  800000::numeric, 5,  2),
     ('2026-27','new',  800000::numeric, 1200000::numeric, 10, 3),
     ('2026-27','new', 1200000::numeric, 1600000::numeric, 15, 4),
     ('2026-27','new', 1600000::numeric, 2000000::numeric, 20, 5),
     ('2026-27','new', 2000000::numeric, 2400000::numeric, 25, 6),
     ('2026-27','new', 2400000::numeric, NULL,             30, 7),
     ('2026-27','old',       0::numeric,  250000::numeric, 0,  1),
     ('2026-27','old',  250000::numeric,  500000::numeric, 5,  2),
     ('2026-27','old',  500000::numeric, 1000000::numeric, 20, 3),
     ('2026-27','old', 1000000::numeric, NULL,             30, 4)
   ) AS t(financial_year, regime, threshold_from, threshold_to, rate_percent, seq)
   WHERE NOT EXISTS (SELECT 1 FROM payroll_tax_slabs WHERE financial_year = '2026-27')`,

  // ── Per-month adjustments (bonus / overtime / one-off deduction) ──────
  // Picked up by run-month for any month/year where there's at least one
  // active row. Sign matters: positive amounts add to gross, negatives
  // subtract. Type is informational (rendered on the payslip).
  `CREATE TABLE IF NOT EXISTS payroll_adjustments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    pay_month   INTEGER NOT NULL CHECK (pay_month BETWEEN 1 AND 12),
    pay_year    INTEGER NOT NULL,
    type        VARCHAR(40) NOT NULL,   -- 'bonus' | 'overtime' | 'reimbursement' | 'deduction' | 'other'
    amount      NUMERIC(12,2) NOT NULL, -- positive for earnings, negative for deductions
    reason      TEXT,
    created_by  UUID REFERENCES employees(id),
    created_at  TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Bring older installs in line — original schema used `notes`, route reads `reason`.
  `ALTER TABLE payroll_adjustments ADD COLUMN IF NOT EXISTS reason TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_adj_employee_period ON payroll_adjustments (employee_id, pay_year, pay_month)`,

  // ── Loans / advances ──────────────────────────────────────────────────
  // Admin disburses principal, sets monthly_recovery; run-month deducts
  // until recovered >= principal then auto-flips status to 'closed'.
  `CREATE TABLE IF NOT EXISTS payroll_loans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    principal        NUMERIC(12,2) NOT NULL,
    monthly_recovery NUMERIC(12,2) NOT NULL DEFAULT 0,
    recovered        NUMERIC(12,2) NOT NULL DEFAULT 0,
    status           VARCHAR(20) DEFAULT 'active',   -- active | closed | paused
    notes            TEXT,
    issued_at        DATE DEFAULT CURRENT_DATE,
    closed_at        TIMESTAMPTZ,
    created_by       UUID REFERENCES employees(id),
    created_at       TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Older installs may have a payroll_loans with the legacy column set
  // (loan_type / total_paid / start_month / start_year / approved_by) and
  // missing the columns the route uses. Patch them in-place:
  `ALTER TABLE payroll_loans ADD COLUMN IF NOT EXISTS recovered NUMERIC(12,2) NOT NULL DEFAULT 0`,
  `ALTER TABLE payroll_loans ADD COLUMN IF NOT EXISTS issued_at DATE DEFAULT CURRENT_DATE`,
  `ALTER TABLE payroll_loans ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES employees(id)`,
  // Backfill recovered from total_paid if that column exists from the legacy shape.
  `DO $$ BEGIN
     IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payroll_loans' AND column_name='total_paid')
     THEN UPDATE payroll_loans SET recovered = total_paid WHERE total_paid IS NOT NULL AND recovered = 0;
     END IF;
   END $$`,
  // Make the legacy NOT NULL columns optional so new INSERTs that omit them don't fail.
  `DO $$ BEGIN
     IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payroll_loans' AND column_name='start_month' AND is_nullable='NO')
     THEN ALTER TABLE payroll_loans ALTER COLUMN start_month DROP NOT NULL; END IF;
     IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payroll_loans' AND column_name='start_year' AND is_nullable='NO')
     THEN ALTER TABLE payroll_loans ALTER COLUMN start_year DROP NOT NULL; END IF;
     IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payroll_loans' AND column_name='monthly_recovery' AND is_nullable='NO')
     THEN ALTER TABLE payroll_loans ALTER COLUMN monthly_recovery DROP NOT NULL; END IF;
   END $$`,
  `CREATE INDEX IF NOT EXISTS idx_loans_active ON payroll_loans (employee_id, status)`,

  // ── New columns on payroll_payslips for the rest of the sprint ────────
  // - slip_number: human-readable PSL-YYYY-MM-NNNN, generated at run time
  // - supersedes / superseded_by: correction payslip chain
  // - approved_by_manager_at: optional manager endorsement before lock
  // - reimbursement: variable pay pulled from compensation_claims
  // - loan_recovery: amount deducted toward an active loan
  // - bonus / overtime / other_adjustment: sum of payroll_adjustments
  // - email_sent_at: when the notification went out (idempotent re-send)
  `ALTER TABLE payroll_payslips ADD COLUMN IF NOT EXISTS slip_number VARCHAR(30)`,
  // Race-protect slip number generation. nextSlipNumber() reads MAX+1
  // then INSERTs; two simultaneous callers could pick the same number.
  // A unique index makes Postgres reject the dupe so the caller (already
  // inside a try/catch) can retry. WHERE clause lets old NULL rows
  // coexist during rollout — they'll be backfilled / aged out naturally.
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_payslip_slip_number
     ON payroll_payslips (slip_number) WHERE slip_number IS NOT NULL`,
  `ALTER TABLE payroll_payslips ADD COLUMN IF NOT EXISTS supersedes UUID REFERENCES payroll_payslips(id)`,
  `ALTER TABLE payroll_payslips ADD COLUMN IF NOT EXISTS superseded_by UUID REFERENCES payroll_payslips(id)`,
  `ALTER TABLE payroll_payslips ADD COLUMN IF NOT EXISTS approved_by_manager_id UUID REFERENCES employees(id)`,
  `ALTER TABLE payroll_payslips ADD COLUMN IF NOT EXISTS approved_by_manager_at TIMESTAMPTZ`,
  `ALTER TABLE payroll_payslips ADD COLUMN IF NOT EXISTS reimbursement NUMERIC(12,2) DEFAULT 0`,
  `ALTER TABLE payroll_payslips ADD COLUMN IF NOT EXISTS loan_recovery NUMERIC(12,2) DEFAULT 0`,
  `ALTER TABLE payroll_payslips ADD COLUMN IF NOT EXISTS bonus NUMERIC(12,2) DEFAULT 0`,
  `ALTER TABLE payroll_payslips ADD COLUMN IF NOT EXISTS overtime NUMERIC(12,2) DEFAULT 0`,
  `ALTER TABLE payroll_payslips ADD COLUMN IF NOT EXISTS other_adjustment NUMERIC(12,2) DEFAULT 0`,
  `ALTER TABLE payroll_payslips ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ`,
  // Stamped when the NEFT bank-upload CSV is generated for a payslip.
  // Subsequent NEFT-export attempts warn the admin to prevent accidental
  // double payment when the bank file gets uploaded twice.
  `ALTER TABLE payroll_payslips ADD COLUMN IF NOT EXISTS payment_exported_at TIMESTAMPTZ`,
  // Org-wide setting: if TRUE, payslips cannot be locked until a manager
  // has signed off (approved_by_manager_at IS NOT NULL). Default FALSE so
  // existing orgs are unaffected.
  `ALTER TABLE settings ADD COLUMN IF NOT EXISTS require_manager_approval_before_lock BOOLEAN DEFAULT FALSE`,
  // The old (employee, month, year) UNIQUE constraint now blocks
  // correction slips. Drop it and replace with a partial unique that
  // only applies to active (non-superseded) rows.
  `ALTER TABLE payroll_payslips DROP CONSTRAINT IF EXISTS payroll_payslips_employee_id_pay_month_pay_year_key`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_payslip_active
     ON payroll_payslips (employee_id, pay_month, pay_year)
     WHERE superseded_by IS NULL`,

  // ── Per-employee access grants for registered API connections ─────────
  // NxtPeople is the master directory. Existing api_connections rows
  // already represent each external website (LMS, User Report, …); this
  // table records which employees each connection is allowed to validate
  // via /api/external/access/check.
  //
  // Three new columns on api_connections distinguish "user-facing apps"
  // (need access grants + show in the My Apps launcher) from data-sync
  // connections (don't need grants). app_icon / app_color give the
  // launcher its visual identity.
  `ALTER TABLE api_connections ADD COLUMN IF NOT EXISTS is_user_app BOOLEAN DEFAULT FALSE`,
  `ALTER TABLE api_connections ADD COLUMN IF NOT EXISTS app_icon VARCHAR(40) DEFAULT 'Layers'`,
  `ALTER TABLE api_connections ADD COLUMN IF NOT EXISTS app_color VARCHAR(60) DEFAULT 'from-blue-500 to-indigo-600'`,
  // Encrypted copy of the raw API key so admins can reveal/copy it later
  // via the UI. The SHA-256 hash is kept for fast lookup on external calls.
  // Encryption uses AES-256-GCM with key = SHA-256(JWT_SECRET).
  `ALTER TABLE api_connections ADD COLUMN IF NOT EXISTS api_key_encrypted TEXT`,

  `CREATE TABLE IF NOT EXISTS application_access (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    api_connection_id UUID NOT NULL REFERENCES api_connections(id) ON DELETE CASCADE,
    employee_id       UUID NOT NULL REFERENCES employees(id)       ON DELETE CASCADE,
    granted_at        TIMESTAMPTZ DEFAULT NOW(),
    granted_by        UUID REFERENCES employees(id) ON DELETE SET NULL,
    revoked_at        TIMESTAMPTZ,
    revoked_by        UUID REFERENCES employees(id) ON DELETE SET NULL,
    revoke_reason     TEXT,
    UNIQUE(api_connection_id, employee_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_app_access_employee_active
     ON application_access(employee_id) WHERE revoked_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_app_access_connection_active
     ON application_access(api_connection_id) WHERE revoked_at IS NULL`,
];

async function runFixes() {
  console.log('🔧 Running Nxt-People bug-fix migrations...\n');
  let success = 0, failed = 0;

  for (const sql of steps) {
    const preview = sql.trim().replace(/\s+/g, ' ').substring(0, 80);
    try {
      await pool.query(sql);
      console.log(`  ✅ ${preview}...`);
      success++;
    } catch (err) {
      console.error(`  ❌ FAILED: ${preview}`);
      console.error(`     ${err.message}\n`);
      failed++;
    }
  }

  console.log(`\n📊 Fix migration complete: ${success} succeeded, ${failed} failed`);
  if (failed === 0) console.log('🎉 All fixes applied successfully!');
  else console.log('⚠️  Some fixes failed — check errors above');

  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

runFixes().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
