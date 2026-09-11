/**
 * routes/team.js — Aggregate endpoint for the Team Space sidebar panels,
 * plus the manager-scoped reads behind the Team workspaces (Home → Team,
 * Attendance → Team, Leave Tracker → Team).
 *
 * /space gives one round-trip → all six panels that page needs:
 *   • teamStrength       (count of active employees in my department)
 *   • teamAvailability   (today's in / out / on-leave / yet-to-check-in)
 *   • locationDiversity  (work_location → count, top 5)
 *   • recentlyCheckedIn  (last 5 check-ins in my department today)
 *   • newHires           (joined in last 15 days, in my department)
 *   • birthdayBuddy      (today's birthdays in my department)
 *
 * Everything below /space is reporting-line scoped through reportsScope()
 * rather than by department, because "my team" for an approver means the
 * people they answer for, not the people who happen to share their
 * department label.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { allows } = require('../utils/functionAccess');
const { reportsScope } = require('../utils/roles');
const { buildCriteria, buildOrder, buildPaging } = require('../utils/listQuery');
const logger = require('../logger');
const { serverError } = require('../utils/serverError');

router.use(protect);

// Same guard shape the other approver queues use (regularizations, on-duty,
// comp-off) and the same set Topbar gates /team/approvals with, so a role that
// can reach the nav entry can reach the data behind it.
const approvers = authorize('admin', 'director', 'hr_admin', 'manager', 'team_incharge');

/**
 * Approved leave that covers a given date, as a LATERAL subquery.
 *
 * `attendance.status` is written at check-in/check-out and nothing rewrites it
 * when a leave is approved afterwards, so it cannot answer "is this person off
 * today" — it is derived from the leave rows instead, the same way org.js and
 * the roster grid derive it.
 *
 * Permission is excluded on purpose: it is an hourly absence measured in
 * `hours`, and somebody with an hour's permission is expected at work. Putting
 * them in the Leave group would say the opposite.
 */
const LEAVE_TODAY = (dateParam) => `
  LEFT JOIN LATERAL (
    SELECT l.employee_id, l.leave_type, l.is_half_day, l.half_day_type
      FROM leaves l
     WHERE l.employee_id = e.id AND l.status = 'approved'
       AND l.start_date <= ${dateParam}::date AND l.end_date >= ${dateParam}::date
       AND l.leave_type <> 'permission'
     ORDER BY l.start_date
     LIMIT 1
  ) lv ON TRUE`;

/* Real attendance wins; approved leave only speaks when there is no punch.
 * Lifted verbatim from org.js's presence CASE so the two screens cannot
 * disagree about the same person on the same day. */
const PRESENCE = `
  CASE
    WHEN a.check_in IS NOT NULL AND a.check_out IS NULL THEN 'in'
    WHEN a.check_out IS NOT NULL THEN 'out'
    WHEN lv.employee_id IS NOT NULL THEN 'onLeave'
    ELSE 'yetToCheckIn'
  END`;

/** Push reportsScope()'s clause and params onto a query being built. */
function scopeInto(user, alias, params) {
  const s = reportsScope(user, alias, params.length + 1);
  params.push(...s.params);
  return s.clause;
}

const todayStr = () => new Date().toLocaleDateString('en-CA');
const dateArg = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : todayStr());

