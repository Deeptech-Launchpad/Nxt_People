import React from 'react';

// Config objects spread as props onto the generic TableReportPage /
// TrendReportPage / ExportReportPage components in App.jsx's route
// definitions — keeps App.jsx itself free of large inline JSX props.

export const diversityConfig = {
  title: 'Diversity', subtitle: 'Active employees by gender', endpoint: '/reports/employee/diversity', filterType: 'none',
  switcherCategory: 'Employee Information',
  columns: [
    { key: 'label', header: 'Gender' },
    { key: 'count', header: 'Count', align: 'right' },
  ],
};

export const experienceExitConfig = {
  title: 'Experience Wise Exit', subtitle: 'Exited employees banded by tenure at exit', endpoint: '/reports/employee/experience-exit', filterType: 'none',
  switcherCategory: 'Employee Information',
  columns: [
    { key: 'label', header: 'Tenure at Exit' },
    { key: 'count', header: 'Count', align: 'right' },
  ],
};

export const leaveTypeSummaryConfig = {
  title: 'Leave Type Wise Summary', subtitle: 'Approved leave requests and days by type', endpoint: '/reports/leave/type-summary', filterType: 'range',
  columns: [
    { key: 'leaveType', header: 'Leave Type', format: v => <span className="capitalize">{v}</span> },
    { key: 'count', header: 'Requests', align: 'right' },
    { key: 'totalDays', header: 'Total Days', align: 'right' },
  ],
};

export const dailyLeaveStatusConfig = {
  title: 'Daily Leave Status', subtitle: "Who's on approved leave for a given date", endpoint: '/reports/leave/daily-status', filterType: 'date',
  emptyText: 'Nobody is on leave this date',
  columns: [
    { key: 'employee', header: 'Employee' },
    { key: 'leaveType', header: 'Leave Type', format: (v, row) => <span className="capitalize">{v}{row.isHalfDay ? ' (Half Day)' : ''}</span> },
  ],
};

export const leaveBalanceConfig = {
  title: 'Employee Leave Balance', subtitle: 'Casual, comp-off, and unpaid leave balances for the selected year', endpoint: '/reports/leave/balance-all', filterType: 'year',
  columns: [
    { key: 'employee', header: 'Employee' },
    { key: 'casualAllocated', header: 'Casual Allocated', align: 'right' },
    { key: 'casualBooked', header: 'Casual Booked', align: 'right' },
    { key: 'casualBalance', header: 'Casual Balance', align: 'right', format: v => <span className="font-semibold text-emerald-700">{v}</span> },
    { key: 'compOffAvailable', header: 'Comp-Off Available', align: 'right' },
    { key: 'unpaidBooked', header: 'Unpaid Booked', align: 'right' },
  ],
};

export const bookedBalanceConfig = {
  title: 'Leave Booked and Balance', subtitle: 'Days booked in the selected period vs. yearly casual allocation', endpoint: '/reports/leave/booked-balance', filterType: 'range',
  columns: [
    { key: 'employee', header: 'Employee' },
    { key: 'daysBooked', header: 'Days Booked (period)', align: 'right' },
    { key: 'casualAllocated', header: 'Casual Allocated (year)', align: 'right' },
  ],
};

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

export const lopConfig = {
  title: 'Loss of Pay Details', subtitle: 'Unpaid LOP days in the selected period — the same calculation Payroll Run uses', endpoint: '/reports/leave/lop', filterType: 'range',
  emptyText: 'No LOP days in this period',
  columns: [
    { key: 'employee', header: 'Employee' },
    { key: 'lopDays', header: 'LOP Days', align: 'right', format: v => <span className="font-semibold text-amber-700">{v}</span> },
  ],
};

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

export const leavePayrollExportConfig = {
  title: 'Leave Data for Payroll', subtitle: 'Download approved leave days for the selected period', endpoint: '/reports/leave/payroll-export', sheetName: 'Leave Data', fileStub: 'leave-payroll-export',
  columns: [
    { key: 'firstName', header: 'First Name' }, { key: 'lastName', header: 'Last Name' }, { key: 'employeeCode', header: 'Employee ID' }, { key: 'department', header: 'Department' },
    { key: 'leaveType', header: 'Leave Type' }, { key: 'totalDays', header: 'Days' }, { key: 'startDate', header: 'Start Date' }, { key: 'endDate', header: 'End Date' },
  ],
};

export const attendancePayrollExportConfig = {
  title: 'Attendance Data for Payroll', subtitle: 'Download present/absent days and hours for the selected period', endpoint: '/reports/attendance/payroll-export', sheetName: 'Attendance Data', fileStub: 'attendance-payroll-export',
  columns: [
    { key: 'firstName', header: 'First Name' }, { key: 'lastName', header: 'Last Name' }, { key: 'employeeCode', header: 'Employee ID' }, { key: 'department', header: 'Department' },
    { key: 'presentDays', header: 'Present Days' }, { key: 'absentDays', header: 'Absent Days' }, { key: 'totalHours', header: 'Total Hours' },
  ],
};
