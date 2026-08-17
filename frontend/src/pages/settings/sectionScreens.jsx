// Maps a catalogue section to the screen that renders it.
//
// Keyed "service.tab.section" so the workspace can look one up without a chain
// of conditionals, and so a section declared in serviceCatalog with no screen
// here fails visibly on that one section rather than blanking the workspace.
//
// Several of these screens already existed and are reused rather than copied —
// Pay Period in particular is the same editor under both Attendance and Leave
// Tracker, because there is one set of pay periods either way and two editors
// for one table is how they drift apart.

import OrganizationDetails from './org/OrganizationDetails';
import OrganizationPolicy from './org/OrganizationPolicy';
import Locations from './org/Locations';
import Departments from './org/Departments';
import Designations from './org/Designations';

import AttendanceMethods from './attendance/AttendanceMethods';
import AttendancePolicy from './attendance/AttendancePolicy';
import CheckInOutConfig from './attendance/CheckInOutConfig';
import RegularizationConfig from './attendance/RegularizationConfig';
import OnDutyConfig from './attendance/OnDutyConfig';
import AttendanceReportsConfig from './attendance/AttendanceReportsConfig';
import AttendanceAdditionalOptions from './attendance/AttendanceAdditionalOptions';
import GeoRestriction from './attendance/GeoRestriction';

import LeaveMethods from './LeaveMethods';
import LeavePolicy from './LeavePolicy';
import LeaveAccrual from './LeaveAccrual';
import CompOffPolicy from './CompOffPolicy';
import WorkCalendar from './WorkCalendar';
import PayPeriods from './PayPeriods';
import LeaveReportsConfig from './LeaveReportsConfig';
import LeaveRequestConfig from './LeaveRequestConfig';
import HolidayConfig from './HolidayConfig';
import LeaveAdditionalOptions from './LeaveAdditionalOptions';

const SECTION_SCREENS = {
  'accounts.configuration.organization-details': OrganizationDetails,
  'accounts.configuration.organization-policy': OrganizationPolicy,
  'accounts.configuration.locations': Locations,
  'accounts.configuration.departments': Departments,
  'accounts.configuration.designations': Designations,

  'attendance.configuration.methods': AttendanceMethods,
  'attendance.configuration.attendance-policy': AttendancePolicy,
  'attendance.configuration.check-in-out': CheckInOutConfig,
  'attendance.configuration.regularization': RegularizationConfig,
  'attendance.configuration.on-duty': OnDutyConfig,
  'attendance.configuration.pay-periods': PayPeriods,
  'attendance.configuration.reports': AttendanceReportsConfig,
  'attendance.configuration.additional-options': AttendanceAdditionalOptions,
  'attendance.permissions.geo-restriction': GeoRestriction,

  'leave.configuration.methods': LeaveMethods,
  'leave.configuration.leave-policy': LeavePolicy,
  'leave.configuration.leave-accrual': LeaveAccrual,
  'leave.configuration.comp-off-policy': CompOffPolicy,
  'leave.configuration.work-calendar': WorkCalendar,
  'leave.configuration.pay-periods': PayPeriods,
  'leave.configuration.reports': LeaveReportsConfig,
  'leave.configuration.leave-request': LeaveRequestConfig,
  'leave.configuration.holidays': HolidayConfig,
  'leave.configuration.additional-options': LeaveAdditionalOptions,
};

export default SECTION_SCREENS;
