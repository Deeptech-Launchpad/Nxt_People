import React from 'react';
import { useParams } from 'react-router-dom';
import CompOff from '../CompOff';
import Reportees from './Reportees';
import TeamOnLeave from './TeamOnLeave';
import TeamLeaveRequests from './TeamLeaveRequests';
import { TeamTabs, WorkspaceHeader } from './teamShared';

/* ── Leave Tracker → Team ─────────────────────────────────────────────────
 *  The Leave Tracker had My Data and Holidays and nothing for an approver;
 *  /leave-tracker/team existed as a URL nobody linked to and rendered the
 *  Approvals page. This is the reference's Reportees | On Leave | Leave
 *  Requests | Compensatory Request in its place.
 *
 *  Compensatory Request is the existing CompOff page, whose Team Pending tab
 *  already reads /comp-off/pending and posts the decision — the comp-off
 *  screen scoped to reports, not a second one. (Operations' comp-off table is
 *  not reused here: it reads /comp-off/all and /employees, both full-access
 *  only, so it would show a manager a permission wall.)
 *
 *  The approval queue is still where it was, at /team/approvals. Nothing here
 *  navigates to it — a manager who opened Leave Tracker stays in Leave
 *  Tracker.
 * ────────────────────────────────────────────────────────────────────────── */

const TABS = [
  { key: 'reportees', label: 'Reportees',             to: '/leave-tracker/team/reportees' },
  { key: 'on-leave',  label: 'On Leave',              to: '/leave-tracker/team/on-leave' },
  { key: 'requests',  label: 'Leave Requests',        to: '/leave-tracker/team/requests' },
  { key: 'comp-off',  label: 'Compensatory Request',  to: '/leave-tracker/team/comp-off' },
];

export default function LeaveTrackerTeam() {
  const { tab } = useParams();
  const active = TABS.some(t => t.key === tab) ? tab : 'reportees';

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden min-h-[calc(100vh-9rem)]">
      <WorkspaceHeader title="Team" subtitle="Leave for the people who report to you." />
      <TeamTabs tabs={TABS} active={active} />

      <div className="bg-slate-50 min-h-[420px]">
        {/* Reportees carries the year's booked total here, which is the figure
            the Leave Tracker's version of this card is for. */}
        {active === 'reportees' && <Reportees embedded showLeaveBooked />}
        {active === 'on-leave'  && <TeamOnLeave embedded />}
        {active === 'requests'  && <TeamLeaveRequests embedded />}
        {active === 'comp-off'  && <CompOff />}
      </div>
    </div>
  );
}
