import React, { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AttendanceProvider } from './context/AttendanceContext';
import { WeekendRulesProvider } from './context/WeekendRulesContext';
import { ChatProvider } from './context/ChatContext';
import MobileBlocker from './components/layout/MobileBlocker';

import Layout from './components/layout/Layout';
import Login from './pages/Login';
import OnboardingForm from './pages/OnboardingForm';

/* ── Existing pages ─────────────────────────────────────────────────── */
const Dashboard       = lazy(() => import('./pages/Dashboard'));
const AttendanceLanding = lazy(() => import('./pages/attendance/AttendanceLanding'));
const CheckInOut      = lazy(() => import('./pages/attendance/CheckInOut'));
const MyAttendance    = lazy(() => import('./pages/attendance/MyAttendance'));
const TeamAttendance  = lazy(() => import('./pages/attendance/TeamAttendance'));
const Regularization  = lazy(() => import('./pages/attendance/Regularization'));
const AttendanceLocation = lazy(() => import('./pages/attendance/AttendanceLocation'));
const Employees       = lazy(() => import('./pages/Employees'));
const EmployeeProfile = lazy(() => import('./pages/EmployeeProfile'));
const Approvals       = lazy(() => import('./pages/Approvals'));
const Settings        = lazy(() => import('./pages/Settings'));
const Registrations   = lazy(() => import('./pages/Registrations'));
const Companies       = lazy(() => import('./pages/Companies'));
const ApiConnections  = lazy(() => import('./pages/ApiConnections'));
const MyApps          = lazy(() => import('./pages/MyApps'));
const Profile         = lazy(() => import('./pages/Profile'));
const Directory       = lazy(() => import('./pages/Directory'));
const LeaveCalendar   = lazy(() => import('./pages/LeaveCalendar'));
const OrgChart        = lazy(() => import('./pages/OrgChart'));
const Announcements   = lazy(() => import('./pages/Announcements'));
const WFHRequests     = lazy(() => import('./pages/WFHRequests'));
const CompOff         = lazy(() => import('./pages/CompOff'));
const Documents       = lazy(() => import('./pages/Documents'));
const PayrollReport   = lazy(() => import('./pages/PayrollReport'));
const PayrollSetup    = lazy(() => import('./pages/payroll/PayrollSetup'));
const PayrollRun      = lazy(() => import('./pages/payroll/PayrollRun'));
const MyPayroll       = lazy(() => import('./pages/payroll/MyPayroll'));
const TeamPayroll     = lazy(() => import('./pages/payroll/TeamPayroll'));
const TaxDeclaration  = lazy(() => import('./pages/payroll/TaxDeclaration'));
const DeclarationApprovals = lazy(() => import('./pages/payroll/DeclarationApprovals'));
const ComplianceReports = lazy(() => import('./pages/payroll/ComplianceReports'));
const Adjustments       = lazy(() => import('./pages/payroll/Adjustments'));
const Loans             = lazy(() => import('./pages/payroll/Loans'));
const TaxSlabs          = lazy(() => import('./pages/payroll/TaxSlabs'));
const Performance     = lazy(() => import('./pages/Performance'));
const ExitManagement  = lazy(() => import('./pages/ExitManagement'));
const ShiftRoster     = lazy(() => import('./pages/ShiftRoster'));
const Shifts          = lazy(() => import('./pages/Shifts'));
const Holidays        = lazy(() => import('./pages/Holidays'));
const Timesheets      = lazy(() => import('./pages/Timesheets'));
const Leave           = lazy(() => import('./pages/Leave'));
const Reports         = lazy(() => import('./pages/Reports'));
const ReportsLanding  = lazy(() => import('./pages/reports/ReportsLanding'));
const DailyAttendance = lazy(() => import('./pages/DailyAttendance'));
const LeaveEncashment = lazy(() => import('./pages/LeaveEncashment'));
const Weekends        = lazy(() => import('./pages/Weekends'));
const Chat            = lazy(() => import('./pages/Chat'));

/* ── New pages — Phase 2: Home ──────────────────────────────────────── */
const DashboardWidgets = lazy(() => import('./pages/DashboardWidgets'));

/* ── New pages — Phase 3: Team ──────────────────────────────────────── */
const TeamSpace    = lazy(() => import('./pages/TeamSpace'));
const TeamProjects = lazy(() => import('./pages/TeamProjects'));
const Peers        = lazy(() => import('./pages/Peers'));

/* ── New pages — Phase 4: Organization ─────────────────────────────── */
const OrgOverview    = lazy(() => import('./pages/OrgOverview'));
const Policies       = lazy(() => import('./pages/Policies'));
const BirthdayFolks  = lazy(() => import('./pages/BirthdayFolks'));
const NewHires       = lazy(() => import('./pages/NewHires'));

