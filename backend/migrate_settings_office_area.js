const pool = require('./db');
async function run() {
  await pool.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS office_area_name VARCHAR(255)`);
  console.log('migrate_settings_office_area: office_area_name column ready');
  await pool.end();
}
run().catch(e => { console.error(e); process.exit(1); });
