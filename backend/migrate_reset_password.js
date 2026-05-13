const { pool } = require('./db');

async function addResetPasswordFields() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('Adding reset password fields to employees table...');
    
    await client.query(`
      ALTER TABLE employees
      ADD COLUMN IF NOT EXISTS reset_password_token VARCHAR(255),
      ADD COLUMN IF NOT EXISTS reset_password_expires TIMESTAMP;
    `);

    await client.query('COMMIT');
    console.log('✅ Reset password fields added successfully.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error adding reset password fields:', error);
  } finally {
    client.release();
    process.exit(0);
  }
}

addResetPasswordFields();
