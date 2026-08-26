const express = require('express');
const router = express.Router();
const logger = require('../logger');
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { shiftForCheckIn, autoAssignEnabled } = require('../utils/shiftPatterns');
const { isFullAccess } = require('../utils/roles');
const { sendCheckOutReminderEmail } = require('../utils/mailer');
const { DEFAULT_TZ } = require('../utils/timezone');
const { classifyDay } = require('../utils/attendanceRule');
const { loadWeekendResolver } = require('../utils/workingDays');
const attendanceAlerts = require('../utils/attendanceAlerts');

router.use(protect);

// Helper: returns today's date as a YYYY-MM-DD string in the org's default timezone
function todayStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: DEFAULT_TZ });
}
function toDateStr(date) {
  return date.toLocaleDateString('en-CA', { timeZone: DEFAULT_TZ });
}

// ── GET today's attendance record ──────────────────────────────────────────────
router.get('/today', async (req, res) => {
  try {
    const today = todayStr();
    const [result, sessionsRes] = await Promise.all([
      pool.query(
        `SELECT id as "_id", check_in as "checkIn", check_out as "checkOut",
         session_started_at as "sessionStartedAt",
         working_hours as "workingHours", status, late_minutes as "lateMinutes",
         check_in_location as "checkInLocation", check_out_location as "checkOutLocation"
         FROM attendance WHERE employee_id = $1 AND date = $2::date`,
        [req.user._id, today]
      ),
      pool.query(
        `SELECT id, check_in as "checkIn", check_out as "checkOut", session_hours as "sessionHours"
         FROM attendance_sessions WHERE employee_id = $1 AND date = $2 ORDER BY check_in ASC`,
        [req.user._id, today]
      ),
    ]);
    const row = result.rows[0] || null;
    if (row) {
      const wh = parseFloat(row.workingHours);
      row.workingHours = isFinite(wh) ? wh : 0;
      row.sessions = sessionsRes.rows;
    }
    res.json({ success: true, data: row });
  } catch (err) {
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  }
});

// ── GET attendance for a specific date (used by Regularization autofill) ────────
// Works for all roles: employee, manager, admin — always for the logged-in user.
router.get('/by-date', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ success: false, message: 'date query param required (YYYY-MM-DD)' });
    const result = await pool.query(
      `SELECT check_in as "checkIn", check_out as "checkOut", status
       FROM attendance WHERE employee_id = $1 AND date = $2::date`,
      [req.user._id, date]
    );
    const row = result.rows[0] || null;
    res.json({ success: true, data: row });
  } catch (err) {
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  }
});

