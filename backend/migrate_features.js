const pool = require('./db');

async function migrate() {
  try {
    console.log('Starting migration for new features...');

    // 1. Settings - GPS Geofencing
    await pool.query(`
      ALTER TABLE settings 
      ADD COLUMN IF NOT EXISTS office_lat NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS office_lng NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS office_radius INT DEFAULT 100;
    `);
    console.log('Added GPS fields to settings');

    // 2. Leave Encashments
    await pool.query(`
      CREATE TABLE IF NOT EXISTS leave_encashments (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
        leave_type VARCHAR(50) NOT NULL,
        days NUMERIC NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        reason TEXT,
        approved_by UUID REFERENCES employees(id),
        approved_at TIMESTAMP,
        rejection_reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Created leave_encashments table');

    // 3. Messages (Chat)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        sender_id UUID REFERENCES employees(id) ON DELETE CASCADE,
        receiver_id UUID REFERENCES employees(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        is_read BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Created messages table');

    // 4. Projects and Tasks
    await pool.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(255) NOT NULL,
        description TEXT,
        status VARCHAR(50) DEFAULT 'active',
        created_by UUID REFERENCES employees(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS tasks (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        assigned_to UUID REFERENCES employees(id) ON DELETE SET NULL,
        status VARCHAR(50) DEFAULT 'todo',
        priority VARCHAR(50) DEFAULT 'medium',
        due_date DATE,
        created_by UUID REFERENCES employees(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Created projects and tasks tables');

    console.log('Migration completed successfully!');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    pool.end();
  }
}

migrate();
