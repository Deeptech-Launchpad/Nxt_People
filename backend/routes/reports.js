const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { isFullAccess, isManager, reportsScope } = require('../utils/roles');
const { countWorkingDays, ruleMatchesDate } = require('../utils/workingDays');
const { lopDaysForRange, listWorkingDays, loadHolidaysAndRules } = require('./payroll');
router.use(protect);

// Merges loadHolidaysAndRules() across every month a [startDate, endDate]
// range touches — the payroll version only loads one month at a time
// (payroll always operates on a single pay-month), but these reports let
// the user pick an arbitrary custom range that can cross month boundaries.
async function loadHolidaysAndRulesRange(startDate, endDate) {
  const start = new Date(startDate), end = new Date(endDate);
  const holMap = new Map();
  let rules = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor <= end) {
    const monthData = await loadHolidaysAndRules(cursor.getMonth() + 1, cursor.getFullYear());
    monthData.holMap.forEach((v, k) => holMap.set(k, v));
    rules = monthData.rules; // the active weekend-rule set isn't month-specific
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return { holMap, rules };
}

// Bug #10 fix: single JOIN+GROUP BY query instead of N+1 loop
// Bug #20 fix: summary now accepts startDate/endDate OR month/year params
router.get('/attendance', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const { startDate, endDate, department, employeeId } = req.query;
    const start = startDate ? startDate : new Date(new Date().setDate(1)).toLocaleDateString('en-CA');
    const end = endDate ? endDate : new Date().toLocaleDateString('en-CA');

    let empQuery = 'WHERE 1=1';
    let empParams = [];
    let empIdx = 1;

    if (department) { empQuery += ` AND department = $${empIdx++}`; empParams.push(department); }
    if (employeeId) { empQuery += ` AND id = $${empIdx++}`; empParams.push(employeeId); }

    // Visibility scope: full-access sees everyone; managers only their direct
    // reports; a plain employee only themselves. This both restricts the data
    // and stands in for a role guard (the route is otherwise protect-only).
    if (!isFullAccess(req.user.role)) {
      if (isManager(req.user.role)) {
        empQuery += ` AND (reporting_manager_id = $${empIdx} OR approving_authority_id = $${empIdx})`;
        empParams.push(req.user._id); empIdx++;
      } else {
        empQuery += ` AND id = $${empIdx++}`; empParams.push(req.user._id);
      }
    }

    const employeesRes = await pool.query(
      `SELECT id as "_id", first_name as "firstName", last_name as "lastName", department, employee_id as "employeeId" FROM employees ${empQuery}`,
      empParams
    );

    if (employeesRes.rows.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const ids = employeesRes.rows.map(e => e._id);
    const empMap = new Map(employeesRes.rows.map(e => [e._id, e]));

    const attRes = await pool.query(
      `SELECT a.id as "_id", a.date, a.check_in as "checkIn", a.check_out as "checkOut", a.working_hours as "workingHours",
              a.status, a.late_minutes as "lateMinutes", s.end_time as "shiftEnd",
       json_build_object('_id', e.id, 'firstName', e.first_name, 'lastName', e.last_name, 'department', e.department, 'employeeId', e.employee_id) as employee
       FROM attendance a
       JOIN employees e ON a.employee_id = e.id
       LEFT JOIN shifts s ON a.shift_id = s.id
       WHERE a.employee_id = ANY($1) AND a.date >= $2::date AND a.date <= $3::date
       ORDER BY a.date DESC`,
      [ids, start, end]
    );

    // Attendance rows never carry status='leave' (see attendance.js:726) — approved
    // leave days have to be pulled from the leaves table and merged in as synthetic
    // rows so the Detailed Report can show "Leave" for days with no attendance record.
    const covered = new Set(attRes.rows.map(r => `${r.employee._id}_${new Date(r.date).toDateString()}`));
    const leaveRes = await pool.query(
      `SELECT employee_id, start_date, end_date
         FROM leaves
        WHERE employee_id = ANY($1) AND status = 'approved' AND start_date <= $3::date AND end_date >= $2::date`,
      [ids, start, end]
    );

    const leaveRows = [];
    for (const l of leaveRes.rows) {
      const emp = empMap.get(l.employee_id);
      if (!emp) continue;
      const rangeStart = new Date(Math.max(new Date(l.start_date), new Date(start)));
      const rangeEnd = new Date(Math.min(new Date(l.end_date), new Date(end)));
      for (let d = new Date(rangeStart); d <= rangeEnd; d.setDate(d.getDate() + 1)) {
        const key = `${l.employee_id}_${d.toDateString()}`;
        if (covered.has(key)) continue;
        covered.add(key);
        leaveRows.push({
          _id: `leave-${l.employee_id}-${d.toISOString().slice(0, 10)}`,
          date: new Date(d), checkIn: null, checkOut: null, workingHours: 0,
          status: 'leave', lateMinutes: null, shiftEnd: null,
          employee: { _id: emp._id, firstName: emp.firstName, lastName: emp.lastName, department: emp.department, employeeId: emp.employeeId },
        });
      }
    }

    const data = [...attRes.rows, ...leaveRows].sort((a, b) => new Date(b.date) - new Date(a.date));
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// Bug #10 + #20 fix: single aggregation query, also accepts startDate/endDate
router.get('/summary', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const { month, year, startDate, endDate } = req.query;
    let start, end;

    if (startDate && endDate) {
      start = startDate;
      end = endDate;
    } else {
      const now = new Date();
      const m = month ? parseInt(month) - 1 : now.getMonth();
      const y = parseInt(year) || now.getFullYear();
      start = new Date(y, m, 1).toLocaleDateString('en-CA');
      end = new Date(y, m + 1, 0).toLocaleDateString('en-CA');
    }

    // Single query with GROUP BY instead of N+1 loop
    const result = await pool.query(
      `SELECT
        e.id as "_id",
        e.first_name as "firstName",
        e.last_name as "lastName",
        e.department,
        COUNT(CASE WHEN a.status IN ('present', 'late') THEN 1 END)::int AS present,
        COUNT(CASE WHEN a.status = 'absent' THEN 1 END)::int AS absent,
        COUNT(CASE WHEN a.status = 'late' THEN 1 END)::int AS late,
        ROUND(COALESCE(SUM(a.working_hours), 0)::numeric, 2) AS "totalHours",
        COALESCE(MAX(perm.permission_hours), 0) AS "permissionHours"
       FROM employees e
       LEFT JOIN attendance a ON a.employee_id = e.id AND a.date >= $1::date AND a.date <= $2::date
       LEFT JOIN (
         SELECT employee_id, SUM(hours) AS permission_hours
           FROM leaves
          WHERE leave_type = 'permission' AND status = 'approved'
            AND start_date >= $1::date AND start_date <= $2::date
          GROUP BY employee_id
       ) perm ON perm.employee_id = e.id
       WHERE e.status = 'active'${reportsScope(req.user, 'e', 3).clause}
       GROUP BY e.id, e.first_name, e.last_name, e.department
       ORDER BY e.first_name ASC`,
      [start, end, ...reportsScope(req.user, 'e', 3).params]
    );

    const results = result.rows.map(r => ({
      employee: { _id: r._id, firstName: r.firstName, lastName: r.lastName, department: r.department },
      present: r.present,
      absent: r.absent,
      late: r.late,
      totalHours: parseFloat(r.totalHours),
      permissionHours: parseFloat(r.permissionHours) || 0
    }));

    // Attendance % needs one shared denominator (actual working days that
    // have elapsed so far), not each employee's own present+absent count —
    // otherwise two people with a different number of recorded days can
    // both land on "100%". Reuses the same weekend-rules/holidays-aware
    // working-day calendar Payroll's LOP calculation already relies on.
    const today = new Date().toLocaleDateString('en-CA');
    const elapsedEnd = end < today ? end : today;
    const [totalWorkingDays, elapsedWorkingDays] = await Promise.all([
      countWorkingDays(start, end),
      start <= elapsedEnd ? countWorkingDays(start, elapsedEnd) : Promise.resolve(0),
    ]);

    res.json({ success: true, data: results, workingDays: { total: totalWorkingDays, elapsed: elapsedWorkingDays } });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// Single-day snapshot for the Daily Report pie chart: how many employees are
// present (broken down into currently checked-in vs. already checked out),
// absent, or on approved leave for one specific date.
router.get('/daily', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const date = req.query.date || new Date().toLocaleDateString('en-CA');
    const { department } = req.query;

    let empQuery = "WHERE e.status = 'active'";
    let empParams = [];
    let empIdx = 1;
    if (department) { empQuery += ` AND e.department = $${empIdx++}`; empParams.push(department); }
    if (!isFullAccess(req.user.role)) {
      if (isManager(req.user.role)) {
        empQuery += ` AND (e.reporting_manager_id = $${empIdx} OR e.approving_authority_id = $${empIdx})`;
        empParams.push(req.user._id); empIdx++;
      } else {
        empQuery += ` AND e.id = $${empIdx++}`; empParams.push(req.user._id);
      }
    }
    const dateIdx = empIdx;

    const r = await pool.query(
      `SELECT e.id as "_id", e.first_name as "firstName", e.last_name as "lastName", e.department,
              a.status as "attStatus", a.check_in as "checkIn", a.check_out as "checkOut",
              l.id as "leaveId"
         FROM employees e
         LEFT JOIN attendance a ON a.employee_id = e.id AND a.date = $${dateIdx}::date
         LEFT JOIN leaves l ON l.employee_id = e.id AND l.status = 'approved'
                            AND l.start_date <= $${dateIdx}::date AND l.end_date >= $${dateIdx}::date
         ${empQuery}
        ORDER BY e.first_name`,
      [...empParams, date]
    );

    // A day that hasn't ended yet (today or a future date) can't have real
    // "absents" — nobody with no record on file has failed to show up, they
    // just haven't checked in yet. Only a past date's no-record employees
    // are counted as Absent.
    const isOpenDay = date >= new Date().toLocaleDateString('en-CA');

    const counts = { checkedIn: 0, checkedOut: 0, leave: 0, absent: 0, yetToCheckIn: 0 };
    const data = r.rows.map(row => {
      let status;
      if (row.leaveId) { status = 'leave'; counts.leave++; }
      else if (row.attStatus === 'absent') { status = 'absent'; counts.absent++; }
      else if (row.checkIn && !row.checkOut) { status = 'checked-in'; counts.checkedIn++; }
      else if (row.checkIn && row.checkOut) { status = 'checked-out'; counts.checkedOut++; }
      else if (isOpenDay) { status = 'yet-to-check-in'; counts.yetToCheckIn++; }
      // Past date, no attendance row and no leave on file — same "absent"
      // convention the dashboard headcount widget already uses
      // (dashboard.js: a.id IS NULL).
      else { status = 'absent'; counts.absent++; }
      return { _id: row._id, firstName: row.firstName, lastName: row.lastName, department: row.department, status, checkIn: row.checkIn, checkOut: row.checkOut };
    });

    res.json({ success: true, date, counts, data });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// ══════════════════════ Employee Information reports ══════════════════════

// null-safe % growth — avoids Infinity/NaN when the baseline is 0.
const pctGrowth = (curr, prev) => (prev ? parseFloat((((curr - prev) / prev) * 100).toFixed(2)) : null);

router.get('/employee/dashboard', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toLocaleDateString('en-CA');
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toLocaleDateString('en-CA');
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toLocaleDateString('en-CA');
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0).toLocaleDateString('en-CA');
    const sameMonthLastYearStart = new Date(now.getFullYear() - 1, now.getMonth(), 1).toLocaleDateString('en-CA');
    const sameMonthLastYearEnd = new Date(now.getFullYear() - 1, now.getMonth() + 1, 0).toLocaleDateString('en-CA');
    const sameDayLastYear = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).toLocaleDateString('en-CA');

    const [statsRes, deptRes, genderRes, additionSeries, attritionSeries, ageRows, experienceRows] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE e.status='active')::int AS active,
           COUNT(*) FILTER (WHERE e.status != 'active')::int AS inactive,
           COUNT(*) FILTER (WHERE e.status='active' AND e.joining_date >= $1::date AND e.joining_date <= $2::date)::int AS "newThisMonth",
           COUNT(*) FILTER (WHERE e.exit_date >= $1::date AND e.exit_date <= $2::date)::int AS "exitsThisMonth",
           COUNT(*) FILTER (WHERE e.status='active' AND e.joining_date >= $3::date AND e.joining_date <= $4::date)::int AS "newLastMonth",
           COUNT(*) FILTER (WHERE e.exit_date >= $3::date AND e.exit_date <= $4::date)::int AS "exitsLastMonth",
           COUNT(*) FILTER (WHERE e.status='active' AND e.joining_date >= $5::date AND e.joining_date <= $6::date)::int AS "newSameMonthLastYear",
           COUNT(*) FILTER (WHERE e.exit_date >= $5::date AND e.exit_date <= $6::date)::int AS "exitsSameMonthLastYear",
           COUNT(*) FILTER (WHERE e.joining_date <= $4::date AND (e.exit_date IS NULL OR e.exit_date > $4::date))::int AS "headcountLastMonth",
           COUNT(*) FILTER (WHERE e.joining_date <= $7::date AND (e.exit_date IS NULL OR e.exit_date > $7::date))::int AS "headcountSameMonthLastYear"
         FROM employees e WHERE 1=1${reportsScope(req.user, 'e', 8).clause}`,
        [monthStart, monthEnd, prevMonthStart, prevMonthEnd, sameMonthLastYearStart, sameMonthLastYearEnd, sameDayLastYear, ...reportsScope(req.user, 'e', 8).params]
      ),
      pool.query(
        `SELECT COALESCE(e.department,'Unassigned') AS label, COUNT(*)::int AS count
           FROM employees e WHERE e.status='active'${reportsScope(req.user, 'e', 1).clause}
          GROUP BY e.department ORDER BY count DESC`,
        reportsScope(req.user, 'e', 1).params
      ),
      pool.query(
        `SELECT COALESCE(e.gender,'Unspecified') AS label, COUNT(*)::int AS count
           FROM employees e WHERE e.status='active'${reportsScope(req.user, 'e', 1).clause}
          GROUP BY e.gender ORDER BY count DESC`,
        reportsScope(req.user, 'e', 1).params
      ),
      // Last 6 months addition/attrition, with month-over-month growth —
      // feeds the two mini combo charts, which deep-link to the full
      // Addition/Attrition Trend reports.
      monthlySeriesWithGrowth('joining_date', 5, req.user),
      monthlySeriesWithGrowth('exit_date', 5, req.user),
      ageOrTenureBuckets('date_of_birth', req.user),
      ageOrTenureBuckets('joining_date', req.user),
    ]);

    const s = statsRes.rows[0];
    res.json({
      success: true,
      data: {
        ...s,
        headcount: { thisMonth: s.active, momGrowth: pctGrowth(s.active, s.headcountLastMonth), yoy: s.headcountSameMonthLastYear, yoyGrowth: pctGrowth(s.active, s.headcountSameMonthLastYear) },
        addition: { thisMonth: s.newThisMonth, momGrowth: pctGrowth(s.newThisMonth, s.newLastMonth), yoy: s.newSameMonthLastYear, yoyGrowth: pctGrowth(s.newThisMonth, s.newSameMonthLastYear) },
        attrition: { thisMonth: s.exitsThisMonth, momGrowth: pctGrowth(s.exitsThisMonth, s.exitsLastMonth), yoy: s.exitsSameMonthLastYear, yoyGrowth: pctGrowth(s.exitsThisMonth, s.exitsSameMonthLastYear) },
        byDepartment: deptRes.rows,
        byGender: genderRes.rows,
        byAge: ageRows,
        byExperience: experienceRows,
        last6MonthsAddition: additionSeries,
        last6MonthsAttrition: attritionSeries,
      },
    });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// Year-over-year headcount trend: how many employees were active as of the
// end of each year (or "as of today" for the current year), plus % growth
// vs. the prior year. Point-in-time reconstruction — an employee counts for
// year Y if they'd joined by then and hadn't exited yet — not just today's
// active count repeated across years.
router.get('/employee/headcount-trend', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const yearsBack = Math.min(15, Math.max(1, parseInt(req.query.years, 10) || 10));
    const currentYear = new Date().getFullYear();
    const startYear = currentYear - yearsBack + 1;
    const today = new Date().toLocaleDateString('en-CA');

    const counts = [];
    for (let y = startYear; y <= currentYear; y++) {
      const asOf = y === currentYear ? today : `${y}-12-31`;
      // eslint-disable-next-line no-await-in-loop
      const r = await pool.query(
        `SELECT COUNT(*)::int AS count FROM employees e
          WHERE e.joining_date <= $1::date AND (e.exit_date IS NULL OR e.exit_date > $1::date)${reportsScope(req.user, 'e', 2).clause}`,
        [asOf, ...reportsScope(req.user, 'e', 2).params]
      );
      counts.push({ year: y, count: r.rows[0].count });
    }

    const data = counts.map((row, i) => {
      const prev = i > 0 ? counts[i - 1].count : null;
      const growth = prev ? parseFloat((((row.count - prev) / prev) * 100).toFixed(2)) : null;
      return { ...row, growth };
    });
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// Dense month-by-month series (zero-count months included, matching Zoho's
// continuous axis) with month-over-month % growth. Fetches one extra
// leading month purely as the growth baseline for the first displayed bar,
// then drops it from the returned series. dateColumn is always a fixed
// literal from this file, never user input.
async function monthlySeriesWithGrowth(dateColumn, months, user) {
  const r = await pool.query(
    `SELECT to_char(date_trunc('month', e.${dateColumn}), 'YYYY-MM') AS ym, COUNT(*)::int AS count
       FROM employees e
      WHERE e.${dateColumn} >= (date_trunc('month', CURRENT_DATE) - ($1 || ' months')::interval)${reportsScope(user, 'e', 2).clause}
      GROUP BY 1`,
    [months + 1, ...reportsScope(user, 'e', 2).params]
  );
  const countMap = new Map(r.rows.map(row => [row.ym, row.count]));
  const now = new Date();
  const series = [];
  for (let i = months; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    series.push({ year: d.getFullYear(), month: d.toLocaleDateString('en-US', { month: 'short' }), count: countMap.get(ym) || 0 });
  }
  return series.slice(1).map((row, i) => {
    const prev = series[i].count;
    const growth = prev > 0 ? parseFloat((((row.count - prev) / prev) * 100).toFixed(2)) : null;
    return { month: row.month, year: row.year, count: row.count, growth };
  });
}

router.get('/employee/addition-trend', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const months = Math.min(24, Math.max(1, parseInt(req.query.months, 10) || 12));
    const data = await monthlySeriesWithGrowth('joining_date', months, req.user);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.get('/employee/attrition-trend', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const months = Math.min(24, Math.max(1, parseInt(req.query.months, 10) || 12));
    const data = await monthlySeriesWithGrowth('exit_date', months, req.user);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.get('/employee/distribution', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    // Whitelisted before interpolation — never accept the column name straight from req.query.
    const col = req.query.by === 'designation' ? 'e.designation' : req.query.by === 'location' ? 'e.work_location' : 'e.department';
    const r = await pool.query(
      `SELECT COALESCE(${col}, 'Unassigned') AS label, COUNT(*)::int AS count
         FROM employees e WHERE e.status='active'${reportsScope(req.user, 'e', 1).clause}
        GROUP BY ${col} ORDER BY count DESC`,
      reportsScope(req.user, 'e', 1).params
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// 5-year-wide buckets for age (date_of_birth) or current tenure
// (joining_date) among active employees. Shared by /employee/diversity's
// age/experience types and the Dashboard's mini widgets, so both always
// agree on the same bucketing.
async function ageOrTenureBuckets(dateColumn, user) {
  const r = await pool.query(
    `SELECT (FLOOR(EXTRACT(YEAR FROM AGE(CURRENT_DATE, e.${dateColumn})) / 5) * 5)::int AS bucket_start, COUNT(*)::int AS count
       FROM employees e
      WHERE e.status='active' AND e.${dateColumn} IS NOT NULL${reportsScope(user, 'e', 1).clause}
      GROUP BY bucket_start ORDER BY bucket_start`,
    reportsScope(user, 'e', 1).params
  );
  return r.rows.map(row => ({ label: `${row.bucket_start}-${row.bucket_start + 4}`, count: row.count }));
}

// Diversity covers three switchable views, matching Zoho's "Type" selector:
// gender (default), age (date_of_birth), and experience (current tenure).
router.get('/employee/diversity', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const type = ['age', 'experience'].includes(req.query.type) ? req.query.type : 'gender';
    if (type === 'age') {
      return res.json({ success: true, type, data: await ageOrTenureBuckets('date_of_birth', req.user) });
    }
    if (type === 'experience') {
      return res.json({ success: true, type, data: await ageOrTenureBuckets('joining_date', req.user) });
    }
    const r = await pool.query(
      `SELECT COALESCE(e.gender,'Unspecified') AS label, COUNT(*)::int AS count
         FROM employees e WHERE e.status='active'${reportsScope(req.user, 'e', 1).clause}
        GROUP BY e.gender ORDER BY count DESC`,
      reportsScope(req.user, 'e', 1).params
    );
    res.json({ success: true, type, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// Per-year buckets (<1, 1, 2, 3, ...) rather than wide bands, matching
// Zoho's granularity — banded at 10+ so a handful of very long tenures
// don't produce a chart with dozens of near-empty buckets.
router.get('/employee/experience-exit', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT
         CASE WHEN yrs < 1 THEN '<1' WHEN yrs >= 10 THEN '10+' ELSE yrs::text END AS label,
         LEAST(yrs, 10) AS sort_key,
         COUNT(*)::int AS count
        FROM (
          SELECT FLOOR(EXTRACT(YEAR FROM AGE(e.exit_date, e.joining_date)))::int AS yrs
            FROM employees e
           WHERE e.exit_date IS NOT NULL AND e.joining_date IS NOT NULL${reportsScope(req.user, 'e', 1).clause}
        ) ranked
       GROUP BY label, sort_key
       ORDER BY sort_key`,
      reportsScope(req.user, 'e', 1).params
    );
    res.json({ success: true, data: r.rows.map(({ label, count }) => ({ label, count })) });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// ══════════════════════════ Leave Tracker reports ══════════════════════════

// Pie-by-leave-type for the day, plus the underlying employee list for the
// "list" view toggle — Zoho's Daily Leave Status is a type breakdown, not
// a flat name list.
router.get('/leave/daily-status', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const date = req.query.date || new Date().toLocaleDateString('en-CA');
    const [typeRes, listRes] = await Promise.all([
      pool.query(
        `SELECT l.leave_type AS "leaveType", COUNT(*)::int AS count
           FROM leaves l JOIN employees e ON l.employee_id = e.id
          WHERE l.status = 'approved' AND l.start_date <= $1::date AND l.end_date >= $1::date${reportsScope(req.user, 'e', 2).clause}
          GROUP BY l.leave_type`,
        [date, ...reportsScope(req.user, 'e', 2).params]
      ),
      pool.query(
        `SELECT l.id AS "_id", e.first_name AS "firstName", e.last_name AS "lastName", e.department, e.employee_id AS "employeeCode",
                l.leave_type AS "leaveType", l.is_half_day AS "isHalfDay"
           FROM leaves l JOIN employees e ON l.employee_id = e.id
          WHERE l.status = 'approved' AND l.start_date <= $1::date AND l.end_date >= $1::date${reportsScope(req.user, 'e', 2).clause}
          ORDER BY e.first_name`,
        [date, ...reportsScope(req.user, 'e', 2).params]
      ),
    ]);
    res.json({ success: true, date, byType: typeRes.rows, employees: listRes.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// Day-by-day leave calendar grid across a date range — same walk pattern as
// Attendance's Muster Roll, but cells carry a leave-type code (CL/CO/LWP/PM)
// instead of a present/absent code. Includes exited employees (annotated
// with their exit date) since Zoho's own report does too.
router.get('/leave/resource-availability', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const start = req.query.startDate || new Date(new Date().setDate(1)).toLocaleDateString('en-CA');
    const end = req.query.endDate || new Date().toLocaleDateString('en-CA');
    const startD = new Date(start), endD = new Date(end);
    const { holMap, rules } = await loadHolidaysAndRulesRange(startD, endD);

    const [empRes, leaveRes, absentRes] = await Promise.all([
      pool.query(
        `SELECT id AS "_id", first_name AS "firstName", last_name AS "lastName", department, employee_id AS "employeeCode", exit_date AS "exitDate"
           FROM employees e WHERE 1=1${reportsScope(req.user, 'e', 1).clause} ORDER BY first_name`,
        reportsScope(req.user, 'e', 1).params
      ),
      pool.query(
        `SELECT employee_id, leave_type, start_date, end_date, is_half_day
           FROM leaves WHERE status='approved' AND start_date <= $2::date AND end_date >= $1::date`,
        [start, end]
      ),
      // Plain attendance-marked absences (no approved leave covering the day)
      // get their own 'A' code — Zoho's calendar marks these too, not just
      // approved-leave days.
      pool.query(
        `SELECT employee_id, date FROM attendance WHERE status='absent' AND date >= $1::date AND date <= $2::date`,
        [start, end]
      ),
    ]);

    const LEAVE_CODE = { casual: 'CL', comp_off: 'CO', unpaid: 'LWP', permission: 'PM' };
    const leavesByEmp = new Map();
    leaveRes.rows.forEach(l => {
      if (!leavesByEmp.has(l.employee_id)) leavesByEmp.set(l.employee_id, []);
      leavesByEmp.get(l.employee_id).push({ code: LEAVE_CODE[l.leave_type] || l.leave_type, start: new Date(l.start_date), end: new Date(l.end_date), isHalfDay: l.is_half_day });
    });
    const absentByEmp = new Set(absentRes.rows.map(r => `${r.employee_id}|${new Date(r.date).toLocaleDateString('en-CA')}`));

    const days = [];
    for (const d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) days.push(new Date(d));

    const data = empRes.rows.map(emp => {
      const cells = days.map(day => {
        const key = `${day.getFullYear()}-${day.getMonth() + 1}-${day.getDate()}`;
        const holType = holMap.get(key);
        if (holType && holType !== 'working_day') return 'H';
        if (!holType && rules.some(rule => ruleMatchesDate(rule, day))) return 'WO';
        const leave = (leavesByEmp.get(emp._id) || []).find(l => day >= l.start && day <= l.end);
        if (leave) return `${leave.code}${leave.isHalfDay ? '½' : ''}`;
        if (absentByEmp.has(`${emp._id}|${day.toLocaleDateString('en-CA')}`)) return 'A';
        return '';
      });
      return { ...emp, days: cells };
    });

    res.json({ success: true, data, dayLabels: days.map(d => d.toLocaleDateString('en-CA')), startDate: start, endDate: end });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// Per-employee balance (pick one employee, see their figures) — matches
// Zoho's picker-driven Employee Leave Balance rather than an all-employees
// table. Every leave type reports both a days figure and an hours figure
// (blank/0 for whichever unit doesn't apply to that type) instead of a
// Day/Hour toggle that hides one or the other.
// Deliberately limited to casual/comp-off/unpaid/permission — those are the
// only leave types with a real, wired-up balance concept anywhere in this
// app's leave flow (see /leaves/balance). employees.sick_leave/earned_leave
// exist as columns but no application flow ever reads/writes them for a
// real balance, so showing them would just be fake numbers.
router.get('/leave/balance-user', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const { employeeId } = req.query;
    if (!employeeId) return res.status(400).json({ success: false, message: 'employeeId is required' });
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();

    const empRes = await pool.query(
      `SELECT id AS "_id", first_name AS "firstName", last_name AS "lastName", employee_id AS "employeeCode", department, exit_date AS "exitDate", COALESCE(casual_leave,0) AS "casualAllocated"
         FROM employees WHERE id = $1`, [employeeId]
    );
    const emp = empRes.rows[0];
    if (!emp) return res.status(404).json({ success: false, message: 'Employee not found' });

    const [leaveRes, compRes] = await Promise.all([
      pool.query(
        `SELECT leave_type AS "leaveType", COALESCE(SUM(total_days),0) AS days, COALESCE(SUM(hours),0) AS hours
           FROM leaves WHERE employee_id = $1 AND status = 'approved' AND EXTRACT(YEAR FROM start_date) = $2
           GROUP BY leave_type`,
        [employeeId, year]
      ),
      pool.query(
        `SELECT COALESCE(SUM(days_earned),0) AS earned, COALESCE(SUM(days_used),0) AS used
           FROM comp_offs WHERE employee_id = $1 AND status = 'approved' AND EXTRACT(YEAR FROM worked_date) = $2`,
        [employeeId, year]
      ),
    ]);

    const byType = new Map(leaveRes.rows.map(r => [r.leaveType, r]));
    const casualBooked = parseFloat(byType.get('casual')?.days) || 0;
    const casualAllocated = parseFloat(emp.casualAllocated) || 0;
    const unpaidBooked = parseFloat(byType.get('unpaid')?.days) || 0;
    const permissionHours = parseFloat(byType.get('permission')?.hours) || 0;
    const compEarned = parseFloat(compRes.rows[0].earned) || 0;
    const compUsed = parseFloat(compRes.rows[0].used) || 0;

    const data = [
      { leaveType: 'casual', label: 'Casual Leave', grantedDays: casualAllocated, bookedDays: casualBooked, balanceDays: Math.max(0, casualAllocated - casualBooked), grantedHours: null, bookedHours: 0, balanceHours: null },
      { leaveType: 'comp_off', label: 'Compensatory Off', grantedDays: compEarned, bookedDays: compUsed, balanceDays: Math.max(0, compEarned - compUsed), grantedHours: null, bookedHours: 0, balanceHours: null },
      { leaveType: 'unpaid', label: 'Leave Without Pay', grantedDays: null, bookedDays: unpaidBooked, balanceDays: null, grantedHours: null, bookedHours: 0, balanceHours: null },
      { leaveType: 'permission', label: 'Permission', grantedDays: null, bookedDays: 0, balanceDays: null, grantedHours: null, bookedHours: permissionHours, balanceHours: null },
    ];
    res.json({ success: true, employee: emp, year, data });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// Month-by-month drilldown for one employee + one leave type — the modal
// Zoho opens when you click a leave type row. Granted is only shown where
// this app actually has a real monthly/annual grant rule: Casual is a flat
// annual allocation (granted once, in January — this system has no monthly
// accrual schedule for it, so spreading it out would be fabricated data);
// Permission is a real 4h/calendar-month allowance (see leaves.js); Comp-Off
// is granted per worked_date event, so its monthly figure is a real sum of
// whatever was earned that month. Unpaid has no grant concept at all, so its
// granted/balance stay null every month, same as the summary table.
router.get('/leave/balance-user-detail', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const { employeeId, leaveType } = req.query;
    if (!employeeId || !['casual', 'comp_off', 'unpaid', 'permission'].includes(leaveType)) {
      return res.status(400).json({ success: false, message: 'employeeId and a valid leaveType are required' });
    }
    const now = new Date();
    const year = parseInt(req.query.year, 10) || now.getFullYear();
    const monthsCount = year === now.getFullYear() ? now.getMonth() + 1 : 12;

    const empRes = await pool.query('SELECT COALESCE(casual_leave,0) AS "casualAllocated" FROM employees WHERE id = $1', [employeeId]);
    if (!empRes.rows[0]) return res.status(404).json({ success: false, message: 'Employee not found' });
    const casualAllocated = parseFloat(empRes.rows[0].casualAllocated) || 0;

    const bookedRes = await pool.query(
      `SELECT EXTRACT(MONTH FROM start_date)::int AS month, COALESCE(SUM(total_days),0) AS days, COALESCE(SUM(hours),0) AS hours
         FROM leaves WHERE employee_id = $1 AND leave_type = $2 AND status = 'approved' AND EXTRACT(YEAR FROM start_date) = $3
         GROUP BY month`,
      [employeeId, leaveType, year]
    );
    const bookedByMonth = new Map(bookedRes.rows.map(r => [r.month, r]));

    let compOffGrantedByMonth = new Map();
    if (leaveType === 'comp_off') {
      const g = await pool.query(
        `SELECT EXTRACT(MONTH FROM worked_date)::int AS month, COALESCE(SUM(days_earned),0) AS earned
           FROM comp_offs WHERE employee_id = $1 AND status = 'approved' AND EXTRACT(YEAR FROM worked_date) = $2
           GROUP BY month`,
        [employeeId, year]
      );
      compOffGrantedByMonth = new Map(g.rows.map(r => [r.month, parseFloat(r.earned) || 0]));
    }

    const data = [];
    let cumGranted = 0, cumBooked = 0;
    for (let m = 1; m <= monthsCount; m++) {
      const bookedRow = bookedByMonth.get(m);
      const bookedDays = bookedRow ? parseFloat(bookedRow.days) || 0 : 0;
      const bookedHours = bookedRow ? parseFloat(bookedRow.hours) || 0 : 0;

      let granted = null;
      if (leaveType === 'casual') granted = m === 1 ? casualAllocated : 0;
      else if (leaveType === 'permission') granted = 4;
      else if (leaveType === 'comp_off') granted = compOffGrantedByMonth.get(m) || 0;

      let balance = null;
      if (granted !== null) {
        cumGranted += granted;
        cumBooked += leaveType === 'permission' ? bookedHours : bookedDays;
        balance = Math.max(0, cumGranted - cumBooked);
      }

      data.push({
        month: m,
        monthLabel: new Date(year, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        granted, bookedDays, bookedHours, balance, lapsed: 0,
      });
    }

    res.json({ success: true, data, leaveType, year, unit: leaveType === 'permission' ? 'hours' : 'days' });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.get('/leave/booked-balance', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const start = req.query.startDate || new Date(new Date().setDate(1)).toLocaleDateString('en-CA');
    const end = req.query.endDate || new Date().toLocaleDateString('en-CA');
    const r = await pool.query(
      `SELECT e.id AS "_id", e.first_name AS "firstName", e.last_name AS "lastName", e.department, e.employee_id AS "employeeCode", e.exit_date AS "exitDate",
              COALESCE(e.casual_leave, 0) AS "casualAllocated",
              COALESCE(casual.days, 0) AS "casualBooked",
              COALESCE(absent.cnt, 0) AS "absentBooked",
              COALESCE(lwp.days, 0) AS "lwpBooked",
              COALESCE(co.earned, 0) - COALESCE(co.used, 0) AS "compOffBalance",
              COALESCE(co_range.used, 0) AS "compOffBooked"
         FROM employees e
         LEFT JOIN (SELECT employee_id, SUM(total_days) AS days FROM leaves WHERE status='approved' AND leave_type='casual' AND start_date <= $2::date AND end_date >= $1::date GROUP BY employee_id) casual ON casual.employee_id = e.id
         LEFT JOIN (SELECT employee_id, SUM(total_days) AS days FROM leaves WHERE status='approved' AND leave_type='unpaid' AND start_date <= $2::date AND end_date >= $1::date GROUP BY employee_id) lwp ON lwp.employee_id = e.id
         LEFT JOIN (SELECT employee_id, COUNT(*)::int AS cnt FROM attendance WHERE status='absent' AND date >= $1::date AND date <= $2::date GROUP BY employee_id) absent ON absent.employee_id = e.id
         LEFT JOIN (SELECT employee_id, SUM(days_earned) AS earned, SUM(days_used) AS used FROM comp_offs WHERE status='approved' GROUP BY employee_id) co ON co.employee_id = e.id
         LEFT JOIN (SELECT employee_id, SUM(days_used) AS used FROM comp_offs WHERE status='approved' AND comp_off_date >= $1::date AND comp_off_date <= $2::date GROUP BY employee_id) co_range ON co_range.employee_id = e.id
        WHERE 1=1${reportsScope(req.user, 'e', 3).clause}
        ORDER BY e.first_name`,
      [start, end, ...reportsScope(req.user, 'e', 3).params]
    );
    const data = r.rows.map(row => {
      const casualAllocated = parseFloat(row.casualAllocated) || 0;
      const casualBooked = parseFloat(row.casualBooked) || 0;
      const absentBooked = parseFloat(row.absentBooked) || 0;
      const lwpBooked = parseFloat(row.lwpBooked) || 0;
      return {
        ...row,
        casualAllocated, casualBooked, casualBalance: Math.max(0, casualAllocated - casualBooked),
        absentBooked, lwpBooked,
        unpaidTotalBooked: absentBooked + lwpBooked,
        compOffBooked: parseFloat(row.compOffBooked) || 0,
        compOffBalance: parseFloat(row.compOffBalance) || 0,
      };
    });
    res.json({ success: true, data, startDate: start, endDate: end });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// Leave types + years that actually have data — feeds the "Leave type"
// dropdown on Leave Type Wise Summary, so it only ever shows real years
// (matching how Zoho's dropdown accumulates a "Casual Leave 2023/2024/2025"
// entry per year it's actually been used) instead of a hardcoded list.
router.get('/leave/types-available', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT DISTINCT leave_type AS "leaveType", EXTRACT(YEAR FROM start_date)::int AS year
         FROM leaves ORDER BY leave_type, year DESC`
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// Per-employee ledger for ONE leave type + year. openingBalance and lapsed
// are always 0 — this system has no carry-forward or lapse-policy tracking,
// so rather than fabricate numbers, those columns honestly show 0 instead
// of a guess.
router.get('/leave/type-summary', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const leaveType = ['casual', 'comp_off', 'unpaid', 'permission'].includes(req.query.leaveType) ? req.query.leaveType : 'casual';
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const r = await pool.query(
      `SELECT e.id AS "_id", e.first_name AS "firstName", e.last_name AS "lastName", e.department, e.employee_id AS "employeeCode", e.exit_date AS "exitDate",
              ${leaveType === 'casual' ? 'COALESCE(e.casual_leave,0)' : 'NULL'} AS granted,
              COALESCE(SUM(l.total_days) FILTER (WHERE l.status='approved'), 0) AS booked,
              COALESCE(SUM(l.hours) FILTER (WHERE l.status='approved'), 0) AS "bookedHours"
         FROM employees e
         LEFT JOIN leaves l ON l.employee_id = e.id AND l.leave_type = $1 AND EXTRACT(YEAR FROM l.start_date) = $2
        WHERE 1=1${reportsScope(req.user, 'e', 3).clause}
        GROUP BY e.id, e.first_name, e.last_name, e.department, e.employee_id, e.exit_date, e.casual_leave
        ORDER BY e.first_name`,
      [leaveType, year, ...reportsScope(req.user, 'e', 3).params]
    );
    const data = r.rows.map(row => {
      const granted = row.granted !== null ? parseFloat(row.granted) : null;
      const booked = parseFloat(row.booked) || 0;
      return {
        ...row, granted, booked,
        bookedHours: parseFloat(row.bookedHours) || 0,
        openingBalance: 0,
        closingBalance: granted !== null ? Math.max(0, granted - booked) : null,
        lapsed: 0,
      };
    });
    res.json({ success: true, data, leaveType, year });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.get('/leave/encashment', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT l.id AS "_id", l.leave_type AS "leaveType", l.days, l.status, l.reason, l.created_at AS "createdAt",
              e.first_name AS "firstName", e.last_name AS "lastName", e.department, e.employee_id AS "employeeCode", e.exit_date AS "exitDate"
         FROM leave_encashments l JOIN employees e ON l.employee_id = e.id
        WHERE 1=1${reportsScope(req.user, 'e', 1).clause}
        ORDER BY l.created_at DESC LIMIT 200`,
      reportsScope(req.user, 'e', 1).params
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// Reuses the exact same lopDaysForRange() Payroll Run computes with, so
// this report can never disagree with what actually gets deducted.
// previousPeriodBalance/waivedOff/carryOver/reason are always 0/blank —
// this system doesn't track LOP adjustments or carry-over between pay
// periods, so those columns are honestly empty rather than invented.
router.get('/leave/lop', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(new Date().setDate(1));
    const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();
    const { holMap, rules } = await loadHolidaysAndRulesRange(startDate, endDate);

    const empRes = await pool.query(
      `SELECT id AS "_id", first_name AS "firstName", last_name AS "lastName", department, employee_id AS "employeeCode", exit_date AS "exitDate"
         FROM employees e WHERE 1=1${reportsScope(req.user, 'e', 1).clause} ORDER BY first_name`,
      reportsScope(req.user, 'e', 1).params
    );

    const data = [];
    for (const emp of empRes.rows) {
      const lopDays = await lopDaysForRange(emp._id, startDate, endDate, holMap, rules, pool);
      if (lopDays > 0) {
        data.push({ ...emp, previousPeriodBalance: 0, booked: lopDays, total: lopDays, waivedOff: 0, carryOver: 0, reason: null, lopDays, lopHours: 0 });
      }
    }
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// Per-employee payroll-period summary — Total days / Loss of Pay / Paid
// days, matching Zoho's actual Leave Data for Payroll report (not a raw
// list of leave applications, which is a different report). "Total days"
// is the days the employee was actually on rolls within the period —
// capped by joining_date/exit_date on either end — so a mid-period
// joiner/exit shows their real partial-period day count, not the full
// period length.
router.get('/leave/payroll-export', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const start = req.query.startDate || new Date(new Date().setDate(1)).toLocaleDateString('en-CA');
    const end = req.query.endDate || new Date().toLocaleDateString('en-CA');
    const startD = new Date(start), endD = new Date(end);
    const { holMap, rules } = await loadHolidaysAndRulesRange(startD, endD);

    const empRes = await pool.query(
      `SELECT id AS "_id", first_name AS "firstName", last_name AS "lastName", employee_id AS "employeeCode", department,
              exit_date AS "exitDate", joining_date AS "joiningDate"
         FROM employees e WHERE 1=1${reportsScope(req.user, 'e', 1).clause} ORDER BY first_name`,
      reportsScope(req.user, 'e', 1).params
    );

    const data = [];
    for (const emp of empRes.rows) {
      const effStart = emp.joiningDate && new Date(emp.joiningDate) > startD ? new Date(emp.joiningDate) : startD;
      const effEnd = emp.exitDate && new Date(emp.exitDate) < endD ? new Date(emp.exitDate) : endD;
      if (effEnd < effStart) continue; // not on rolls at any point in this period
      const totalDays = Math.round((effEnd - effStart) / 86400000) + 1;
      const lopDays = await lopDaysForRange(emp._id, effStart, effEnd, holMap, rules, pool);
      data.push({ ...emp, totalDays, lopDays, paidDays: Math.max(0, totalDays - lopDays) });
    }
    res.json({ success: true, data, startDate: start, endDate: end });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// ══════════════════════════ Attendance reports (new) ═══════════════════════
// Daily attendance status, Employee present/absent status, and Early/late
// check-in and check-out are already covered by the existing Attendance
// Reports page's Daily/Summary/Detailed tabs (deep-linked via ?tab=) — no
// need to duplicate them here.

router.get('/attendance/hours-breakup', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const start = req.query.startDate || new Date(new Date().setDate(1)).toLocaleDateString('en-CA');
    const end = req.query.endDate || new Date().toLocaleDateString('en-CA');
    const r = await pool.query(
      `SELECT e.id AS "_id", e.first_name AS "firstName", e.last_name AS "lastName", e.department,
              COUNT(*) FILTER (WHERE a.status IN ('present','late'))::int AS "presentDays",
              ROUND(COALESCE(SUM(a.working_hours), 0)::numeric, 2) AS "totalHours"
         FROM employees e
         LEFT JOIN attendance a ON a.employee_id = e.id AND a.date >= $1::date AND a.date <= $2::date
        WHERE e.status='active'${reportsScope(req.user, 'e', 3).clause}
        GROUP BY e.id, e.first_name, e.last_name, e.department
        ORDER BY e.first_name`,
      [start, end, ...reportsScope(req.user, 'e', 3).params]
    );
    const data = r.rows.map(row => {
      const totalHours = parseFloat(row.totalHours) || 0;
      return { ...row, totalHours, avgHoursPerDay: row.presentDays > 0 ? parseFloat((totalHours / row.presentDays).toFixed(2)) : 0 };
    });
    res.json({ success: true, data, startDate: start, endDate: end });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.get('/attendance/payroll-export', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const start = req.query.startDate || new Date(new Date().setDate(1)).toLocaleDateString('en-CA');
    const end = req.query.endDate || new Date().toLocaleDateString('en-CA');
    const r = await pool.query(
      `SELECT e.first_name AS "firstName", e.last_name AS "lastName", e.employee_id AS "employeeCode", e.department,
              COUNT(*) FILTER (WHERE a.status IN ('present','late'))::int AS "presentDays",
              COUNT(*) FILTER (WHERE a.status = 'absent')::int AS "absentDays",
              ROUND(COALESCE(SUM(a.working_hours), 0)::numeric, 2) AS "totalHours"
         FROM employees e
         LEFT JOIN attendance a ON a.employee_id = e.id AND a.date >= $1::date AND a.date <= $2::date
        WHERE e.status='active'${reportsScope(req.user, 'e', 3).clause}
        GROUP BY e.id, e.first_name, e.last_name, e.employee_id, e.department
        ORDER BY e.first_name`,
      [start, end, ...reportsScope(req.user, 'e', 3).params]
    );
    const data = r.rows.map(row => ({ ...row, totalHours: parseFloat(row.totalHours) || 0 }));
    res.json({ success: true, data, startDate: start, endDate: end });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

// Day-by-day grid for one calendar month: P (present), HD (half-day),
// A (absent), L (leave), WO (weekly off), H (holiday), - (future/no data).
router.get('/attendance/muster-roll', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const month = Math.min(12, Math.max(1, parseInt(req.query.month, 10) || (new Date().getMonth() + 1)));
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const { holMap, rules } = await loadHolidaysAndRules(month, year);

    const daysInMonth = new Date(year, month, 0).getDate();
    const start = new Date(year, month - 1, 1).toLocaleDateString('en-CA');
    const end = new Date(year, month - 1, daysInMonth).toLocaleDateString('en-CA');

    const empRes = await pool.query(
      `SELECT id AS "_id", first_name AS "firstName", last_name AS "lastName", department, employee_id AS "employeeCode"
         FROM employees e WHERE e.status='active'${reportsScope(req.user, 'e', 1).clause} ORDER BY first_name`,
      reportsScope(req.user, 'e', 1).params
    );
    const [attRes, leaveRes] = await Promise.all([
      pool.query(`SELECT employee_id, date::text AS date, status FROM attendance WHERE date >= $1::date AND date <= $2::date`, [start, end]),
      pool.query(`SELECT employee_id, start_date, end_date FROM leaves WHERE status='approved' AND start_date <= $2::date AND end_date >= $1::date`, [start, end]),
    ]);

    const attMap = new Map(attRes.rows.map(r => [`${r.employee_id}_${r.date}`, r.status]));
    const leavesByEmp = new Map();
    leaveRes.rows.forEach(l => {
      if (!leavesByEmp.has(l.employee_id)) leavesByEmp.set(l.employee_id, []);
      leavesByEmp.get(l.employee_id).push({ start: new Date(l.start_date), end: new Date(l.end_date) });
    });

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const data = empRes.rows.map(emp => {
      const days = [];
      for (let d = 1; d <= daysInMonth; d++) {
        const dateObj = new Date(year, month - 1, d);
        const ymd = dateObj.toLocaleDateString('en-CA');
        const holType = holMap.get(`${year}-${month}-${d}`);
        let code;
        if (dateObj > today) code = '-';
        else if (holType && holType !== 'working_day') code = 'H';
        else if (!holType && rules.some(rule => ruleMatchesDate(rule, dateObj))) code = 'WO';
        else {
          const attStatus = attMap.get(`${emp._id}_${ymd}`);
          const onLeave = (leavesByEmp.get(emp._id) || []).some(l => dateObj >= l.start && dateObj <= l.end);
          if (attStatus === 'present' || attStatus === 'late') code = 'P';
          else if (attStatus === 'half-day') code = 'HD';
          else if (onLeave) code = 'L';
          else code = 'A';
        }
        days.push(code);
      }
      return { ...emp, days };
    });

    res.json({ success: true, data, month, year, daysInMonth });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.get('/attendance/consecutive-absences', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const start = req.query.startDate || new Date(new Date().setDate(1)).toLocaleDateString('en-CA');
    const end = req.query.endDate || new Date().toLocaleDateString('en-CA');
    const minDays = Math.max(2, parseInt(req.query.minDays, 10) || 2);

    const r = await pool.query(
      `SELECT a.employee_id AS "_id", a.date::text AS date, e.first_name AS "firstName", e.last_name AS "lastName", e.department
         FROM attendance a JOIN employees e ON a.employee_id = e.id
        WHERE a.status = 'absent' AND a.date >= $1::date AND a.date <= $2::date${reportsScope(req.user, 'e', 3).clause}
        ORDER BY a.employee_id, a.date`,
      [start, end, ...reportsScope(req.user, 'e', 3).params]
    );

    // Run-length detection of consecutive calendar-day absences per employee.
    const streaks = [];
    let cur = null;
    for (const row of r.rows) {
      const d = new Date(row.date);
      if (cur && cur.employeeId === row._id && (d - cur.lastDate) === 86400000) {
        cur.lastDate = d; cur.count++; cur.endDate = row.date;
      } else {
        if (cur && cur.count >= minDays) streaks.push(cur);
        cur = { employeeId: row._id, firstName: row.firstName, lastName: row.lastName, department: row.department, startDate: row.date, endDate: row.date, lastDate: d, count: 1 };
      }
    }
    if (cur && cur.count >= minDays) streaks.push(cur);

    const data = streaks.map(({ lastDate, employeeId, ...rest }) => ({ _id: employeeId, ...rest }));
    res.json({ success: true, data, startDate: start, endDate: end });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

router.get('/attendance/expected-vs-worked', authorize('admin', 'director', 'hr_admin', 'manager'), async (req, res) => {
  try {
    const start = req.query.startDate || new Date(new Date().setDate(1)).toLocaleDateString('en-CA');
    const end = req.query.endDate || new Date().toLocaleDateString('en-CA');
    const { holMap, rules } = await loadHolidaysAndRulesRange(new Date(start), new Date(end));
    const workingDaysCount = listWorkingDays(new Date(start), new Date(end), holMap, rules).length;

    const r = await pool.query(
      `SELECT e.id AS "_id", e.first_name AS "firstName", e.last_name AS "lastName", e.department,
              s.start_time AS "shiftStart", s.end_time AS "shiftEnd",
              ROUND(COALESCE(SUM(a.working_hours), 0)::numeric, 2) AS "workedHours"
         FROM employees e
         LEFT JOIN shifts s ON e.shift_id = s.id
         LEFT JOIN attendance a ON a.employee_id = e.id AND a.date >= $1::date AND a.date <= $2::date
        WHERE e.status='active'${reportsScope(req.user, 'e', 3).clause}
        GROUP BY e.id, e.first_name, e.last_name, e.department, s.start_time, s.end_time
        ORDER BY e.first_name`,
      [start, end, ...reportsScope(req.user, 'e', 3).params]
    );

    const data = r.rows.map(row => {
      let shiftHours = 9; // sane default when no shift is assigned
      if (row.shiftStart && row.shiftEnd) {
        const [sh, sm] = row.shiftStart.split(':').map(Number);
        const [eh, em] = row.shiftEnd.split(':').map(Number);
        shiftHours = ((eh * 60 + em) - (sh * 60 + sm)) / 60;
        if (shiftHours <= 0) shiftHours += 24;
      }
      const expectedHours = parseFloat((shiftHours * workingDaysCount).toFixed(2));
      const workedHours = parseFloat(row.workedHours) || 0;
      return { _id: row._id, firstName: row.firstName, lastName: row.lastName, department: row.department, expectedHours, workedHours, variance: parseFloat((workedHours - expectedHours).toFixed(2)) };
    });
    res.json({ success: true, data, startDate: start, endDate: end, workingDays: workingDaysCount });
  } catch (err) { res.status(500).json({ success: false, message: 'An internal server error occurred' }); }
});

module.exports = router;