router.get('/space', async (req, res) => {
  try {
    const me = req.user;
    const dept = me.department || null;

    // If the caller has no department, the page still works but with empty
    // department-scoped widgets. We won't 500 for that.
    const inDept = dept ? `AND LOWER(TRIM(e.department)) = LOWER(TRIM($1))` : '';
    const params = dept ? [me._id, dept] : [me._id];

    const [strengthRes, availRes, locRes, recentRes, newHiresRes, birthdaysRes] = await Promise.all([
      // 1. Strength
      pool.query(
        `SELECT COUNT(*)::int AS n FROM employees e
          WHERE e.status = 'active' AND e.deleted_at IS NULL ${inDept}`,
        dept ? [dept] : []
      ),
      // 2. Availability — today's attendance for departmentmates.
      //
      // onLeave is carved OUT of yetToCheckIn rather than added beside it:
      // somebody on approved leave was being counted as yet to check in, which
      // is the one reading that is certainly wrong. The four buckets still sum
      // to the department, so the panel keeps adding up.
      pool.query(
        `SELECT
            SUM(CASE WHEN a.check_in IS NOT NULL AND a.check_out IS NULL THEN 1 ELSE 0 END)::int AS "in",
            SUM(CASE WHEN a.check_out IS NOT NULL THEN 1 ELSE 0 END)::int AS "out",
            SUM(CASE WHEN a.check_in IS NULL AND lv.employee_id IS NOT NULL THEN 1 ELSE 0 END)::int AS "onLeave",
            SUM(CASE WHEN a.check_in IS NULL AND lv.employee_id IS NULL THEN 1 ELSE 0 END)::int     AS "yetToCheckIn"
           FROM employees e
      LEFT JOIN attendance a ON a.employee_id = e.id AND a.date = CURRENT_DATE
      ${LEAVE_TODAY('CURRENT_DATE')}
          WHERE e.status = 'active' AND e.deleted_at IS NULL ${dept ? 'AND LOWER(TRIM(e.department)) = LOWER(TRIM($1))' : ''}`,
        dept ? [dept] : []
      ),
      // 3. Location diversity — work_location → count, top 5
      pool.query(
        `SELECT COALESCE(NULLIF(work_location, ''), 'Unassigned') AS location,
                COUNT(*)::int AS n
           FROM employees
          WHERE status = 'active' AND deleted_at IS NULL ${dept ? 'AND LOWER(TRIM(department)) = LOWER(TRIM($1))' : ''}
       GROUP BY location
       ORDER BY n DESC LIMIT 5`,
        dept ? [dept] : []
      ),
      // 4. Recently checked-in today — top 5 by latest check-in
      pool.query(
        `SELECT e.id, e.employee_id AS "employeeId",
                e.first_name AS "firstName", e.last_name AS "lastName",
                e.photo_url AS "photoUrl", e.work_location AS "workLocation",
                a.check_in AS "checkIn"
           FROM attendance a JOIN employees e ON e.id = a.employee_id
          WHERE a.date = CURRENT_DATE AND a.check_in IS NOT NULL
            AND e.status = 'active' AND e.deleted_at IS NULL ${dept ? 'AND LOWER(TRIM(e.department)) = LOWER(TRIM($1))' : ''}
       ORDER BY a.check_in DESC LIMIT 5`,
        dept ? [dept] : []
      ),
      // 5. New hires — joined in last 15 days, my department. Column is
      // `joining_date` (not `join_date`) — that one-letter typo was the
      // SQL error that 500'd the whole endpoint.
      pool.query(
        `SELECT id, employee_id AS "employeeId",
                first_name AS "firstName", last_name AS "lastName",
                designation, photo_url AS "photoUrl",
                joining_date AS "joinDate"
           FROM employees
          WHERE status = 'active' AND deleted_at IS NULL
            AND joining_date >= CURRENT_DATE - INTERVAL '15 days'
            ${dept ? 'AND LOWER(TRIM(department)) = LOWER(TRIM($1))' : ''}
       ORDER BY joining_date DESC LIMIT 10`,
        dept ? [dept] : []
      ),
      // 6. Today's birthdays in my department
      pool.query(
        `SELECT id, employee_id AS "employeeId",
                first_name AS "firstName", last_name AS "lastName",
                photo_url AS "photoUrl", date_of_birth AS "dateOfBirth"
           FROM employees
          WHERE status = 'active' AND deleted_at IS NULL
            AND date_of_birth IS NOT NULL
            AND EXTRACT(MONTH FROM date_of_birth) = EXTRACT(MONTH FROM CURRENT_DATE)
            AND EXTRACT(DAY   FROM date_of_birth) = EXTRACT(DAY   FROM CURRENT_DATE)
            ${dept ? 'AND LOWER(TRIM(department)) = LOWER(TRIM($1))' : ''}
       ORDER BY first_name ASC`,
        dept ? [dept] : []
      ),
    ]);

    const [showNewHires, showBirthdays] = await Promise.all([
      allows(req, 'new_joinee_list'),
      allows(req, 'birthday_buddy'),
    ]);

    res.json({
      success: true,
      data: {
        department: dept,
        teamStrength:       strengthRes.rows[0]?.n || 0,
        teamAvailability:   {
          in: availRes.rows[0]?.in || 0,
          out: availRes.rows[0]?.out || 0,
          onLeave: availRes.rows[0]?.onLeave || 0,
          yetToCheckIn: availRes.rows[0]?.yetToCheckIn || 0,
        },
        locationDiversity:  locRes.rows,
        recentlyCheckedIn:  recentRes.rows,
        // Omitted rather than refused — this response is the whole Team Space
        // page, and one switched-off card should not take the other five with it.
        newHires:           showNewHires  ? newHiresRes.rows  : [],
        birthdayBuddy:      showBirthdays ? birthdaysRes.rows : [],
      },
    });
  } catch (err) {
    // Explicit log so the real SQL/JS error appears in docker logs.
    // pino-http only captures the response status, not the JSON body,
    // so the previous 500 looked like "failed with status code 500"
    // with no detail. logger.error lands in the container's stdout as JSON.
    logger.error({ err: err.message, stack: err.stack }, '[/api/team/space] failed');
    serverError(res, err, 'team');
  }
});

