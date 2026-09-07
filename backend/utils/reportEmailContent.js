/**
 * utils/reportEmailContent.js
 *
 * Builds the {subject, text, html} for each scheduled report email. Every
 * number here comes from a direct read of the same tables the on-screen
 * reports read — nothing is invented or estimated — but the email itself is
 * a SUMMARY, not a redraw of the full interactive grid: Muster Roll's
 * day-by-day shift/status pairing, for instance, has no honest one-screen
 * email equivalent, so the email gives per-employee totals for the week and
 * links back into the app for the full picture. Where LOP figures are
 * needed, this calls the exact same lopDaysForRange() payroll itself uses,
 * rather than re-deriving the rule — so a number in this email and a number
 * on the LOP report can never quietly disagree.
 *
 * Every builder takes an optional trailing `custom` object — { subject, body }
 * — an admin's own wording from the Scheduled Reports screen. `subject`
 * replaces the email's envelope subject; `body` replaces the description
 * paragraph under the heading. Neither ever touches the data table: the
 * numbers stay computed live no matter what an admin has written, so a
 * template edit can change the wording but never misrepresent the figures.
 */
const pool = require('../db');
const { FRONTEND_URL } = process.env;
const APP_URL = FRONTEND_URL || 'https://nxtpeople.altiusnxt.tech';

const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const fmtDate = (d) => new Date(`${String(d).slice(0, 10)}T00:00:00`)
  .toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/* One shared shell so every scheduled email looks like it belongs to the
 * same feature. `rows` is an array of [label, value] pairs rendered as a
 * simple stat table; `table` is an optional pre-built HTML table for
 * per-employee detail beneath it. `custom.subject`/`custom.body` are an
 * admin's own wording, applied on top of the defaults. */
function wrap({ title, periodLabel, introLine, rows = [], table = '', linkPath, linkLabel, custom = {} }) {
  const subject = (custom.subject || '').trim() || title;
  const effectiveIntro = (custom.body || '').trim() || introLine;
  const statRows = rows.map(([label, value]) =>
    `<tr><td style="padding:6px 0;color:#64748b;font-size:13px;">${escapeHtml(label)}</td>
         <td style="padding:6px 0;text-align:right;font-weight:600;color:#0f172a;font-size:13px;">${escapeHtml(value)}</td></tr>`
  ).join('');
  const button = linkPath
    ? `<tr><td style="padding:20px 32px 8px;"><a href="${APP_URL}${linkPath}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:13.5px;font-weight:600;">${escapeHtml(linkLabel || 'Open in NxtPeople')}</a></td></tr>`
    : '';
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
    <tr><td style="padding:28px 32px 4px;font-size:17px;font-weight:700;color:#0f172a;">${escapeHtml(title)}</td></tr>
    <tr><td style="padding:0 32px 16px;font-size:13px;color:#64748b;">${escapeHtml(periodLabel)}</td></tr>
    ${effectiveIntro ? `<tr><td style="padding:0 32px 16px;font-size:13.5px;color:#334155;white-space:pre-wrap;">${escapeHtml(effectiveIntro)}</td></tr>` : ''}
    ${rows.length ? `<tr><td style="padding:0 32px;"><table role="presentation" cellpadding="0" cellspacing="0" width="100%">${statRows}</table></td></tr>` : ''}
    ${table ? `<tr><td style="padding:16px 32px 0;">${table}</td></tr>` : ''}
    ${button}
    <tr><td style="padding:20px 32px;margin-top:8px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:11.5px;color:#94a3b8;">Automated report from NxtPeople. This is a summary — open the link above for the full, live report.</td></tr>
  </table>
</body></html>`;
  const text = `${title}\n${periodLabel}\n\n${effectiveIntro ? effectiveIntro + '\n\n' : ''}`
    + rows.map(([l, v]) => `${l}: ${v}`).join('\n')
    + (linkPath ? `\n\nOpen in NxtPeople: ${APP_URL}${linkPath}` : '');
  return { subject, text, html };
}

function detailTable(headers, rows) {
  if (!rows.length) return '';
  const th = headers.map(h => `<th style="text-align:left;padding:6px 8px;background:#f8fafc;color:#475569;font-size:12px;border-bottom:1px solid #e2e8f0;">${escapeHtml(h)}</th>`).join('');
  const trs = rows.map(r => `<tr>${r.map(c => `<td style="padding:6px 8px;font-size:12.5px;color:#334155;border-bottom:1px solid #f1f5f9;">${escapeHtml(c)}</td>`).join('')}</tr>`).join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
}

/* ── Daily Attendance — content covers yesterday ─────────────────────── */
async function dailyAttendanceEmail(reportDate, custom) {
  const r = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM employees WHERE status='active' AND deleted_at IS NULL AND is_user=TRUE) AS total,
       (SELECT COUNT(*) FROM attendance a JOIN employees e ON e.id=a.employee_id
          WHERE a.date=$1::date AND a.check_in IS NOT NULL AND e.status='active') AS present,
       (SELECT COUNT(*) FROM attendance a JOIN employees e ON e.id=a.employee_id
          WHERE a.date=$1::date AND a.status='late' AND e.status='active') AS late,
       (SELECT COUNT(DISTINCT l.employee_id) FROM leaves l JOIN employees e ON e.id=l.employee_id
          WHERE l.status='approved' AND l.start_date<=$1::date AND l.end_date>=$1::date AND e.status='active') AS on_leave,
       (SELECT COUNT(DISTINCT o.employee_id) FROM on_duty_requests o JOIN employees e ON e.id=o.employee_id
          WHERE o.status='approved' AND o.start_date<=$1::date AND COALESCE(o.end_date,o.start_date)>=$1::date AND e.status='active') AS on_duty`,
    [reportDate]);
  const s = r.rows[0];
  const accounted = Number(s.present) + Number(s.on_leave) + Number(s.on_duty);
  const absent = Math.max(0, Number(s.total) - accounted);
  return wrap({
    title: 'Daily Attendance',
    periodLabel: fmtDate(reportDate),
    rows: [
      ['Total active users', s.total],
      ['Present', s.present],
      ['Late', s.late],
      ['On approved leave', s.on_leave],
      ['On duty', s.on_duty],
      ['Absent / unaccounted', absent],
    ],
    linkPath: `/reports/attendance/daily-status?date=${reportDate}`,
    linkLabel: 'View Daily Attendance report',
    custom,
  });
}

