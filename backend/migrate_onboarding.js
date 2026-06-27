const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

async function migrate() {
  try {
    console.log('Running onboarding migration...');
    
    // Add columns to employees table
    await pool.query(`
      ALTER TABLE employees 
      ADD COLUMN IF NOT EXISTS gender VARCHAR(20),
      ADD COLUMN IF NOT EXISTS date_of_birth DATE,
      ADD COLUMN IF NOT EXISTS marital_status VARCHAR(30),
      ADD COLUMN IF NOT EXISTS blood_group VARCHAR(10),
      ADD COLUMN IF NOT EXISTS photo_url VARCHAR(500),
      ADD COLUMN IF NOT EXISTS alternate_mobile VARCHAR(20),
      ADD COLUMN IF NOT EXISTS current_address TEXT,
      ADD COLUMN IF NOT EXISTS permanent_address TEXT,
      ADD COLUMN IF NOT EXISTS city VARCHAR(100),
      ADD COLUMN IF NOT EXISTS state VARCHAR(100),
      ADD COLUMN IF NOT EXISTS country VARCHAR(100),
      ADD COLUMN IF NOT EXISTS pin_code VARCHAR(20),
      ADD COLUMN IF NOT EXISTS aadhaar_number VARCHAR(20),
      ADD COLUMN IF NOT EXISTS pan_number VARCHAR(20),
      ADD COLUMN IF NOT EXISTS passport_number VARCHAR(30),
      ADD COLUMN IF NOT EXISTS driving_license VARCHAR(30),
      ADD COLUMN IF NOT EXISTS voter_id VARCHAR(30),
      ADD COLUMN IF NOT EXISTS emergency_contact_name VARCHAR(100),
      ADD COLUMN IF NOT EXISTS emergency_contact_relationship VARCHAR(50),
      ADD COLUMN IF NOT EXISTS emergency_contact_number VARCHAR(20),
      ADD COLUMN IF NOT EXISTS emergency_contact_alternate VARCHAR(20),
      ADD COLUMN IF NOT EXISTS date_of_joining DATE,
      ADD COLUMN IF NOT EXISTS employee_type VARCHAR(30),
      ADD COLUMN IF NOT EXISTS working_mode VARCHAR(30),
      ADD COLUMN IF NOT EXISTS official_email VARCHAR(255),
      ADD COLUMN IF NOT EXISTS allow_access TEXT;
    `);
    console.log('Added onboarding columns to employees table.');

    // Create employee_education table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS employee_education (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
        highest_qualification VARCHAR(100),
        university_or_institution VARCHAR(255),
        year_of_passing INT,
        percentage_or_cgpa VARCHAR(20),
        certifications TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Created employee_education table.');

    // Create onboarding_tokens table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS onboarding_tokens (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        token VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) NOT NULL,
        created_by UUID REFERENCES employees(id),
        expires_at TIMESTAMP NOT NULL,
        used BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Created onboarding_tokens table.');

    console.log('Migration complete.');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

migrate();
