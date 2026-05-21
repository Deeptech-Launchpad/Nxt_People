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

    // Fetch settings + shift for late detection.
    // enforce_geofence is a new flag (default FALSE) that separates two
    // policies that used to be conflated under require_gps:
    //   - require_gps:       GPS coords MUST be sent (browser permission)
    //   - enforce_geofence:  GPS must additionally be inside the radius
    // Default keeps geofence informational so WFH/field/late employees
    // can still check in; HR sees the distance in attendance reports.
    const settingsRes = await pool.query(
      'SELECT late_after_minutes, require_gps, enforce_geofence, office_latitude, office_longitude, gps_radius_meters FROM settings LIMIT 1'
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
        // Hard-block ONLY when the org has explicitly opted into geofence
        // enforcement. Default is soft-warn so WFH / field / late-commute
        // employees can still check in (HR sees the distance via the
        // stored lat/lng + the gpsWarning surfaced in the response).
        if (settings.enforce_geofence) {
          return res.status(403).json({ success: false, message: gpsWarning, code: 'OUT_OF_RANGE' });
        }
      }
    }

    const now = new Date();
    const checkInMins = now.getHours() * 60 + now.getMinutes();

    // ── Late detection ──────────────────────────────────────────────────────────
    // ALWAYS compute lateMinutes from the actual minutes past shift start —
    // even 1 minute late shows "Late by 00:01" in the UI (Zoho parity). The
    // grace period only decides whether status flips to 'late' (which has
    // downstream effects on policy / reports). Display lateness != status
    // lateness.
    let lateMinutes = 0;
    let status = 'present';

    if (shift && shift.start_time) {
      const [shiftH, shiftM] = shift.start_time.split(':').map(Number);
      const shiftStartMins = shiftH * 60 + (shiftM || 0);
      const graceMins = 15;
      if (checkInMins > shiftStartMins) {
        lateMinutes = checkInMins - shiftStartMins;
        if (checkInMins > shiftStartMins + graceMins) status = 'late';
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

    // Pull half_day_hours AND require_gps in one round-trip so check-out
    // honours the same GPS rule as check-in. Previously this route blocked
    // every check-out when GPS was missing, even though check-in defaults
    // to allowing GPS-less attendance unless settings.require_gps = TRUE.
    const settingsRes = await pool.query('SELECT half_day_hours, require_gps FROM settings LIMIT 1');
    const halfDayHours = settingsRes.rows[0]?.half_day_hours || 4;
    const requireGps   = settingsRes.rows[0]?.require_gps;

    if (requireGps && (!latitude || !longitude)) {
      return res.status(403).json({ success: false, message: 'Location is required to check out. Please enable GPS and try again.', code: 'GPS_REQUIRED' });
    }

    const now = new Date();
    const location = req.body.location ||
      (latitude && longitude
        ? `GPS (${parseFloat(latitude).toFixed(4)}, ${parseFloat(longitude).toFixed(4)})`
        : 'Office');

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
// Computes lateMinutes ON THE FLY from check-in vs. the employee's current
// shift start time. This handles two cases the stored late_minutes can't:
//   • Older rows from before the late-detection logic existed (NULL in DB).
//   • New rows where the check-in fell inside the 15-min grace period — we
//     don't flip status to 'late' in that case (preserves the grace-period
//     semantics) but the UI still wants to show "Late by 00:02" like Zoho.
// The stored column remains the source of truth for the status flag and
// daily reports; the computed value is purely a display helper.
router.get('/my', async (req, res) => {
  try {
    const { month, year } = req.query;
    const now = new Date();
    const parsedM = parseInt(month, 10);
    const m = Number.isFinite(parsedM) ? parsedM : now.getMonth();
    const y = parseInt(year, 10) || now.getFullYear();

    const start = toDateStr(new Date(y, m, 1));
    const end   = toDateStr(new Date(y, m + 1, 0));

    // Pull the employee's current shift start + the fallback from settings
    // alongside attendance so we can compute lateMinutes per row.
    const [attRes, shiftRes, sRes] = await Promise.all([
      pool.query(
        `SELECT id as "_id", date, check_in as "checkIn", check_out as "checkOut",
                working_hours as "workingHours", status,
                late_minutes as "lateMinutes",
                check_in_location as "checkInLocation"
           FROM attendance
          WHERE employee_id=$1 AND date>=$2::date AND date<=$3::date
          ORDER BY date ASC`,
        [req.user._id, start, end]
      ),
      pool.query(
        `SELECT s.start_time
           FROM employees e LEFT JOIN shifts s ON s.id = e.shift_id
          WHERE e.id = $1`,
        [req.user._id]
      ),
      pool.query(`SELECT late_after_minutes FROM settings LIMIT 1`),
    ]);

    const shiftStart = shiftRes.rows[0]?.start_time || null;
    const lateAfter  = sRes.rows[0]?.late_after_minutes || 570; // 09:30 AM default

    const shiftStartMins = shiftStart
      ? (() => { const [h, mi] = String(shiftStart).split(':').map(Number); return h * 60 + (mi || 0); })()
      : lateAfter;

    const mapped = attRes.rows.map(r => {
      // Always compute lateness from the actual check-in time. The stored
      // late_minutes column was historically only filled when the old
      // grace-aware check was triggered, so older rows often have 0 even
      // for legitimately-late check-ins (e.g. 10:17 AM with a 9:30 shift).
      // We take the max of stored vs. computed so we never under-report.
      let computed = 0;
      if (r.checkIn) {
        const t = new Date(r.checkIn);
        const ciMins = t.getHours() * 60 + t.getMinutes();
        const diff = ciMins - shiftStartMins;
        if (diff > 0) computed = diff;
      }
      const lateMinutes = Math.max(Number(r.lateMinutes) || 0, computed);
      return {
        ...r,
        workingHours: Number(r.workingHours) || 0,
        lateMinutes,
      };
    });

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
// Accepts EITHER (startDate, endDate) OR legacy (month, year). The week-view
// in MyAttendance passes a 7-day range so the counts reflect what's visible —
// previously /summary always ran a full-month query, which is why a weekly
// view was showing "Weekend 10 Days" (the whole month, not the week).
//
// Counts returned: present, absent, late, halfDay, leave, holidays, onDuty,
// weekend, payableDays, totalHours, totalLateMinutes.
//   • Weekend uses weekend_rules when available, otherwise settings.working_days,
//     otherwise falls back to Sun + (1st/3rd Sat). Whatever convention is
//     active at the rest of the app applies here too.
//   • Holidays is a separate count via the holidays table for the same range.
//   • payableDays excludes future days (a day in the future isn't payable yet)
//     AND today if the day is still in progress (no check-out).
router.get('/summary', async (req, res) => {
  try {
    const { startDate, endDate, month, year, employeeId } = req.query;
    const now = new Date();

    // Resolve the date range. If startDate+endDate provided, honour them;
    // otherwise compute the full month from month+year (legacy callers).
    let start, end;
    if (startDate && endDate) {
      start = startDate;
      end   = endDate;
    } else {
      const m = month !== undefined ? parseInt(month) : now.getMonth();
      const y = parseInt(year) || now.getFullYear();
      start = toDateStr(new Date(y, m, 1));
      end   = toDateStr(new Date(y, m + 1, 0));
    }

    const empId = req.user.role === 'admin' && employeeId ? employeeId : req.user._id;

    // Pull attendance + holidays + settings + weekend_rules in parallel.
    // settings.working_days is the simplest weekend source; if weekend_rules
    // is populated we prefer that (richer recurrence patterns).
    const [attRes, hRes, sRes, wrRes] = await Promise.all([
      pool.query(
        'SELECT date, status, working_hours, late_minutes, check_in, check_out FROM attendance WHERE employee_id=$1 AND date>=$2::date AND date<=$3::date',
        [empId, start, end]
      ),
      pool.query(
        `SELECT date FROM holidays WHERE date >= $1::date AND date <= $2::date`,
        [start, end]
      ),
      pool.query(`SELECT working_days FROM settings LIMIT 1`),
      pool.query(`SELECT days_of_week, weeks_of_month, interval_weeks, start_date
                    FROM weekend_rules WHERE is_active = TRUE`),
    ]);

    const workingDays = Array.isArray(sRes.rows[0]?.working_days)
      ? sRes.rows[0].working_days.map(d => String(d).toLowerCase().slice(0, 3))
      : ['mon','tue','wed','thu','fri'];
    const weekendRules = wrRes.rows;
    const dayMap = ['sun','mon','tue','wed','thu','fri','sat'];

    const isWeekend = (d) => {
      // weekend_rules takes precedence when any row exists. Each rule says
      // "this date IS a weekend" — we OR them together.
      if (weekendRules.length > 0) {
        return weekendRules.some(rule => ruleMatches(rule, d));
      }
      // Fall back to settings.working_days: weekend ⇔ day is NOT a working day.
      return !workingDays.includes(dayMap[d.getDay()]);
    };

    // Iterate every day in the range to compute weekend/holiday/payable counts.
    const holidayDates = new Set(hRes.rows.map(r => toDateStr(new Date(r.date))));
    const attByDate    = new Map(attRes.rows.map(r => [toDateStr(new Date(r.date)), r]));

    const today = toDateStr(now);
    let weekendDays = 0, holidayDays = 0, payableDays = 0;

    const cur = new Date(start);
    const stop = new Date(end);
    while (cur <= stop) {
      const dStr = toDateStr(cur);
      const wknd = isWeekend(cur);
      const hol  = holidayDates.has(dStr);
      if (wknd) weekendDays++;
      if (hol)  holidayDays++;

      // Payable: any past-or-today day that's NOT a weekend (working day).
      // Future days don't count; "today" counts even if check-out hasn't
      // happened yet (Zoho treats the current day as payable once it begins).
      if (!wknd && dStr <= today) payableDays++;
      cur.setDate(cur.getDate() + 1);
    }

    const summary = {
      present: 0, absent: 0, late: 0, halfDay: 0, leave: 0,
      onDuty: 0, holidays: holidayDays, weekend: weekendDays,
      payableDays,
      totalHours: 0, totalLateMinutes: 0,
    };
    // Present-day counting follows Zoho's convention: a day only counts
    // once the employee has checked OUT. An in-progress day (checked in
    // but not yet out) is still on the clock and doesn't tally — otherwise
    // a week with one fully-worked day + one in-progress day would
    // misleadingly say "Present 2 Days".
    attRes.rows.forEach(r => {
      const completed = !!r.check_out;
      switch (r.status) {
        case 'present':  if (completed) summary.present++; break;
        case 'absent':   summary.absent++; break;
        case 'late':     summary.late++; if (completed) summary.present++; break;
        case 'half-day': if (completed) summary.halfDay++; break;
        case 'leave':    summary.leave++; break;
        case 'on_duty':
        case 'on-duty':  summary.onDuty++; break;
        default: break;
      }
      summary.totalHours       += Number(r.working_hours) || 0;
      summary.totalLateMinutes += r.late_minutes || 0;
    });
    summary.totalHours = Math.round(summary.totalHours * 100) / 100;

    res.json({ success: true, data: summary, range: { start, end } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Recurrence-aware weekend rule matcher (matches the frontend's
// utils/weekendRules.js logic — kept simple, no end-date handling because
// that wasn't enforced on the frontend either).
function ruleMatches(rule, date) {
  const dayMap = ['sun','mon','tue','wed','thu','fri','sat'];
  const dow = dayMap[date.getDay()];
  const days = Array.isArray(rule.days_of_week) ? rule.days_of_week.map(d => String(d).toLowerCase()) : [];
  if (!days.includes(dow)) return false;

  const startDate = rule.start_date ? new Date(rule.start_date) : null;
  if (startDate && date < startDate) return false;

  const weeksOfMonth = Array.isArray(rule.weeks_of_month) ? rule.weeks_of_month.map(Number) : [];
  if (weeksOfMonth.length > 0) {
    // Which occurrence of this weekday is it in the month? (1st, 2nd, 3rd …)
    const occurrence = Math.floor((date.getDate() - 1) / 7) + 1;
    if (!weeksOfMonth.includes(occurrence)) return false;
  }

  const interval = Math.max(1, parseInt(rule.interval_weeks) || 1);
  if (interval > 1 && startDate) {
    const msPerWeek = 7 * 24 * 60 * 60 * 1000;
    const weeksSinceStart = Math.floor((date - startDate) / msPerWeek);
    if (weeksSinceStart % interval !== 0) return false;
  }
  return true;
}

// ── GET /attendance/export?startDate=&endDate= ──────────────────────────────
// CSV export of the caller's own attendance for the given range. Columns match
// what Zoho's export gives: Employee Id, Name, Date, First Check-In, Last
// Check-Out, Total Hours, Payable Hours, Status, Shift, Reason, Description.
router.get('/export', async (req, res) => {
  try {
    const { startDate, endDate, employeeId } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, message: 'startDate and endDate required (YYYY-MM-DD)' });
    }
    const empId = req.user.role === 'admin' && employeeId ? employeeId : req.user._id;

    const r = await pool.query(
      `SELECT e.employee_id AS "employeeId",
              e.first_name || ' ' || COALESCE(e.last_name,'') AS name,
              a.date, a.check_in AS "checkIn", a.check_out AS "checkOut",
              a.working_hours AS "workingHours", a.status,
              s.name AS "shiftName", s.start_time AS "shiftStart", s.end_time AS "shiftEnd",
              a.late_minutes AS "lateMinutes", a.notes
         FROM attendance a
         JOIN employees e ON e.id = a.employee_id
    LEFT JOIN shifts s    ON s.id = e.shift_id
        WHERE a.employee_id = $1::uuid
          AND a.date >= $2::date AND a.date <= $3::date
        ORDER BY a.date ASC`,
      [empId, startDate, endDate]
    );

    const fmtTime = (t) => (t ? new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }) : '');
    const csvEscape = (v) => {
      if (v == null) return '';
      const s = String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const header = ['Employee Id','Name','Date','First Check-In','Last Check-Out',
                    'Total Hours','Status','Shift','Late By (min)','Notes'];
    const lines = [header.join(',')];

    for (const row of r.rows) {
      const shift = row.shiftName ? `${row.shiftName} (${row.shiftStart || ''}-${row.shiftEnd || ''})` : '';
      lines.push([
        csvEscape(row.employeeId),
        csvEscape(row.name),
        csvEscape(toDateStr(new Date(row.date))),
        csvEscape(fmtTime(row.checkIn)),
        csvEscape(fmtTime(row.checkOut)),
        csvEscape(row.workingHours != null ? Number(row.workingHours).toFixed(2) : ''),
        csvEscape(row.status || ''),
        csvEscape(shift),
        csvEscape(row.lateMinutes || 0),
        csvEscape(row.notes || ''),
      ].join(','));
    }

    const filename = `attendance_${startDate}_to_${endDate}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(lines.join('\n'));
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
