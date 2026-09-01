/* ── Operations → Attendance → Check-in/out Import & Export ─────────────────
 *  Bulk export of raw attendance records, and bulk import to correct or
 *  backfill them from an external source (a biometric device's own export,
 *  for instance).
 *
 *  Export always produces one row per employee per calendar day in the
 *  range, whether or not anything happened that day — matching the reference,
 *  whose own export does the same rather than only listing days with data.
 *
 *  Import writes through the same classification a live check-out uses
 *  (utils/attendanceImportClassify.js), so an imported day and a punched day
 *  of identical length are judged identically. Every row is validated and
 *  reported on individually; a partial import that says nothing about what
 *  it skipped would be worse than a refusal.
 * ───────────────────────────────────────────────────────────────────────── */

const express = require('express');
const router = express.Router();
const pool = require('../db');
const multer = require('multer');
const xlsx = require('xlsx');
const { protect, authorize } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { serverError } = require('../utils/serverError');
const { runsOn } = require('../utils/manualAttendance');
const { classifyImportedDay } = require('../utils/attendanceImportClassify');
const { DEFAULT_TZ } = require('../utils/timezone');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const MAX_IMPORT_ROWS = 500;
const MAX_EXPORT_DAYS = 366;

router.use(protect);
const FULL = ['admin', 'director', 'hr_admin'];
router.use(authorize(...FULL));

const fmtTime12 = (isoLike) => {
  if (!isoLike) return '';
  const d = new Date(isoLike);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: DEFAULT_TZ });
};
const fmtHrs = (n) => {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '00:00';
  const total = Math.round(Number(n) * 60);
  const h = Math.floor(total / 60), m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};
const STATUS_LABEL = {
  present: 'Present', late: 'Present', 'half-day': 'Half Day', on_duty: 'On Duty', absent: 'Absent',
};

