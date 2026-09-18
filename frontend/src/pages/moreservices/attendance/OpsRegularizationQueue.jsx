import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Check, X, Plus } from 'lucide-react';
import api from '../../../utils/api';
import LeaveDetailModal from '../../../components/LeaveDetailModal';
import RegularizeModal from '../../../components/requests/RegularizeModal';
import useSortable from '../../../components/table/useSortable';
import SortableTh from '../../../components/table/SortableTh';
import { useAuth } from '../../../context/AuthContext';
import { useFormat, formatTime } from '../../../utils/datetime';
import {
  useTeamScope, ScopeSwitch, withScope, useFilingPeople, DirectScopeNote, addButtonClass,
} from '../../team/teamShared';

/* ── Operations → Attendance → Regularization ────────────────────────────
 *  The organisation-wide queue, laid out the way the reference does it:
 *  what the day says now beside what the request would make it, so an
 *  approver can see the correction rather than only the times asked for.
 *
 *  Same endpoints the Approvals page uses — /regularizations/pending to
 *  read, /regularizations/:id/action to act. One source of truth for the
 *  data and the decision; only the table differs.
 */
const fmtHM = (n) => {
  if (n === null || n === undefined || n === '') return '00:00';
  const total = Math.round(Number(n) * 60);
  if (!Number.isFinite(total)) return '00:00';
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};
const fmtTime = (hms, timeFormat) => formatTime(hms, timeFormat) || '—';
const fmtDay = (d) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const STATUS_WORD = { present: 'Present', late: 'Present', absent: 'Absent', 'half-day': 'Half Day', on_duty: 'On Duty' };

// Hours the request would produce, from the times it asks for. The server
// decides this properly on approval (shift rules, leave, on-duty); this is
// only the span, shown so the queue can say what is being asked for.
const requestedHours = (checkIn, checkOut) => {
  if (!checkIn || !checkOut) return null;
  const [ih, im] = String(checkIn).split(':').map(Number);
  const [oh, om] = String(checkOut).split(':').map(Number);
  const mins = (oh * 60 + om) - (ih * 60 + im);
  return mins > 0 ? mins / 60 : null;
};

const levelsDone = (r) => (r.approvalLevels || []).filter(l => l.status === 'approved').length;

/* `scopeKey` is passed by Attendance → Team, where a manager-role viewer gets
 * Direct | All. Operations is full access and passes none. */
