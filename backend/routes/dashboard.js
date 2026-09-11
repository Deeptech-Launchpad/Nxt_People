const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect } = require('../middleware/auth');
const { allows, optionsFor } = require('../utils/functionAccess');
const { serverError } = require('../utils/serverError');
router.use(protect);

/* Birthdays in the next 30 days, wrapping across the year end.
 *
 * Shared with /my-space below rather than copied: the Admin dashboard and My
 * Space → Dashboard show the same faces, and two copies of this MM-DD wrap
 * would be two places to get the December-to-January case wrong. */
const UPCOMING_BIRTHDAYS_SQL = `
  SELECT first_name as "firstName", last_name as "lastName", department, designation,
         employee_id as "employeeId", date_of_birth as "dateOfBirth",
         TO_CHAR(date_of_birth, 'MM-DD') as "mmdd"
    FROM employees
   WHERE date_of_birth IS NOT NULL AND status = 'active' AND deleted_at IS NULL
     AND (
       (TO_CHAR(date_of_birth,'MM-DD') >= TO_CHAR(CURRENT_DATE,'MM-DD') AND TO_CHAR(date_of_birth,'MM-DD') <= TO_CHAR(CURRENT_DATE + INTERVAL '30 days','MM-DD'))
       OR (TO_CHAR(CURRENT_DATE,'MM-DD') > TO_CHAR(CURRENT_DATE + INTERVAL '30 days','MM-DD')
           AND (TO_CHAR(date_of_birth,'MM-DD') >= TO_CHAR(CURRENT_DATE,'MM-DD') OR TO_CHAR(date_of_birth,'MM-DD') <= TO_CHAR(CURRENT_DATE + INTERVAL '30 days','MM-DD')))
     )
   ORDER BY TO_CHAR(date_of_birth,'MM-DD') LIMIT $1`;