// ── Export ───────────────────────────────────────────────────────────────
router.get('/export', async (req, res) => {
  try {
    const { from, to, employeeId, format = 'xlsx' } = req.query;
    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({ success: false, message: 'from and to are required, as YYYY-MM-DD' });
    }
    const start = new Date(`${from}T00:00:00`), end = new Date(`${to}T00:00:00`);
    const days = Math.round((end - start) / 86400000) + 1;
    if (days < 1 || days > MAX_EXPORT_DAYS) {
      return res.status(400).json({ success: false, message: `Range must be 1 to ${MAX_EXPORT_DAYS} days` });
    }
    if (!['xlsx', 'xls', 'csv'].includes(format)) {
      return res.status(400).json({ success: false, message: 'format must be xlsx, xls, or csv' });
    }

    const empParams = [from, to];
    let empClause = '';
    if (employeeId) { empParams.push(employeeId); empClause = ' AND e.id = $3'; }

    const [empRes, attRes, holRes, regRes] = await Promise.all([
      pool.query(
        `SELECT e.id, e.employee_id AS code, e.first_name AS "firstName", e.last_name AS "lastName",
                s.id AS "shiftId", s.name AS "shiftName", s.working_days AS "workingDays",
                s.start_time AS "shiftStart", s.end_time AS "shiftEnd"
           FROM employees e LEFT JOIN shifts s ON s.id = e.shift_id
          WHERE e.deleted_at IS NULL AND e.status = 'active' AND e.attendance_tracked = TRUE${empClause}
          ORDER BY e.employee_id`,
        employeeId ? [employeeId] : []
      ),
      pool.query(
        `SELECT employee_id, date::text AS date, check_in AS "checkIn", check_out AS "checkOut",
                working_hours AS "workingHours", status, source
           FROM attendance WHERE date >= $1::date AND date <= $2::date`,
        empParams.slice(0, 2)
      ),
      pool.query(
        `SELECT date::text AS date, name FROM holidays WHERE date >= $1::date AND date <= $2::date AND type <> 'working_day'`,
        empParams.slice(0, 2)
      ),
      pool.query(
        `SELECT employee_id, date::text AS date, reason
           FROM attendance_regularizations WHERE status = 'approved' AND date >= $1::date AND date <= $2::date`,
        empParams.slice(0, 2)
      ),
    ]);

    const attByKey = new Map(attRes.rows.map(r => [`${r.employee_id}|${r.date}`, r]));
    const holByDate = new Map(holRes.rows.map(h => [h.date, h.name]));
    const regByKey = new Map(regRes.rows.map(r => [`${r.employee_id}|${r.date}`, r.reason]));

    const out = [];
    for (const emp of empRes.rows) {
      // The shift's own daily span — constant per employee, matching the
      // reference's own export, which shows the same Payable Hours figure on
      // every row for a given person regardless of what happened that day.
      let payableHrs = '00:00';
      if (emp.shiftStart && emp.shiftEnd) {
        const [sh, sm] = String(emp.shiftStart).split(':').map(Number);
        const [eh, em] = String(emp.shiftEnd).split(':').map(Number);
        let mins = (eh * 60 + em) - (sh * 60 + sm);
        if (mins < 0) mins += 24 * 60; // an overnight shift
        payableHrs = fmtHrs(mins / 60);
      }

      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const ymd = d.toISOString().slice(0, 10);
        const att = attByKey.get(`${emp.id}|${ymd}`);
        const holiday = holByDate.get(ymd);
        const isWeekend = !runsOn({ working_days: emp.workingDays }, d);

        let status = '';
        if (holiday) status = holiday;
        else if (isWeekend) status = 'Weekend';
        else if (att) status = STATUS_LABEL[att.status] || att.status || '';

        out.push({
          'Employee Id': emp.code || '',
          'Employee Name': `${emp.firstName || ''} ${emp.lastName || ''}`.trim(),
          'Date': ymd.split('-').reverse().join('/'),
          'First Check-In': fmtTime12(att?.checkIn),
          'Last Check-Out': fmtTime12(att?.checkOut),
          'Check-in Source': att?.source || '',
          'Check-out Source': att?.source || '',
          'Check-in Location': '', // not distinguished by day in this export; see MyAttendance for the per-punch location
          'Check-out Location': '',
          'Total Hours': fmtHrs(att?.workingHours),
          'Payable Hours': payableHrs,
          'Status': status,
          'Shift(s)': emp.shiftName || '',
          'Reason': regByKey.get(`${emp.id}|${ymd}`) || '',
        });
      }
    }

    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(out);
    xlsx.utils.book_append_sheet(wb, ws, 'Attendance');
    const bookType = format === 'csv' ? 'csv' : 'xlsx';
    const buffer = xlsx.write(wb, { type: 'buffer', bookType });

    const mime = format === 'csv' ? 'text/csv'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    res.setHeader('Content-Disposition', `attachment; filename="attendance-${from}-to-${to}.${format === 'csv' ? 'csv' : 'xlsx'}"`);
    res.setHeader('Content-Type', mime);
    res.send(buffer);
  } catch (err) { serverError(res, err); }
});

// ── Import ───────────────────────────────────────────────────────────────
// Excel date/time serials, and DD/MM/YYYY strings, both handled — the same
// two shapes holidays.js already deals with, since the same spreadsheet
// tools produce both depending on how a cell was typed vs formula-filled.
const excelSerialToDate = (n) => new Date(Date.UTC(1899, 11, 30) + n * 86400 * 1000);
const parseDate = (raw) => {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw === 'number') return excelSerialToDate(raw).toISOString().slice(0, 10);
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
};
const parseTime = (raw) => {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw === 'number') {
    // Excel time-of-day fraction of a 24h day.
    const totalMins = Math.round(raw * 24 * 60);
    return `${String(Math.floor(totalMins / 60) % 24).padStart(2, '0')}:${String(totalMins % 60).padStart(2, '0')}:00`;
  }
  const s = String(raw).trim();
  const ampm = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampm) {
    let h = parseInt(ampm[1], 10) % 12;
    if (/pm/i.test(ampm[3])) h += 12;
    return `${String(h).padStart(2, '0')}:${ampm[2]}:00`;
  }
  const plain = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (plain) return `${plain[1].padStart(2, '0')}:${plain[2]}:00`;
  return null;
};

