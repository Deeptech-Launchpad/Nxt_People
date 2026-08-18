const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect } = require('../middleware/auth');
const { serverError } = require('../utils/serverError');
router.use(protect);

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

    const pendingLeavesRes = await pool.query(
      "SELECT COUNT(*) FROM leaves WHERE status = 'pending'"
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
    const birthdaysRes = await pool.query(
      `SELECT first_name as "firstName", last_name as "lastName", department, date_of_birth as "dateOfBirth",
       TO_CHAR(date_of_birth, 'MM-DD') as "mmdd"
       FROM employees WHERE date_of_birth IS NOT NULL AND status = 'active'
       AND (
         (TO_CHAR(date_of_birth,'MM-DD') >= TO_CHAR(CURRENT_DATE,'MM-DD') AND TO_CHAR(date_of_birth,'MM-DD') <= TO_CHAR(CURRENT_DATE + INTERVAL '30 days','MM-DD'))
         OR (TO_CHAR(CURRENT_DATE,'MM-DD') > TO_CHAR(CURRENT_DATE + INTERVAL '30 days','MM-DD')
             AND (TO_CHAR(date_of_birth,'MM-DD') >= TO_CHAR(CURRENT_DATE,'MM-DD') OR TO_CHAR(date_of_birth,'MM-DD') <= TO_CHAR(CURRENT_DATE + INTERVAL '30 days','MM-DD')))
       )
       ORDER BY TO_CHAR(date_of_birth,'MM-DD') LIMIT 5`
    );

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

    // Latest announcements (top 5)
    const announcementsRes = await pool.query(
      `SELECT a.id as "_id", a.title, a.content as body, a.priority as type,
       a.is_active as "isPinned", a.created_at as "createdAt",
       json_build_object('firstName', e.first_name, 'lastName', e.last_name) as "postedBy"
       FROM announcements a
       JOIN employees e ON a.created_by = e.id
       WHERE a.is_active = true
       ORDER BY a.created_at DESC LIMIT 5`
    );

    res.json({
      success: true,
      data: {
        totalEmployees, present, absent, late, onLeave, pendingLeaves, weekData,
        recentActivity: recentAttendanceRes.rows,
        birthdays: birthdaysRes.rows,
        anniversaries: anniversariesRes.rows,
        deptBreakdown: deptRes.rows,
        announcements: announcementsRes.rows
      }
    });
  } catch (err) {
    serverError(res, err);
  }
});

module.exports = router;

