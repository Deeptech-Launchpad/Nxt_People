const express = require('express');
const router = express.Router();
const pool = require('../db');
const multer = require('multer');
const xlsx = require('xlsx');
const { protect, authorize } = require('../middleware/auth');
const { audit } = require('../middleware/audit');

const upload = multer({ storage: multer.memoryStorage() });

router.use(protect);

router.get('/template', authorize('admin'), (req, res) => {
  const ws = xlsx.utils.json_to_sheet([{
    "Name": "Happy New Year 2026",
    "From": "01/01/2026",
    "To": "01/01/2026",
    "Locations": "Saibaba Colony, Coimbatore",
    "Shifts": "General Shift",
    "Description": "Wishing you ever",
    "Restricted holiday": "FALSE",
    "Reminder": "2",
    "Date - Duration and Session": "",
    "Holiday Classification": "Holiday"
  }]);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, "Holidays Template");
  const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  
  res.setHeader('Content-Disposition', 'attachment; filename="holidays_template.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

router.post('/import', authorize('admin'), audit('IMPORT', 'holiday'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    
    const wb = xlsx.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(ws);
    
    if (data.length === 0) return res.status(400).json({ success: false, message: 'Empty sheet' });

    let count = 0;
    for (const row of data) {
      const name = row['Name'] || row['Holiday Name'];
      const dateRaw = row['From'] || row['Date (YYYY-MM-DD)'] || row['Date'];
      let typeRaw = row['Holiday Classification'] || row['Type (national/company/optional)'] || row['Type'] || 'company';
      if (typeRaw.toLowerCase() === 'holiday') typeRaw = 'company';
      const description = row['Description'] || '';
      
      if (!name || !dateRaw) continue;
      
      let dateStr = dateRaw;
      if (typeof dateRaw === 'number') {
        // Correct Excel serial-date conversion (handles the 1900 leap-year bug)
        const d = new Date(Date.UTC(1899, 11, 30) + dateRaw * 86400 * 1000);
        dateStr = d.toISOString().split('T')[0];
      } else if (typeof dateRaw === 'string' && dateRaw.includes('/')) {
        const parts = dateRaw.split('/');
        if (parts.length === 3) {
          dateStr = `${parts[2]}-${parts[1]}-${parts[0]}`; // Convert DD/MM/YYYY to YYYY-MM-DD
        }
      }

      const year = new Date(dateStr).getFullYear();
      const type = typeRaw.toLowerCase();

      await pool.query(`INSERT INTO holidays (name, date, type, description, year) VALUES ($1, $2, $3, $4, $5)`, [name, dateStr, type, description, year]);
      count++;
    }

    res.json({ success: true, message: `Successfully imported ${count} holidays.` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const { year } = req.query;
    const params = [];
    let query = '';
    if (year) {
      query = 'WHERE year = $1';
      params.push(parseInt(year));
    }
    const result = await pool.query(`SELECT id as "_id", name, date, type, year, description FROM holidays ${query} ORDER BY date ASC`, params);
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/', authorize('admin'), audit('CREATE', 'holiday'), async (req, res) => {
  try {
    const { name, date, type, description, year } = req.body;
    const result = await pool.query(`INSERT INTO holidays (name, date, type, description, year) VALUES ($1, $2, $3, $4, $5) RETURNING id as "_id", name, date, type, year, description`, [name, date, type || 'company', description, year]);
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.put('/:id', authorize('admin'), audit('UPDATE', 'holiday'), async (req, res) => {
  try {
    const { name, date, type, description, year } = req.body;
    const result = await pool.query(`UPDATE holidays SET name = $1, date = $2, type = $3, description = $4, year = $5, updated_at = NOW() WHERE id = $6 RETURNING id as "_id", name, date, type, year, description`, [name, date, type, description, year, req.params.id]);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/:id', authorize('admin'), audit('DELETE', 'holiday'), async (req, res) => {
  try {
    await pool.query('DELETE FROM holidays WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Holiday deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
