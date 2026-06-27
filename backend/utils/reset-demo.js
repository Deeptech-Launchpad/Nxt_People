/**
 * Demo data reset — wipes employees + transactional data so you can run a
 * clean Zoho sync and walk a fresh demo. Preserves:
 *   • Admin users named in ADMIN_EMAIL (.env) — you can still log in afterwards
 *   • Master data: settings, leave_types, shifts, holidays, weekend_rules,
 *     companies, departments
 *
 * Cascades take care of most child tables (attendance, leaves, documents,
 * announcements posted by deleted users, notifications, etc.). Tables that
 * don't have an ON DELETE CASCADE FK to employees are TRUNCATEd explicitly.
 *
 * Usage:
 *   cd backend
 *   npm run reset:demo          ← prompts you to type "WIPE"
 *   npm run reset:demo -- --force  (skip prompt — use sparingly)
 *
 * After it finishes:
 *   1. Restart the backend (nodemon does this automatically on file change,
 *      but if you ran reset:demo against a stopped server, start it now —
 *      the ADMIN_EMAIL bootstrap re-creates admin rows if they were
 *      somehow wiped).
 *   2. Log in as admin.
 *   3. Click "Sync from Zoho" in the Employees page.
 *   4. Demo away.
 */

require('dotenv').config();
const readline = require('readline');
const pool     = require('../db');

const adminEmails = (process.env.ADMIN_EMAIL || '')
  .split(/[,;\s]+/)
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

if (adminEmails.length === 0) {
  console.error('❌ ADMIN_EMAIL is not set in .env. Refusing to wipe — you would lock yourself out.');
  console.error('   Add ADMIN_EMAIL=you@example.com to backend/.env first.');
  process.exit(1);
}

// Tables to clear explicitly. Some of these would also be cleared via FK
// cascade when employees are deleted, but listing them keeps the reset
// predictable even if a future migration removes a cascade.
//
// Wrapped in try/catch in case a migration hasn't created the table on this
// DB — we don't want a missing-table error to halt the wipe.
// Tables that REFERENCE employees(id) but should NEVER be wiped — master
// data / org config that survives demo resets.
const PRESERVE = new Set([
  'weekend_rules',     // "Sundays" / "1st & 3rd Saturdays" recurrence rules
  'holidays',          // company holiday calendar
  'shifts',            // shift definitions
  'leave_types',       // leave type catalogue
  'settings',          // org-wide settings
  'companies',
  'departments',
]);

const TABLES_TO_TRUNCATE = [
  'audit_log',
  'refresh_tokens',
  'announcement_reads',
  'announcements',
  'notifications',
  'feeds',
  'messages',
  'onboarding_tokens',
  'attendance_regularizations',
  'wfh_requests',
  'comp_offs',
  'compensation_claims',
  'hr_letter_requests',
  'travel_requests',
  'travel_expenses',
  'performance_reviews',
  'performance_goals',
  'exit_requests',
  'employee_documents',
  'employee_education',
  'leaves',
  'leave_balances',
  'leave_accrual_log',
  'attendance',
  'time_logs',
  'timesheets',
  'tasks',
  'projects',
  'project_members',
  'jobs',
  'job_schedules',
  'shift_roster',
  'feedback',
  'payslips',
  'encashments',
  'assets',
  'benefits',
  'report_favorites',
];

async function ask(question) {
  if (process.argv.includes('--force')) return 'WIPE';
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans); }));
}