/* ── Weekly Attendance — the week just closed ────────────────────────── */
async function weeklyAttendanceEmail(start, end, holidays, custom) {
  const r = await pool.query(
    `WITH days AS (SELECT d::date AS day FROM generate_series($1::date, $2::date, '1 day') d)
     SELECT
       (SELECT COUNT(*) FROM employees WHERE status='active' AND deleted_at IS NULL AND is_user=TRUE) AS total,
       (SELECT COUNT(*) FROM attendance a JOIN employees e ON e.id=a.employee_id
          WHERE a.date BETWEEN $1::date AND $2::date AND a.check_in IS NOT NULL AND e.status='active') AS present_days,
       (SELECT COUNT(*) FROM leaves l JOIN employees e ON e.id=l.employee_id
          WHERE l.status='approved' AND l.start_date<=$2::date AND l.end_date>=$1::date AND e.status='active') AS leave_spans`,
    [start, end]);
  const s = r.rows[0];
  const holidayLine = holidays.length
    ? `Holiday(s) this week: ${holidays.map(h => `${h.name} (${fmtDate(h.date)})`).join(', ')}`
    : 'No holidays fell in this week.';
  return wrap({
    title: 'Weekly Attendance',
    periodLabel: `${fmtDate(start)} – ${fmtDate(end)}`,
    introLine: holidayLine,
    rows: [
      ['Total active users', s.total],
      ['Present (employee-days)', s.present_days],
      ['Leave spans overlapping the week', s.leave_spans],
    ],
    linkPath: `/reports/attendance/present-absent?startDate=${start}&endDate=${end}`,
    linkLabel: 'View the week in Present/Absent Status',
    custom,
  });
}

