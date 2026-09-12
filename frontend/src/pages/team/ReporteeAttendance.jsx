import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Users } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { isFullAccess } from '../../utils/roles';
import { UserAttendanceTabs } from '../moreservices/attendance/OpsUserSpecific';
import { WorkspaceHeader, Spinner, Empty } from './teamShared';

/* ── Attendance → Team → one reportee ─────────────────────────────────────
 *  A reportee card was inert: it showed where somebody stood today and then
 *  led nowhere. This is where it leads — the same four tabs Operations opens
 *  on an employee, which is why the screen itself is imported rather than
 *  rebuilt (UserAttendanceTabs out of OpsUserSpecific). Operations is a
 *  full-access door and this is a manager's, so only two things differ: the
 *  roster behind the header switcher is /team/reportees rather than every
 *  employee, and `canManage` is off for anyone who is not full access.
 *
 *  The employee comes from /team/reportees and not from a lookup by id: that
 *  endpoint is already scoped to the reporting line, so a manager who types
 *  somebody else's id into the URL finds nobody here — and the attendance
 *  endpoints behind the tabs refuse the same id independently. Before this
 *  screen existed they did something worse than refuse: they handed the
 *  caller their OWN attendance back under the other person's name.
 * ────────────────────────────────────────────────────────────────────────── */
export default function ReporteeAttendance() {
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

  /* /team/reportees answers with `id`; the attendance tabs and their pickers
   * key off `_id`, the shape /employees uses. Mapped once here rather than
   * teaching the shared screen two spellings of the same field. */
  const people = useMemo(
    () => (rows || []).map(p => ({ ...p, _id: p.id })),
    [rows],
  );
  const employee = useMemo(
    () => people.find(p => String(p._id) === String(employeeId)) || null,
    [people, employeeId],
  );

  const toList = () => navigate('/attendance/team/reportees');

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden min-h-[calc(100vh-9rem)]">
      <WorkspaceHeader title="Team"
        subtitle={employee
          ? `Attendance for ${employee.firstName} ${employee.lastName || ''}`.trim()
          : 'Attendance for the people who report to you.'} />

      <div className="bg-slate-50 min-h-[420px] p-5">
        {rows === null ? <Spinner /> : !employee ? (
          <Empty icon={Users}
            title="That person does not report to you"
            sub="Only your direct reports — people whose reporting manager or approving authority is you — can be opened from here." />
        ) : (
          <UserAttendanceTabs
            employee={employee}
            people={people}
            onPick={p => navigate(`/attendance/team/user/${p._id}`)}
            onBack={toList}
            backTitle="Back to Reportees"
            canManage={isFullAccess(user)} />
        )}
      </div>
    </div>
  );
}
