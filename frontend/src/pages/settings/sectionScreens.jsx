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
import AccountWorkflows from './automation/Workflows';
import WorkflowEmailAlerts from './automation/EmailAlerts';
import WorkflowFieldUpdates from './automation/FieldUpdates';
import WorkflowEmailTemplates from './automation/EmailTemplates';
import { WorkflowLogs, SchedulerLogs } from './automation/Logs';
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
import AutoShiftAssignment from './shifts/AutoShiftAssignment';
import ShiftPatterns from './shifts/ShiftPatterns';
import ShiftRotation from './shifts/ShiftRotation';

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

// Settings -> Employee Information.
import EmpBasicDetails from './empinfo/BasicDetails';
import EmpStatuses from './empinfo/EmployeeStatuses';
import EmpIdRules from './empinfo/EmployeeIdRules';
import EmpStreams from './empinfo/Streams';
import { KnowledgeBase as EmpKnowledgeBase, Faqs as EmpFaqs } from './empinfo/Resources';
import { Forms as EmpForms, CustomButton as EmpCustomButton, WebForms as EmpWebForms } from './empinfo/ExtendService';
import EmpApprovals from './empinfo/Approvals';
import {
  FieldPermissions as EmpFieldPermissions,
  ImportExportPermissions as EmpImportExportPermissions,
  TabularSectionPermissions as EmpTabularPermissions,
} from './empinfo/AccessControl';

const SECTION_SCREENS = {
  /* Employee Information. Approvals, Workflows, Email Alerts, Field Updates,
   * Templates and Logs are the SAME screens the other services use, given a
   * different scope — a second copy of an automation editor would drift from
   * the first within a release. */
  'employee-information.configuration.basic-details': EmpBasicDetails,
  'employee-information.configuration.employee-id': EmpIdRules,
  'employee-information.configuration.employee-status': EmpStatuses,
  'employee-information.configuration.streams': EmpStreams,
  'employee-information.configuration.knowledge-base': EmpKnowledgeBase,
  'employee-information.configuration.faq': EmpFaqs,
  'employee-information.extend-service.forms': EmpForms,
  'employee-information.extend-service.custom-button': EmpCustomButton,
  'employee-information.extend-service.web-forms': EmpWebForms,

  /* Not ApprovalRules. That engine approves REQUESTS — leave, regularization,
   * on duty. The reference's Employee Information approvals govern changes to
   * the RECORD itself: somebody edits their profile and it waits for consent.
   * We have no such flow, and pointing this at the request engine would show
   * an empty list that reads as broken rather than as absent. */
  'employee-information.approvals.approvals': EmpApprovals,

  'employee-information.automation.workflows': AccountWorkflows,
  'employee-information.automation.email-alerts': WorkflowEmailAlerts,
  'employee-information.automation.field-updates': WorkflowFieldUpdates,
  'employee-information.automation.email-templates': WorkflowEmailTemplates,
  'employee-information.automation.workflow-logs': WorkflowLogs,

  'employee-information.permissions.field-permissions': EmpFieldPermissions,
  'employee-information.permissions.import-export-permissions': EmpImportExportPermissions,
  'employee-information.permissions.tabular-permissions': EmpTabularPermissions,

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

  // Automation. Actions and Templates nest in the rail; routing stays flat.
  'accounts.automation.workflows': AccountWorkflows,
  'accounts.automation.email-alerts': WorkflowEmailAlerts,
  'accounts.automation.field-updates': WorkflowFieldUpdates,
  'accounts.automation.email-templates': WorkflowEmailTemplates,
  'accounts.automation.workflow-logs': WorkflowLogs,
  'accounts.automation.scheduler-logs': SchedulerLogs,

  // No service prop: every form's approvals in one list.
  'accounts.approvals.approvals': () => <ApprovalRules />,
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
  // Explicit, because the component's default became "every form" for the
  // account-level tab — leaving this bare would have quietly shown Leave and
  // Comp Off approvals under Attendance.
  'attendance.approvals.approvals': () => <ApprovalRules service="attendance" />,
  'attendance.automation.absent-scheduler': AbsentScheduler,
  'attendance.automation.email-alerts': EmailAlerts,
  'attendance.automation.email-templates': EmailTemplates,

  'shifts.configuration.general': ShiftsGeneral,
  'shifts.configuration.manage-shifts': ManageShifts,
  'shifts.configuration.auto-shift-assignment': AutoShiftAssignment,
  'shifts.configuration.shift-patterns': ShiftPatterns,
  'shifts.automation.shift-rotation': ShiftRotation,

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
