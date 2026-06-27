const pool = require('./db');

async function run() {
  try {
    console.log('🔄 Renaming roles to new system...');

    // Update existing roles to new names
    await pool.query(`
      UPDATE employees SET role = 'admin' WHERE role = 'super_admin'
    `);
    console.log('  ✅ super_admin → admin');

    await pool.query(`
      UPDATE employees SET role = 'director' WHERE role = 'hr'
    `);
    console.log('  ✅ hr → director');

    // manager stays the same, but add team_incharge as alternative
    // employee → team_member
    await pool.query(`
      UPDATE employees SET role = 'team_member' WHERE role = 'employee'
    `);
    console.log('  ✅ employee → team_member');

    // Update MFA required roles in settings if they contain old role names
    await pool.query(`
      UPDATE settings
      SET mfa_required_roles = jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              mfa_required_roles,
              '{0}',
              CASE
                WHEN mfa_required_roles->0 = '"super_admin"' THEN '"admin"'
                WHEN mfa_required_roles->0 = '"hr"' THEN '"director"'
                WHEN mfa_required_roles->0 = '"employee"' THEN '"team_member"'
                ELSE mfa_required_roles->0
              END
            ),
            '{1}',
            CASE
              WHEN mfa_required_roles->1 = '"super_admin"' THEN '"admin"'
              WHEN mfa_required_roles->1 = '"hr"' THEN '"director"'
              WHEN mfa_required_roles->1 = '"employee"' THEN '"team_member"'
              ELSE mfa_required_roles->1
            END
          ),
          '{2}',
          CASE
            WHEN mfa_required_roles->2 = '"super_admin"' THEN '"admin"'
            WHEN mfa_required_roles->2 = '"hr"' THEN '"director"'
            WHEN mfa_required_roles->2 = '"employee"' THEN '"team_member"'
            ELSE mfa_required_roles->2
          END
        ),
        '{3}',
        CASE
          WHEN mfa_required_roles->3 = '"super_admin"' THEN '"admin"'
          WHEN mfa_required_roles->3 = '"hr"' THEN '"director"'
          WHEN mfa_required_roles->3 = '"employee"' THEN '"team_member"'
          ELSE mfa_required_roles->3
        END
      )
    `);
    console.log('  ✅ Updated MFA required roles');

    console.log('✨ Role renaming complete!');
    await pool.end();
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

run();