// ── POST check-in ──────────────────────────────────────────────────────────────
router.post('/checkin', async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    // GPS is validated against settings — not required by default
    const today = todayStr();

    // Run all three read queries in parallel — eliminates 3 sequential
    // round-trips that were adding latency before the UPSERT.
    // Timezone-adjusted check-in minutes are merged into the settings query
    // so the separate tzNowRes round-trip is no longer needed.
    const [existingRes, settingsRes, shiftRes] = await Promise.all([
      pool.query(
        'SELECT * FROM attendance WHERE employee_id = $1 AND date = $2::date',
        [req.user._id, today]
      ),
      pool.query(
        `SELECT late_after_minutes, require_gps, enforce_geofence, office_latitude, office_longitude, gps_radius_meters,
          (EXTRACT(HOUR FROM NOW() AT TIME ZONE COALESCE(timezone, '${DEFAULT_TZ}')) * 60
          + EXTRACT(MINUTE FROM NOW() AT TIME ZONE COALESCE(timezone, '${DEFAULT_TZ}')))::int AS check_in_mins
         FROM settings LIMIT 1`
      ),
      // A rostered shift for today wins over the employee's standing one.
      // shift_roster has been written by the roster screen since it was built
      // and read by nothing, so assigning someone a different shift for a day
      // changed neither their expected start nor when they counted as late.
      // COALESCE, so with no roster row the answer is exactly what it was.
      pool.query(
        `SELECT COALESCE(rs.id, s.id) AS id,
                COALESCE(rs.start_time, s.start_time) AS start_time,
                rs.id AS "rosteredId"
           FROM employees e
           LEFT JOIN shifts s ON s.id = e.shift_id
           LEFT JOIN shift_roster r ON r.employee_id = e.id AND r.date = $2::date
           LEFT JOIN shifts rs ON rs.id = r.shift_id
          WHERE e.id = $1`, [req.user._id, today]
      ),
    ]);
    const existing = existingRes.rows[0];
    const settings = settingsRes.rows[0] || {};
    let shift = shiftRes.rows[0];

    // Auto shift assignment. Only when it is switched on, only when nothing
    // has already decided — a rostered shift, or one a pattern generated, is
    // an explicit answer and wins — and only for today, which is the only date
    // this route writes. Wrapped, because failing to guess a shift must never
    // fail a check-in.
    try {
      const rostered = shiftRes.rows[0]?.rosteredId;
      if (!rostered && await autoAssignEnabled()) {
        const picked = await shiftForCheckIn(settings.check_in_mins ?? 0);
        if (picked) shift = { id: picked.id, start_time: shift?.start_time };
      }
    } catch (err) {
      logger.warn({ err: err.message }, '[attendance] auto shift assignment skipped');
    }

    if (existing && existing.check_in && !existing.check_out) {
      return res.status(400).json({ success: false, message: 'Already checked in today' });
    }

    // GPS validation
    const { location } = req.body;
    let gpsWarning = null;
    let withinRange = true;

    if (settings.office_latitude && settings.office_longitude && latitude && longitude) {
      const R = 6371000;
      const lat1Rad = latitude * Math.PI / 180;
      const lat2Rad = settings.office_latitude * Math.PI / 180;
      const dLat = (settings.office_latitude - latitude) * Math.PI / 180;
      const dLon = (settings.office_longitude - longitude) * Math.PI / 180;
      const a = Math.sin(dLat/2)**2 + Math.cos(lat1Rad)*Math.cos(lat2Rad)*Math.sin(dLon/2)**2;
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
    const checkInMins = Number(settings.check_in_mins) || (now.getHours() * 60 + now.getMinutes());

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

    // ── Race-safe UPSERT ──────────────────────────────────────────────────
    // Two concurrent check-in requests (rapid double-tap, two devices)
    // both passed the early SELECT-and-400 guard above and used to race on
    // INSERT/UPDATE: one INSERT would 500 with a unique-constraint
    // violation; UPDATE-after-update could clobber an already-clean row.
    // ON CONFLICT (employee_id, date) DO UPDATE collapses both paths into
    // one atomic statement.
    //
    // The WHERE clause on the conflict branch is the safety belt: only
    // overwrite if the existing row already has check_out set (i.e.,
    // user closed the day and is re-checking-in). If a concurrent peer
    // checked in microseconds earlier, the WHERE fails, RETURNING is
    // empty, and we surface the "already checked in" error instead of
    // silently double-writing.
    const upRes = await pool.query(
      `INSERT INTO attendance
         (employee_id, date, check_in, session_started_at, status, late_minutes,
          check_in_location, check_in_latitude, check_in_longitude, shift_id)
       VALUES ($1, $2::date, $3, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (employee_id, date) DO UPDATE
         -- check_in stays the day's arrival, which is what lateness is
         -- measured from. session_started_at moves to NOW, because the stretch
         -- being timed starts here. Leaving it at check_in is what made a
         -- re-check-in count the first session a second time.
         SET check_in           = LEAST(attendance.check_in, EXCLUDED.check_in),
             session_started_at = EXCLUDED.session_started_at,
             check_out          = NULL,
             status             = attendance.status,
             late_minutes       = attendance.late_minutes,
             check_in_location  = EXCLUDED.check_in_location,
             check_in_latitude  = EXCLUDED.check_in_latitude,
             check_in_longitude = EXCLUDED.check_in_longitude,
             shift_id           = EXCLUDED.shift_id,
             updated_at         = NOW()
         WHERE attendance.check_out IS NOT NULL
       RETURNING id as "_id", check_in as "checkIn", check_out as "checkOut",
                 session_started_at as "sessionStartedAt",
                 working_hours as "workingHours", status, late_minutes as "lateMinutes"`,
      [req.user._id, today, now, status, lateMinutes, locLabel,
       latitude || null, longitude || null, shift?.id || null]
    );
    if (upRes.rows.length === 0) {
      // Conflict + WHERE rejected = someone else just checked in for this
      // employee+date in the gap between our SELECT and our UPSERT.
      return res.status(409).json({ success: false, message: 'Already checked in today' });
    }
    const record = upRes.rows[0];

    // Fire-and-forget: the check-in is already committed and an alert must
    // never be able to fail it. Does nothing unless the switch is on.
    attendanceAlerts.fire('late_check_in', {
      employeeId: req.user._id, date: today, lateMinutes: record.lateMinutes,
    });

    // Insert a session row for this check-in (soft-fail — must not break the response)
    try {
      await pool.query(
        `INSERT INTO attendance_sessions (attendance_id, employee_id, date, check_in)
         VALUES ($1, $2, $3, $4)`,
        [record._id, req.user._id, today, now]
      );
    } catch (err) {
      logger.error({ err: err.message, attendanceId: record._id }, '[attendance] session insert failed');
    }

    const isReCheckin = !!(existing && existing.check_out);

    const effectiveLate = Number(record.lateMinutes) || 0;
    const lateMsg = !isReCheckin && effectiveLate > 0
      ? `Late by ${Math.floor(effectiveLate/60)}h ${effectiveLate%60}m`
      : null;
    const toastMsg = isReCheckin ? 'Re-checked in successfully' : lateMsg;

    res.status(201).json({
      success: true, data: record,
      message: isReCheckin ? 'Re-checked in successfully' : (lateMsg ? `Checked in — ${lateMsg}` : 'Checked in successfully'),
      gpsWarning, lateMinutes: effectiveLate, lateMessage: toastMsg
    });

    // ── Notify Manager (if late) & Feed Entry — fire after response ──
    setImmediate(async () => {
      try {
        const { createFeedEntry } = require('./feeds');
        const { createNotification } = require('./notifications');
        const timeLabel = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
        const feedMsg = effectiveLate > 0
          ? `Late check-in at ${timeLabel} — ${Math.floor(effectiveLate/60)}h ${effectiveLate%60}m late`
          : `Checked in at ${timeLabel}`;

        await createFeedEntry(req.user._id, effectiveLate > 0 ? 'late_checkin' : 'checkin', 'Attendance', feedMsg, effectiveLate > 0 ? '🟠' : '🟢');

        if (effectiveLate > 0) {
          const emp = await pool.query('SELECT reporting_manager_id FROM employees WHERE id=$1', [req.user._id]);
          if (emp.rows[0]?.reporting_manager_id) {
            await createNotification(
              emp.rows[0].reporting_manager_id,
              'late_arrival',
              'Late Arrival',
              `${req.user.firstName} checked in ${Math.floor(effectiveLate/60)}h ${effectiveLate%60}m late.`,
              '/attendance/team'
            );
          }
        }
      } catch (e) { logger.error({ err: e.message }, '[attendance] notify/feed soft-fail'); }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
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
    // The policy that decides what this day gets called, plus the two facts the
    // day itself cannot supply: what the company had already approved for it.
    // Without those, someone on half-day leave or two hours of permission is
    // measured against a full eight hours and marked short for time off that
    // was granted.
    const [settingsRes, dayRes] = await Promise.all([
      pool.query(
        `SELECT expected_hours_mode AS "expectedMode",
                expected_hours_per_day AS "expectedFullDay",
                expected_half_day_hours AS "expectedHalfDay",
                attendance_policy_config AS policy
           FROM settings LIMIT 1`),
      pool.query(
        `SELECT COALESCE((
                  SELECT MAX(CASE WHEN l.is_half_day THEN 0.5 ELSE 1 END)
                    FROM leaves l
                   WHERE l.employee_id = $1 AND l.status = 'approved'
                     AND l.leave_type <> 'permission'
                     AND $2::date BETWEEN l.start_date AND l.end_date), 0) AS leave_portion,
                COALESCE((
                  SELECT SUM(COALESCE(l.hours, 0))
                    FROM leaves l
                   WHERE l.employee_id = $1 AND l.status = 'approved'
                     AND l.leave_type = 'permission'
                     AND $2::date BETWEEN l.start_date AND l.end_date), 0) AS permission_hours,
                EXISTS (
                  SELECT 1 FROM on_duty_requests o
                   WHERE o.employee_id = $1 AND o.status = 'approved'
                     AND $2::date BETWEEN o.start_date AND o.end_date) AS on_duty,
                (SELECT EXTRACT(EPOCH FROM (s.end_time::time - s.start_time::time))/3600.0
                   FROM employees e LEFT JOIN shifts s ON s.id = e.shift_id
                  WHERE e.id = $1) AS shift_hours,
                (SELECT COALESCE(s.grace_minutes, 15)
                   FROM employees e LEFT JOIN shifts s ON s.id = e.shift_id
                  WHERE e.id = $1) AS grace`,
        [req.user._id, today]),
    ]);
    const cfgRow = settingsRes.rows[0] || {};
    const dayFacts = dayRes.rows[0] || {};
    const ruleCfg = {
      ...(cfgRow.policy || {}),
      expectedMode: cfgRow.expectedMode || 'manual',
      expectedFullDay: Number(cfgRow.expectedFullDay ?? 8),
      expectedHalfDay: Number(cfgRow.expectedHalfDay ?? 4),
    };

    const now = new Date();
    const location = req.body.location ||
      (latitude && longitude
        ? `GPS (${parseFloat(latitude).toFixed(4)}, ${parseFloat(longitude).toFixed(4)})`
        : 'Office');

    // pg returns TIMESTAMP columns as JS Date objects, not strings.
    // String(dateObj) produces an unstructured locale string that breaks ISO parsing.
    // If it's already a Date, use it directly; if it's a string (older pg configs),
    // convert the "YYYY-MM-DD HH:MM:SS" format to ISO before parsing.
    const asDate = (v) => v instanceof Date
      ? v
      : new Date(String(v).replace(' ', 'T')
          + (String(v).includes('+') || String(v).endsWith('Z') ? '' : 'Z'));

    /* Measure the session from when the session began, not from when the
     * person arrived. On a day with one check-in those are the same instant.
     * On a day somebody checked out and came back they are not, and using
     * check_in charged the first stretch again on top of the hours already
     * banked — 2:02 PM to 6:21, back at 6:23, and the day read 8:39 worked
     * before five hours had passed.
     *
     * Falling back to check_in keeps rows written before the column existed
     * working exactly as they did. */
    const sessionStart = asDate(record.session_started_at || record.check_in);

    // Round to nearest minute logic (if seconds >= 35, count as a full minute)
    const diffSeconds = isFinite(sessionStart) ? (now - sessionStart) / 1000 : 0;
    let diffMinutes = Math.floor(diffSeconds / 60);
    const remainderSeconds = diffSeconds % 60;
    if (remainderSeconds >= 35) {
      diffMinutes += 1;
    }
    const sessionHours = diffMinutes / 60;

    const prevHoursRaw = parseFloat(record.working_hours);
    const safePrev = isFinite(prevHoursRaw) ? prevHoursRaw : 0;
    const workingHours = parseFloat((safePrev + sessionHours).toFixed(8));

    // One engine decides this, the same one the reports and the "update older
    // entries" sweep use. Three separate implementations of "was this a full
    // day" is how the calendar and the report come to disagree.
    //
    // Days before the effective date keep the old rule, so switching the policy
    // on cannot change how this afternoon is judged against a month that has
    // already been reported.
    let status = record.status;
    const ruleLive = !ruleCfg.ruleEffectiveFrom || today >= ruleCfg.ruleEffectiveFrom;
    if (isFinite(workingHours) && record.status !== 'on_duty') {
      if (ruleLive) {
        status = classifyDay({
          workedHours: workingHours,
          hasPunch: true,
          leavePortion: Number(dayFacts.leave_portion) || 0,
          permissionHours: Number(dayFacts.permission_hours) || 0,
          onDuty: dayFacts.on_duty === true,
          lateMinutes: Number(record.late_minutes) || 0,
          graceMinutes: Number(dayFacts.grace) || 0,
          cfg: ruleCfg,
          shiftHours: dayFacts.shift_hours === null || dayFacts.shift_hours === undefined
            ? null : Number(dayFacts.shift_hours),
        }).status;
      } else {
        const legacy = await pool.query('SELECT half_day_hours, full_day_hours FROM settings LIMIT 1');
        const halfDayHours = parseFloat(legacy.rows[0]?.half_day_hours) || 4;
        const fullDayHours = parseFloat(legacy.rows[0]?.full_day_hours) || 7.5;
        if (workingHours < halfDayHours) status = 'absent';
        else if (workingHours < fullDayHours) status = 'half-day';
        else status = record.late_minutes > 0 ? 'late' : 'present';
      }
    }

    // Race-safe: only write check_out if it's still NULL. Two concurrent
    // checkout requests both passed the SELECT-and-400 guard above; one
    // will succeed and one will return a 409 instead of double-writing
    // working_hours (which used to overstate the day).
    const up = await pool.query(
      `UPDATE attendance
       SET check_out=$1, check_out_location=$2, check_out_latitude=$3, check_out_longitude=$4,
           working_hours=$5, status=$6, updated_at=NOW()
       WHERE id=$7 AND check_out IS NULL
       RETURNING id as "_id", check_in as "checkIn", check_out as "checkOut",
                 working_hours as "workingHours", status, late_minutes as "lateMinutes"`,
      [now, location, latitude||null, longitude||null, workingHours, status, record.id]
    );
    if (up.rows.length === 0) {
      return res.status(409).json({ success: false, message: 'Already checked out' });
    }

    // The shift end is resolved inside the alert rather than fetched here — the
    // checkout handler should not grow a join to satisfy a switch that is off
    // by default.
    attendanceAlerts.fire('early_check_out', {
      employeeId: req.user._id, date: today, checkOutAt: now,
    });

    // Update the open session with checkout time and hours (soft-fail)
    try {
      await pool.query(
        `UPDATE attendance_sessions SET check_out = $1, session_hours = $2
         WHERE id = (SELECT id FROM attendance_sessions WHERE attendance_id = $3 AND check_out IS NULL ORDER BY check_in DESC LIMIT 1)`,
        [now, sessionHours, up.rows[0]._id]
      );
    } catch (err) {
      logger.error({ err: err.message, attendanceId: up.rows[0]._id }, '[attendance] session checkout update failed');
    }

    res.json({ success: true, data: up.rows[0], message: 'Checked out successfully' });

    // ── Feed Entry — fire after response ──
    setImmediate(async () => {
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
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  }
});

// ── PATCH location (background GPS update after fast check-in/out) ───────────
// The frontend fires check-in/out immediately with null coords, then patches
// the location once GPS resolves (~2-5s later) so the UI never waits for GPS.
router.patch('/location', async (req, res) => {
  try {
    const { type, latitude, longitude } = req.body;
    if (!latitude || !longitude || !['checkin', 'checkout'].includes(type)) {
      return res.status(400).json({ success: false });
    }
    const today = todayStr();
    const locLabel = `GPS (${parseFloat(latitude).toFixed(4)}, ${parseFloat(longitude).toFixed(4)})`;
    if (type === 'checkin') {
      await pool.query(
        `UPDATE attendance SET check_in_location=$1, check_in_latitude=$2, check_in_longitude=$3, updated_at=NOW()
         WHERE employee_id=$4 AND date=$5::date`,
        [locLabel, latitude, longitude, req.user._id, today]
      );
    } else {
      await pool.query(
        `UPDATE attendance SET check_out_location=$1, check_out_latitude=$2, check_out_longitude=$3, updated_at=NOW()
         WHERE employee_id=$4 AND date=$5::date`,
        [locLabel, latitude, longitude, req.user._id, today]
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
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

    // Read the org timezone from settings (defaults to DEFAULT_TZ) so the
    // SQL EXTRACT below returns the wall-clock time the employee actually
    // saw when they checked in, not whatever timezone the backend container
    // happens to be running in. Without this, a UTC server treats a 10:17
    // IST check-in as 04:47 and computes negative lateness → "Late by"
    // never renders for legitimately-late rows.
    const [attRes, shiftRes, sRes] = await Promise.all([
      pool.query(
        `SELECT id as "_id", date, check_in as "checkIn", check_out as "checkOut",
                working_hours as "workingHours", status,
                late_minutes as "lateMinutes",
                check_in_location as "checkInLocation",
                -- Compute minutes-past-midnight in IST (default; overridden
                -- below if settings.timezone differs). PG's AT TIME ZONE on
                -- a TIMESTAMPTZ converts to that zone's wall clock.
                -- check_in is a plain TIMESTAMP storing the UTC wall-clock
                -- (Node sends NOW() as TIMESTAMPTZ, PG drops the TZ on insert
                -- into a TIMESTAMP column using the session TZ — UTC in
                -- Docker). So we first tag it AS UTC, then convert TO the
                -- org timezone. A single AT TIME ZONE on a TIMESTAMP runs
                -- the conversion the WRONG way (treats the value as being
                -- in that zone, converts to UTC) — that's the bug that
                -- showed "Late by 13:47" for a real 47-min lateness.
                CASE WHEN check_in IS NULL THEN NULL ELSE
                  (EXTRACT(HOUR   FROM check_in AT TIME ZONE 'UTC' AT TIME ZONE COALESCE($4::text, '${DEFAULT_TZ}')) * 60 +
                   EXTRACT(MINUTE FROM check_in AT TIME ZONE 'UTC' AT TIME ZONE COALESCE($4::text, '${DEFAULT_TZ}')))::int
                END AS "checkInMins"
           FROM attendance
          WHERE employee_id=$1 AND date>=$2::date AND date<=$3::date
          ORDER BY date ASC`,
        [req.user._id, start, end, null]
      ),
      pool.query(
        `SELECT s.start_time
           FROM employees e LEFT JOIN shifts s ON s.id = e.shift_id
          WHERE e.id = $1`,
        [req.user._id]
      ),
      pool.query(`SELECT late_after_minutes, timezone FROM settings LIMIT 1`),
    ]);

    const tz         = sRes.rows[0]?.timezone || DEFAULT_TZ;
    const shiftStart = shiftRes.rows[0]?.start_time || null;
    const lateAfter  = sRes.rows[0]?.late_after_minutes || 570; // 09:30 AM default

    const shiftStartMins = shiftStart
      ? (() => { const [h, mi] = String(shiftStart).split(':').map(Number); return h * 60 + (mi || 0); })()
      : lateAfter;

    // Re-run the same query with the resolved tz so EXTRACT uses the org's
    // configured timezone instead of the default (only matters for orgs
    // that override the default; the extra round-trip cost is negligible).
    let rows = attRes.rows;
    if (tz !== DEFAULT_TZ) {
      const r2 = await pool.query(
        `SELECT id as "_id", date, check_in as "checkIn", check_out as "checkOut",
                working_hours as "workingHours", status,
                late_minutes as "lateMinutes",
                check_in_location as "checkInLocation",
                CASE WHEN check_in IS NULL THEN NULL ELSE
                  (EXTRACT(HOUR   FROM check_in AT TIME ZONE $4::text) * 60 +
                   EXTRACT(MINUTE FROM check_in AT TIME ZONE $4::text))::int
                END AS "checkInMins"
           FROM attendance
          WHERE employee_id=$1 AND date>=$2::date AND date<=$3::date
          ORDER BY date ASC`,
        [req.user._id, start, end, tz]
      );
      rows = r2.rows;
    }

    // Fetch sessions for each attendance record in the date range
    const sessionsByAtt = {};
    try {
      const sessRes = await pool.query(
        `SELECT attendance_id, id, check_in as "checkIn", check_out as "checkOut", session_hours as "sessionHours"
         FROM attendance_sessions WHERE employee_id = $1 AND date >= $2 AND date <= $3 ORDER BY check_in ASC`,
        [req.user._id, start, end]
      );
      sessRes.rows.forEach(s => {
        if (!sessionsByAtt[s.attendance_id]) sessionsByAtt[s.attendance_id] = [];
        const { attendance_id, ...sData } = s;
        sessionsByAtt[s.attendance_id].push(sData);
      });
    } catch (err) {
      logger.error({ err: err.message, employeeId: req.user._id }, '[attendance] sessions range query failed');
    }

    const mapped = rows.map(r => {
      // Always compute lateness from the SQL-extracted check-in minutes
      // (timezone-correct). Take the max of stored vs computed so we never
      // under-report, but the SQL value is the canonical one.
      let computed = 0;
      if (r.checkInMins != null) {
        const diff = r.checkInMins - shiftStartMins;
        if (diff > 0) computed = diff;
      }
      const lateMinutes = Math.max(Number(r.lateMinutes) || 0, computed);
      const { checkInMins, ...rest } = r; // drop the helper column from response
      return {
        ...rest,
        workingHours: Number(rest.workingHours) || 0,
        lateMinutes,
        sessions: sessionsByAtt[r._id] || [],
      };
    });

    res.json({ success: true, data: mapped });
  } catch (err) {
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  }
});

// ── GET team attendance ───────────────────────────────────────────────────────
router.get('/team', authorize('admin', 'director', 'hr_admin', 'manager', 'team_incharge'), async (req, res) => {
  try {
    const { date, department, employeeId } = req.query;
    const targetDate = date || todayStr();

    let empQuery = 'WHERE e.status = \'active\'';
    let empParams = [];
    let empIdx = 1;

    if (department) { empQuery += ` AND e.department = $${empIdx++}`; empParams.push(department); }
    if (['manager', 'team_incharge'].includes(req.user.role)) { empQuery += ` AND e.reporting_manager_id = $${empIdx++}`; empParams.push(req.user._id); }

    const [employeesRes, weekend] = await Promise.all([
      pool.query(
        `SELECT e.id as "_id", e.first_name as "firstName", e.last_name as "lastName",
         e.department, e.employee_id as "employeeId", e.designation, e.photo_url as "photoUrl",
         e.phone,
         json_build_object('name', s.name, 'start_time', s.start_time, 'end_time', s.end_time) as shift
         FROM employees e
         LEFT JOIN shifts s ON e.shift_id = s.id
         ${empQuery}`,
        empParams
      ),
      loadWeekendResolver(),
    ]);

    // Same weekend determination as /summary — org-wide rule, so one flag
    // covers the whole team view rather than a per-employee lookup. The
    // resolver prefers weekend_rules and falls back to the work calendar's
    // work week, which is Mon-Sat here rather than the old hardcoded Mon-Fri.
    const isWeekendDay = weekend.isWeekend(new Date(targetDate));

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

    res.json({ success: true, data: mapped, employees: employeesRes.rows, isWeekend: isWeekendDay });
  } catch (err) {
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
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

    const empId = isFullAccess(req.user.role) && employeeId ? employeeId : req.user._id;

    // Pull attendance + holidays + settings + weekend_rules in parallel.
    // settings.working_days is the simplest weekend source; if weekend_rules
    // is populated we prefer that (richer recurrence patterns).
    const [attRes, hRes, weekend, leavesRes] = await Promise.all([
      pool.query(
        'SELECT date, status, working_hours, late_minutes, check_in, check_out FROM attendance WHERE employee_id=$1 AND date>=$2::date AND date<=$3::date',
        [empId, start, end]
      ),
      pool.query(
        `SELECT date FROM holidays WHERE date >= $1::date AND date <= $2::date`,
        [start, end]
      ),
      loadWeekendResolver(),
      // Approved leaves overlapping the range, clipped to it and prorated the
      // same way payroll's lopDaysForRange does — a leave that only partially
      // falls inside [start,end] shouldn't count its full total_days here.
      pool.query(
        `SELECT l.leave_type,
                COALESCE(SUM(
                  ROUND(
                    l.total_days::numeric *
                    (LEAST(l.end_date, $3::date) - GREATEST(l.start_date, $2::date) + 1.0) /
                    NULLIF((l.end_date - l.start_date + 1)::numeric, 0)
                  , 2)
                ), 0) AS days
           FROM leaves l
          WHERE l.employee_id = $1
            AND l.status = 'approved'
            AND l.leave_type != 'permission'
            AND l.start_date <= $3::date AND l.end_date >= $2::date
          GROUP BY l.leave_type`,
        [empId, start, end]
      ),
    ]);

    // weekend_rules takes precedence; with none configured this falls back to
    // the work calendar's work week rather than a hardcoded Mon-Fri, which
    // was counting every Saturday as a weekend in a Mon-Sat organisation.
    const isWeekend = d => weekend.isWeekend(d);

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

    // Paid vs unpaid leave days come from the leaves table directly — nothing
    // ever writes status='leave' into the attendance table on approval, so
    // deriving these from attendance rows would always read zero.
    let paidLeaveDays = 0, unpaidLeaveDays = 0;
    leavesRes.rows.forEach(r => {
      const days = parseFloat(r.days) || 0;
      if (r.leave_type === 'unpaid') unpaidLeaveDays += days;
      else paidLeaveDays += days;
    });

    const summary = {
      present: 0, absent: 0, late: 0, halfDay: 0, leave: paidLeaveDays, unpaid: unpaidLeaveDays,
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
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
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
    const empId = isFullAccess(req.user.role) && employeeId ? employeeId : req.user._id;

    const r = await pool.query(
      `SELECT e.employee_id AS "employeeId",
              e.first_name || ' ' || COALESCE(e.last_name,'') AS name,
              a.date, a.check_in AS "checkIn", a.check_out AS "checkOut",
              a.working_hours AS "workingHours", a.status,
              s.name AS "shiftName", s.start_time AS "shiftStart", s.end_time AS "shiftEnd",
              a.late_minutes AS "lateMinutes", a.notes
         FROM attendance a
         JOIN employees e ON e.id = a.employee_id
    -- The shift stamped on the row when it was created, falling back to the
    -- employee's current one for rows written before stamping existed. Reading
    -- e.shift_id alone rewrote history: move someone to a new shift and every
    -- past report showed them against hours they were never on.
    LEFT JOIN shifts s    ON s.id = COALESCE(a.shift_id, e.shift_id)
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
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  }
});

// ── GET holidays via attendance route (alias for leave summary) ───────────────
router.get('/holidays', async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    // `is_optional` was selected here and the column has never existed, so this
    // route answered 500 to every request it ever served. Optionality lives in
    // `type`: a restricted holiday is the one an employee may choose to take.
    const r = await pool.query(
      `SELECT id as "_id", name, date, description, type,
              (type = 'restricted') AS "isOptional"
       FROM holidays
       WHERE EXTRACT(YEAR FROM date) = $1
       ORDER BY date ASC`,
      [year]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    // Logged, not just swallowed. The generic reply with no log is why a
    // permanently broken query went unnoticed.
    logger.error({ err: err.message }, '[attendance] holidays list failed');
    res.status(500).json({ success: false, message: 'An internal server error occurred' });
  }
});

// ── Attendance location logs ────────────────────────────────────────────────
// Additive history of where each check-in / check-out happened. POSTed by the
// client right after a successful check-in/out (never blocks that flow), and
// listed back on the Location page. The existing check-in/out endpoints above
// are untouched.

// Log a captured location for the signed-in user.
router.post('/location', async (req, res) => {
  try {
    const { type, latitude, longitude, accuracy, location, permissionStatus } = req.body;
    if (!['checkin', 'checkout'].includes(type)) {
      return res.status(400).json({ success: false, message: 'Invalid type — use checkin or checkout' });
    }
    const r = await pool.query(
      `INSERT INTO attendance_location_logs
         (employee_id, type, latitude, longitude, accuracy, location_label, permission_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [req.user._id, type,
       latitude ?? null, longitude ?? null, accuracy ?? null,
       location || null, permissionStatus || null]
    );
    res.json({ success: true, id: r.rows[0].id });
  } catch (err) {
    logger.error({ err: err.message }, '[attendance] location log failed');
    res.status(500).json({ success: false, message: 'Failed to log location' });
  }
});

// Location history. Scope: HR / Super Admin see everyone (optionally filtered by
// employeeId); Employees and Team Leads see only their own records.
router.get('/location', async (req, res) => {
  try {
    const { employeeId, startDate, endDate, type } = req.query;
    const full = isFullAccess(req.user.role);
    const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, parseInt(req.query.limit, 10) || 30);
    const offset = (page - 1) * limit;

    const where = [];
    const params = [];
    let idx = 1;

    if (full) {
      if (employeeId) { where.push(`l.employee_id = $${idx++}`); params.push(employeeId); }
    } else {
      where.push(`l.employee_id = $${idx++}`); params.push(req.user._id);
    }
    if (type && ['checkin', 'checkout'].includes(type)) { where.push(`l.type = $${idx++}`); params.push(type); }
    if (startDate) { where.push(`l.captured_at >= $${idx++}::date`); params.push(startDate); }
    if (endDate)   { where.push(`l.captured_at < ($${idx++}::date + INTERVAL '1 day')`); params.push(endDate); }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const totalRes = await pool.query(
      `SELECT COUNT(*)::int AS n FROM attendance_location_logs l ${whereSql}`, params
    );
    const total = totalRes.rows[0].n;

    const dataRes = await pool.query(
      `SELECT l.id as "_id", l.type, l.latitude, l.longitude, l.accuracy,
              l.location_label as "locationLabel", l.permission_status as "permissionStatus",
              l.captured_at as "capturedAt",
              json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name,
                'department', e.department, 'employeeId', e.employee_id) as employee
         FROM attendance_location_logs l
         JOIN employees e ON l.employee_id = e.id
         ${whereSql}
         ORDER BY l.captured_at DESC
         LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset]
    );

    // Work Mode keyword — graceful fallback if the column hasn't been migrated yet.
    let officeAreaName = null;
    try {
      const areaRes = await pool.query('SELECT office_area_name FROM settings LIMIT 1');
      officeAreaName = areaRes.rows[0]?.office_area_name || null;
    } catch (_) { /* column not yet migrated — work mode shows "—" until migration runs */ }

    res.json({ success: true, data: dataRes.rows, total, page, limit, scope: full ? 'all' : 'self', officeAreaName });
  } catch (err) {
    logger.error({ err: err.message }, '[attendance] location history failed');
    res.status(500).json({ success: false, message: 'Failed to load location history' });
  }
});

// ── POST send check-out reminder email ──────────────────────────────────────────
// Endpoint for HR/Admin to send check-out reminders to employee(s).
// Used to remind employees to log out of Zoho and update daily production report.
router.post('/reminder/checkout', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  try {
    const { employeeIds } = req.body;
    if (!employeeIds || !Array.isArray(employeeIds) || employeeIds.length === 0) {
      return res.status(400).json({ success: false, message: 'employeeIds array is required' });
    }

    const result = await pool.query(
      `SELECT id, email, first_name AS "firstName", last_name AS "lastName"
       FROM employees
       WHERE id = ANY($1::uuid[]) AND email IS NOT NULL AND status = 'active' AND LOWER(email) != 'vellayan@altiusnxt.com'`,
      [employeeIds]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid employee emails found' });
    }

    const successCount = await Promise.all(
      result.rows.map(emp =>
        sendCheckOutReminderEmail({
          to: emp.email,
          employeeName: `${emp.firstName || ''} ${emp.lastName || ''}`.trim(),
        })
          .then(() => 1)
          .catch(err => {
            logger.warn({ err: err.message, employeeId: emp.id }, '[attendance] checkout reminder email failed');
            return 0;
          })
      )
    ).then(counts => counts.reduce((a, b) => a + b, 0));

    res.json({
      success: true,
      message: `Check-out reminders sent to ${successCount} of ${result.rows.length} employee(s)`,
      sent: successCount,
      total: result.rows.length,
    });
  } catch (err) {
    logger.error({ err: err.message }, '[attendance] checkout reminder endpoint failed');
    res.status(500).json({ success: false, message: 'Failed to send reminders' });
  }
});

// ── POST send checkout reminder to self ──────────────────────────────────────────
// Employee can request their own check-out reminder email.
router.post('/reminder/checkout-self', async (req, res) => {
  try {
    const empRes = await pool.query(
      `SELECT email, first_name AS "firstName", last_name AS "lastName" FROM employees WHERE id = $1`,
      [req.user._id]
    );
    if (!empRes.rows[0]?.email) {
      return res.status(400).json({ success: false, message: 'No email address on file' });
    }

    const emp = empRes.rows[0];
    await sendCheckOutReminderEmail({
      to: emp.email,
      employeeName: `${emp.firstName || ''} ${emp.lastName || ''}`.trim(),
    });

    res.json({ success: true, message: 'Check-out reminder email sent' });
  } catch (err) {
    logger.error({ err: err.message }, '[attendance] self checkout reminder failed');
    res.status(500).json({ success: false, message: 'Failed to send reminder' });
  }
});

module.exports = router;