/* ── New pages — Phase 5: Time Tracker ─────────────────────────────── */
const TimeTrackerLanding = lazy(() => import('./pages/timetracker/TimeTrackerLanding'));
const TimeLogs         = lazy(() => import('./pages/timetracker/TimeLogs'));
const JobSchedule      = lazy(() => import('./pages/timetracker/JobSchedule'));
const TimeTrackerProjs = lazy(() => import('./pages/timetracker/Projects'));

/* ── New pages — Phase 6: Leave Tracker ────────────────────────────── */
const LeaveTrackerLanding = lazy(() => import('./pages/leavetracker/LeaveTrackerLanding'));
const LeaveSummary   = lazy(() => import('./pages/leavetracker/LeaveSummary'));
const LeaveBalance   = lazy(() => import('./pages/leavetracker/LeaveBalance'));
const LeaveRequests  = lazy(() => import('./pages/leavetracker/LeaveRequests'));
const LeaveTeam      = lazy(() => import('./pages/leavetracker/LeaveTeam'));

/* ── New pages — Phase 7: Performance ──────────────────────────────── */
const PerformanceGoals = lazy(() => import('./pages/performance/Goals'));
const SkillMatrix      = lazy(() => import('./pages/performance/SkillMatrix'));

/* ── New pages — Phase 8: More Services ────────────────────────────── */
const Travel       = lazy(() => import('./pages/moreservices/Travel'));
const Compensation = lazy(() => import('./pages/moreservices/Compensation'));
const HRLetters    = lazy(() => import('./pages/moreservices/HRLetters'));
const Operations       = lazy(() => import('./pages/moreservices/Operations'));
const LeaveTrackerAdmin = lazy(() => import('./pages/moreservices/LeaveTrackerAdmin'));
const PermissionUsage = lazy(() => import('./pages/moreservices/PermissionUsage'));
const Conference = lazy(() => import('./pages/moreservices/Conference'));

/* ── Loaders & Guards ──────────────────────────────────────────────── */
const PageLoader = () => (
  <div className="min-h-[60vh] flex items-center justify-center">
    <div className="flex flex-col items-center gap-3">
      <div className="w-8 h-8 border-[3px] border-blue-500 border-t-transparent rounded-full animate-spin"/>
      <span className="text-slate-400 text-base">Loading…</span>
    </div>
  </div>
);

const ProtectedRoute = ({ children, roles }) => {
  const { user, loading } = useAuth();
  if (loading) return <PageLoader/>;
  if (!user) return <Navigate to="/login" replace/>;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace/>;
  return children;
};