/* ── GET /api/team/on-leave?date= ─────────────────────────────────────────
 * Who among my reports has approved leave covering `date`, and of what type.
 *
 * Exists as an overlay rather than as a change to /attendance/team so the
 * Team Members screen can tell "on leave" apart from "has not arrived"
 * without that endpoint's attendance payload growing a second meaning.
 * Callers merge by employee id, so a person absent from their own roster
 * cannot appear through this.
 */
router.get('/on-leave', approvers, async (req, res) => {
  try {
    const date = dateArg(req.query.date);
    const params = [date];
    const scope = scopeInto(req.user, 'e', params);

    const r = await pool.query(
      `SELECT l.employee_id AS "employeeId", l.leave_type AS "leaveType",
              l.start_date::text AS "startDate", l.end_date::text AS "endDate",
              l.is_half_day AS "isHalfDay", l.half_day_type AS "halfDayType",
              l.start_time::text AS "startTime", l.end_time::text AS "endTime",
              -- Permission is hourly, so it rides along labelled rather than
              -- counted as a day off. The caller groups on this flag.
              (l.leave_type <> 'permission') AS "fullDayOff"
         FROM leaves l
         JOIN employees e ON e.id = l.employee_id
        WHERE l.status = 'approved'
          AND l.start_date <= $1::date AND l.end_date >= $1::date
          AND e.deleted_at IS NULL ${scope}
        ORDER BY l.start_date`,
      params
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { serverError(res, err, 'team'); }
});

/* ── GET /api/team/reportees?date= ────────────────────────────────────────
 * A row per direct report: who they are, where they stand today, their shift,
 * and how much leave they have booked this calendar year.
 *
 * One endpoint feeds three screens (Home → Team → Reportees, Attendance →
 * Team → Reportees, Leave Tracker → Team → Reportees) because they show the
 * same person from the same day — three endpoints would be three chances for
 * the same card to say different things.
 */
router.get('/reportees', approvers, async (req, res) => {
  try {
    const date = dateArg(req.query.date);
    const params = [date];
    const scope = scopeInto(req.user, 'e', params);

    const r = await pool.query(
      `SELECT e.id, e.employee_id AS "employeeId",
              e.first_name AS "firstName", e.last_name AS "lastName",
              e.designation, e.department, e.email, e.phone,
              e.work_location AS "workLocation", e.photo_url AS "photoUrl",
              a.check_in AS "checkIn", a.check_out AS "checkOut",
              CASE WHEN s.id IS NULL THEN NULL ELSE json_build_object(
                'name', s.name, 'startTime', s.start_time, 'endTime', s.end_time) END AS shift,
              lv.leave_type AS "leaveType",
              lv.is_half_day AS "isHalfDay", lv.half_day_type AS "halfDayType",
              ${PRESENCE} AS presence,
              COALESCE(bk.days, 0)::float AS "leaveBookedThisYear"
         FROM employees e
         LEFT JOIN shifts s ON s.id = e.shift_id
         LEFT JOIN attendance a ON a.employee_id = e.id AND a.date = $1::date
         ${LEAVE_TODAY('$1')}
         -- Booked counts pending as well as approved, matching the balance
         -- card in leaves.js: a request in flight has already been reserved.
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(l.total_days), 0) AS days
             FROM leaves l
            WHERE l.employee_id = e.id AND l.status IN ('approved', 'pending')
              AND EXTRACT(YEAR FROM l.start_date) = EXTRACT(YEAR FROM $1::date)
         ) bk ON TRUE
        WHERE e.status = 'active' AND e.deleted_at IS NULL ${scope}
        ORDER BY e.first_name ASC, e.last_name ASC`,
      params
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { serverError(res, err, 'team'); }
});

/* ── GET /api/team/list ───────────────────────────────────────────────────
 * The team roster as a paged table. /employees is full-access only, so an
 * approver has had no roster data table at all; this is that table, narrowed
 * to the reporting line instead of opened up to the org.
 */
const TEAM_LIST_FIELDS = {
  employeeId:   { column: 'e.employee_id',    label: 'Employee ID',   type: 'text' },
  firstName:    { column: 'e.first_name',     label: 'First Name',    type: 'text' },
  lastName:     { column: 'e.last_name',      label: 'Last Name',     type: 'text' },
  email:        { column: 'e.email',          label: 'Email',         type: 'text' },
  designation:  { column: 'e.designation',    label: 'Designation',   type: 'text' },
  department:   { column: 'e.department',      label: 'Department',    type: 'text' },
  workLocation: { column: 'e.work_location',  label: 'Work Location', type: 'text' },
  employmentType: { column: 'e.employment_type', label: 'Employment Type', type: 'text' },
  shiftName:    { column: 's.name',           label: 'Shift',         type: 'text' },
  phone:        { column: 'e.phone',           label: 'Mobile',        type: 'text' },
  joined:       { column: 'COALESCE(e.date_of_joining, e.joining_date::date)', label: 'Date of Joining', type: 'date' },
};

router.get('/list', approvers, async (req, res) => {
  try {
    const { page, limit, offset } = buildPaging(req.query);
    const orderBy = buildOrder(TEAM_LIST_FIELDS, req.query.sortBy, req.query.sortDir, 'e.first_name');

    const params = [];
    const scope = scopeInto(req.user, 'e', params);
    let where = `e.status = 'active' AND e.deleted_at IS NULL ${scope}`;

    // The same filter engine Employee Information's list uses, over a field
    // registry of its own. Additive: the reporting-line clause is already in
    // `where`, so criteria can only narrow it further.
    const crit = buildCriteria(TEAM_LIST_FIELDS, req.query.criteria, params.length + 1);
    if (crit.clause) { where += crit.clause; params.push(...crit.params); }

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS n FROM employees e
         LEFT JOIN shifts s ON s.id = e.shift_id
        WHERE ${where}`, params);

    params.push(limit, offset);
    const rows = await pool.query(
      `SELECT e.id AS "_id", e.employee_id AS "employeeId",
              e.first_name AS "firstName", e.last_name AS "lastName",
              e.email, e.phone, e.designation, e.department, e.status,
              e.work_location AS "workLocation",
              e.employment_type AS "employmentType",
              COALESCE(e.date_of_joining, e.joining_date::date) AS joined,
              s.name AS "shiftName",
              TRIM(CONCAT(m.first_name, ' ', m.last_name)) AS "reportingManager"
         FROM employees e
         LEFT JOIN shifts s ON s.id = e.shift_id
         LEFT JOIN employees m ON m.id = e.reporting_manager_id
        WHERE ${where}
        ORDER BY ${orderBy}
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json({ success: true, data: rows.rows, total: countRes.rows[0].n, page, limit });
  } catch (err) { serverError(res, err, 'team'); }
});

/* ── GET /api/team/ex-employees ───────────────────────────────────────────
 * Former reports. "Former" is `exit_date IS NOT NULL` — the same test
 * reports.js's Active/Ex-Employee chip uses. Deliberately NOT
 * `status <> 'active'`, which also catches notice-period and resigned people
 * who have not left yet and would be listed here with no leaving date.
 *
 * Experience is computed from the dates rather than read from
 * employees.total_experience: that column is free text carried over from the
 * Zoho import and says nothing about tenure here.
 */
router.get('/ex-employees', approvers, async (req, res) => {
  try {
    const params = [];
    const scope = scopeInto(req.user, 'e', params);

    const r = await pool.query(
      `SELECT e.id, e.employee_id AS "employeeId",
              e.first_name AS "firstName", e.last_name AS "lastName",
              e.designation, e.department, e.email,
              e.photo_url AS "photoUrl", e.status,
              e.exit_date::text AS "exitDate",
              COALESCE(e.date_of_joining, e.joining_date::date)::text AS "joinedOn",
              GREATEST(0, EXTRACT(YEAR FROM age(e.exit_date,
                COALESCE(e.date_of_joining, e.joining_date::date))))::int AS "experienceYears",
              GREATEST(0, EXTRACT(MONTH FROM age(e.exit_date,
                COALESCE(e.date_of_joining, e.joining_date::date))))::int AS "experienceMonths"
         FROM employees e
        WHERE e.deleted_at IS NULL AND e.exit_date IS NOT NULL ${scope}
        ORDER BY e.exit_date DESC`,
      params
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { serverError(res, err, 'team'); }
});

/* ── GET /api/team/leave-week?start= ──────────────────────────────────────
 * Who is off on each of seven days, for the On Leave strip. Returns one row
 * per person per day they are off, so the caller counts and names from the
 * same list rather than trusting a count computed somewhere else.
 *
 * Permission is left out for the same reason it is left out of the Leave
 * group: an hour away is not a day off, and counting it would inflate every
 * day in the strip.
 */
router.get('/leave-week', approvers, async (req, res) => {
  try {
    const start = dateArg(req.query.start);
    const params = [start];
    const scope = scopeInto(req.user, 'e', params);

    const r = await pool.query(
      `SELECT d.day::date::text AS date, e.id AS "employeeId", e.employee_id AS "employeeCode",
              e.first_name AS "firstName", e.last_name AS "lastName",
              e.photo_url AS "photoUrl", e.designation,
              l.leave_type AS "leaveType", l.is_half_day AS "isHalfDay",
              l.half_day_type AS "halfDayType"
         FROM generate_series($1::date, $1::date + 6, INTERVAL '1 day') AS d(day)
         JOIN leaves l ON l.status = 'approved'
                      AND l.leave_type <> 'permission'
                      AND l.start_date <= d.day::date AND l.end_date >= d.day::date
         JOIN employees e ON e.id = l.employee_id
        WHERE e.deleted_at IS NULL ${scope}
        ORDER BY d.day, e.first_name`,
      params
    );
    res.json({ success: true, data: r.rows, start });
  } catch (err) { serverError(res, err, 'team'); }
});

/* ── GET /api/team/leave-requests ─────────────────────────────────────────
 * The team's leave history, every status, newest first.
 *
 * /leaves/team-pending is the pending approval queue and answers a different
 * question — it cannot be extended into this without changing what the
 * Approvals page reads. This is the history beside it, scoped through
 * reportsScope() rather than team-pending's own two-level walk.
 */
router.get('/leave-requests', approvers, async (req, res) => {
  try {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
    const params = [];
    const scope = scopeInto(req.user, 'e', params);

    let where = `e.deleted_at IS NULL ${scope}`;
    const status = String(req.query.status || '').trim();
    if (['pending', 'approved', 'rejected', 'cancelled'].includes(status)) {
      params.push(status);
      where += ` AND l.status = $${params.length}`;
    }

    params.push(limit);
    const r = await pool.query(
      `SELECT l.id AS "_id", l.leave_type AS "leaveType", l.status,
              l.start_date::text AS "startDate", l.end_date::text AS "endDate",
              l.total_days AS "totalDays", l.hours,
              l.start_time::text AS "startTime", l.end_time::text AS "endTime",
              l.is_half_day AS "isHalfDay", l.half_day_type AS "halfDayType",
              l.reason, l.rejection_reason AS "rejectionReason",
              l.created_at AS "createdAt",
              json_build_object('_id', e.id, 'employeeId', e.employee_id,
                'firstName', e.first_name, 'lastName', e.last_name,
                'department', e.department, 'designation', e.designation,
                'photoUrl', e.photo_url) AS employee
         FROM leaves l
         JOIN employees e ON e.id = l.employee_id
        WHERE ${where}
        ORDER BY l.start_date DESC, l.created_at DESC
        LIMIT $${params.length}`,
      params
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { serverError(res, err, 'team'); }
});

/* The Shift Schedule tab has no endpoint here on purpose: /roster already
 * returns the roster, the standing shifts and the approved leave for a date
 * range and already narrows a manager to their own team through
 * shiftConfig's mapping-visibility matrix. A second query over shift_roster
 * would be a second opinion about which shift applies on a given day. */

module.exports = router;