/* ── Onboarding data — new joiners in the week just closed ───────────── */
async function onboardingEmail(start, end, custom) {
  const r = await pool.query(
    `SELECT employee_id AS code, first_name || ' ' || COALESCE(last_name,'') AS name,
            department, date_of_joining::text AS doj
       FROM employees
      WHERE date_of_joining BETWEEN $1::date AND $2::date AND deleted_at IS NULL
      ORDER BY date_of_joining`,
    [start, end]);
  const rows = r.rows.map(e => [e.code, e.name.trim(), e.department || '—', fmtDate(e.doj)]);
  return wrap({
    title: 'Onboarding Data',
    periodLabel: `New joiners, ${fmtDate(start)} – ${fmtDate(end)}`,
    introLine: r.rows.length ? `${r.rows.length} new joiner(s) this week.` : 'No new joiners this week.',
    table: detailTable(['Code', 'Name', 'Department', 'Joined'], rows),
    linkPath: '/registrations',
    linkLabel: 'View Registrations',
    custom,
  });
}

/* ── Muster Roll — per-employee totals for the week just closed ──────── */
async function musterRollEmail(start, end, custom) {
  const r = await pool.query(
    `SELECT e.employee_id AS code, e.first_name || ' ' || COALESCE(e.last_name,'') AS name,
            COUNT(*) FILTER (WHERE a.check_in IS NOT NULL) AS present_days,
            COUNT(DISTINCT l.id) AS leave_records
       FROM employees e
       LEFT JOIN attendance a ON a.employee_id = e.id AND a.date BETWEEN $1::date AND $2::date
       LEFT JOIN leaves l ON l.employee_id = e.id AND l.status='approved'
                          AND l.start_date <= $2::date AND l.end_date >= $1::date
      WHERE e.status='active' AND e.deleted_at IS NULL AND e.is_user=TRUE
      GROUP BY e.id, e.employee_id, e.first_name, e.last_name
      ORDER BY e.employee_id`,
    [start, end]);
  const rows = r.rows.map(e => [e.code, e.name.trim(), e.present_days, e.leave_records]);
  return wrap({
    title: 'Muster Roll',
    periodLabel: `Week of ${fmtDate(start)} – ${fmtDate(end)}`,
    introLine: 'Per-employee totals for the week. Shift and daily status are on the live grid, not this summary.',
    table: detailTable(['Code', 'Name', 'Present days', 'Leave records'], rows),
    linkPath: `/reports/attendance/muster-roll?startDate=${start}&endDate=${end}`,
    linkLabel: 'View the full Muster Roll grid',
    custom,
  });
}

