import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Check, X, Plus } from 'lucide-react';
import api from '../../../utils/api';
import LeaveDetailModal from '../../../components/LeaveDetailModal';
import OnDutyModal from '../../../components/requests/OnDutyModal';
import useSortable from '../../../components/table/useSortable';
import SortableTh from '../../../components/table/SortableTh';
import { useAuth } from '../../../context/AuthContext';
import {
  useTeamScope, ScopeSwitch, withScope, useFilingPeople, DirectScopeNote, addButtonClass,
} from '../../team/teamShared';

/* ── Operations → Attendance → On Duty ───────────────────────────────────
 *  The organisation-wide queue, in the reference's column layout: who, the
 *  period, the type, and how long it runs for.
 *
 *  Same endpoints the Approvals page uses — /on-duty/pending to read,
 *  /on-duty/:id/action to act.
 */
const fmtDay = (d) => new Date(`${String(d).slice(0, 10)}T00:00:00`)
  .toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

/* A request is either a stretch of days or a slice of one — the reference
 * shows "4 day(s)" and "03:00 hours" in the same column, and so does this. */
const durationOf = (r) => {
  if (r.unit === 'hours' && r.hours) return `${Number(r.hours).toFixed(2).replace(/\.00$/, '')} hours`;
  const start = new Date(`${String(r.startDate).slice(0, 10)}T00:00:00`);
  const end = new Date(`${String(r.endDate || r.startDate).slice(0, 10)}T00:00:00`);
  const days = Math.round((end - start) / 86400000) + 1;
  return `${days} day${days === 1 ? '' : 's'}`;
};

const levelsDone = (r) => (r.approvalLevels || []).filter(l => l.status === 'approved').length;

/* `scopeKey` — see OpsRegularizationQueue. */
export default function OpsOnDutyQueue({ scopeKey = null }) {
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
    api.get(withScope('/on-duty/pending', scope))
      .then(r => setRows(r.data.data || []))
      .catch(err => { toast.error(err.response?.data?.message || 'Could not load on-duty requests'); setRows([]); });
  };
  useEffect(load, [scope.scope]);

  const act = async (row, action, rejectionReason, confirmed = false) => {
    const who = `${row.employee.firstName} ${row.employee.lastName || ''}`.trim();
    if (action === 'rejected' && !confirmed && !window.confirm(`Reject ${who}'s on-duty request?`)) return;
    setBusyId(row._id);
    try {
      await api.put(`/on-duty/${row._id}/action`, rejectionReason ? { action, rejectionReason } : { action });
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
    id: 'ops-on-duty-queue',
    columns: {
      employee: r => `${r.employee.firstName || ''} ${r.employee.lastName || ''}`.trim(),
      period: { get: r => (r.startDate ? String(r.startDate).slice(0, 10) : null), type: 'date' },
      type: { get: r => r.requestType, type: 'text' },
      duration: { get: r => (r.unit === 'hours' ? Number(r.hours) || 0 : parseFloat(durationOf(r)) * 24), type: 'number' },
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
        <p className="text-center text-slate-400 py-16">No on-duty requests have been raised currently.</p>
      ) : (
        <div className="border border-slate-200 rounded-2xl overflow-auto">
          <table className="w-full text-[14.5px] min-w-max">
            <thead className="bg-slate-50">
              <tr className="text-left text-slate-500 text-sm">
                <SortableTh sort={sort} k="employee" className="px-4 py-3 font-medium">Employee</SortableTh>
                <SortableTh sort={sort} k="period" className="px-4 py-3 font-medium">Period</SortableTh>
                <SortableTh sort={sort} k="type" className="px-4 py-3 font-medium">Type</SortableTh>
                <SortableTh sort={sort} k="duration" className="px-4 py-3 font-medium">Duration</SortableTh>
                <SortableTh sort={sort} k="reason" className="px-4 py-3 font-medium">Reason</SortableTh>
                <SortableTh sort={sort} k="approval" className="px-4 py-3 font-medium">Approval Status</SortableTh>
                <th className="px-4 py-3 font-medium w-28"></th>
              </tr>
            </thead>
            <tbody>
              {sort.sorted.map(r => {
                const levels = r.approvalLevels || [];
                const done = levelsDone(r);
                const sameDay = !r.endDate || String(r.endDate).slice(0, 10) === String(r.startDate).slice(0, 10);
                return (
                  <tr key={r._id} className="border-t border-slate-100 hover:bg-slate-50/60 cursor-pointer focus:outline-none focus:bg-blue-50/60"
                    tabIndex={0} role="button"
                    onClick={() => setDetail(r)}
                    onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setDetail(r); } }}>
                    <td className="px-4 py-3">
                      <span className="text-slate-700">{r.employee.firstName} {r.employee.lastName || ''}</span>
                      <span className="block text-[12.5px] text-slate-400">{r.employee.employeeId} · {r.employee.department || '—'}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                      {fmtDay(r.startDate)}{sameDay ? '' : ` – ${fmtDay(r.endDate)}`}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{r.requestType || '—'}</td>
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{durationOf(r)}</td>
                    <td className="px-4 py-3 text-slate-500 max-w-[260px] truncate" title={r.reason}>{r.reason || '—'}</td>
                    <td className="px-4 py-3">
                      <span className="text-amber-600 text-[13.5px]">Submitted</span>
                      {levels.length > 0 && (
                        <span className="block text-[12.5px] text-slate-400">{done} of {levels.length} levels approved</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {r.canAct ? (
                        <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
                          <button onClick={() => act(r, 'approved')} disabled={busyId === r._id}
                            className="flex items-center gap-1 text-[13px] text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50 px-2.5 py-1.5 rounded-lg">
                            <Check size={14} /> Approve
                          </button>
                          <button onClick={() => act(r, 'rejected')} disabled={busyId === r._id}
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
        <OnDutyModal people={filers.people} peopleLoading={filers.loading}
          onClose={() => setAdding(false)}
          onDone={() => { setAdding(false); load(); }} />
      )}

      {detail && (
        <LeaveDetailModal
          leave={detail}
          kind="on_duty"
          onClose={() => setDetail(null)}
          canAct={detail.status === 'pending' && !!detail.canAct && detail.employee?._id !== user?._id}
          onApprove={(x, comment) => { setDetail(null); act(x, 'approved', comment); }}
          onReject={(x, comment) => { setDetail(null); act(x, 'rejected', comment, true); }}
        />
      )}
    </div>
  );
}
