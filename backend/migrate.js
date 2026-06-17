/**
 * Single command to bootstrap or upgrade the database from scratch.
 *
 *   npm run migrate
 *
 * Runs schema.sql + every migrate_*.js in a known order. All steps are
 * idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / ON CONFLICT) so
 * re-running is safe.
 *
 * Why this exists: the project accumulated 14 separate migration scripts
 * and a fresh developer had to discover the right order. This consolidates
 * the entry point. Long-term, swap this for node-pg-migrate or Knex.
 */

const fs   = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const pool = require('./db');

// Ordered list — earlier scripts create tables that later scripts ALTER.
// Add new migrations here in the order they should run.
//
// Dependency notes (why this specific order):
//   - phase1 must run first because it creates `notifications` and
//     `announcements`, which zoho_features later ALTERs.
//   - features must run before zoho_features because zoho_features's
//     `time_logs` and `jobs` tables reference `projects`.
//   - refresh_audit_projects's `project_members` also references `projects`,
//     so it sits after features.
const ORDER = [
  'schema.sql',                          // base tables (employees, attendance, etc.)
  'migrate_phase1.js',                   // notifications, announcements, employee enrichment
  'migrate_features.js',                 // projects, tasks, messages, leave_encashments
  'migrate_refresh_audit_projects.js',   // refresh_tokens, audit_log, chat_*, project_members
  'migrate_zoho_features.js',            // departments, leave_types, time_logs, jobs (needs projects + notifications)
  'migrate_phases2to5.js',               // attendance_regularizations, wfh_requests, etc.
  'migrate_final.js',                    // comp_offs, performance_reviews, exit_requests, shift_roster
  'migrate_onboarding.js',               // employee_education, onboarding_tokens
  'migrate_reset_password.js',           // reset_password_token / expires columns
  'migrate_docs.js',                     // employee_documents (covered by later migrations too)
  'migrate_announcements_schema.js',     // legacy ↔ modern column name reconciliation
  'migrate_all.js',                      // catch-all idempotent additions
  'migrate_fixes.js',                    // most recent additions (api_key_hash, announcement_reads, weekend_rules)
  'migrate_comp_off_rules.js',           // comp_offs.comp_off_date + expires_at (3-month validity)
  'migrate_settings_office_area.js',    // settings.office_area_name for location Work Mode keyword
  'migrate_rename_roles.js',             // rename roles: super_admin→admin, hr→director, employee→team_member
  'migrate_indexes.js',                  // perf indexes — run last
];

const here = __dirname;

async function runSqlFile(file) {
  const sql = fs.readFileSync(path.join(here, file), 'utf8');
  await pool.query(sql);
  console.log(`  ✅ ${file}`);
}

function runJsFile(file) {
  // Migration scripts use `process.exit`, so spawn them in their own node
  // process and inherit stdio so the user sees the same output they'd get
  // running each script by hand.
  const res = spawnSync(process.execPath, [path.join(here, file)], {
    stdio: 'inherit',
    cwd: here,
  });
  if (res.status !== 0) {
    throw new Error(`${file} exited with code ${res.status}`);
  }
}

(async () => {
  console.log('🚀 Nxt-People — running ordered migrations\n');
  const start = Date.now();
  let ranSql = false;
  for (const file of ORDER) {
    const abs = path.join(here, file);
    if (!fs.existsSync(abs)) {
      // Fail loudly. Previously this silently skipped, so an accidentally
      // deleted migration would let the app boot against an incomplete
      // schema and crash later with cryptic FK errors. Better to refuse
      // to migrate at all than to half-migrate.
      console.error(`\n❌ Missing migration file: ${file}`);
      console.error('   This file is listed in ORDER but does not exist on disk.');
      console.error('   Restore it from git history or remove it from migrate.js ORDER intentionally.');
      process.exit(1);
    }
    try {
      if (file.endsWith('.sql')) {
        await runSqlFile(file);
        ranSql = true;
      } else {
        runJsFile(file);
      }
    } catch (err) {
      console.error(`\n❌ Aborting on ${file}: ${err.message}`);
      process.exit(1);
    }
  }
  // The JS scripts call pool.end() themselves, but if we only ran .sql files
  // through this process we still need to close.
  if (ranSql) await pool.end();
  console.log(`\n✨ All migrations applied in ${((Date.now() - start) / 1000).toFixed(1)}s`);
  process.exit(0);
})();