/* ── Monthly attendance — the closing pay period ─────────────────────── */
async function monthlyAttendanceEmail(start, end, custom) {
  const r = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM employees WHERE status='active' AND deleted_at IS NULL AND is_user=TRUE) AS total,
       (SELECT COUNT(*) FROM attendance a JOIN employees e ON e.id=a.employee_id
          WHERE a.date BETWEEN $1::date AND $2::date AND a.check_in IS NOT NULL AND e.status='active') AS present_days,
       (SELECT COUNT(*) FROM leaves l JOIN employees e ON e.id=l.employee_id
          WHERE l.status='approved' AND l.start_date<=$2::date AND l.end_date>=$1::date AND e.status='active') AS leave_spans,
       (SELECT COUNT(*) FROM attendance_regularizations r JOIN employees e ON e.id=r.employee_id
          WHERE r.status='approved' AND r.date BETWEEN $1::date AND $2::date AND e.status='active') AS regularizations`,
    [start, end]);
  const s = r.rows[0];
  return wrap({
    title: 'Monthly Attendance',
    periodLabel: `${fmtDate(start)} – ${fmtDate(end)} (pay period closing)`,
    introLine: 'Regularizations approved inside this window are already reflected in the present-day count above.',
    rows: [
      ['Total active users', s.total],
      ['Present (employee-days)', s.present_days],
      ['Leave spans overlapping the period', s.leave_spans],
      ['Regularizations approved', s.regularizations],
    ],
    linkPath: `/reports/attendance/present-absent?startDate=${start}&endDate=${end}`,
    linkLabel: 'View the full period',
    custom,
  });
}

/* Shared LOP computation for Payroll and LOP emails — same function, same
 * numbers, framed for two different audiences. */
async function lopByEmployee(start, end) {
  const { loadHolidaysAndRules, lopDaysForRange } = require('../routes/payroll');
  const d = new Date(`${start}T00:00:00`);
  const { holMap, rules } = await loadHolidaysAndRules(d.getMonth() + 1, d.getFullYear());
  const emps = (await pool.query(
    `SELECT id, employee_id AS code, first_name || ' ' || COALESCE(last_name,'') AS name
       FROM employees WHERE status='active' AND deleted_at IS NULL AND is_user=TRUE ORDER BY employee_id`)).rows;
  const out = [];
  for (const e of emps) {
    const days = await lopDaysForRange(e.id, start, end, holMap, rules);
    if (days > 0) out.push({ code: e.code, name: e.name.trim(), days });
  }
  return out;
}

/* ── Payroll feed — that period's LOP, ready for payroll processing ──── */
async function payrollFeedEmail(start, end, custom) {
  const lop = await lopByEmployee(start, end);
  const total = lop.reduce((s, r) => s + r.days, 0);
  return wrap({
    title: 'Payroll Feed',
    periodLabel: `${fmtDate(start)} – ${fmtDate(end)} (pay period closing)`,
    introLine: `${lop.length} employee(s) have Loss-of-Pay days this period, ${total} day(s) total. Attendance is ready for payroll processing.`,
    table: detailTable(['Code', 'Name', 'LOP days'], lop.map(r => [r.code, r.name, r.days])),
    linkPath: '/payroll/run',
    linkLabel: 'Open Payroll Run',
    custom,
  });
}

/* ── LOP data — its own report, same numbers as the payroll feed ─────── */
async function lopDataEmail(start, end, custom) {
  const lop = await lopByEmployee(start, end);
  const total = lop.reduce((s, r) => s + r.days, 0);
  return wrap({
    title: 'Loss of Pay (LOP) Data',
    periodLabel: `${fmtDate(start)} – ${fmtDate(end)}`,
    introLine: lop.length ? `${total} LOP day(s) across ${lop.length} employee(s) this period.` : 'No Loss-of-Pay days this period.',
    table: detailTable(['Code', 'Name', 'LOP days'], lop.map(r => [r.code, r.name, r.days])),
    linkPath: `/reports/leave/lop?startDate=${start}&endDate=${end}`,
    linkLabel: 'View the LOP report',
    custom,
  });
}

/* ── Regularization pending reminder — one recipient's own scoped list ── */
async function regularizationReminderEmail(recipientId, isFullAccessRole, custom) {
  const r = await pool.query(
    `SELECT r.date::text AS date, r.reason,
            e.first_name || ' ' || COALESCE(e.last_name,'') AS name, e.employee_id AS code
       FROM attendance_regularizations r
       JOIN employees e ON e.id = r.employee_id
      WHERE r.status = 'pending'
        AND ($2::boolean OR EXISTS (
             SELECT 1 FROM approval_levels x
              WHERE x.request_type='regularization' AND x.request_id=r.id
                AND x.approver_id=$1 AND x.status='pending'))
      ORDER BY r.date`,
    [recipientId, isFullAccessRole]);
  if (!r.rows.length) return null; // nothing pending for this person — no mail
  const rows = r.rows.map(x => [x.code, x.name.trim(), fmtDate(x.date), x.reason || '—']);
  return wrap({
    title: 'Regularization Requests Pending Your Approval',
    periodLabel: `${r.rows.length} request(s) awaiting action`,
    introLine: 'These are due for approval or rejection today.',
    table: detailTable(['Code', 'Name', 'Date', 'Reason'], rows),
    linkPath: '/approvals',
    linkLabel: 'Open Approvals',
    custom,
  });
}

/* ── Headcount — active employees as of the report date ──────────────── */
async function headcountEmail(start, end, custom) {
  const r = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM employees WHERE status='active' AND deleted_at IS NULL) AS active_now,
       (SELECT COUNT(*) FROM employees WHERE date_of_joining BETWEEN $1::date AND $2::date AND deleted_at IS NULL) AS joined,
       (SELECT COUNT(*) FROM employees WHERE exit_date BETWEEN $1::date AND $2::date) AS exited`,
    [start, end]);
  const byDept = await pool.query(
    `SELECT COALESCE(department, 'Unassigned') AS dept, COUNT(*) AS n
       FROM employees WHERE status='active' AND deleted_at IS NULL
      GROUP BY dept ORDER BY n DESC`);
  const s = r.rows[0];
  return wrap({
    title: 'Headcount',
    periodLabel: `As of ${fmtDate(end)}, joiners/exits ${fmtDate(start)} – ${fmtDate(end)}`,
    rows: [
      ['Active headcount', s.active_now],
      ['Joined in this period', s.joined],
      ['Exited in this period', s.exited],
    ],
    table: detailTable(['Department', 'Active headcount'], byDept.rows.map(d => [d.dept, d.n])),
    linkPath: '/reports/employee/headcount',
    linkLabel: 'View Headcount report',
    custom,
  });
}

