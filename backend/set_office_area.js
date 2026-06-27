const pool = require('./db');
pool.query("UPDATE settings SET office_area_name = 'NSR Road, Saibaba Colony, சாய்பாபா காலனி'")
  .then(r => { console.log('Done, rows updated:', r.rowCount); pool.end(); })
  .catch(e => { console.error(e.message); pool.end(); });