router.get('/stats', async (req, res) => {
  try {
    const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local date

    // Get 7-day window start date
    const weekStartDate = new Date();
    weekStartDate.setDate(weekStartDate.getDate() - 6);
    const weekStart = weekStartDate.toLocaleDateString('en-CA');

    const totalEmployeesRes = await pool.query(
      "SELECT COUNT(*) FROM employees WHERE status = 'active' AND deleted_at IS NULL"
    );
    const totalEmployees = parseInt(totalEmployeesRes.rows[0].count, 10);

    const todayAttendanceRes = await pool.query(
      'SELECT status FROM attendance WHERE date = $1::date',
      [today]
    );
    const todayAttendance = todayAttendanceRes.rows;
    const present = todayAttendance.filter(a => ['present', 'late'].includes(a.status)).length;
    const late = todayAttendance.filter(a => a.status === 'late').length;

    const onLeaveRes = await pool.query(
      "SELECT COUNT(*) FROM leaves WHERE status = 'approved' AND start_date <= $1::date AND end_date >= $1::date",
      [today]
    );
    const onLeave = parseInt(onLeaveRes.rows[0].count, 10);
    const absent = Math.max(0, totalEmployees - present - onLeave);

    /* Pending requests still waiting on a decision.
     *
     * This counted rows in `leaves` and joined nothing, so a request belonging
     * to a deleted employee was counted here and — correctly — not on Leave
     * Approvals, leaving the two screens quietly disagreeing with no way to tell
     * which was right. The join is what makes this the same population Approvals
     * works from.
     *
     * Permission lives in the same table and is just as pending, so it is
     * counted here too; that matches what Approvals totals. */
    const pendingLeavesRes = await pool.query(
      `SELECT COUNT(*) FROM leaves l
         JOIN employees e ON e.id = l.employee_id
        WHERE l.status = 'pending' AND e.deleted_at IS NULL`
    );
    const pendingLeaves = parseInt(pendingLeavesRes.rows[0].count, 10);

    // Bug #11 fix: single query for all 7 days using GROUP BY date
    const weekAttRes = await pool.query(
      `SELECT date::text as day_date,
        COUNT(CASE WHEN status IN ('present', 'late') THEN 1 END) AS present,
        COUNT(CASE WHEN status = 'late' THEN 1 END) AS late
       FROM attendance
       WHERE date >= $1::date AND date <= $2::date
       GROUP BY date
       ORDER BY date ASC`,
      [weekStart, today]
    );

    // Build the weekData array filling in missing days with zeros
    const weekDataMap = {};
    weekAttRes.rows.forEach(r => { weekDataMap[r.day_date] = r; });

    const weekData = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const ds = d.toLocaleDateString('en-CA');
      const row = weekDataMap[ds];
      const dayPresent = row ? parseInt(row.present, 10) : 0;
      const dayLate = row ? parseInt(row.late, 10) : 0;
      weekData.push({
        day: d.toLocaleDateString('en-US', { weekday: 'short' }),
        date: ds,
        present: dayPresent,
        absent: Math.max(0, totalEmployees - dayPresent),
        late: dayLate
      });
    }

    const recentAttendanceRes = await pool.query(
      `SELECT a.id as "_id", a.status, a.check_in as "checkIn",
       json_build_object('firstName', e.first_name, 'lastName', e.last_name, 'department', e.department) as employee
       FROM attendance a
       JOIN employees e ON a.employee_id = e.id
       WHERE a.date = $1::date
       ORDER BY a.updated_at DESC
       LIMIT 8`,
      [today]
    );

    // Upcoming birthdays in next 30 days
    const birthdaysRes = await pool.query(UPCOMING_BIRTHDAYS_SQL, [5]);

    // Work anniversaries this month
    const anniversariesRes = await pool.query(
      `SELECT first_name as "firstName", last_name as "lastName", department, joining_date as "joiningDate",
       EXTRACT(YEAR FROM AGE(CURRENT_DATE, joining_date))::int as "years"
       FROM employees
       WHERE status='active' AND deleted_at IS NULL AND joining_date IS NOT NULL
       AND EXTRACT(MONTH FROM joining_date) = EXTRACT(MONTH FROM CURRENT_DATE)
       AND EXTRACT(DAY FROM joining_date) >= EXTRACT(DAY FROM CURRENT_DATE)
       AND EXTRACT(YEAR FROM joining_date) < EXTRACT(YEAR FROM CURRENT_DATE)
       ORDER BY EXTRACT(DAY FROM joining_date) LIMIT 5`
    );

    // Department attendance breakdown (today)
    const deptRes = await pool.query(
      `SELECT e.department, COUNT(*) as total,
       COUNT(CASE WHEN a.status IN ('present','late') THEN 1 END) as present,
       COUNT(CASE WHEN a.status = 'absent' OR a.id IS NULL THEN 1 END) as absent
       FROM employees e
       LEFT JOIN attendance a ON e.id = a.employee_id AND a.date = $1::date
       WHERE e.status = 'active' AND e.deleted_at IS NULL AND e.department IS NOT NULL
       GROUP BY e.department ORDER BY present DESC LIMIT 8`,
      [today]
    );

    /* Latest announcements (top 5).
     *
     * `isPinned` was aliased off is_active, which is the conflation
     * /api/announcements was explicitly fixed to stop making: is_active is
     * whether the announcement is visible at all, is_pinned is whether it wears
     * the badge. Every row here passes `WHERE a.is_active = true`, so the old
     * alias reported every announcement as pinned. */
    const announcementsRes = await pool.query(
      `SELECT a.id as "_id", a.title, a.content as body, a.priority as type,
       a.is_pinned as "isPinned", a.created_at as "createdAt",
       json_build_object('firstName', e.first_name, 'lastName', e.last_name) as "postedBy"
       FROM announcements a
       JOIN employees e ON a.created_by = e.id
       WHERE a.is_active = true
       ORDER BY a.is_pinned DESC, a.created_at DESC LIMIT 5`
    );

    /* Function Based Permissions, applied by omission rather than refusal.
     *
     * This one response carries five widgets. Refusing it because a role has
     * Birthday Buddy switched off would blank the whole dashboard over one
     * card, so a switched-off widget comes back empty and the card renders as
     * "nothing to show" — which is what the person is meant to see. */
    const [showBirthdays, showAnniversaries, showAnnouncements] = await Promise.all([
      allows(req, 'birthday_buddy'),
      allows(req, 'work_anniversary'),
      allows(req, 'announcements'),
    ]);
    const anniversaryOpts = await optionsFor(req, 'work_anniversary');

    res.json({
      success: true,
      data: {
        totalEmployees, present, absent, late, onLeave, pendingLeaves, weekData,
        recentActivity: recentAttendanceRes.rows,
        birthdays: showBirthdays ? birthdaysRes.rows : [],
        // "Show year of experience" is the sub-control beside Work Anniversary.
        // Off means the years figure is not sent at all, rather than sent and
        // hidden by the browser.
        anniversaries: showAnniversaries
          ? anniversariesRes.rows.map(r => (
              anniversaryOpts.showYearsOfExperience ? r : { ...r, years: undefined }
            ))
          : [],
        deptBreakdown: deptRes.rows,
        announcements: showAnnouncements ? announcementsRes.rows : []
      }
    });
  } catch (err) {
    serverError(res, err);
  }
});