/* ── Addition Trend — new joiners in the period ───────────────────────── */
async function additionTrendEmail(start, end, custom) {
  const r = await pool.query(
    `SELECT employee_id AS code, first_name || ' ' || COALESCE(last_name,'') AS name,
            department, date_of_joining::text AS doj
       FROM employees
      WHERE date_of_joining BETWEEN $1::date AND $2::date AND deleted_at IS NULL
      ORDER BY date_of_joining`,
    [start, end]);
  return wrap({
    title: 'Addition Trend',
    periodLabel: `${fmtDate(start)} – ${fmtDate(end)}`,
    introLine: `${r.rows.length} addition(s) this period.`,
    table: detailTable(['Code', 'Name', 'Department', 'Joined'],
      r.rows.map(e => [e.code, e.name.trim(), e.department || '—', fmtDate(e.doj)])),
    linkPath: `/reports/employee/addition-trend?startDate=${start}&endDate=${end}`,
    linkLabel: 'View Addition Trend report',
    custom,
  });
}

/* ── Attrition Trend — exits in the period ────────────────────────────── */
async function attritionTrendEmail(start, end, custom) {
  const r = await pool.query(
    `SELECT employee_id AS code, first_name || ' ' || COALESCE(last_name,'') AS name,
            department, exit_date::text AS exit_date
       FROM employees
      WHERE exit_date BETWEEN $1::date AND $2::date
      ORDER BY exit_date`,
    [start, end]);
  return wrap({
    title: 'Attrition Trend',
    periodLabel: `${fmtDate(start)} – ${fmtDate(end)}`,
    introLine: `${r.rows.length} exit(s) this period.`,
    table: detailTable(['Code', 'Name', 'Department', 'Exit date'],
      r.rows.map(e => [e.code, e.name.trim(), e.department || '—', fmtDate(e.exit_date)])),
    linkPath: `/reports/employee/attrition-trend?startDate=${start}&endDate=${end}`,
    linkLabel: 'View Attrition Trend report',
    custom,
  });
}

/* ── Experience & Exit — exits in the period, with tenure ─────────────── */
async function experienceExitEmail(start, end, custom) {
  const r = await pool.query(
    `SELECT employee_id AS code, first_name || ' ' || COALESCE(last_name,'') AS name,
            department, date_of_joining::text AS doj, exit_date::text AS exit_date,
            AGE(exit_date, date_of_joining) AS tenure
       FROM employees
      WHERE exit_date BETWEEN $1::date AND $2::date
      ORDER BY exit_date`,
    [start, end]);
  const tenureLabel = (t) => {
    if (!t) return '—';
    const years = t.years || 0, months = t.months || 0;
    return years ? `${years}y ${months}m` : `${months}m`;
  };
  return wrap({
    title: 'Experience & Exit',
    periodLabel: `${fmtDate(start)} – ${fmtDate(end)}`,
    introLine: `${r.rows.length} exit(s) this period, with tenure at the time of exit.`,
    table: detailTable(['Code', 'Name', 'Department', 'Joined', 'Exited', 'Tenure'],
      r.rows.map(e => [e.code, e.name.trim(), e.department || '—', fmtDate(e.doj), fmtDate(e.exit_date), tenureLabel(e.tenure)])),
    linkPath: `/reports/employee/experience-exit?startDate=${start}&endDate=${end}`,
    linkLabel: 'View Experience & Exit report',
    custom,
  });
}

module.exports = {
  dailyAttendanceEmail, weeklyAttendanceEmail, onboardingEmail, musterRollEmail,
  monthlyAttendanceEmail, payrollFeedEmail, lopDataEmail, regularizationReminderEmail,
  headcountEmail, additionTrendEmail, attritionTrendEmail, experienceExitEmail,
};