const AppRoutes = () => {
  const { user } = useAuth();
  return (
    <Suspense fallback={<PageLoader/>}>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" replace/> : <Login/>}/>
        {/* Password reset must always render — even for users with an active
         *  session. Otherwise clicking the email link in the same browser silently
         *  redirects them home and the reset never happens. */}
        <Route path="/reset-password/:token" element={<Login/>}/>
        <Route path="/onboarding/:token" element={<OnboardingForm/>}/>
        <Route path="/" element={<ProtectedRoute><Layout/></ProtectedRoute>}>

          {/* ── Home / My Space ──────────────────────────────────────── */}
          <Route index element={<Dashboard/>}/>
          <Route path="dashboard"  element={<DashboardWidgets/>}/>
          <Route path="calendar"   element={<LeaveCalendar/>}/>
          <Route path="profile"    element={<Profile/>}/>

          {/* ── Home / Team ──────────────────────────────────────────── */}
          <Route path="team-space"      element={<TeamSpace/>}/>
          <Route path="team/department" element={<OrgChart/>}/>
          <Route path="team/projects"   element={<TeamProjects/>}/>
          <Route path="team/peers"      element={<Peers/>}/>
          <Route path="team/approvals"  element={<ProtectedRoute roles={['admin','director','hr_admin','manager','team_incharge']}><Approvals/></ProtectedRoute>}/>
          <Route path="approvals"       element={<ProtectedRoute roles={['admin','director','hr_admin','manager','team_incharge']}><Approvals/></ProtectedRoute>}/>

          {/* ── Home / Organization ──────────────────────────────────── */}
          <Route path="organization" element={<OrgOverview/>}/>
          <Route path="org-chart"    element={<OrgChart/>}/>
          <Route path="dept-tree"    element={<OrgChart/>}/>
          <Route path="announcements"element={<Announcements/>}/>
          <Route path="policies"     element={<Policies/>}/>
          <Route path="birthdays"    element={<BirthdayFolks/>}/>
          <Route path="new-hires"    element={<NewHires/>}/>
          <Route path="directory"    element={<Directory/>}/>
          <Route path="companies"    element={<ProtectedRoute roles={['admin','director']}><Companies/></ProtectedRoute>}/>
          <Route path="holidays"     element={<Holidays/>}/>

          {/* ── Attendance ───────────────────────────────────────────── */}
          <Route path="attendance"                element={<AttendanceLanding/>}/>
          <Route path="attendance/my"             element={<MyAttendance/>}/>
          <Route path="attendance/checkin"        element={<CheckInOut/>}/>
          <Route path="attendance/regularization" element={<Regularization/>}/>
          <Route path="attendance/location"       element={<AttendanceLocation/>}/>
          <Route path="attendance/team"           element={<ProtectedRoute roles={['admin','director','hr_admin','manager','team_incharge']}><TeamAttendance/></ProtectedRoute>}/>

          {/* ── Time Tracker ─────────────────────────────────────────── */}
          <Route path="time-tracker"             element={<TimeTrackerLanding/>}/>
          <Route path="time-tracker/timelogs"    element={<TimeLogs/>}/>
          <Route path="time-tracker/timesheets"  element={<Timesheets/>}/>
          <Route path="time-tracker/projects"    element={<TimeTrackerProjs/>}/>
          <Route path="time-tracker/schedule"    element={<JobSchedule/>}/>

          {/* ── Leave Tracker ────────────────────────────────────────── */}
          <Route path="leave-tracker"            element={<LeaveTrackerLanding/>}/>
          <Route path="leave-tracker/summary"    element={<LeaveSummary/>}/>
          <Route path="leave-tracker/balance"    element={<LeaveBalance/>}/>
          <Route path="leave-tracker/requests"   element={<LeaveRequests/>}/>
          <Route path="leave-tracker/comp-off"   element={<CompOff/>}/>
          {/* /leave-tracker/team renders the same Approvals page as
              /approvals, but keeping the URL under /leave-tracker/* keeps
              the sidebar highlight on Leave Tracker instead of jumping
              the user back to Home (which was the pre-fix behaviour).
              Role-gated identically — only admins/managers can view it. */}
          <Route path="leave-tracker/team"       element={<ProtectedRoute roles={['admin','director','hr_admin','manager','team_incharge']}><Approvals/></ProtectedRoute>}/>
          <Route path="leave-tracker/holidays"   element={<Holidays/>}/>
          <Route path="leave-tracker/weekends"   element={<ProtectedRoute roles={['admin','director','hr_admin']}><Weekends/></ProtectedRoute>}/>

          {/* ── Performance ──────────────────────────────────────────── */}
          <Route path="performance/goals"  element={<PerformanceGoals/>}/>
          <Route path="performance/skills" element={<SkillMatrix/>}/>
          <Route path="performance"        element={<Performance/>}/>

          {/* ── More Services ────────────────────────────────────────── */}
          <Route path="more-services/files"        element={<Documents/>}/>
          {/* Operations workspace + admin Leave Tracker — Super Admin / HR only. */}
          <Route path="more-services/operations"               element={<ProtectedRoute roles={['admin','director','hr_admin']}><Operations/></ProtectedRoute>}/>
          <Route path="more-services/operations/leave-tracker" element={<ProtectedRoute roles={['admin','director','hr_admin','manager','team_incharge']}><LeaveTrackerAdmin/></ProtectedRoute>}/>
          <Route path="more-services/operations/permission-usage" element={<ProtectedRoute roles={['admin','director','hr_admin']}><PermissionUsage/></ProtectedRoute>}/>
          <Route path="more-services/operations/conference" element={<ProtectedRoute roles={['admin','director','hr_admin']}><Conference/></ProtectedRoute>}/>
          <Route path="more-services/travel"       element={<Travel/>}/>
          <Route path="more-services/compensation" element={<Compensation/>}/>
          <Route path="more-services/hr-letters"   element={<HRLetters/>}/>

          {/* ── Reports / Admin ──────────────────────────────────────── */}
          <Route path="reports"            element={<ProtectedRoute roles={['admin','director','hr_admin','manager']}><ReportsLanding/></ProtectedRoute>}/>
          <Route path="reports/attendance" element={<ProtectedRoute roles={['admin','director','hr_admin','manager']}><Reports/></ProtectedRoute>}/>
          <Route path="daily-attendance" element={<ProtectedRoute roles={['admin','director','hr_admin','manager']}><DailyAttendance/></ProtectedRoute>}/>
          <Route path="payroll"                element={<ProtectedRoute roles={['admin','director','hr_admin','manager']}><PayrollReport/></ProtectedRoute>}/>
          <Route path="payroll/setup"          element={<ProtectedRoute roles={['admin','director']}><PayrollSetup/></ProtectedRoute>}/>
          <Route path="payroll/run"            element={<ProtectedRoute roles={['admin','director']}><PayrollRun/></ProtectedRoute>}/>
          <Route path="payroll/my"             element={<MyPayroll/>}/>
          <Route path="payroll/team"           element={<ProtectedRoute roles={['admin','director','manager']}><TeamPayroll/></ProtectedRoute>}/>
          <Route path="payroll/tax-declaration" element={<TaxDeclaration/>}/>
          <Route path="payroll/declarations"   element={<ProtectedRoute roles={['admin','director']}><DeclarationApprovals/></ProtectedRoute>}/>
          <Route path="payroll/compliance"     element={<ProtectedRoute roles={['admin','director']}><ComplianceReports/></ProtectedRoute>}/>
          <Route path="payroll/adjustments"    element={<ProtectedRoute roles={['admin','director']}><Adjustments/></ProtectedRoute>}/>
          <Route path="payroll/loans"          element={<ProtectedRoute roles={['admin','director']}><Loans/></ProtectedRoute>}/>
          <Route path="payroll/tax-slabs"      element={<ProtectedRoute roles={['admin','director']}><TaxSlabs/></ProtectedRoute>}/>
          {/* Employee management — HR / Super Admin only. Team Leads view their
              team via Team Space / Org Chart, not this admin page. */}
          <Route path="employees"    element={<ProtectedRoute roles={['admin','director','hr_admin']}><Employees/></ProtectedRoute>}/>
          {/* Read-only profile of any colleague — reachable from the eye
              button on the Employee/Department tree popups. Open to every
              logged-in role; the backend GET /api/employees/:id is already
              just `protect`-gated. */}
          <Route path="employees/:id" element={<EmployeeProfile/>}/>
          {/* Onboarding creates employees — full-access only (no manager CRUD). */}
          <Route path="registrations"element={<ProtectedRoute roles={['admin','director','hr_admin']}><Registrations/></ProtectedRoute>}/>
          <Route path="shifts"       element={<ProtectedRoute roles={['admin','director','hr_admin']}><Shifts/></ProtectedRoute>}/>
          <Route path="shift-roster" element={<ProtectedRoute roles={['admin','director','hr_admin','manager']}><ShiftRoster/></ProtectedRoute>}/>

          {/* ── Other ────────────────────────────────────────────────── */}
          <Route path="documents"      element={<Documents/>}/>
          <Route path="chat"           element={<Chat/>}/>
          <Route path="exit"           element={<ExitManagement/>}/>
          <Route path="leave"          element={<Navigate to="/leave-tracker/requests" replace/>}/>
          <Route path="timesheets"     element={<Navigate to="/time-tracker/timesheets" replace/>}/>
          <Route path="wfh"            element={<WFHRequests/>}/>
          <Route path="comp-off"       element={<Navigate to="/leave-tracker/comp-off" replace/>}/>
          <Route path="leave-calendar" element={<Navigate to="/calendar" replace/>}/>
          <Route path="leave-encashment" element={<LeaveEncashment/>}/>
          <Route path="projects"       element={<Navigate to="/team/projects" replace/>}/>
          <Route path="api-connections"element={<ProtectedRoute roles={['admin','director']}><ApiConnections/></ProtectedRoute>}/>
          <Route path="my-apps"          element={<MyApps/>}/>
          <Route path="settings"       element={<ProtectedRoute roles={['admin','director']}><Settings/></ProtectedRoute>}/>
        </Route>

        <Route path="*" element={<Navigate to="/" replace/>}/>
      </Routes>
    </Suspense>
  );
};

export default function App() {
  return (
    <MobileBlocker>
      <AuthProvider>
        <WeekendRulesProvider>
          <AttendanceProvider>
            <ChatProvider>
              <Toaster
                position="bottom-right"
                toastOptions={{
                  duration: 4000,
                  style: { fontSize: '13px', fontWeight: 600 },
                  // Errors deserve more dwell time — 4s isn't enough to read
                  // a stack-trace-style message before it disappears.
                  error: { duration: 7000 },
                  success: { duration: 3500 },
                }}
              />
              <AppRoutes/>
            </ChatProvider>
          </AttendanceProvider>
        </WeekendRulesProvider>
      </AuthProvider>
    </MobileBlocker>
  );
}
