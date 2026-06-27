/**
 * Promote every email listed in ADMIN_EMAIL (.env) to role='admin'.
 *
 * Why this exists: server.js bootstraps an admin row if the email is missing
 * from the employees table, but it deliberately does NOT elevate an existing
 * non-admin row (safety guard against accidental privilege grants). This
 * script is the explicit, opt-in way for HR to say "yes, promote them."
 *
 * Useful after:
 *   • npm run reset:demo wiped + Zoho re-import where your admin came in
 *     with role='team_member'
 *   • Onboarding form created your account as an employee
 *   • Manual SQL is annoying to write
 *
 * Usage:
 *   cd backend
 *   npm run promote:admin
 */

require('dotenv').config();
const pool = require('../db');

const adminEmails = (process.env.ADMIN_EMAIL || '')
  .split(/[,;\s]+/)
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

if (adminEmails.length === 0) {
  console.error('❌ ADMIN_EMAIL is empty in .env — nothing to promote.');
  console.error('   Add ADMIN_EMAIL=you@example.com to backend/.env first.');
  process.exit(1);
}

(async () => {
  console.log(`Promoting these ADMIN_EMAIL accounts to role='admin':\n  • ${adminEmails.join('\n  • ')}\n`);

  const r = await pool.query(
    `UPDATE employees
        SET role = 'admin'
      WHERE LOWER(email) = ANY($1::text[])
        AND role <> 'admin'
      RETURNING email`,
    [adminEmails]
  );

  if (r.rowCount === 0) {
    console.log('Nothing to update — every ADMIN_EMAIL account is already admin (or none of them exist in employees yet).');
  } else {
    console.log(`✅ Promoted ${r.rowCount} row(s):`);
    r.rows.forEach(row => console.log(`  • ${row.email}`));
  }

  // Sanity print — show every admin in the system after the promotion.
  const allAdmins = await pool.query("SELECT email FROM employees WHERE role = 'admin' ORDER BY email");
  console.log(`\nAll admins now: ${allAdmins.rows.length}`);
  allAdmins.rows.forEach(row => console.log(`  • ${row.email}`));

  console.log('\n⚠️  Log out and log back in for the new role to take effect (JWT contains the old role until you re-auth).');

  await pool.end();
})().catch(err => {
  console.error('❌ Failed:', err.message);
  process.exit(1);
});

