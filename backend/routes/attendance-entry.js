/* ── Editing somebody else's attendance entry ──────────────────────────────
 *  Attendance → Configuration → Check-in/Check-out already offered "allow
 *  editing a reportee's entries", and a box for who to notify when it happens.
 *  Neither did anything, because there was nowhere to do the editing.
 *
 *  This is that place. It is deliberately narrow:
 *
 *    Only the punches move. working_hours and status are recomputed from them
 *    by the same engine check-out uses, so an edited day and a punched day of
 *    the same length are called the same thing.
 *
 *    A manager may only touch their own reportees. Full-access roles may touch
 *    anyone. The scoping is on the write, not only on the screen.
 *
 *    The setting gates it. With "allow editing" off the route refuses, so a
 *    tab left open cannot still edit.
 *
 *    Every edit is written to the audit trail with the old and new times, and
 *    the employee is told in the app. Somebody changing your recorded hours
 *    without your knowledge is the thing this feature could most easily
 *    become.
 * ────────────────────────────────────────────────────────────────────────── */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { isFullAccess } = require('../utils/roles');
const { logAudit } = require('../utils/audit');
const { classifyDay } = require('../utils/attendanceRule');
const { createNotification } = require('./notifications');
const attendanceConfig = require('../utils/attendanceConfig');
const { sendCheckOutReminderEmail } = require('../utils/mailer');
const { DEFAULT_TZ } = require('../utils/timezone');
const logger = require('../logger');

router.use(protect);

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// GET /api/attendance-entry/:employeeId/:date — what is currently recorded.
router.get('/:employeeId/:date', authorize('admin', 'director', 'hr_admin', 'manager', 'team_incharge'),
  async (req, res) => {
    try {
      const { employeeId, date } = req.params;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ success: false, message: 'Date must be YYYY-MM-DD' });
      }
      const emp = await pool.query(
        `SELECT id, employee_id AS code, TRIM(CONCAT(first_name,' ',last_name)) AS name,
                reporting_manager_id
           FROM employees WHERE id = $1 AND deleted_at IS NULL`, [employeeId]);
      if (!emp.rows[0]) return res.status(404).json({ success: false, message: 'Employee not found' });
      if (!isFullAccess(req.user.role)
        && String(emp.rows[0].reporting_manager_id) !== String(req.user._id)) {
        return res.status(403).json({ success: false, message: 'They do not report to you' });
      }

      const r = await pool.query(
        `SELECT to_char(check_in  AT TIME ZONE 'UTC' AT TIME ZONE $3, 'HH24:MI') AS "checkIn",
                to_char(check_out AT TIME ZONE 'UTC' AT TIME ZONE $3, 'HH24:MI') AS "checkOut",
                working_hours AS "workingHours", status
           FROM attendance WHERE employee_id = $1 AND date = $2::date`,
        [employeeId, date, DEFAULT_TZ]);

      res.json({
        success: true,
        data: {
          employee: { _id: emp.rows[0].id, code: emp.rows[0].code, name: emp.rows[0].name },
          date,
          entry: r.rows[0] || null,
          canEdit: (await attendanceConfig.section('checkin')).allowEditReporteeEntries === true,
        },
      });
    } catch (err) {
      res.status(500).json({ success: false, message: 'An internal server error occurred' });
    }
  });

