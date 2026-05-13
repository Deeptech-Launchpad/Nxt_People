/**
 * migrate_refresh_audit_projects.js
 * Adds: refresh_tokens, audit_log, enhanced projects/tasks, chat tables.
 * Safe to run multiple times (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
 */
const { pool } = require('./db');

const migrations = [
  // ── REFRESH TOKENS ─────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    ip_address VARCHAR(45),
    user_agent VARCHAR(500),
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_refresh_token_hash ON refresh_tokens(token_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_refresh_token_employee ON refresh_tokens(employee_id)`,

  // ── AUDIT LOG ──────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    actor_email VARCHAR(255),
    actor_role VARCHAR(50),
    action VARCHAR(50) NOT NULL,
    resource VARCHAR(100) NOT NULL,
    resource_id VARCHAR(255),
    changes JSONB,
    ip_address VARCHAR(45),
    user_agent VARCHAR(500),
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_log(resource, resource_id)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC)`,

  // ── PROJECTS (enhance existing table) ─────────────────────────────────────
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'active'`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'medium'`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS start_date DATE`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS due_date DATE`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES employees(id)`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,

  // ── PROJECT MEMBERS ────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS project_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    role VARCHAR(30) DEFAULT 'member',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(project_id, employee_id)
  )`,

  // ── TASKS (enhance existing table) ────────────────────────────────────────
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'todo'`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'medium'`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignee_id UUID REFERENCES employees(id)`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES employees(id)`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_date DATE`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,

  // ── CHAT TABLES ────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS chat_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(20) DEFAULT 'direct',
    name VARCHAR(255),
    created_by UUID REFERENCES employees(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS chat_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    last_read_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(conversation_id, employee_id)
  )`,
  `CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES employees(id),
    content TEXT NOT NULL,
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ── INDEXES ────────────────────────────────────────────────────────────────
  `CREATE INDEX IF NOT EXISTS idx_chat_messages_conv ON chat_messages(conversation_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_participants_emp ON chat_participants(employee_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id)`,
  `CREATE INDEX IF NOT EXISTS idx_project_members_proj ON project_members(project_id)`,
];

async function run() {
  console.log('\n🚀 Running migration: refresh_tokens + audit_log + projects + tasks + chat\n');
  let ok = 0, fail = 0;
  for (const sql of migrations) {
    const label = sql.trim().substring(0, 72).replace(/\s+/g, ' ');
    try {
      await pool.query(sql);
      console.log(`  ✅ ${label}...`);
      ok++;
    } catch (err) {
      console.error(`  ❌ ${label}`);
      console.error(`     ${err.message}`);
      fail++;
    }
  }
  console.log(`\n📊 Done: ${ok} succeeded, ${fail} failed\n`);
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

run().catch(err => { console.error('Fatal:', err); process.exit(1); });
