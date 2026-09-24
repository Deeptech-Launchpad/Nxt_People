/* ── The two Zoho "on save" checkboxes: notify via feeds, reprocess leave ────
 *  Both are one-time actions triggered by the admin ticking a box on the
 *  Add/Edit Holiday popup and hitting Save — not persisted settings, so they
 *  are read off req.body and never written back to the holidays row.
 * ────────────────────────────────────────────────────────────────────────── */
const logger = require('../logger');
const { holidayAppliesTo, countWorkingDays } = require('./workingDays');
const { reclassifyRange } = require('./attendanceReprocess');
const { debitOnApproval, refundApproved } = require('./leaveBalance');

/** Active employees this holiday's location/shift scope actually reaches. */
async function scopedActiveEmployees(db, holiday) {
  const r = await db.query(
    `SELECT id, work_location_id AS "workLocationId", shift_id AS "shiftId"
       FROM employees WHERE status = 'active' AND deleted_at IS NULL`
  );
  return r.rows.filter(emp => holidayAppliesTo(holiday, emp));
}

/** Posts one feed entry per in-scope active employee. Returns how many. */
async function notifyHolidayViaFeeds(db, holiday) {
  const { createFeedEntry } = require('../routes/feeds');
  const emps = await scopedActiveEmployees(db, holiday);
  const label = holiday.type === 'working_day' ? 'Working Day' : 'Holiday';
  const title = `${label}: ${holiday.name}`;
  const body = `${holiday.name} on ${new Date(`${holiday.date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`;
  for (const emp of emps) {
    await createFeedEntry(emp.id, 'announcement', title, body, '📅');
  }
  return emps.length;
}

/* Recompute every pending/approved leave application that overlaps this
 * holiday's date, so a holiday added (or edited) after the fact stops being
 * silently charged against someone's balance — mirrors what leave
 * cancellation/extension already does when a range's day count changes. */
async function reprocessLeaveForHoliday(db, holiday) {
  const affected = await db.query(
    `SELECT id, employee_id AS "employeeId", leave_type AS "leaveType",
            start_date AS "startDate", end_date AS "endDate",
            total_days AS "totalDays", status, balance_source AS "balanceSource"
       FROM leaves
      WHERE leave_type <> 'permission'
        AND status IN ('pending', 'approved')
        AND $1::date BETWEEN start_date AND end_date`,
    [holiday.date]
  );

  let recomputed = 0;
  for (const leave of affected.rows) {
    const from = new Date(leave.startDate).toLocaleDateString('en-CA');
    const to = new Date(leave.endDate).toLocaleDateString('en-CA');
    const newDays = await countWorkingDays(from, to);
    const oldDays = parseFloat(leave.totalDays) || 0;
    if (newDays === oldDays) continue;

    await db.query('UPDATE leaves SET total_days = $1, updated_at = NOW() WHERE id = $2', [newDays, leave.id]);
    recomputed++;

    if (leave.status === 'approved' && leave.leaveType !== 'unpaid') {
      const year = new Date(leave.startDate).getFullYear();
      const delta = newDays - oldDays;
      try {
        if (delta > 0) {
          await debitOnApproval(db, { employeeId: leave.employeeId, leaveType: leave.leaveType, days: delta, year });
        } else {
          await refundApproved(db, {
            employeeId: leave.employeeId, leaveType: leave.leaveType,
            days: -delta, year, store: leave.balanceSource,
          });
        }
      } catch (err) {
        logger.error({ err: err.message, leaveId: leave.id }, '[holidayActions] balance adjustment failed during reprocess');
      }
    }

    try {
      const s = await db.query(`SELECT attendance_policy_config AS policy FROM settings LIMIT 1`);
      await reclassifyRange(db, {
        employeeId: leave.employeeId, from: holiday.date, to: holiday.date,
        cfg: s.rows[0]?.policy || {},
      });
    } catch (err) {
      logger.warn({ err: err.message, leaveId: leave.id }, '[holidayActions] attendance reclassify failed during reprocess');
    }
  }
  return { scanned: affected.rows.length, recomputed };
}

module.exports = { scopedActiveEmployees, notifyHolidayViaFeeds, reprocessLeaveForHoliday };
