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

      // Parse as local-midnight so 2026-12-31 doesn't shift to 2026-12-30
      // when JS treats it as UTC and we're in IST. `${dateStr}T00:00:00`
      // anchors it to the server's local day.
      const year = new Date(`${dateStr}T00:00:00`).getFullYear();
      const type = typeRaw.toLowerCase();

      await pool.query(`INSERT INTO holidays (name, date, type, description, year) VALUES ($1, $2, $3, $4, $5)`, [name, dateStr, type, description, year]);
      count++;
    }

    res.json({ success: true, message: `Successfully imported ${count} holidays.` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

const SELECT_COLS = `
  h.id as "_id", h.name, h.date, h.type, h.year, h.description,
  h.category, h.is_compensatory AS "isCompensatory", h.mail_body AS "mailBody",
  h.compensation_type AS "compensationType",
  h.compensated_holiday_id AS "compensatedHolidayId",
  h.compensated_rule_id    AS "compensatedRuleId",
  h.notified_at AS "notifiedAt"
`;

router.get('/', async (req, res) => {
  try {
    const { year } = req.query;
    const params = [];
    let where = '';
    if (year) {
      where = 'WHERE h.year = $1';
      params.push(parseInt(year));
    }
    const result = await pool.query(
      `SELECT ${SELECT_COLS} FROM holidays h ${where} ORDER BY h.date ASC`,
      params
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/', authorize('admin'), audit('CREATE', 'holiday'), async (req, res) => {
  try {
    const {
      name, date, type, description, year,
      category, isCompensatory, mailBody,
      compensationType, compensatedHolidayId, compensatedRuleId,
    } = req.body;
    const result = await pool.query(
      `INSERT INTO holidays
         (name, date, type, description, year,
          category, is_compensatory, mail_body,
          compensation_type, compensated_holiday_id, compensated_rule_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING ${SELECT_COLS.replace(/h\./g, '')}`,
      [
        name, date, type || 'company', description, year,
        category || null, !!isCompensatory, mailBody || null,
        compensationType || null, compensatedHolidayId || null, compensatedRuleId || null,
      ]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.put('/:id', authorize('admin'), audit('UPDATE', 'holiday'), async (req, res) => {
  try {
    const {
      name, date, type, description, year,
      category, isCompensatory, mailBody,
      compensationType, compensatedHolidayId, compensatedRuleId,
    } = req.body;
    const result = await pool.query(
      `UPDATE holidays
          SET name = $1, date = $2, type = $3, description = $4, year = $5,
              category = $6, is_compensatory = $7, mail_body = $8,
              compensation_type = $9, compensated_holiday_id = $10,
              compensated_rule_id = $11,
              updated_at = NOW()
        WHERE id = $12
        RETURNING ${SELECT_COLS.replace(/h\./g, '')}`,
      [
        name, date, type, description, year,
        category || null, !!isCompensatory, mailBody || null,
        compensationType || null, compensatedHolidayId || null, compensatedRuleId || null,
        req.params.id,
      ]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/:id', authorize('admin'), audit('DELETE', 'holiday'), async (req, res) => {
  try {
    await pool.query('DELETE FROM holidays WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Holiday deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Send the holiday's mail_body to every active employee. Idempotent — admin
// can re-trigger if they edit the message. Marks notified_at so the UI can
// show "Sent on …".
router.post('/:id/notify', authorize('admin'), audit('NOTIFY', 'holiday'), async (req, res) => {
  try {
    const h = await pool.query(
      `SELECT name, date, type, mail_body FROM holidays WHERE id = $1`,
      [req.params.id]
    );
    if (h.rows.length === 0) return res.status(404).json({ success: false, message: 'Holiday not found' });
    const holiday = h.rows[0];
    if (!holiday.mail_body || !holiday.mail_body.trim()) {
      return res.status(400).json({ success: false, message: 'mail_body is empty — nothing to send' });
    }

    const emps = await pool.query(
      `SELECT first_name, last_name, email FROM employees
        WHERE status = 'active' AND email IS NOT NULL AND email <> ''`
    );

    const { sendMail } = require('../utils/mailer');
    const subject = `${process.env.COMPANY_NAME || 'Company'} — ${holiday.name}`;
    let sent = 0, failed = 0;

    for (const emp of emps.rows) {
      try {
        await sendMail({
          to: emp.email,
          subject,
          text: `Hi ${emp.first_name},\n\n${holiday.mail_body}\n\nDate: ${holiday.date}\n\nRegards,\nHR Team`,
        });
        sent++;
      } catch { failed++; }
    }

    // Only stamp notified_at when every recipient succeeded. Partial-success
    // would mislead the UI ("Sent on …") into thinking the broadcast worked
    // when 17 of 20 inboxes bounced. Admin can re-trigger after fixing SMTP.
    if (failed === 0 && sent > 0) {
      await pool.query('UPDATE holidays SET notified_at = NOW() WHERE id = $1', [req.params.id]);
    }
    res.json({ success: true, sent, failed, total: emps.rows.length });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
