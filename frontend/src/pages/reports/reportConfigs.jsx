import React from 'react';

// Config objects spread as props onto the generic TableReportPage /
// TrendReportPage / ExportReportPage components in App.jsx's route
// definitions — keeps App.jsx itself free of large inline JSX props.

// Diversity and Experience Wise Exit are now bespoke pages (donut chart /
// area chart) — see Diversity.jsx and ExperienceExit.jsx — not routed
// through TableReportPage anymore.

// Daily Leave Status, Resource Availability, Employee Leave Balance, Leave
// Booked and Balance, and Leave Type Wise Summary are now bespoke pages
// (DailyLeaveStatus.jsx / ResourceAvailability.jsx / LeaveBalance.jsx /
// BookedBalance.jsx / LeaveTypeSummary.jsx) — their real Zoho structure
// (pie+list toggle, calendar grid, employee-picker drilldown, grouped
// headers, dropdown-filtered ledger) doesn't fit the generic single-table
// TableReportPage shape.

export const encashmentConfig = {
  title: 'Leave Encashment Details', subtitle: 'All leave encashment requests', endpoint: '/reports/leave/encashment', filterType: 'none',
  emptyText: 'No encashment requests',
  columns: [
    { key: 'employee', header: 'Employee' },
    { key: 'leaveType', header: 'Type', format: v => <span className="capitalize">{v}</span> },
    { key: 'days', header: 'Days', align: 'right' },
    { key: 'status', header: 'Status', format: v => (
        <span className={`text-[12px] font-semibold px-2 py-0.5 rounded-full capitalize ${v === 'approved' ? 'bg-emerald-100 text-emerald-700' : v === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{v}</span>
      ) },
    { key: 'createdAt', header: 'Requested', format: v => new Date(v).toLocaleDateString('en-IN') },
  ],
};

// Loss of Pay Details is now a bespoke page (LossOfPay.jsx) — grouped
// Previous Period Balance/Booked/Total/Waived Off/Carry Over columns plus
// a "Push To Payroll" shortcut, matching Zoho's structure.

export const hoursBreakupConfig = {
  title: 'Presence Hours Break-up', subtitle: 'Total and average hours worked per employee', endpoint: '/reports/attendance/hours-breakup', filterType: 'range',
  columns: [
    { key: 'employee', header: 'Employee' },
    { key: 'presentDays', header: 'Present Days', align: 'right' },
    { key: 'totalHours', header: 'Total Hours', align: 'right', format: v => `${v}h` },
    { key: 'avgHoursPerDay', header: 'Avg Hours/Day', align: 'right', format: v => `${v}h` },
  ],
};

export const consecutiveAbsencesConfig = {
  title: 'Consecutive Absences', subtitle: 'Employees absent 2 or more days in a row', endpoint: '/reports/attendance/consecutive-absences', filterType: 'range',
  emptyText: 'No consecutive absence streaks in this period',
  columns: [
    { key: 'employee', header: 'Employee' },
    { key: 'startDate', header: 'From', format: v => new Date(v).toLocaleDateString('en-IN') },
    { key: 'endDate', header: 'To', format: v => new Date(v).toLocaleDateString('en-IN') },
    { key: 'count', header: 'Days', align: 'right' },
  ],
};

export const expectedVsWorkedConfig = {
  title: 'Expected vs Worked Hours', subtitle: 'Expected hours from shift × working days vs. actual hours logged', endpoint: '/reports/attendance/expected-vs-worked', filterType: 'range',
  columns: [
    { key: 'employee', header: 'Employee' },
    { key: 'expectedHours', header: 'Expected Hours', align: 'right' },
    { key: 'workedHours', header: 'Worked Hours', align: 'right' },
    { key: 'variance', header: 'Variance', align: 'right', format: v => <span className={v < 0 ? 'text-red-600 font-semibold' : 'text-emerald-600 font-semibold'}>{v > 0 ? '+' : ''}{v}h</span> },
  ],
};

export const additionTrendConfig = { title: 'Employee Addition Trend', subtitle: 'New hires per month', endpoint: '/reports/employee/addition-trend', barColor: '#10b981', switcherCategory: 'Employee Information' };
export const attritionTrendConfig = { title: 'Employee Attrition Trend', subtitle: 'Exits per month', endpoint: '/reports/employee/attrition-trend', barColor: '#ef4444', switcherCategory: 'Employee Information' };

// Leave Data for Payroll is now a bespoke page (LeavePayrollExport.jsx) —
// a per-employee Total/Loss of Pay/Paid days summary, matching Zoho's
// actual report structure rather than a raw leave-application list.

export const attendancePayrollExportConfig = {
  title: 'Attendance Data for Payroll', subtitle: 'Download present/absent days and hours for the selected period', endpoint: '/reports/attendance/payroll-export', sheetName: 'Attendance Data', fileStub: 'attendance-payroll-export',
  columns: [
    { key: 'firstName', header: 'First Name' }, { key: 'lastName', header: 'Last Name' }, { key: 'employeeCode', header: 'Employee ID' }, { key: 'department', header: 'Department' },
    { key: 'presentDays', header: 'Present Days' }, { key: 'absentDays', header: 'Absent Days' }, { key: 'totalHours', header: 'Total Hours' },
  ],
};
