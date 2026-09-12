import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Users } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { isFullAccess } from '../../utils/roles';
import { UserLeaveTabs } from '../moreservices/leavetracker/OpsUserSpecific';
import { WorkspaceHeader, Spinner, Empty } from './teamShared';

/* ── Leave Tracker → Team → one reportee ──────────────────────────────────
 *  The twin of ReporteeAttendance, and deliberately so: the same card, the
 *  same roster, the same shared person-screen imported rather than rebuilt
 *  (UserLeaveTabs out of the Operations OpsUserSpecific). Operations is a
 *  full-access door and this is a manager's, so only the roster and
 *  `canManage` differ.
 *
 *  The card that leads here is the same component the Attendance workspace
 *  uses, and it stays pointed within its own section: an Attendance card
 *  opens attendance, a Leave Tracker card opens leave. Sending either one to
 *  the other is the cross-section hop these workspaces exist to prevent.
 *
 *  The employee comes from /team/reportees rather than a lookup by id,
 *  because that endpoint is already scoped to the reporting line — so a
 *  hand-typed id finds nobody here, and the balance endpoints behind the tabs
 *  refuse it independently. Until this week they did something worse than
 *  refuse: they answered with the CALLER's own balances under the named
 *  person's name, which on a leave screen is the number a manager is about to
 *  approve against.
 * ────────────────────────────────────────────────────────────────────────── */
export default function ReporteeLeave() {
  const { employeeId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [rows, setRows] = useState(null);

  useEffect(() => {
    let live = true;
    api.get('/team/reportees')
      .then(r => { if (live) setRows(r.data.data || []); })
      .catch(err => {
        if (live) {
          toast.error(err.response?.data?.message || 'Could not load your reportees');
          setRows([]);
        }
      });
    return () => { live = false; };
  }, []);

  /* /team/reportees answers with `id`; the leave tabs and their pickers key
   * off `_id`, the shape /employees uses. Mapped once here rather than
   * teaching the shared screen two spellings of the same field. */
  const people = useMemo(
    () => (rows || []).map(p => ({ ...p, _id: p.id })),
    [rows],
  );
  const employee = useMemo(
    () => people.find(p => String(p._id) === String(employeeId)) || null,
    [people, employeeId],
  );

  const toList = () => navigate('/leave-tracker/team/reportees');

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden min-h-[calc(100vh-9rem)]">
      <WorkspaceHeader title="Team"
        subtitle={employee
          ? `Leave for ${employee.firstName} ${employee.lastName || ''}`.trim()
          : 'Leave for the people who report to you.'} />

      <div className="bg-slate-50 min-h-[420px] p-5">
        {rows === null ? <Spinner /> : !employee ? (
          <Empty icon={Users}
            title="That person does not report to you"
            sub="Only your direct reports — people whose reporting manager or approving authority is you — can be opened from here." />
        ) : (
          <UserLeaveTabs
            employee={employee}
            people={people}
            onPick={p => navigate(`/leave-tracker/team/user/${p._id}`)}
            onBack={toList}
            backTitle="Back to Reportees"
            canManage={isFullAccess(user)} />
        )}
      </div>
    </div>
  );
}