router.post('/import', audit('IMPORT', 'attendance'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    const wb = xlsx.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(ws, { defval: '' });

    if (rows.length === 0) return res.status(400).json({ success: false, message: 'The file has no rows' });
    if (rows.length > MAX_IMPORT_ROWS) {
      return res.status(400).json({ success: false, message: `Import limited to ${MAX_IMPORT_ROWS} rows per file.` });
    }

    const empRes = await pool.query(
      `SELECT id, employee_id AS code FROM employees WHERE deleted_at IS NULL AND employee_id IS NOT NULL`);
    const empByCode = new Map(empRes.rows.map(e => [String(e.code).trim().toLowerCase(), e.id]));

    const results = { updated: 0, skipped: [] };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // header is row 1
      const code = String(row['Employee Id'] ?? row['Employee ID'] ?? '').trim();
      const dateStr = parseDate(row['Date']);
      const checkInStr = parseTime(row['First Check-In'] ?? row['Check-in']);
      const checkOutStr = parseTime(row['Last Check-Out'] ?? row['Check-out']);

      if (!code) { results.skipped.push({ row: rowNum, reason: 'Missing Employee Id' }); continue; }
      const employeeId = empByCode.get(code.toLowerCase());
      if (!employeeId) { results.skipped.push({ row: rowNum, reason: `No employee with Employee Id "${code}"` }); continue; }
      if (!dateStr) { results.skipped.push({ row: rowNum, reason: 'Missing or unreadable Date' }); continue; }
      if (row['First Check-In'] && !checkInStr) { results.skipped.push({ row: rowNum, reason: 'Unreadable check-in time' }); continue; }
      if (row['Last Check-Out'] && !checkOutStr) { results.skipped.push({ row: rowNum, reason: 'Unreadable check-out time' }); continue; }
      if (checkOutStr && !checkInStr) { results.skipped.push({ row: rowNum, reason: 'A check-out with no check-in' }); continue; }

      try {
        const { workingHours, status, lateMinutes } = checkInStr
          ? await classifyImportedDay(pool, employeeId, dateStr, checkInStr, checkOutStr)
          : { workingHours: null, status: 'absent', lateMinutes: 0 };

        await pool.query(
          `INSERT INTO attendance (employee_id, date, check_in, check_out, working_hours, status, late_minutes, source)
           VALUES ($1, $2::date,
             CASE WHEN $3::time IS NOT NULL THEN (($2::date + $3::time) AT TIME ZONE '${DEFAULT_TZ}' AT TIME ZONE 'UTC') END,
             CASE WHEN $4::time IS NOT NULL THEN (($2::date + $4::time) AT TIME ZONE '${DEFAULT_TZ}' AT TIME ZONE 'UTC') END,
             $5, $6, $7, 'import')
           ON CONFLICT (employee_id, date) DO UPDATE SET
             check_in = EXCLUDED.check_in, check_out = EXCLUDED.check_out,
             working_hours = EXCLUDED.working_hours, status = EXCLUDED.status,
             late_minutes = EXCLUDED.late_minutes, source = 'import', updated_at = NOW()`,
          [employeeId, dateStr, checkInStr, checkOutStr, workingHours, status, lateMinutes]
        );
        results.updated++;
      } catch (rowErr) {
        results.skipped.push({ row: rowNum, reason: 'Could not save this row' });
      }
    }

    res.json({
      success: true,
      message: `${results.updated} row(s) imported${results.skipped.length ? `, ${results.skipped.length} skipped` : ''}.`,
      updated: results.updated,
      skipped: results.skipped,
    });
  } catch (err) { serverError(res, err); }
});

module.exports = router;
