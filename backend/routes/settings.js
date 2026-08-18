const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { serverError } = require('../utils/serverError');
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
  full_day_hours as "fullDayHours",
  comp_off_expiry_months as "compOffExpiryMonths",
  allow_remote_check_in as "allowRemoteCheckIn",
  leave_policy as "leavePolicy",
  leave_accrual_enabled as "leaveAccrualEnabled",
  casual_accrual_per_month as "casualAccrualPerMonth",
  sick_accrual_per_month as "sickAccrualPerMonth",
  earned_accrual_per_month as "earnedAccrualPerMonth",
  office_latitude as "officeLatitude",
  office_longitude as "officeLongitude",
  gps_radius_meters as "gpsRadiusMeters",
  require_gps as "requireGps",
  require_manager_approval_before_lock as "requireManagerApprovalBeforeLock",
  mfa_required_roles as "mfaRequiredRoles"
`;

router.get('/', async (req, res) => {
  try {
    let result = await pool.query(`SELECT ${SELECT_COLS} FROM settings LIMIT 1`);
    if (result.rows.length === 0) {
      await pool.query('INSERT INTO settings DEFAULT VALUES');
      result = await pool.query(`SELECT ${SELECT_COLS} FROM settings LIMIT 1`);
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { serverError(res, err); }
});

router.put('/', authorize('admin', 'director', 'hr_admin'), async (req, res) => {
  try {
    const {
      companyName, companyEmail, timezone,
      workStartTime, workEndTime, workingDays,
      lateAfterMinutes, halfDayHours, fullDayHours, allowRemoteCheckIn,
      compOffExpiryMonths,
      leavePolicy,
      leaveAccrualEnabled, casualAccrualPerMonth, sickAccrualPerMonth, earnedAccrualPerMonth,
      officeLatitude, officeLongitude, gpsRadiusMeters, requireGps,
      requireManagerApprovalBeforeLock,
      mfaRequiredRoles
    } = req.body;

    // Whitelist role strings — never trust caller-supplied JSONB.
    const ALLOWED_ROLES = new Set(['admin', 'manager', 'director', 'team_member']);
    const safeMfaRoles = Array.isArray(mfaRequiredRoles)
      ? mfaRequiredRoles.filter(r => typeof r === 'string' && ALLOWED_ROLES.has(r))
      : undefined;

    let result = await pool.query('SELECT id, half_day_hours, full_day_hours FROM settings LIMIT 1');
    if (result.rows.length === 0) {
      await pool.query('INSERT INTO settings DEFAULT VALUES');
      result = await pool.query('SELECT id, half_day_hours, full_day_hours FROM settings LIMIT 1');
    }
    const id = result.rows[0].id;

    // The two day-length thresholds are one rule between them: below half is
    // absent, below full is half-day, at or above full is present. Crossing
    // them over would make 'half-day' unreachable, so it is rejected here
    // rather than surfacing as a raw constraint violation.
    const effHalf = halfDayHours === undefined ? parseFloat(result.rows[0].half_day_hours) : Number(halfDayHours);
    const effFull = fullDayHours === undefined ? parseFloat(result.rows[0].full_day_hours) : Number(fullDayHours);
    if (Number.isNaN(effHalf) || Number.isNaN(effFull) || effHalf < 0) {
      return res.status(400).json({ success: false, message: 'Day-length thresholds must be numbers' });
    }
    if (effFull < effHalf) {
      return res.status(400).json({ success: false, message: 'Full day hours cannot be less than half day hours' });
    }
    if (compOffExpiryMonths !== undefined) {
      const m = Number(compOffExpiryMonths);
      if (!Number.isInteger(m) || m < 1 || m > 60) {
        return res.status(400).json({ success: false, message: 'Comp-off validity must be a whole number of months between 1 and 60' });
      }
    }

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
        require_manager_approval_before_lock = COALESCE($19, require_manager_approval_before_lock),
        mfa_required_roles = COALESCE($20, mfa_required_roles),
        full_day_hours = COALESCE($22, full_day_hours),
        comp_off_expiry_months = COALESCE($23, comp_off_expiry_months),
        updated_at = NOW()
      WHERE id = $21
      RETURNING ${SELECT_COLS}
    `, [
      companyName, companyEmail, timezone,
      workStartTime, workEndTime,
      workingDays ? JSON.stringify(workingDays) : null,
      lateAfterMinutes, halfDayHours, allowRemoteCheckIn,
      leavePolicy ? JSON.stringify(leavePolicy) : null,
      leaveAccrualEnabled, casualAccrualPerMonth, sickAccrualPerMonth, earnedAccrualPerMonth,
      officeLatitude ?? null, officeLongitude ?? null, gpsRadiusMeters, requireGps,
      requireManagerApprovalBeforeLock === undefined ? null : !!requireManagerApprovalBeforeLock,
      safeMfaRoles ? JSON.stringify(safeMfaRoles) : null,
      id,
      fullDayHours === undefined ? null : fullDayHours,
      compOffExpiryMonths === undefined ? null : compOffExpiryMonths,
    ]);

    await logAudit(req, {
      action: 'UPDATE',
      resource: 'Settings',
      resourceId: id,
      changes: req.body
    });

    res.json({ success: true, data: up.rows[0], message: 'Settings saved' });
  } catch (err) { serverError(res, err); }
});

module.exports = router;
