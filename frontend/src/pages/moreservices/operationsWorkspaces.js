/* ── The navigation for an Operations workspace ───────────────────────────
 *  Attendance, Attendance Marking and Leave Tracker are workspaces: you go
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
export const MARKING_BASE = '/more-services/operations/attendance-marking';
export const LEAVE_TRACKER_BASE = '/more-services/operations/leave-tracker';

/* Attendance Marking is a tab in this strip but a route of its own, because
 * it is a whole page with its own sub-tabs rather than a panel — so it
 * carries `path` and the rest carry `tab`. */
export const ATTENDANCE_TABS = [
  { id: 'user', label: 'User-specific Operations' },
  { id: 'regularization', label: 'Regularization' },
  { id: 'onduty', label: 'On Duty' },
  { id: 'biometric', label: 'Biometric ID mapping' },
  { id: 'import-export', label: 'Check-in/out Import & Export' },
  { id: 'marking', label: 'Attendance Marking', path: MARKING_BASE },
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

const WORKSPACES = [
  { base: MARKING_BASE, title: 'Attendance', tabs: ATTENDANCE_TABS, fixedTab: 'marking' },
  { base: ATTENDANCE_BASE, title: 'Attendance', tabs: ATTENDANCE_TABS, defaultTab: 'user' },
  { base: LEAVE_TRACKER_BASE, title: 'Leave Tracker', tabs: LEAVE_TRACKER_TABS, defaultTab: 'user' },
];

/**
 * The workspace this path is in, or null. MARKING_BASE is tested before
 * ATTENDANCE_BASE deliberately — one is a prefix of the other, and matching
 * the shorter one first would make Attendance Marking look like the
 * Attendance hub with a stray suffix.
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