export default function OpsRegularizationQueue({ scopeKey = null }) {
  const { timeFormat } = useFormat();
  const [rows, setRows] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [q, setQ] = useState('');
  const [detail, setDetail] = useState(null);
  const [adding, setAdding] = useState(false);
  const { user } = useAuth();
  const scope = useTeamScope(scopeKey);
  const filers = useFilingPeople(adding);

  const load = () => {
    setRows(null);
    api.get(withScope('/regularizations/pending', scope))
      .then(r => setRows(r.data.data || []))
      .catch(err => { toast.error(err.response?.data?.message || 'Could not load regularizations'); setRows([]); });
  };
  useEffect(load, [scope.scope]);

  const act = async (row, action, rejectionReason, confirmed = false) => {
    const who = `${row.employee.firstName} ${row.employee.lastName || ''}`.trim();
    if (action === 'rejected' && !confirmed && !window.confirm(`Reject ${who}'s regularization for ${fmtDay(row.date)}?`)) return;
    setBusyId(row._id);
    try {
      await api.put(`/regularizations/${row._id}/action`, rejectionReason ? { action, rejectionReason } : { action });
      toast.success(action === 'approved' ? 'Approved' : 'Rejected');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not record that decision');
    } finally { setBusyId(null); }
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows || [];
    return (rows || []).filter(r =>
      `${r.employee.firstName} ${r.employee.lastName || ''} ${r.employee.employeeId || ''}`.toLowerCase().includes(needle));
  }, [rows, q]);

  const sort = useSortable(filtered, {
    id: 'ops-regularization-queue',
    columns: {
      employee: r => `${r.employee.firstName || ''} ${r.employee.lastName || ''}`.trim(),
      date: { get: r => (r.date ? String(r.date).slice(0, 10) : null), type: 'date' },
      oldHours: { get: r => (r.oldHours == null ? null : Number(r.oldHours)), type: 'number' },
      newHours: { get: r => requestedHours(r.checkIn, r.checkOut), type: 'number' },
      oldStatus: { get: r => STATUS_WORD[r.oldStatus] || 'Absent', type: 'text' },
      reason: { get: r => r.reason, type: 'text' },
      approval: { get: levelsDone, type: 'number' },
    },
  });

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search employee"
          className="border border-slate-200 rounded-xl px-3 py-2 text-[14px] w-64 focus:outline-none focus:border-brand-400" />
        <div className="flex items-center gap-3 flex-wrap">
          <div className="text-[13px] text-slate-400 text-right">
            {rows === null ? '' : `${filtered.length} waiting for approval`}
            {scope.enabled && <DirectScopeNote scope={scope.scope} />}
          </div>
          <ScopeSwitch ctl={scope} />
          {filers.canFile && (
            <button type="button" onClick={() => setAdding(true)} className={addButtonClass}>
              <Plus size={14} /> Add Request
            </button>
          )}
        </div>
      </div>

      {rows === null ? (
        <div className="flex justify-center py-16"><div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <p className="text-center text-slate-400 py-16">No regularization requests have been raised currently.</p>
      ) : (
        <div className="border border-slate-200 rounded-2xl overflow-auto">
          <table className="w-full text-[14.5px] min-w-max">
            <thead className="bg-slate-50">
              <tr className="text-left text-slate-500 text-sm">
                <SortableTh sort={sort} k="employee" className="px-4 py-3 font-medium" rowSpan={2}>Employee</SortableTh>
                <SortableTh sort={sort} k="date" className="px-4 py-3 font-medium" rowSpan={2}>Worked day</SortableTh>
                <th className="px-4 py-2 font-medium text-center border-l border-slate-200" colSpan={2}>Hours</th>
                <th className="px-4 py-2 font-medium text-center border-l border-slate-200" colSpan={2}>Status</th>
                <SortableTh sort={sort} k="reason" className="px-4 py-3 font-medium border-l border-slate-200" rowSpan={2}>Reason</SortableTh>
                <SortableTh sort={sort} k="approval" className="px-4 py-3 font-medium" rowSpan={2}>Approval Status</SortableTh>
                <th className="px-4 py-3 font-medium w-28" rowSpan={2}></th>
              </tr>
              <tr className="text-left text-slate-400 text-[13px]">
                <SortableTh sort={sort} k="oldHours" className="px-4 pb-2 font-medium border-l border-slate-200">Old</SortableTh>
                <SortableTh sort={sort} k="newHours" className="px-4 pb-2 font-medium">New</SortableTh>
                <SortableTh sort={sort} k="oldStatus" className="px-4 pb-2 font-medium border-l border-slate-200">Old</SortableTh>
                <th className="px-4 pb-2 font-medium">New</th>
              </tr>
            </thead>
            <tbody>
              {sort.sorted.map(r => {
                const newHours = requestedHours(r.checkIn, r.checkOut);
                const levels = r.approvalLevels || [];
                const done = levelsDone(r);
                return (
                  <tr key={r._id} className="border-t border-slate-100 hover:bg-slate-50/60 cursor-pointer focus:outline-none focus:bg-blue-50/60"
                    tabIndex={0} role="button"
                    onClick={() => setDetail(r)}
                    onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setDetail(r); } }}>
                    <td className="px-4 py-3">
                      <span className="text-slate-700">{r.employee.firstName} {r.employee.lastName || ''}</span>
                      <span className="block text-[12.5px] text-slate-400">{r.employee.employeeId} · {r.employee.department || '—'}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{fmtDay(r.date)}</td>
                    <td className="px-4 py-3 font-mono text-slate-500 border-l border-slate-100">{fmtHM(r.oldHours)}</td>
                    <td className="px-4 py-3 font-mono text-slate-800 font-medium">{newHours === null ? '—' : fmtHM(newHours)}</td>
                    <td className="px-4 py-3 text-slate-500 border-l border-slate-100">{STATUS_WORD[r.oldStatus] || 'Absent'}</td>
                    <td className="px-4 py-3 text-slate-800 font-medium">Present</td>
                    <td className="px-4 py-3 text-slate-500 max-w-[200px] truncate border-l border-slate-100" title={r.reason}>
                      {r.reason || '—'}
                      <span className="block text-[12.5px] text-slate-400">
                        In {fmtTime(r.checkIn, timeFormat)} · Out {fmtTime(r.checkOut, timeFormat)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-amber-600 text-[13.5px]">Waiting for approval</span>
                      {levels.length > 0 && (
                        <span className="block text-[12.5px] text-slate-400">{done} of {levels.length} levels approved</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {r.canAct ? (
                        <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
                          <button onClick={() => act(r, 'approved')} disabled={busyId === r._id}
                            title="Approve"
                            className="flex items-center gap-1 text-[13px] text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50 px-2.5 py-1.5 rounded-lg">
                            <Check size={14} /> Approve
                          </button>
                          <button onClick={() => act(r, 'rejected')} disabled={busyId === r._id}
                            title="Reject"
                            className="flex items-center gap-1 text-[13px] text-red-600 bg-red-50 hover:bg-red-100 disabled:opacity-50 px-2.5 py-1.5 rounded-lg">
                            <X size={14} /> Reject
                          </button>
                        </div>
                      ) : (
                        <span className="text-[13px] text-slate-400">Not yours to approve</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
        <RegularizeModal people={filers.people} peopleLoading={filers.loading}
          onClose={() => setAdding(false)}
          onDone={() => { setAdding(false); load(); }} />
      )}

      {detail && (
        <LeaveDetailModal
          leave={detail}
          kind="regularization"
          onClose={() => setDetail(null)}
          canAct={detail.status === 'pending' && !!detail.canAct && detail.employee?._id !== user?._id}
          onApprove={(x, comment) => { setDetail(null); act(x, 'approved', comment); }}
          onReject={(x, comment) => { setDetail(null); act(x, 'rejected', comment, true); }}
        />
      )}
    </div>
  );
}
