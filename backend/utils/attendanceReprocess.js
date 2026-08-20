/* ── Re-apply the attendance policy to days already recorded ───────────────
 *  A day's status is written once, at check-out, under whatever policy was in
 *  force that afternoon. Changing the policy afterwards therefore leaves every
 *  older day saying what the old rule said — which is why the reference puts an
 *  "Update older attendance entries" button on the policy screen rather than
 *  silently rewriting history on save.
 *
 *  Two things keep this honest:
 *
 *    It never runs on its own. Somebody has to ask for it, and the dry run is
 *    the default — apply is a second, deliberate call.
 *
 *    It respects the effective date. Days before it are left exactly as they
 *    are, so a month that has already been reported on cannot move underneath
 *    whoever reported it.
 *
 *  Only `status` moves. Punches, working_hours and late_minutes are the record
 *  of what happened; the policy decides what to CALL that, not what it was.
 * ────────────────────────────────────────────────────────────────────────── */

const { classifyDay } = require('./attendanceRule');

// Every fact a day needs to be classified: the punches, and whatever else the
// company had already approved for it.
const DAY_QUERY = `
  SELECT a.id, a.date::text AS d, a.status, a.working_hours, a.late_minutes,
         e.employee_id AS code,
         TRIM(CONCAT(e.first_name, ' ', e.last_name)) AS name,
         (a.check_in IS NOT NULL OR a.check_out IS NOT NULL) AS has_punch,
         (a.check_out IS NOT NULL) AS finished,
         EXTRACT(EPOCH FROM (sh.end_time::time - sh.start_time::time))/3600.0 AS shift_hours,
         COALESCE(sh.grace_minutes, 15) AS grace,
         COALESCE((
           SELECT MAX(CASE WHEN l.is_half_day THEN 0.5 ELSE 1 END)
             FROM leaves l
            WHERE l.employee_id = a.employee_id AND l.status = 'approved'
              AND l.leave_type <> 'permission'
              AND a.date BETWEEN l.start_date AND l.end_date), 0) AS leave_portion,
         COALESCE((
           SELECT SUM(COALESCE(l.hours, 0))
             FROM leaves l
            WHERE l.employee_id = a.employee_id AND l.status = 'approved'
              AND l.leave_type = 'permission'
              AND a.date BETWEEN l.start_date AND l.end_date), 0) AS permission_hours,
         EXISTS (
           SELECT 1 FROM on_duty_requests o
            WHERE o.employee_id = a.employee_id AND o.status = 'approved'
              AND a.date BETWEEN o.start_date AND o.end_date) AS on_duty
    FROM attendance a
    JOIN employees e ON e.id = a.employee_id
    LEFT JOIN shifts sh ON sh.id = e.shift_id
   WHERE a.date >= $1::date
     AND a.date < (NOW() AT TIME ZONE $2)::date
     AND e.deleted_at IS NULL
     AND COALESCE(e.employment_type, '') <> 'Employee Profile'
   ORDER BY a.date DESC, e.employee_id`;

/**
 * @param {object}  client   pg client or pool
 * @param {object}  cfg      the attendance policy, as the engine reads it
 * @param {string}  from     earliest date to touch (YYYY-MM-DD)
 * @param {string}  tz       org timezone, so "before today" means today here
 * @param {boolean} apply    false (default) reports; true writes
 */
async function reprocess(client, { cfg, from, tz = 'Asia/Kolkata', apply = false }) {
  const { rows } = await client.query(DAY_QUERY, [from, tz]);

  // An unfinished day is not a short day. Somebody checked in this morning and
  // has not left yet; classifying that as absent would be nonsense.
  const finished = rows.filter(r => r.finished);

  const changes = [];
  const transitions = new Map();

  for (const r of finished) {
    const verdict = classifyDay({
      workedHours: Number(r.working_hours) || 0,
      hasPunch: r.has_punch,
      leavePortion: Number(r.leave_portion) || 0,
      permissionHours: Number(r.permission_hours) || 0,
      onDuty: r.on_duty,
      lateMinutes: Number(r.late_minutes) || 0,
      graceMinutes: Number(r.grace) || 0,
      cfg,
      shiftHours: r.shift_hours === null ? null : Number(r.shift_hours),
    });

    // 'late' and 'present' are both a full present day. Treating a change
    // between them as a change would report the whole database as moving.
    const sameDay = (a, b) =>
      a === b || (['present', 'late'].includes(a) && ['present', 'late'].includes(b));
    if (sameDay(r.status, verdict.status)) continue;

    const key = `${r.status} → ${verdict.status}`;
    transitions.set(key, (transitions.get(key) || 0) + 1);
    changes.push({
      id: r.id, code: r.code, name: r.name, date: r.d,
      hours: Number(r.working_hours) || 0,
      owed: verdict.owed,
      from: r.status, to: verdict.status,
      present: verdict.present, absent: verdict.absent, leave: verdict.leave,
    });
  }

  let written = 0;
  if (apply && changes.length) {
    // One statement rather than a query per row: this can be thousands of days,
    // and a loop would hold a connection open for the whole sweep.
    const ids = changes.map(c => c.id);
    const statuses = changes.map(c => c.to);
    const r = await client.query(
      `UPDATE attendance a
          SET status = v.status, updated_at = NOW()
         FROM (SELECT UNNEST($1::uuid[]) AS id, UNNEST($2::text[]) AS status) v
        WHERE a.id = v.id`,
      [ids, statuses]
    );
    written = r.rowCount;
  }

  return {
    scanned: rows.length,
    finished: finished.length,
    changed: changes.length,
    written,
    transitions: [...transitions.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count),
    sample: changes.slice(0, 25),
  };
}

module.exports = { reprocess };
