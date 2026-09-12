import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import TeamAttendance from '../attendance/TeamAttendance';
import OpsRegularizationQueue from '../moreservices/attendance/OpsRegularizationQueue';
import OpsOnDutyQueue from '../moreservices/attendance/OpsOnDutyQueue';
import Reportees from './Reportees';
import TeamShiftSchedule from './TeamShiftSchedule';
import { TeamTabs, WorkspaceHeader } from './teamShared';

/* ── Attendance → Team ────────────────────────────────────────────────────
 *  /attendance/team was an orphan: role-gated, rendering a working Team
 *  Members screen, and reachable only by typing the URL. This is the
 *  workspace around it — the reference's Reportees | Team Members |
 *  Regularization | On Duty | Shift Schedule.
 *
 *  Only two of the five are new. Team Members is the existing TeamAttendance
 *  with its page header suppressed; Regularization and On Duty are the
 *  Operations queues, which read /regularizations/pending and
 *  /on-duty/pending — endpoints that already return only requests where the
 *  caller is an assigned approver, so a manager sees their own team's and a
 *  full-access user sees everything, exactly as on the Approvals page. They
 *  are rendered rather than linked to so that acting on a request does not
 *  send anybody out of Attendance to do it.
 *
 *  A Reportees card opens that person's attendance at
 *  /attendance/team/user/:employeeId — still inside Attendance, and still the
 *  same screen Operations uses for an employee rather than a second one.
 * ────────────────────────────────────────────────────────────────────────── */

const TABS = [
  { key: 'reportees',      label: 'Reportees',      to: '/attendance/team/reportees' },
  { key: 'members',        label: 'Team Members',   to: '/attendance/team/members' },
  { key: 'regularization', label: 'Regularization', to: '/attendance/team/regularization' },
  { key: 'on-duty',        label: 'On Duty',        to: '/attendance/team/on-duty' },
  { key: 'shift-schedule', label: 'Shift Schedule', to: '/attendance/team/shift-schedule' },
];

export default function AttendanceTeam() {
  const { tab } = useParams();
  const navigate = useNavigate();
  // The bare /attendance/team keeps doing what it did before this workspace
  // existed — it opens on Team Members.
  const active = TABS.some(t => t.key === tab) ? tab : 'members';

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden min-h-[calc(100vh-9rem)]">
      <WorkspaceHeader title="Team" subtitle="Attendance for the people who report to you." />
      <TeamTabs tabs={TABS} active={active} />

      <div className="bg-slate-50 min-h-[420px]">
        {active === 'reportees'      && <Reportees embedded
          onOpen={p => navigate(`/attendance/team/user/${p.id}`)} />}
        {active === 'members'        && <TeamAttendance embedded />}
        {active === 'shift-schedule' && <TeamShiftSchedule embedded />}
        {active === 'regularization' && <div className="p-5"><OpsRegularizationQueue /></div>}
        {active === 'on-duty'        && <div className="p-5"><OpsOnDutyQueue /></div>}
      </div>
    </div>
  );
}