/* ── My Space → Dashboard ──────────────────────────────────────────────────
 *
 * The widget page used to load /dashboard/stats for a single field and
 * /employees?limit=200 to re-derive birthdays and new hires in the browser —
 * two hundred employee records, salaries and addresses included, so that three
 * cards could show a name and a photo. Everything the page cannot get from an
 * existing self-scoped endpoint comes from here instead.
 *
 * Announcements deliberately do NOT appear here: /api/announcements already
 * serves them with the pinned/active distinction and the read state, and is the
 * route the Announcements page itself uses.
 */
router.get('/my-space', async (req, res) => {
  try {
    const showBirthdays = await allows(req, 'birthday_buddy');

    const [birthdaysRes, newHiresRes] = await Promise.all([
      showBirthdays ? pool.query(UPCOMING_BIRTHDAYS_SQL, [8]) : Promise.resolve({ rows: [] }),
      pool.query(
        `SELECT id as "_id", first_name as "firstName", last_name as "lastName",
                employee_id as "employeeId", designation, department,
                joining_date as "joiningDate"
           FROM employees
          WHERE status = 'active' AND deleted_at IS NULL
            AND joining_date IS NOT NULL
            AND joining_date >= CURRENT_DATE - INTERVAL '30 days'
            AND joining_date <= CURRENT_DATE
          ORDER BY joining_date DESC LIMIT 8`
      ),
    ]);

    res.json({
      success: true,
      data: { birthdays: birthdaysRes.rows, newHires: newHiresRes.rows }
    });
  } catch (err) {
    serverError(res, err);
  }
});

/* LOP the caller has actually been docked for, read off their own payslips.
 *
 * Not recomputed with payroll's lopDaysForRange(): that would give the dashboard
 * its own opinion of a pay-affecting number, free to disagree with the payslip
 * the person was paid against. A payslip is the only figure that has actually
 * been applied, so that is the one shown — which is also why a month with no
 * payslip yet reports nothing here rather than zero.
 *
 * /payroll/my is the natural home for this but does not select lop_days, and
 * /payroll/my/:id does — one call per slip. Hence one aggregate read here.
 */
router.get('/lop-summary', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT pay_year AS "payYear", pay_month AS "payMonth",
              COALESCE(lop_days, 0)::float   AS "lopDays",
              COALESCE(lop_amount, 0)::float AS "lopAmount"
         FROM payroll_payslips
        WHERE employee_id = $1
          AND status IN ('locked','paid')
          AND superseded_by IS NULL
        ORDER BY pay_year DESC, pay_month DESC
        LIMIT 6`,
      [req.user._id]
    );

    res.json({
      success: true,
      data: {
        periods: r.rows,
        totalDays: r.rows.reduce((s, x) => s + x.lopDays, 0),
        totalAmount: r.rows.reduce((s, x) => s + x.lopAmount, 0),
      }
    });
  } catch (err) {
    serverError(res, err);
  }
});

/* ── Widget layout ─────────────────────────────────────────────────────────
 *
 * The whitelist is the contract with the frontend registry: a key the browser
 * invents is dropped rather than stored, so the column can never grow into a
 * place to park arbitrary JSON. Keep it in step with WIDGETS in
 * frontend/src/pages/dashboard/widgets.jsx.
 */
const WIDGET_KEYS = [
  'newHires', 'favorites', 'birthday', 'quickLinks', 'announcements',
  'leaveReport', 'holidays', 'myGoals', 'appraisals', 'pendingTasks',
  'myFiles', 'engagement', 'lopSummary',
];

/** Known keys only, in the order given, no repeats. */
function cleanKeys(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const k of value) {
    if (typeof k !== 'string' || !WIDGET_KEYS.includes(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

router.get('/layout', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT dashboard_layout AS "layout" FROM employees WHERE id = $1`,
      [req.user._id]
    );
    const saved = r.rows[0]?.layout;
    if (!saved) return res.json({ success: true, data: null });

    // Sanitised on the way out too: a key retired since the layout was saved
    // would otherwise be handed back to a frontend that no longer knows it.
    res.json({
      success: true,
      data: { order: cleanKeys(saved.order), hidden: cleanKeys(saved.hidden) }
    });
  } catch (err) {
    serverError(res, err);
  }
});

router.put('/layout', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const layout = { order: cleanKeys(body.order), hidden: cleanKeys(body.hidden) };

    if (layout.order.length === 0) {
      return res.status(400).json({ success: false, message: 'order must list at least one known widget' });
    }

    await pool.query(
      `UPDATE employees SET dashboard_layout = $1 WHERE id = $2`,
      [JSON.stringify(layout), req.user._id]
    );
    res.json({ success: true, data: layout });
  } catch (err) {
    serverError(res, err);
  }
});

module.exports = router;