// PUT /api/attendance-entry/:employeeId/:date — set the punches for a day.
router.put('/:employeeId/:date', authorize('admin', 'director', 'hr_admin', 'manager', 'team_incharge'),
  async (req, res) => {
    const client = await pool.connect();
    try {
      const { employeeId, date } = req.params;
      const { checkIn, checkOut, reason } = req.body || {};

      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ success: false, message: 'Date must be YYYY-MM-DD' });
      }
      if (checkIn && !HHMM.test(checkIn)) {
        return res.status(400).json({ success: false, message: 'Check-in must be HH:MM' });
      }
      if (checkOut && !HHMM.test(checkOut)) {
        return res.status(400).json({ success: false, message: 'Check-out must be HH:MM' });
      }
      if (!checkIn && checkOut) {
        return res.status(400).json({ success: false, message: 'A check-out needs a check-in' });
      }
      if (checkIn && checkOut && checkOut <= checkIn) {
        return res.status(400).json({ success: false, message: 'Check-out must be after check-in' });
      }
      const today = new Date().toLocaleDateString('en-CA', { timeZone: DEFAULT_TZ });
      if (date > today) {
        return res.status(400).json({ success: false, message: 'Cannot record attendance for a future date' });
      }

      const cfg = await attendanceConfig.section('checkin');
      if (cfg.allowEditReporteeEntries !== true) {
        return res.status(403).json({
          success: false,
          message: "Editing a reportee's entries is switched off for this organization",
        });
      }

      const emp = await client.query(
        `SELECT id, employee_id AS code, TRIM(CONCAT(first_name,' ',last_name)) AS name,
                reporting_manager_id, employment_type
           FROM employees WHERE id = $1 AND deleted_at IS NULL`, [employeeId]);
      if (!emp.rows[0]) return res.status(404).json({ success: false, message: 'Employee not found' });
      const subject = emp.rows[0];

      if (String(subject.id) === String(req.user._id)) {
        return res.status(403).json({
          success: false,
          message: 'Use regularization to correct your own attendance',
        });
      }
      if (!isFullAccess(req.user.role)
        && String(subject.reporting_manager_id) !== String(req.user._id)) {
        return res.status(403).json({ success: false, message: 'They do not report to you' });
      }

      await client.query('BEGIN');

      // The punch columns hold a UTC wall clock in a timezone-free timestamp,
      // so the conversion has to happen in SQL. Formatting the JS Date in IST
      // instead reads 09:30 back as 04:00 — the same shift that put every
      // approved regularization five and a half hours out.
      const beforeRes = await client.query(
        `SELECT id, working_hours, status, late_minutes,
                to_char(check_in  AT TIME ZONE 'UTC' AT TIME ZONE $3, 'HH24:MI') AS ci,
                to_char(check_out AT TIME ZONE 'UTC' AT TIME ZONE $3, 'HH24:MI') AS co
           FROM attendance WHERE employee_id = $1 AND date = $2::date FOR UPDATE`,
        [employeeId, date, DEFAULT_TZ]);
      const before = beforeRes.rows[0] || null;

      // Everything else the day already had approved, so an edited day is
      // judged on the same facts a punched one is.
      const factsRes = await client.query(
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
                   FROM employees e LEFT JOIN shifts s ON s.id = e.shift_id WHERE e.id = $1) AS shift_hours,
                (SELECT COALESCE(s.grace_minutes, 15)
                   FROM employees e LEFT JOIN shifts s ON s.id = e.shift_id WHERE e.id = $1) AS grace,
                (SELECT COALESCE(s.start_time::text, '09:30:00')
                   FROM employees e LEFT JOIN shifts s ON s.id = e.shift_id WHERE e.id = $1) AS shift_start`,
        [employeeId, date]);
      const facts = factsRes.rows[0] || {};

      const policyRes = await client.query(
        `SELECT expected_hours_mode AS "expectedMode",
                expected_hours_per_day AS "expectedFullDay",
                expected_half_day_hours AS "expectedHalfDay",
                attendance_policy_config AS policy
           FROM settings LIMIT 1`);
      const pRow = policyRes.rows[0] || {};
      const ruleCfg = {
        ...(pRow.policy || {}),
        expectedMode: pRow.expectedMode || 'manual',
        expectedFullDay: Number(pRow.expectedFullDay ?? 8),
        expectedHalfDay: Number(pRow.expectedHalfDay ?? 4),
      };

      // Hours from the two times given, not accumulated: this is a correction
      // of the whole day, not another session added to it.
      let workingHours = null;
      let lateMinutes = 0;
      if (checkIn) {
        const [sh, sm] = String(facts.shift_start).split(':').map(Number);
        const [ih, im] = checkIn.split(':').map(Number);
        lateMinutes = Math.max(0, (ih * 60 + im) - (sh * 60 + (sm || 0)));
        if (checkOut) {
          const [oh, om] = checkOut.split(':').map(Number);
          workingHours = Math.round((((oh * 60 + om) - (ih * 60 + im)) / 60) * 100000000) / 100000000;
        }
      }

      let status = before?.status || 'absent';
      if (workingHours !== null) {
        const ruleLive = !ruleCfg.ruleEffectiveFrom || date >= ruleCfg.ruleEffectiveFrom;
        if (ruleLive) {
          status = classifyDay({
            workedHours: workingHours,
            hasPunch: true,
            leavePortion: Number(facts.leave_portion) || 0,
            permissionHours: Number(facts.permission_hours) || 0,
            onDuty: facts.on_duty === true,
            lateMinutes,
            graceMinutes: Number(facts.grace) || 0,
            cfg: ruleCfg,
            shiftHours: facts.shift_hours === null || facts.shift_hours === undefined
              ? null : Number(facts.shift_hours),
          }).status;
        } else {
          const legacy = await client.query('SELECT half_day_hours, full_day_hours FROM settings LIMIT 1');
          const half = parseFloat(legacy.rows[0]?.half_day_hours) || 4;
          const full = parseFloat(legacy.rows[0]?.full_day_hours) || 7.5;
          status = workingHours < half ? 'absent' : workingHours < full ? 'half-day'
            : (lateMinutes > 0 ? 'late' : 'present');
        }
      } else if (checkIn) {
        // Checked in and not out. Leave the day open rather than calling it.
        status = before?.status || 'present';
      }

      const upsert = await client.query(
        `INSERT INTO attendance (employee_id, date, check_in, check_out, working_hours, status, late_minutes)
         VALUES ($1, $2::date,
           CASE WHEN $3::text IS NULL THEN NULL
                ELSE (($2::date + $3::time) AT TIME ZONE $8 AT TIME ZONE 'UTC') END,
           CASE WHEN $4::text IS NULL THEN NULL
                ELSE (($2::date + $4::time) AT TIME ZONE $8 AT TIME ZONE 'UTC') END,
           $5, $6, $7)
         ON CONFLICT (employee_id, date) DO UPDATE
           SET check_in = EXCLUDED.check_in,
               check_out = EXCLUDED.check_out,
               working_hours = EXCLUDED.working_hours,
               status = EXCLUDED.status,
               late_minutes = EXCLUDED.late_minutes,
               updated_at = NOW()
         RETURNING id`,
        [employeeId, date, checkIn || null, checkOut || null,
         workingHours, status, lateMinutes, DEFAULT_TZ]);

      await client.query('COMMIT');

      const changes = [
        { field: 'checkIn', from: before?.ci ?? null, to: checkIn || null },
        { field: 'checkOut', from: before?.co ?? null, to: checkOut || null },
        { field: 'workingHours', from: before?.working_hours == null ? null : Number(before.working_hours), to: workingHours },
        { field: 'status', from: before?.status ?? null, to: status },
      ].filter(c => String(c.from ?? '') !== String(c.to ?? ''));

      await logAudit(req, {
        action: before ? 'UPDATE' : 'CREATE',
        resource: 'Attendance entry',
        resourceId: upsert.rows[0].id,
        changes: {
          employee: subject.code,
          date,
          reason: String(reason || '').trim() || null,
          summary: `${subject.code} on ${date}: ${changes.map(c => c.field).join(', ') || 'no change'}`,
          fields: changes,
        },
      });

      // The employee is told, always. This is their record, and an edit they
      // cannot see is the thing this feature could most easily become.
      if (changes.length) {
        const editor = [req.user.firstName, req.user.lastName].filter(Boolean).join(' ') || 'An administrator';
        const detail = checkIn
          ? `${checkIn}${checkOut ? `–${checkOut}` : ''}`
          : 'cleared';
        createNotification(
          employeeId,
          'attendance',
          'Your attendance was edited',
          `${editor} changed your ${date} entry to ${detail}.`,
          '/attendance/my'
        ).catch(() => {});
      }

      // And whoever the org nominated, if they nominated anyone. Off by
      // default, and it only ever goes to the one configured address.
      const notify = cfg.notifyOnReporteeEdit || {};
      if (changes.length && notify.enabled && notify.email) {
        sendCheckOutReminderEmail({
          to: notify.email,
          employeeName: subject.name,
          subject: `Attendance edited — ${subject.code} on ${date}`,
          body: `${[req.user.firstName, req.user.lastName].filter(Boolean).join(' ') || 'An administrator'} `
            + `edited the attendance entry for ${subject.name} (${subject.code}) on ${date}.\n\n`
            + changes.map(c => `  ${c.field}: ${c.from ?? '—'} → ${c.to ?? '—'}`).join('\n')
            + (reason ? `\n\nReason: ${String(reason).trim()}` : ''),
        }).catch(err => logger.warn({ err: err.message }, '[attendance-entry] notify email failed'));
      }

      res.json({
        success: true,
        message: changes.length ? 'Attendance entry updated' : 'Nothing changed',
        data: { date, checkIn: checkIn || null, checkOut: checkOut || null, workingHours, status, changes },
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      logger.error({ err: err.message }, '[attendance-entry] update failed');
      res.status(500).json({ success: false, message: 'An internal server error occurred' });
    } finally { client.release(); }
  });

module.exports = router;
