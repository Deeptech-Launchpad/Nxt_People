/**
 * Idempotent: ensure the three demo users used by the Cypress E2E suite
 * exist with role-appropriate passwords. Safe to run any number of times.
 *
 *   cd backend
 *   npm run test:setup
 *
 * The hash in seed.sql is a placeholder that was never a real bcrypt of
 * "password123" — running the seed alone won't produce a working login.
 * This script rehashes the password at runtime and patches the rows
 * (creating them if missing), so the test suite is reliable regardless
 * of how the database was originally bootstrapped.
 */
const bcrypt = require('bcryptjs');
const pool = require('../db');

const PASSWORD = 'password123';

const USERS = [
  { email: 'balaji@altiusnxt.com', role: 'admin', firstName: 'Test', lastName: 'Admin', employeeId: 'NXT-TEST-ADM' },
  { email: 'sanjana@altiusnxt.com', role: 'manager', firstName: 'Test', lastName: 'Manager', employeeId: 'NXT-TEST-MGR' },
  { email: 'saranya@altiusnxt.com', role: 'team_member', firstName: 'Test', lastName: 'Employee', employeeId: 'NXT-TEST-EMP' },
];

(async () => {
  console.log('🔧 ensuring Cypress test users exist...\n');
  const hash = await bcrypt.hash(PASSWORD, 12);

  for (const u of USERS) {
    const existing = await pool.query(
      'SELECT id FROM employees WHERE LOWER(email) = $1',
      [u.email]
    );

    if (existing.rows.length > 0) {
      await pool.query(
        `UPDATE employees SET
           password            = $1,
           role                = $2,
           status              = 'active',
           registration_status = 'active',
           has_accepted        = TRUE,
           accepted_at         = COALESCE(accepted_at, NOW()),
           mfa_enabled         = FALSE,
           mfa_secret          = NULL,
           mfa_backup_codes    = '[]'::jsonb,
           updated_at          = NOW()
         WHERE id = $3`,
        [hash, u.role, existing.rows[0].id]
      );
      console.log(`  ✅ refreshed ${u.email.padEnd(28)} (${u.role})`);
    } else {
      await pool.query(
        `INSERT INTO employees
           (first_name, last_name, email, password, role, status,
            registration_status, has_accepted, accepted_at, employee_id, department, designation)
         VALUES ($1, $2, $3, $4, $5, 'active', 'active', TRUE, NOW(), $6, 'HR', 'Demo Account')`,
        [u.firstName, u.lastName, u.email, hash, u.role, u.employeeId]
      );
      console.log(`  ✨ created   ${u.email.padEnd(28)} (${u.role})`);
    }
  }

  console.log(`\nPassword for all three: "${PASSWORD}"`);
  console.log('🎉 Ready. Run:  cd ../frontend && npm run test:run\n');
  await pool.end();
})().catch((err) => {
  console.error('❌ Failed:', err.message);
  process.exit(1);
});
