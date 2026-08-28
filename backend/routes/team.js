/**
 * routes/team.js — Aggregate endpoint for the Team Space sidebar panels.
 *
 * One round-trip → all six panels the page needs:
 *   • teamStrength       (count of active employees in my department)
 *   • teamAvailability   (today's in / out / yet-to-check-in breakdown)
 *   • locationDiversity  (work_location → count, top 5)
 *   • recentlyCheckedIn  (last 5 check-ins in my department today)
 *   • newHires           (joined in last 15 days, in my department)
 *   • birthdayBuddy      (today's birthdays in my department)
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect } = require('../middleware/auth');
const { allows } = require('../utils/functionAccess');
const logger = require('../logger');
const { serverError } = require('../utils/serverError');

router.use(protect);

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
      // 2. Availability — today's attendance for departmentmates
      pool.query(
        `SELECT
            SUM(CASE WHEN a.check_in IS NOT NULL AND a.check_out IS NULL THEN 1 ELSE 0 END)::int AS "in",
            SUM(CASE WHEN a.check_out IS NOT NULL THEN 1 ELSE 0 END)::int AS "out",
            SUM(CASE WHEN a.check_in IS NULL THEN 1 ELSE 0 END)::int     AS "yetToCheckIn"
           FROM employees e
      LEFT JOIN attendance a ON a.employee_id = e.id AND a.date = CURRENT_DATE
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

module.exports = router;
