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

import React from 'react';
import OrganizationDetails from './org/OrganizationDetails';
import OrganizationPolicy from './org/OrganizationPolicy';
import Locations from './org/Locations';
import Departments from './org/Departments';
import Designations from './org/Designations';
import Companies from './org/Companies';
import BusinessUnits from './org/BusinessUnits';
import Divisions from './org/Divisions';
import StructureConfiguration from './org/StructureConfiguration';
import ManageStructure from './org/ManageStructure';
import { GeneralRole, SpecificRole } from './access/RoleCards';
import SpecificRoleAssignment from './access/SpecificRoleAssignment';
import FunctionPermissions from './access/FunctionPermissions';
import Administrators from './access/Administrators';
import ApplicabilityGroups from './access/ApplicabilityGroups';
import Users from './org/Users';

import AttendanceMethods from './attendance/AttendanceMethods';
import AttendancePolicy from './attendance/AttendancePolicy';
import CheckInOutConfig from './attendance/CheckInOutConfig';
import RegularizationConfig from './attendance/RegularizationConfig';
import OnDutyConfig from './attendance/OnDutyConfig';
import AttendanceReportsConfig from './attendance/AttendanceReportsConfig';
import AttendanceAdditionalOptions from './attendance/AttendanceAdditionalOptions';
import GeoRestriction from './attendance/GeoRestriction';
import ApprovalRules from './attendance/ApprovalRules';
import EmailTemplates from './attendance/EmailTemplates';
import EmailAlerts from './attendance/EmailAlerts';
import AbsentScheduler from './attendance/AbsentScheduler';

import ShiftsGeneral from './shifts/ShiftsGeneral';
// Manage Shifts is the existing Shifts screen, not a copy: there is one set of
// shifts, and two editors for one table is how they drift apart.
import ManageShifts from '../Shifts';

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
  'accounts.users.users': Users,
  // Organization Structure. The rail nests these under one group; the routing
  // is flat, because a group is never a destination of its own.
  'accounts.configuration.structure-configuration': StructureConfiguration,
  'accounts.configuration.companies': Companies,
  'accounts.configuration.business-units': BusinessUnits,
  'accounts.configuration.divisions': Divisions,
  'accounts.configuration.manage-structure': ManageStructure,

  // User Access Control. Roles nests in the rail; the routing is flat.
  'accounts.permissions.general-role': GeneralRole,
  'accounts.permissions.specific-role': SpecificRole,
  'accounts.permissions.specific-role-assignment': SpecificRoleAssignment,
  'accounts.permissions.function-permissions': FunctionPermissions,
  'accounts.permissions.administrator': Administrators,
  'accounts.permissions.applicability-groups': ApplicabilityGroups,
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
  'attendance.approvals.approvals': ApprovalRules,
  'attendance.automation.absent-scheduler': AbsentScheduler,
  'attendance.automation.email-alerts': EmailAlerts,
  'attendance.automation.email-templates': EmailTemplates,

  'shifts.configuration.general': ShiftsGeneral,
  'shifts.configuration.manage-shifts': ManageShifts,

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
  // Same screen, different service: it lists the request types that belong to
  // whichever service opened it.
  'leave.approvals.approvals': () => <ApprovalRules service="leave" />,
};

export default SECTION_SCREENS;
