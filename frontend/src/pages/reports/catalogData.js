// Single source of truth for the report catalog — shared between the
// Reports landing page (renders the full categorized list) and ReportShell
// (renders the in-page "switch to another report in this category"
// dropdown), so the two never drift out of sync.
export const REPORT_CATALOG = [
  {
    category: 'Employee Information',
    reports: [
      { label: 'Dashboard',                  to: '/reports/employee/dashboard' },
      { label: 'Headcount',                  to: '/reports/employee/headcount' },
      { label: 'Employee addition trend',    to: '/reports/employee/addition-trend' },
      { label: 'Employee attrition trend',   to: '/reports/employee/attrition-trend' },
      { label: 'Distribution',               to: '/reports/employee/distribution' },
      { label: 'Diversity',                  to: '/reports/employee/diversity' },
      { label: 'Experience wise exit',       to: '/reports/employee/experience-exit' },
    ],
  },
  {
    category: 'Leave Tracker',
    reports: [
      { label: 'Daily leave status',          to: '/reports/leave/daily-status' },
      { label: 'Resource availability',       to: '/reports/leave/resource-availability' },
      { label: 'Employee leave balance',      to: '/reports/leave/balance' },
      { label: 'Leave booked and balance',    to: '/reports/leave/booked-balance' },
      { label: 'Leave type wise summary',     to: '/reports/leave/type-summary' },
      { label: 'Leave encashment details',    to: '/reports/leave/encashment' },
      { label: 'Loss of pay details',         to: '/reports/leave/lop' },
      { label: 'Leave data for payroll',      to: '/reports/leave/payroll-export' },
    ],
  },
  {
    // "Attendance Report" and "Daily Attendance" used to sit at the bottom of
    // this list. Both predate the per-report pages above and duplicated them:
    // the first rendered pages/Reports.jsx against three legacy endpoints, the
    // second was a live team view rather than a report at all. Neither was
    // linked from anywhere else, and neither excluded Employee Profiles, so the
    // catalog offered two ways to see a number that the report beside them had
    // just been corrected to stop showing.
    category: 'Attendance',
    reports: [
      { label: 'Daily attendance status',              to: '/reports/attendance/daily-status' },
      { label: 'Early/late check-in and check-out',    to: '/reports/attendance/early-late' },
      { label: 'Employee present/absent status',       to: '/reports/attendance/present-absent' },
      { label: 'Presence hours break-up',               to: '/reports/attendance/hours-breakup' },
      { label: 'Attendance data for payroll',           to: '/reports/attendance/payroll-export' },
      { label: 'Muster roll',                            to: '/reports/attendance/muster-roll' },
      { label: 'Consecutive absences',                   to: '/reports/attendance/consecutive-absences' },
      { label: 'Expected vs Worked Hours',               to: '/reports/attendance/expected-vs-worked' },
    ],
  },
];
