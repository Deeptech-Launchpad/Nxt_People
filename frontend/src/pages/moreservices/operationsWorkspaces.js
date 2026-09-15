/* ── The navigation for an Operations workspace ───────────────────────────
 *  Attendance, Leave Tracker and Leave Approvals are workspaces: you go
 *  into one and work there. Each has a way back, a name, and its own tabs.
 *
 *  That navigation belongs in the navy bar, the way Settings already does it
 *  (see settingsWorkspace in components/layout/Topbar.jsx) and the way the
 *  reference does it — one bar carrying back, title and tabs, with the global
 *  icons on the same line. Rendered inside each page instead, it sat BELOW a
 *  navy bar that then had nothing in it, under a white bar repeating
 *  "Services / Leave Tracker / Leave Approvals" that had nothing to do with
 *  where you were: three rows of chrome, none of them the one you needed.
 *
 *  Defined here rather than inside each page so the bar and the page cannot
 *  disagree about which tabs exist — Topbar reads this to draw them, and the
 *  page reads it to decide what to render.
 * ────────────────────────────────────────────────────────────────────────── */

export const ATTENDANCE_BASE = '/more-services/operations/attendance';
export const LEAVE_TRACKER_BASE = '/more-services/operations/leave-tracker';
export const LEAVE_APPROVALS_BASE = '/more-services/operations/leave-approvals';
export const EMPLOYEE_INFO_BASE = '/more-services/operations/employee-information';
export const SHIFT_BASE = '/more-services/operations/shift';

export const ATTENDANCE_TABS = [
  { id: 'user', label: 'User-specific Operations' },
  { id: 'regularization', label: 'Regularization' },
  { id: 'onduty', label: 'On Duty' },
  { id: 'biometric', label: 'Biometric ID mapping' },
  { id: 'import-export', label: 'Check-in/out Import & Export' },
];

/* The same ids Approvals.jsx has always used for its in-page strip, so the
 * navy bar, ?tab= links and the page's own badges all mean the same tab. */
export const APPROVALS_TABS = [
  { id: 'leaves', label: 'Leave Requests' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'approvedLeaves', label: 'Approved Leaves' },
  { id: 'rejectedLeaves', label: 'Rejected Leaves' },
  { id: 'regularizations', label: 'Regularizations' },
  { id: 'wfh', label: 'WFH Requests' },
  { id: 'compoff', label: 'Comp-Off' },
  { id: 'onduty', label: 'On Duty' },
];

export const LEAVE_TRACKER_TABS = [
  { id: 'user', label: 'User-specific Operations' },
  { id: 'requests', label: 'Leave Requests' },
  { id: 'compoff', label: 'Compensatory Request' },
  { id: 'holidays', label: 'Holidays' },
  { id: 'balance', label: 'Customize Balance' },
  { id: 'policy', label: 'Customize Policy' },
  { id: 'workdays', label: 'Exceptional Working days' },
];

/* Manage Shifts is the existing /shifts screen rendered as a panel here, not a
 * second editor for the same table — see Shifts.jsx's own note on why there is
 * only ever one of those. */
export const SHIFT_TABS = [
  { id: 'user', label: 'User-specific Operations' },
  { id: 'manage', label: 'Manage Shifts' },
  { id: 'mapping', label: 'Employee Shift Mapping' },
  { id: 'groups', label: 'Shift Group' },
];

export const EMPLOYEE_INFO_TABS = [
  { id: 'employees', label: 'Employees' },
  { id: 'user', label: 'User-specific Operations' },
  { id: 'insights', label: 'Insights' },
  { id: 'departments', label: 'Departments' },
  { id: 'designations', label: 'Designations' },
  { id: 'groups', label: 'Groups' },
  { id: 'delegation', label: 'Delegation' },
];

const WORKSPACES = [
  { base: ATTENDANCE_BASE, title: 'Attendance', tabs: ATTENDANCE_TABS, defaultTab: 'user' },
  { base: LEAVE_TRACKER_BASE, title: 'Leave Tracker', tabs: LEAVE_TRACKER_TABS, defaultTab: 'user' },
  { base: LEAVE_APPROVALS_BASE, title: 'Leave Approvals', tabs: APPROVALS_TABS, defaultTab: 'leaves' },
  { base: EMPLOYEE_INFO_BASE, title: 'Employee Information', tabs: EMPLOYEE_INFO_TABS, defaultTab: 'employees' },
  { base: SHIFT_BASE, title: 'Shift', tabs: SHIFT_TABS, defaultTab: 'user' },
];

/**
 * The workspace this path is in, or null. Matched on the base or base + "/",
 * so a base that is a string prefix of another route never claims it; if two
 * bases ever nest, list the longer one first.
 */
export function operationsWorkspaceFor(pathname, search = '') {
  const ws = WORKSPACES.find(w => pathname === w.base || pathname.startsWith(`${w.base}/`));
  if (!ws) return null;
  const requested = new URLSearchParams(search).get('tab');
  const activeId = ws.fixedTab
    || (ws.tabs.some(t => t.id === requested && !t.path) ? requested : ws.defaultTab);
  return { base: ws.base, title: ws.title, tabs: ws.tabs, activeId };
}

/** Where clicking a tab goes: its own route, or this workspace with ?tab=. */
export const tabHref = (base, tab) => (tab.path ? tab.path : `${base}?tab=${tab.id}`);
