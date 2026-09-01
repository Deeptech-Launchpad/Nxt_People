/**
 * utils/attendanceImportClassify.js
 *
 * How an imported check-in/check-out pair is judged — present, late,
 * half-day, absent — for a specific employee on a specific date.
 *
 * A bulk import writing a bare check_in/check_out with no status, or a
 * hand-picked status divorced from the same rule everything else obeys, is
 * how an imported day and a punched day of identical length end up called
 * different things. This is the same classification regularization approval
 * applies when it patches attendance for a corrected day (routes/
 * regularizations.js) — the context-gathering is reproduced here rather than
 * imported from there, because that file's own approval flow is live and
 * tested and untouched by this feature; duplicating a well-understood block
 * is a smaller risk than restructuring it to be shared.
 */
const { classifyDay } = require('./attendanceRule');

/**
 * @returns {Promise<{workingHours: number|null, status: string, lateMinutes: number}>}
 */
async function classifyImportedDay(pool, employeeId, dateStr, checkInTime, checkOutTime) {
  const [settingsRes, shiftRes, policyRes] = await Promise.all([
    pool.query('SELECT half_day_hours, full_day_hours, late_after_minutes FROM settings LIMIT 1'),
    pool.query(
      'SELECT s.start_time, s.grace_minutes FROM employees e LEFT JOIN shifts s ON s.id = e.shift_id WHERE e.id = $1',
      [employeeId]
    ),
    pool.query(
      `SELECT expected_hours_mode AS "expectedMode",
              expected_hours_per_day AS "expectedFullDay",
              expected_half_day_hours AS "expectedHalfDay",
              attendance_policy_config AS policy
         FROM settings LIMIT 1`
    ),
  ]);

  const halfDayHours = parseFloat(settingsRes.rows[0]?.half_day_hours) || 4;
  const fullDayHours = parseFloat(settingsRes.rows[0]?.full_day_hours) || 7.5;
  const lateAfterMins = parseInt(settingsRes.rows[0]?.late_after_minutes, 10) || 570;
  const shiftStartRaw = shiftRes.rows[0]?.start_time || null;
  const graceMinutes = Number.isFinite(Number(shiftRes.rows[0]?.grace_minutes))
    ? Number(shiftRes.rows[0].grace_minutes) : 15;
  const shiftStartMins = shiftStartRaw
    ? (() => { const [h, m] = String(shiftStartRaw).split(':').map(Number); return h * 60 + (m || 0); })()
    : lateAfterMins;

  const pRow = policyRes.rows[0] || {};
  const ruleCfg = {
    ...(pRow.policy || {}),
    expectedMode: pRow.expectedMode || 'manual',
    expectedFullDay: Number(pRow.expectedFullDay ?? 8),
    expectedHalfDay: Number(pRow.expectedHalfDay ?? 4),
  };

  const factsRes = await pool.query(
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
              WHERE e.id = $1) AS shift_hours`,
    [employeeId, dateStr]
  );
  const dayFacts = factsRes.rows[0] || {};

  let workingHours = null;
  let status = 'present';
  let lateMinutes = 0;

  if (checkInTime) {
    const [ciH, ciM] = checkInTime.split(':').map(Number);
    const checkInMins = ciH * 60 + (ciM || 0);
    const minsLate = checkInMins - shiftStartMins;
    if (minsLate > 0) lateMinutes = minsLate;

    if (checkOutTime) {
      const ciDate = new Date(`${dateStr}T${checkInTime}`);
      const coDate = new Date(`${dateStr}T${checkOutTime}`);
      const diffMs = coDate - ciDate;
      if (diffMs > 0) {
        workingHours = parseFloat((diffMs / 3600000).toFixed(8));
        status = classifyDay({
          workedHours: workingHours,
          hasPunch: true,
          leavePortion: Number(dayFacts.leave_portion) || 0,
          permissionHours: Number(dayFacts.permission_hours) || 0,
          onDuty: dayFacts.on_duty === true,
          lateMinutes,
          graceMinutes,
          cfg: ruleCfg,
          shiftHours: dayFacts.shift_hours === null || dayFacts.shift_hours === undefined
            ? null : Number(dayFacts.shift_hours),
        }).status;
      }
    } else {
      status = (lateMinutes > graceMinutes) ? 'late' : 'present';
    }
  } else {
    status = 'absent';
  }

  return { workingHours, status, lateMinutes };
}

module.exports = { classifyImportedDay };
