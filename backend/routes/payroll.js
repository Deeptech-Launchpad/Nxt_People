const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
router.use(protect);

// GET payroll report for a month
router.get('/', authorize('admin', 'manager'), async (req, res) => {
  try {
    const { month, year } = req.query;
    const m = parseInt(month) || new Date().getMonth() + 1;
    const y = parseInt(year) || new Date().getFullYear();
    const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
    const endDate = new Date(y, m, 0).toLocaleDateString('en-CA');

    // Working days in this month (Mon-Fri, excluding holidays)
    const holidaysRes = await pool.query(
      `SELECT date FROM holidays WHERE EXTRACT(MONTH FROM date) = $1 AND EXTRACT(YEAR FROM date) = $2`,
      [m, y]
    );
    const holidayDates = new Set(holidaysRes.rows.map(h => h.date.toISOString().split('T')[0]));
    let totalWorkingDays = 0;
    const current = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T00:00:00');
    while (current <= end) {
      const day = current.getDay();
      const ds = current.toLocaleDateString('en-CA');
      if (day !== 0 && day !== 6 && !holidayDates.has(ds)) totalWorkingDays++;
      current.setDate(current.getDate() + 1);
    }

    // Per-employee summary
    const r = await pool.query(
      `SELECT e.id, e.first_name, e.last_name, e.employee_id as emp_id, e.department, e.designation,
       e.basic_salary, e.monthly_ctc,
       COUNT(CASE WHEN a.status IN ('present','late') THEN 1 END) as present_days,
       COUNT(CASE WHEN a.status = 'late' THEN 1 END) as late_days,
       COUNT(CASE WHEN a.status = 'half-day' THEN 1 END) as half_days,
       COALESCE(SUM(CASE WHEN a.check_out IS NOT NULL AND a.check_in IS NOT NULL
         THEN EXTRACT(EPOCH FROM (a.check_out - a.check_in))/3600 ELSE 0 END), 0) as total_hours,
       (SELECT COUNT(*) FROM leaves l WHERE l.employee_id = e.id AND l.status='approved'
         AND l.start_date <= $2 AND l.end_date >= $1) as approved_leave_days
       FROM employees e
       LEFT JOIN attendance a ON e.id = a.employee_id AND a.date BETWEEN $1::date AND $2::date
       WHERE e.status = 'active'
       GROUP BY e.id, e.first_name, e.last_name, e.employee_id, e.department, e.designation, e.basic_salary, e.monthly_ctc
       ORDER BY e.first_name`,
      [startDate, endDate]
    );

    const rows = r.rows.map(emp => {
      const present = parseInt(emp.present_days) || 0;
      const approved_leave = parseInt(emp.approved_leave_days) || 0;
      const half_days = parseInt(emp.half_days) || 0;
      const late = parseInt(emp.late_days) || 0;
      const paid_days = present + approved_leave + (half_days * 0.5);
      const lop_days = Math.max(0, totalWorkingDays - paid_days);
      const salary = parseFloat(emp.monthly_ctc) || 0;
      const per_day = salary > 0 ? salary / totalWorkingDays : 0;
      const net_salary = salary > 0 ? Math.round(salary - (lop_days * per_day)) : null;

      return {
        _id: emp.id,
        firstName: emp.first_name, lastName: emp.last_name,
        employeeId: emp.emp_id, department: emp.department, designation: emp.designation,
        basicSalary: parseFloat(emp.basic_salary) || 0,
        monthlyCTC: salary,
        presentDays: present, lateDays: late, halfDays: half_days,
        approvedLeaveDays: approved_leave,
        totalWorkingDays,
        paidDays: parseFloat(paid_days.toFixed(1)),
        lopDays: parseFloat(lop_days.toFixed(1)),
        totalHours: parseFloat(parseFloat(emp.total_hours).toFixed(1)),
        netSalary: net_salary
      };
    });

    res.json({ success: true, data: rows, meta: { month: m, year: y, totalWorkingDays, startDate, endDate } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// GET leave accrual — run monthly accrual
router.post('/accrue', authorize('admin'), async (req, res) => {
  try {
    const settingsRes = await pool.query('SELECT * FROM settings LIMIT 1');
    const s = settingsRes.rows[0];
    if (!s?.leave_accrual_enabled) return res.status(400).json({ success: false, message: 'Leave accrual is disabled in Settings' });

    const empRes = await pool.query("SELECT id FROM employees WHERE status='active'");
    let credited = 0;
    for (const emp of empRes.rows) {
      // Casual
      if (s.casual_accrual_per_month > 0) {
        await pool.query('UPDATE employees SET casual_leave = COALESCE(casual_leave,0) + $1 WHERE id=$2', [s.casual_accrual_per_month, emp.id]);
        await pool.query('INSERT INTO leave_accrual_log (employee_id, leave_type, days_added, reason) VALUES ($1,$2,$3,$4)', [emp.id, 'casual', s.casual_accrual_per_month, 'Monthly accrual']);
      }
      // Sick
      if (s.sick_accrual_per_month > 0) {
        await pool.query('UPDATE employees SET sick_leave = COALESCE(sick_leave,0) + $1 WHERE id=$2', [s.sick_accrual_per_month, emp.id]);
        await pool.query('INSERT INTO leave_accrual_log (employee_id, leave_type, days_added, reason) VALUES ($1,$2,$3,$4)', [emp.id, 'sick', s.sick_accrual_per_month, 'Monthly accrual']);
      }
      // Earned
      if (s.earned_accrual_per_month > 0) {
        await pool.query('UPDATE employees SET earned_leave = COALESCE(earned_leave,0) + $1 WHERE id=$2', [s.earned_accrual_per_month, emp.id]);
        await pool.query('INSERT INTO leave_accrual_log (employee_id, leave_type, days_added, reason) VALUES ($1,$2,$3,$4)', [emp.id, 'earned', s.earned_accrual_per_month, 'Monthly accrual']);
      }
      credited++;
    }
    await logAudit(req, {
      action: 'ACCRUE_LEAVE',
      resource: 'Payroll',
      details: { count: credited }
    });
    res.json({ success: true, message: `Leave accrued for ${credited} employees` });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
