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
