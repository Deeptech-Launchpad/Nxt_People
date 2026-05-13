const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
router.use(protect);

const SELECT_COLS = `
  id as "_id",
  company_name as "companyName",
  company_email as "companyEmail",
  timezone,
  work_start_time as "workStartTime",
  work_end_time as "workEndTime",
  working_days as "workingDays",
  late_after_minutes as "lateAfterMinutes",
  half_day_hours as "halfDayHours",
  allow_remote_check_in as "allowRemoteCheckIn",
  leave_policy as "leavePolicy",
  leave_accrual_enabled as "leaveAccrualEnabled",
  casual_accrual_per_month as "casualAccrualPerMonth",
  sick_accrual_per_month as "sickAccrualPerMonth",
  earned_accrual_per_month as "earnedAccrualPerMonth",
  office_latitude as "officeLatitude",
  office_longitude as "officeLongitude",
  gps_radius_meters as "gpsRadiusMeters",
  require_gps as "requireGps"
`;

router.get('/', async (req, res) => {
  try {
    let result = await pool.query(`SELECT ${SELECT_COLS} FROM settings LIMIT 1`);
    if (result.rows.length === 0) {
      await pool.query('INSERT INTO settings DEFAULT VALUES');
      result = await pool.query(`SELECT ${SELECT_COLS} FROM settings LIMIT 1`);
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.put('/', authorize('admin'), async (req, res) => {
  try {
    const {
      companyName, companyEmail, timezone,
      workStartTime, workEndTime, workingDays,
      lateAfterMinutes, halfDayHours, allowRemoteCheckIn,
      leavePolicy,
      leaveAccrualEnabled, casualAccrualPerMonth, sickAccrualPerMonth, earnedAccrualPerMonth,
      officeLatitude, officeLongitude, gpsRadiusMeters, requireGps
    } = req.body;

    let result = await pool.query('SELECT id FROM settings LIMIT 1');
    if (result.rows.length === 0) {
      await pool.query('INSERT INTO settings DEFAULT VALUES');
      result = await pool.query('SELECT id FROM settings LIMIT 1');
    }
    const id = result.rows[0].id;

    const up = await pool.query(`
      UPDATE settings SET
        company_name = COALESCE($1, company_name),
        company_email = COALESCE($2, company_email),
        timezone = COALESCE($3, timezone),
        work_start_time = COALESCE($4, work_start_time),
        work_end_time = COALESCE($5, work_end_time),
        working_days = COALESCE($6, working_days),
        late_after_minutes = COALESCE($7, late_after_minutes),
        half_day_hours = COALESCE($8, half_day_hours),
        allow_remote_check_in = COALESCE($9, allow_remote_check_in),
        leave_policy = COALESCE($10, leave_policy),
        leave_accrual_enabled = COALESCE($11, leave_accrual_enabled),
        casual_accrual_per_month = COALESCE($12, casual_accrual_per_month),
        sick_accrual_per_month = COALESCE($13, sick_accrual_per_month),
        earned_accrual_per_month = COALESCE($14, earned_accrual_per_month),
        office_latitude = $15,
        office_longitude = $16,
        gps_radius_meters = COALESCE($17, gps_radius_meters),
        require_gps = COALESCE($18, require_gps),
        updated_at = NOW()
      WHERE id = $19
      RETURNING ${SELECT_COLS}
    `, [
      companyName, companyEmail, timezone,
      workStartTime, workEndTime,
      workingDays ? JSON.stringify(workingDays) : null,
      lateAfterMinutes, halfDayHours, allowRemoteCheckIn,
      leavePolicy ? JSON.stringify(leavePolicy) : null,
      leaveAccrualEnabled, casualAccrualPerMonth, sickAccrualPerMonth, earnedAccrualPerMonth,
      officeLatitude ?? null, officeLongitude ?? null, gpsRadiusMeters, requireGps,
      id
    ]);

    await logAudit(req, {
      action: 'UPDATE',
      resource: 'Settings',
      resourceId: id,
      changes: req.body
    });

    res.json({ success: true, data: up.rows[0], message: 'Settings saved' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
