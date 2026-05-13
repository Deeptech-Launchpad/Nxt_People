const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

// Helper: returns today's date as a YYYY-MM-DD string in server local time
function todayStr() {
  return new Date().toLocaleDateString('en-CA');
}
function toDateStr(date) {
  return date.toLocaleDateString('en-CA');
}

// ── GET today's attendance record ──────────────────────────────────────────────
router.get('/today', async (req, res) => {
  try {
    const today = todayStr();
    const result = await pool.query(
      `SELECT id as "_id", check_in as "checkIn", check_out as "checkOut",
       working_hours as "workingHours", status, late_minutes as "lateMinutes",
       check_in_location as "checkInLocation", check_out_location as "checkOutLocation"
       FROM attendance WHERE employee_id = $1 AND date = $2::date`,
      [req.user._id, today]
    );
    const row = result.rows[0] || null;
    if (row) {
      const wh = parseFloat(row.workingHours);
      row.workingHours = isFinite(wh) ? wh : 0;
    }
    res.json({ success: true, data: row });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST check-in ──────────────────────────────────────────────────────────────
router.post('/checkin', async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    // GPS is validated against settings — not required by default
    const today = todayStr();

    const existingRes = await pool.query(
      'SELECT * FROM attendance WHERE employee_id = $1 AND date = $2::date',
      [req.user._id, today]
    );
    const existing = existingRes.rows[0];

    if (existing && existing.check_in && !existing.check_out) {
      return res.status(400).json({ success: false, message: 'Already checked in today' });
    }

    // Fetch settings + shift for late detection
    const settingsRes = await pool.query(
      'SELECT late_after_minutes, require_gps, office_latitude, office_longitude, gps_radius_meters FROM settings LIMIT 1'
    );
    const settings = settingsRes.rows[0] || {};

    // Try to get employee's assigned shift for precise late detection
    const shiftRes = await pool.query(
      `SELECT s.id, s.start_time FROM employees e
       LEFT JOIN shifts s ON e.shift_id = s.id
       WHERE e.id = $1`, [req.user._id]
    );
    const shift = shiftRes.rows[0];

    // GPS validation
    const { location } = req.body;
    let gpsWarning = null;
    let withinRange = true;

    if (settings.require_gps && (!latitude || !longitude)) {
      return res.status(403).json({ success: false, message: 'Location is required. Please enable GPS and try again.', code: 'GPS_REQUIRED' });
    }

    if (settings.office_latitude && settings.office_longitude && latitude && longitude) {
      const R = 6371000;
      const φ1 = latitude * Math.PI / 180;
      const φ2 = settings.office_latitude * Math.PI / 180;
      const Δφ = (settings.office_latitude - latitude) * Math.PI / 180;
      const Δλ = (settings.office_longitude - longitude) * Math.PI / 180;
      const a = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
      const distance = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
      const radius = settings.gps_radius_meters || 200;
      withinRange = distance <= radius;
      if (!withinRange) {
        gpsWarning = `You are ${distance}m from office (allowed: ${radius}m)`;
        if (settings.require_gps) {
          return res.status(403).json({ success: false, message: gpsWarning, code: 'OUT_OF_RANGE' });
        }
      }
    }

    const now = new Date();
    const checkInMins = now.getHours() * 60 + now.getMinutes();

    // ── Late detection ──────────────────────────────────────────────────────────
    let lateMinutes = 0;
    let status = 'present';

    if (shift && shift.start_time) {
      // Parse shift start_time (e.g. "09:00" or "09:00:00")
      const [shiftH, shiftM] = shift.start_time.split(':').map(Number);
      const shiftStartMins = shiftH * 60 + (shiftM || 0);
      // Use grace period: 15 minutes
      const graceMins = 15;
      if (checkInMins > shiftStartMins + graceMins) {
        lateMinutes = checkInMins - shiftStartMins;
        status = 'late';
      }
    } else {
      // Fall back to settings.late_after_minutes
      const lateAfter = settings.late_after_minutes || 570; // 9:30 AM default
      if (checkInMins > lateAfter) {
        lateMinutes = checkInMins - lateAfter;
        status = 'late';
      }
    }

    const locLabel = location || (latitude ? `GPS (${parseFloat(latitude).toFixed(4)}, ${parseFloat(longitude).toFixed(4)})` : 'Office');

    let record;
    if (existing) {
      const up = await pool.query(
        `UPDATE attendance
         SET check_in=$1, check_out=NULL, status=$2, late_minutes=$3,
             check_in_location=$4, check_in_latitude=$5, check_in_longitude=$6,
             shift_id=$7, updated_at=NOW()
         WHERE id=$8
         RETURNING id as "_id", check_in as "checkIn", check_out as "checkOut",
                   working_hours as "workingHours", status, late_minutes as "lateMinutes"`,
        [now, status, lateMinutes, locLabel, latitude||null, longitude||null,
         shift?.id||null, existing.id]
      );
      record = up.rows[0];
    } else {
      const ins = await pool.query(
        `INSERT INTO attendance (employee_id, date, check_in, status, late_minutes,
         check_in_location, check_in_latitude, check_in_longitude, shift_id)
         VALUES ($1,$2::date,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id as "_id", check_in as "checkIn", check_out as "checkOut",
                   working_hours as "workingHours", status, late_minutes as "lateMinutes"`,
        [req.user._id, today, now, status, lateMinutes, locLabel,
         latitude||null, longitude||null, shift?.id||null]
      );
      record = ins.rows[0];
    }

    // ── Notify Manager (if late) & Feed Entry ──
    try {
      const { createFeedEntry } = require('./feeds');
      const { createNotification } = require('./notifications');
      const timeLabel = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      const feedMsg = lateMinutes > 0
        ? `Late check-in at ${timeLabel} — ${Math.floor(lateMinutes/60)}h ${lateMinutes%60}m late`
        : `Checked in at ${timeLabel}`;
      
      await createFeedEntry(req.user._id, lateMinutes > 0 ? 'late_checkin' : 'checkin', 'Attendance', feedMsg, lateMinutes > 0 ? '🟠' : '🟢');

      if (lateMinutes > 0) {
        const emp = await pool.query('SELECT reporting_manager_id FROM employees WHERE id=$1', [req.user._id]);
        if (emp.rows[0]?.reporting_manager_id) {
          await createNotification(
            emp.rows[0].reporting_manager_id,
            'late_arrival',
            'Late Arrival',
            `${req.user.firstName} checked in ${Math.floor(lateMinutes/60)}h ${lateMinutes%60}m late.`,
            '/attendance/team'
          );
        }
      }
    } catch (e) { console.error('Notify/Feed error:', e.message); }

    const lateMsg = lateMinutes > 0
      ? `Late by ${Math.floor(lateMinutes/60)}h ${lateMinutes%60}m`
      : null;

    res.status(201).json({
      success: true, data: record,
      message: lateMsg ? `Checked in — ${lateMsg}` : 'Checked in successfully',
      gpsWarning, lateMinutes, lateMessage: lateMsg
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST check-out ─────────────────────────────────────────────────────────────
router.post('/checkout', async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    if (!latitude || !longitude) {
      return res.status(400).json({ success: false, message: 'Location is required to check out. Please enable GPS and try again.' });
    }

    const today = todayStr();
    const existingRes = await pool.query(
      'SELECT * FROM attendance WHERE employee_id = $1 AND date = $2::date',
      [req.user._id, today]
    );
    const record = existingRes.rows[0];

    if (!record || !record.check_in) {
      return res.status(400).json({ success: false, message: 'No check-in found for today' });
    }
    if (record.check_out) {
      return res.status(400).json({ success: false, message: 'Already checked out' });
    }

    const settingsRes = await pool.query('SELECT half_day_hours FROM settings LIMIT 1');
    const halfDayHours = settingsRes.rows[0]?.half_day_hours || 4;

    const now = new Date();
    const location = req.body.location || `GPS (${parseFloat(latitude).toFixed(4)}, ${parseFloat(longitude).toFixed(4)})`;

    const checkInDate = new Date(record.check_in);
    
    // Round to nearest minute logic (if seconds >= 35, count as a full minute)
    const diffSeconds = isFinite(checkInDate) ? (now - checkInDate) / 1000 : 0;
    let diffMinutes = Math.floor(diffSeconds / 60);
    const remainderSeconds = diffSeconds % 60;
    if (remainderSeconds >= 35) {
      diffMinutes += 1;
    }
    const sessionHours = diffMinutes / 60;

    const prevHoursRaw = parseFloat(record.working_hours);
    const safePrev = isFinite(prevHoursRaw) ? prevHoursRaw : 0;
    const workingHours = parseFloat((safePrev + sessionHours).toFixed(8));

    let status = record.status;
    if (isFinite(workingHours)) {
      if (workingHours < 7.5) {
        status = 'absent';
      } else {
        status = record.late_minutes > 0 ? 'late' : 'present';
      }
    }

    const up = await pool.query(
      `UPDATE attendance
       SET check_out=$1, check_out_location=$2, check_out_latitude=$3, check_out_longitude=$4,
           working_hours=$5, status=$6, updated_at=NOW()
       WHERE id=$7
       RETURNING id as "_id", check_in as "checkIn", check_out as "checkOut",
                 working_hours as "workingHours", status, late_minutes as "lateMinutes"`,
      [now, location, latitude||null, longitude||null, workingHours, status, record.id]
    );

    // ── Feed Entry ──
    try {
      const { createFeedEntry } = require('./feeds');
      const totalH = Math.floor(workingHours);
      const totalM = Math.round((workingHours - totalH) * 60);
      const timeLabel = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      await createFeedEntry(
        req.user._id,
        'checkout',
        'Attendance',
        `Checked out at ${timeLabel} — ${totalH}h ${totalM}m worked`,
        '🔵'
      );
    } catch (_) {}

    res.json({ success: true, data: up.rows[0], message: 'Checked out successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET my attendance (monthly) ───────────────────────────────────────────────
router.get('/my', async (req, res) => {
  try {
    const { month, year } = req.query;
    const now = new Date();
    // parseInt(undefined) returns NaN, and `??` doesn't catch NaN — only
    // null/undefined. Without this guard, callers that omit ?month=... get
    // a 500 because `new Date(y, NaN, 1)` produces an invalid date and the
    // SQL ::date cast throws.
    const parsedM = parseInt(month, 10);
    const m = Number.isFinite(parsedM) ? parsedM : now.getMonth();
    const y = parseInt(year, 10) || now.getFullYear();

    const start = toDateStr(new Date(y, m, 1));
    const end   = toDateStr(new Date(y, m + 1, 0));

    const result = await pool.query(
      `SELECT id as "_id", date, check_in as "checkIn", check_out as "checkOut",
       working_hours as "workingHours", status, late_minutes as "lateMinutes",
       check_in_location as "checkInLocation"
       FROM attendance
       WHERE employee_id=$1 AND date>=$2::date AND date<=$3::date
       ORDER BY date ASC`,
      [req.user._id, start, end]
    );

    const mapped = result.rows.map(r => ({
      ...r,
      workingHours: Number(r.workingHours) || 0,
      lateMinutes: r.lateMinutes || 0
    }));

    res.json({ success: true, data: mapped });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET team attendance ───────────────────────────────────────────────────────
router.get('/team', authorize('admin', 'manager'), async (req, res) => {
  try {
    const { date, department, employeeId } = req.query;
    const targetDate = date || todayStr();

    let empQuery = 'WHERE e.status = \'active\'';
    let empParams = [];
    let empIdx = 1;

    if (department) { empQuery += ` AND e.department = $${empIdx++}`; empParams.push(department); }
    if (req.user.role === 'manager') { empQuery += ` AND e.reporting_manager_id = $${empIdx++}`; empParams.push(req.user._id); }

    const employeesRes = await pool.query(
      `SELECT e.id as "_id", e.first_name as "firstName", e.last_name as "lastName",
       e.department, e.employee_id as "employeeId", e.designation, e.photo_url as "photoUrl",
       e.phone,
       json_build_object('name', s.name, 'start_time', s.start_time, 'end_time', s.end_time) as shift
       FROM employees e
       LEFT JOIN shifts s ON e.shift_id = s.id
       ${empQuery}`,
      empParams
    );

    let attQuery = 'WHERE a.date = $1::date';
    let attParams = [targetDate];
    let attIdx = 2;

    if (employeeId) {
      attQuery += ` AND a.employee_id = $${attIdx++}`;
      attParams.push(employeeId);
    } else if (employeesRes.rows.length > 0) {
      const ids = employeesRes.rows.map(e => e._id);
      attQuery += ` AND a.employee_id = ANY($${attIdx++})`;
      attParams.push(ids);
    } else {
      return res.json({ success: true, data: [], employees: [] });
    }

    const attRes = await pool.query(
      `SELECT a.id as "_id", a.date, a.check_in as "checkIn", a.check_out as "checkOut",
       a.working_hours as "workingHours", a.status, a.late_minutes as "lateMinutes",
       a.check_in_location as "checkInLocation",
       json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name,
         'department', e.department, 'employeeId', e.employee_id, 'photoUrl', e.photo_url) as employee
       FROM attendance a
       JOIN employees e ON a.employee_id = e.id
       ${attQuery}`,
      attParams
    );

    const mapped = attRes.rows.map(r => ({
      ...r,
      workingHours: Number(r.workingHours) || 0
    }));

    res.json({ success: true, data: mapped, employees: employeesRes.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET attendance summary ─────────────────────────────────────────────────────
router.get('/summary', async (req, res) => {
  try {
    const { month, year, employeeId } = req.query;
    const now = new Date();
    const m = month !== undefined ? parseInt(month) : now.getMonth();
    const y = parseInt(year) || now.getFullYear();

    const start = toDateStr(new Date(y, m, 1));
    const end   = toDateStr(new Date(y, m + 1, 0));

    const empId = req.user.role === 'admin' && employeeId ? employeeId : req.user._id;

    const result = await pool.query(
      'SELECT status, working_hours, late_minutes FROM attendance WHERE employee_id=$1 AND date>=$2::date AND date<=$3::date',
      [empId, start, end]
    );

    // Count weekends in the month
    let weekendDays = 0;
    const cur = new Date(y, m, 1);
    const endDate = new Date(y, m + 1, 0);
    while (cur <= endDate) {
      const d = cur.getDay();
      if (d === 0 || d === 6) weekendDays++;
      cur.setDate(cur.getDate() + 1);
    }

    const summary = { present: 0, absent: 0, late: 0, halfDay: 0, leave: 0,
                      totalHours: 0, totalLateMinutes: 0, weekend: weekendDays };
    result.rows.forEach(r => {
      if (r.status === 'present') summary.present++;
      else if (r.status === 'absent') summary.absent++;
      else if (r.status === 'late') { summary.late++; summary.present++; }
      else if (r.status === 'half-day') summary.halfDay++;
      else if (r.status === 'leave') summary.leave++;
      summary.totalHours += Number(r.working_hours) || 0;
      summary.totalLateMinutes += r.late_minutes || 0;
    });
    summary.totalHours = Math.round(summary.totalHours * 100) / 100;

    res.json({ success: true, data: summary });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET holidays via attendance route (alias for leave summary) ───────────────
router.get('/holidays', async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const r = await pool.query(
      `SELECT id as "_id", name, date, description, is_optional as "isOptional"
       FROM holidays
       WHERE EXTRACT(YEAR FROM date) = $1
       ORDER BY date ASC`,
      [year]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
