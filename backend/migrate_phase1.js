const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });

const stmts = [
  `CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    type VARCHAR(50) DEFAULT 'info',
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    link VARCHAR(255),
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS announcements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    type VARCHAR(50) DEFAULT 'general',
    is_pinned BOOLEAN DEFAULT false,
    posted_by UUID REFERENCES employees(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_employee ON notifications(employee_id, is_read)`,
  `CREATE INDEX IF NOT EXISTS idx_announcements_created ON announcements(created_at DESC)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS date_of_birth DATE`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS address TEXT`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_contact_name VARCHAR(150)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_contact_phone VARCHAR(50)`,
  `ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_contact_relation VARCHAR(100)`
];

(async () => {
  const c = await pool.connect();
  for (const s of stmts) {
    try {
      await c.query(s);
      console.log('✅', s.trim().substring(0, 65));
    } catch (e) {
      console.log('⚠️ (skip)', e.message.substring(0, 65));
    }
  }
  c.release();
  await pool.end();
  console.log('\n✅ Phase 1 migration complete!');
})();
