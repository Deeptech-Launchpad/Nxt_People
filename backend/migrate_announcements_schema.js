/**
 * migrate_announcements_schema.js
 *
 * Aligns the announcements table columns with what the routes expect.
 * The table was created by migrate_all.js with: content, priority, is_active, created_by
 * But older code inserted: body, type, is_pinned, posted_by
 *
 * This migration:
 *  1. Adds the 'updated_at' column if missing
 *  2. Ensures the correct columns exist (ADD COLUMN IF NOT EXISTS is idempotent)
 *  3. Copies data from old columns to new columns if old columns exist
 *
 * Safe to run multiple times.
 */

const { pool } = require('./db');

const steps = [
  // Ensure the correct column names exist
  `ALTER TABLE announcements ADD COLUMN IF NOT EXISTS content    TEXT`,
  `ALTER TABLE announcements ADD COLUMN IF NOT EXISTS priority   VARCHAR(20) DEFAULT 'normal'`,
  `ALTER TABLE announcements ADD COLUMN IF NOT EXISTS is_active  BOOLEAN DEFAULT TRUE`,
  `ALTER TABLE announcements ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES employees(id)`,
  `ALTER TABLE announcements ADD COLUMN IF NOT EXISTS expires_at DATE`,
  `ALTER TABLE announcements ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,

  // Back-fill content from body if body column exists and content is NULL
  `DO $$
   BEGIN
     IF EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'announcements' AND column_name = 'body'
     ) THEN
       UPDATE announcements SET content = body WHERE content IS NULL AND body IS NOT NULL;
     END IF;
   END$$`,

  // Back-fill created_by from posted_by if posted_by column exists
  `DO $$
   BEGIN
     IF EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'announcements' AND column_name = 'posted_by'
     ) THEN
       UPDATE announcements SET created_by = posted_by WHERE created_by IS NULL AND posted_by IS NOT NULL;
     END IF;
   END$$`,

  // Back-fill priority from type if type column exists
  `DO $$
   BEGIN
     IF EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'announcements' AND column_name = 'type'
     ) THEN
       UPDATE announcements SET priority = type WHERE priority = 'normal' AND type IS NOT NULL;
     END IF;
   END$$`,

  // Back-fill is_active from is_pinned if is_pinned column exists (treat pinned as active)
  `DO $$
   BEGIN
     IF EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'announcements' AND column_name = 'is_pinned'
     ) THEN
       UPDATE announcements SET is_active = is_pinned WHERE is_pinned IS NOT NULL;
     END IF;
   END$$`,
];

async function migrate() {
  console.log('\n🚀 Migrating announcements table schema...\n');
  let success = 0;
  let failed = 0;

  for (const sql of steps) {
    const label = sql.trim().substring(0, 80).replace(/\s+/g, ' ');
    try {
      await pool.query(sql);
      console.log(`  ✅ ${label}...`);
      success++;
    } catch (err) {
      console.error(`  ❌ FAILED: ${label}`);
      console.error(`     ${err.message}`);
      failed++;
    }
  }

  console.log(`\n📊 Done: ${success} succeeded, ${failed} failed\n`);
  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

migrate().catch(err => {
  console.error('Fatal migration error:', err);
  process.exit(1);
});