(async () => {
  console.log('\n🧨  Demo data reset');
  console.log('   Database:        ', process.env.DB_NAME);
  console.log('   Admin email(s):  ', adminEmails.join(', '));
  console.log('   Will preserve:   admins above + master data (settings, leave_types, shifts, holidays, weekend_rules, companies, departments)');
  console.log('   Will WIPE:       every other employee + all attendance, leaves, documents, announcements, etc.\n');

  const empCountBefore = await pool.query('SELECT COUNT(*) FROM employees');
  console.log(`   Current employee count: ${empCountBefore.rows[0].count}`);

  const ans = await ask('\nType "WIPE" to confirm (anything else cancels): ');
  if (ans !== 'WIPE') {
    console.log('Aborted. Nothing was deleted.');
    await pool.end();
    process.exit(0);
  }

  // Discover EVERY table that has a foreign key referencing employees(id).
  // This way we don't have to maintain a hardcoded list — any future
  // migration that adds a new employee-dependent table is handled automatically.
  const fkTablesRes = await pool.query(`
    SELECT DISTINCT tc.table_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.referential_constraints rc
        ON tc.constraint_name = rc.constraint_name
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = rc.unique_constraint_name
     WHERE tc.constraint_type = 'FOREIGN KEY'
       AND ccu.table_name     = 'employees'
       AND tc.table_name     <> 'employees'
     ORDER BY tc.table_name
  `);
  const discovered = fkTablesRes.rows.map(r => r.table_name);
  const allTables  = Array.from(new Set([...TABLES_TO_TRUNCATE, ...discovered]))
                          .filter(t => !PRESERVE.has(t));

  console.log(`\nClearing ${allTables.length} employee-dependent tables (hardcoded ${TABLES_TO_TRUNCATE.length} + discovered ${discovered.length} − preserved ${PRESERVE.size})…`);
  for (const t of allTables) {
    try {
      await pool.query(`TRUNCATE TABLE ${t} RESTART IDENTITY CASCADE`);
      console.log(`  ✅ ${t}`);
    } catch (err) {
      // Most likely "relation does not exist" — table never migrated on this DB.
      if (err.code === '42P01') console.log(`  ⏭  ${t} (table does not exist — skipping)`);
      else console.log(`  ⚠️  ${t}: ${err.message}`);
    }
  }

  // Break self-referencing FKs (reporting_manager_id, approving_authority_id,
  // approved_by) BEFORE the delete. Without this, deleting employee A whose
  // reporting_manager_id points to employee B (also being deleted) errors out
  // because the FK has no ON DELETE action — Postgres doesn't know which one
  // to delete first.
  console.log('\nBreaking self-referential FKs on employees…');
  await pool.query(`
    UPDATE employees
       SET reporting_manager_id     = NULL,
           approving_authority_id   = NULL,
           approved_by              = NULL
  `);
  console.log('  ✅ Cleared reporting / approving / approved_by links');

  console.log('\nDeleting non-admin employees…');
  const r = await pool.query(
    `DELETE FROM employees
       WHERE LOWER(email) <> ALL($1::text[])
       RETURNING email`,
    [adminEmails]
  );
  console.log(`  ✅ Removed ${r.rowCount} employee row(s)`);

  // Make sure every surviving admin actually has role='admin'. The
  // bootstrap in server.js deliberately refuses to elevate an existing
  // non-super_admin row, but during a demo reset we WANT the ADMIN_EMAIL users
  // to be super admins so you can immediately log in and trigger Zoho sync.
  console.log('\nEnsuring super_admin role for ADMIN_EMAIL accounts…');
  const promote = await pool.query(
    `UPDATE employees
        SET role = 'admin'
      WHERE LOWER(email) = ANY($1::text[])
        AND role <> 'admin'
      RETURNING email`,
    [adminEmails]
  );
  if (promote.rowCount > 0) {
    console.log(`  ✅ Promoted ${promote.rowCount} row(s) to admin: ${promote.rows.map(r => r.email).join(', ')}`);
  } else {
    console.log('  ✅ Already admin — nothing to change');
  }

  // Sanity check — admin rows survived?
  const remaining = await pool.query('SELECT email, role FROM employees ORDER BY email');
  console.log('\nRemaining employees:');
  remaining.rows.forEach(row => console.log(`  • ${row.email} (${row.role})`));

  console.log('\n✨ Done. Next steps:');
  console.log('   1. Make sure the backend is running.');
  console.log('   2. Log in as an admin.');
  console.log('   3. Go to Employees → click "Sync from Zoho" to import live data.');
  console.log('   4. Demo!\n');

  await pool.end();
  process.exit(0);
})().catch(err => {
  console.error('\n❌ Reset failed:', err.message);
  process.exit(1);
});
