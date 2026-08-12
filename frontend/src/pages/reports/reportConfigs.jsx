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

export const additionTrendConfig = { title: 'Employee Addition Trend', subtitle: 'New hires per month', endpoint: '/reports/employee/addition-trend', barColor: '#10b981', switcherCategory: 'Employee Information' };
export const attritionTrendConfig = { title: 'Employee Attrition Trend', subtitle: 'Exits per month', endpoint: '/reports/employee/attrition-trend', barColor: '#ef4444', switcherCategory: 'Employee Information', showEmploymentType: true };

// Leave Data for Payroll is now a bespoke page (LeavePayrollExport.jsx) —
// a per-employee Total/Loss of Pay/Paid days summary, matching Zoho's
// actual report structure rather than a raw leave-application list.

// Every Attendance report is now a bespoke page too (AttendanceDailyStatus,
// EarlyLateCheckInOut, PresentAbsentStatus, PresenceHoursBreakup,
// AttendancePayrollData, MusterRoll, ConsecutiveAbsences, ExpectedVsWorked) —
// their real structure (two-chart dashboard, grouped Entry/Exit headers,
// calendar grids, single-employee drilldown, grouped payroll table) doesn't
// fit the generic single-table TableReportPage/ExportReportPage shape.
