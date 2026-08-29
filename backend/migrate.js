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
  'migrate_permission_hours.js',         // leaves.start_time/end_time/hours (Permission hourly leave)
  'migrate_conference.js',               // conference_bookings (Operations → Conference hall booking)
  'migrate_location_logs.js',            // attendance_location_logs (check-in/out location history)
  'migrate_rename_roles.js',             // rename roles: super_admin→admin, hr→director, employee→team_member
  'migrate_sessions.js',                 // attendance_sessions (per check-in/out pairs)
  'migrate_payroll_v2.js',               // payroll rebuild: templates, increments/arrears, versioned compliance settings, declaration windows, extended payslips
  /* ── Everything below was on disk but not in this list ───────────────────
   *  A fresh install built from the list above produced 79 tables where a
   *  working installation has 112. Thirty-three were missing outright,
   *  including roles, role_permissions and role_functions — the entire access
   *  control system — along with workflows, designations, work_locations and
   *  pay_periods. Anyone installing this from scratch got a database the
   *  running code could not use.
   *
   *  Ordered by what depends on what: organisation structure first because
   *  designations, locations and companies are referenced later; then access
   *  control, since function permissions seed against roles; then shifts,
   *  which rotation and patterns build on; then leave, comp-off and
   *  approvals; payroll and one-off repairs last.
   * ────────────────────────────────────────────────────────────────────── */

  // Organisation: designations, work_locations, business_units, divisions
  'migrate_org_setup.js',
  'migrate_org_details.js',
  'migrate_org_structure.js',
  'migrate_merge_locations.js',
  'migrate_user_accounts.js',            // employees.company_id + is_user
  'migrate_user_page.js',
  'migrate_privacy_prefs.js',

  // Access control: roles, role_permissions, role_functions, administrators
  'migrate_rbac_roles.js',
  'migrate_access_control.js',
  'migrate_function_permissions_enforce.js',  // seeds against roles, so after it

  /* Approvals come before shifts: migrate_shift_change_requests references
   * approval_rules, which migrate_approvals_automation creates. Placed after
   * shifts on the first attempt, the fresh-install build stopped there with
   * `relation "approval_rules" does not exist`. */
  'migrate_approvals_automation.js',     // approval_rules, email_templates, email_alerts
  'migrate_generalize_approvals.js',     // approval_levels
  'migrate_approval_flow.js',            // reads approval_rules, so it follows
  'migrate_approval_followups.js',
  'migrate_workflows.js',
  'migrate_on_duty.js',

  // Shifts: the model patterns and rotation build on
  'migrate_shift_config.js',
  'migrate_default_shift.js',
  'migrate_shift_model.js',              // working_days, weekend_source, shift_patterns
  'migrate_shift_rotation.js',
  'migrate_shift_change_requests.js',

  // Attendance
  'migrate_attendance_config.js',
  'migrate_expected_hours.js',
  'migrate_session_start.js',
  'migrate_cover_image.js',

  /* pay_periods is created here and ALTERed by migrate_work_calendar, so it
   * has to exist first. Placed after the calendar on the first attempt, its
   * whole table went missing and every later ALTER reported
   * `relation "pay_periods" does not exist`. */
  'migrate_pay_periods.js',

  // Leave and the calendar it depends on
  'migrate_work_calendar.js',
  'migrate_holiday_scope.js',            // holiday_scopes — needs holidays
  'migrate_leave_policy.js',
  'migrate_leave_methods.js',
  'migrate_leave_config_rest.js',
  'migrate_leave_approvals.js',
  'migrate_leave_balance_source.js',
  'migrate_leave_cancellation.js',
  'migrate_leave_extension.js',
  'migrate_sandwich_leave.js',

  // Comp-off
  'migrate_comp_off_config.js',
  'migrate_compoff_holiday_config.js',
  'migrate_comp_off_on_behalf.js',       // comp_offs.applied_by

  // Attendance marking for staff who cannot punch — needs shifts and employees
  'migrate_manual_attendance.js',

  // One-off repairs and safety nets
  'migrate_import_backup.js',
  'migrate_fix_encoding.js',

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

// Tracks which files in ORDER have already completed successfully. Every
// migration is still written to be idempotent on its own (defense in depth),
// but the tracking table means a deploy that fails on file #28 only re-runs
// file #28 on retry instead of re-running #1–27 first. That mattered in
// practice: a UUID-type mistake in migrate_sessions.js aborted mid-deploy,
// and without this table the fix would have re-run every prior migration
// (including slow ALTER TABLEs) before ever reaching the actual fix.
async function ensureTrackingTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function isApplied(file) {
  const r = await pool.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [file]);
  return r.rows.length > 0;
}

async function markApplied(file) {
  await pool.query(
    'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING',
    [file]
  );
}

(async () => {
  console.log('🚀 Nxt-People — running ordered migrations\n');
  const start = Date.now();
  await ensureTrackingTable();

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
    if (await isApplied(file)) {
      console.log(`  ⏭  ${file} (already applied)`);
      continue;
    }
    try {
      if (file.endsWith('.sql')) {
        await runSqlFile(file);
      } else {
        runJsFile(file);
      }
      await markApplied(file);
    } catch (err) {
      console.error(`\n❌ Aborting on ${file}: ${err.message}`);
      process.exit(1);
    }
  }
  await pool.end();
  console.log(`\n✨ All migrations applied in ${((Date.now() - start) / 1000).toFixed(1)}s`);
  process.exit(0);
})();
