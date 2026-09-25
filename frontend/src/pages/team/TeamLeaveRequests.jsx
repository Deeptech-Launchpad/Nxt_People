import React, { useEffect, useState } from 'react';
import { FileText, Search, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import LeaveDetailModal from '../../components/LeaveDetailModal';
import LeaveRequestDialog from '../moreservices/leavetracker/LeaveRequestDialog';
import useSortable from '../../components/table/useSortable';
import SortableTh from '../../components/table/SortableTh';
import { useAuth } from '../../context/AuthContext';
import { LEAVE_LABEL, to12 } from '../moreservices/shift/shiftGrid';
import { useFormat, formatHoursDuration } from '../../utils/datetime';
import {
  Avatar, DirectScopeNote, Spinner, Empty, fmtDay,
  useTeamScope, ScopeSwitch, withScope, useFilingPeople, addButtonClass,
} from './teamShared';

/* ── Leave Requests ───────────────────────────────────────────────────────
 *  The team's leave history — every status, not just the pending queue.
 *
 *  Approvals is the queue and answers "what needs me"; this answers "what has
 *  the team taken", which is the question a manager brings to a one-to-one.
 *  They are different reads, which is why this does not reuse
 *  /leaves/team-pending: that endpoint is pending-only by definition and
 *  widening it would change what the Approvals page counts.
 * ────────────────────────────────────────────────────────────────────────── */

const STATUS_STYLE = {
  pending:   'bg-amber-100 text-amber-700',
  approved:  'bg-emerald-100 text-emerald-700',
  rejected:  'bg-red-100 text-red-700',
  cancelled: 'bg-slate-100 text-slate-500',
};

const FILTERS = [
  ['', 'All'], ['pending', 'Pending'], ['approved', 'Approved'],
  ['rejected', 'Rejected'], ['cancelled', 'Cancelled'],
];

/* Permission is hourly — total_days is 0 on every permission row by design,
 * so printing days there would put the one number the row cannot be next to
 * it. The same rule Approvals.jsx applies. */
const amountLabel = (l, timeFormat) => {
  if (l.leaveType === 'permission') {
    const window = l.startTime && l.endTime ? ` (${to12(l.startTime, timeFormat)}–${to12(l.endTime, timeFormat)})` : '';
    return `${formatHoursDuration(l.hours)}${window}`;
  }
  const days = Number(l.totalDays) || 0;
  const half = l.isHalfDay ? ` · ${l.halfDayType === 'second_half' ? '2nd' : '1st'} half` : '';
  return `${days} day${days === 1 ? '' : 's'}${half}`;
};

const COLUMNS = [
  ['employee', 'Employee'], ['type', 'Type'], ['from', 'From'], ['to', 'To'],
  ['amount', 'Amount'], ['reason', 'Reason'], ['status', 'Status'],
];

export default function TeamLeaveRequests({ embedded = false, scopeKey = null }) {
  const { timeFormat } = useFormat();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [reload, setReload] = useState(0);
  const [detail, setDetail] = useState(null);
  const [detailBalance, setDetailBalance] = useState(null);
  const [adding, setAdding] = useState(false);
  const [types, setTypes] = useState([]);
  const { user } = useAuth();
  const canApproveAll = ['admin', 'director', 'hr_admin', 'manager'].includes(user?.role);
  const scope = useTeamScope(scopeKey);
  const filers = useFilingPeople(adding);

  useEffect(() => {
    if (!adding || types.length) return;
    api.get('/leave-types').then(r => setTypes(r.data.data || [])).catch(() => {});
  }, [adding, types.length]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    api.get(withScope(`/team/leave-requests${status ? `?status=${status}` : ''}`, scope))
      .then(r => { if (live) setRows(r.data.data || []); })
      .catch(err => {
        if (live) toast.error(err.response?.data?.message || 'Could not load the team leave history');
      })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [status, reload, scope.scope]);

  const openDetail = (l) => {
    setDetail(l); setDetailBalance(null);
    if (l.status === 'pending' && l.employee?._id) {
      api.get(`/leaves/balance?employeeId=${l.employee._id}&year=${new Date(l.startDate || Date.now()).getFullYear()}`)
        .then(r => setDetailBalance(r.data.data || [])).catch(() => setDetailBalance(null));
    }
  };

  const action = async (id, act, reason, approveAll = false) => {
    try {
      await api.put(`/leaves/${id}/action`, { action: act, rejectionReason: reason, approveAll });
      toast.success(approveAll ? 'All levels approved' : `${act.charAt(0).toUpperCase() + act.slice(1)} successfully`);
      setReload(n => n + 1);
    } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
  };

  const closeDetail = () => { setDetail(null); setDetailBalance(null); };

  const term = q.trim().toLowerCase();
  const shown = term
    ? rows.filter(l =>
        `${l.employee?.firstName} ${l.employee?.lastName}`.toLowerCase().includes(term) ||
        (l.employee?.employeeId || '').toLowerCase().includes(term))
    : rows;

  const sort = useSortable(shown, {
    id: 'team-leave-requests',
    columns: {
      employee: l => `${l.employee?.firstName || ''} ${l.employee?.lastName || ''}`.trim(),
      type: l => LEAVE_LABEL[l.leaveType] || l.leaveType,
      from: { get: l => (l.startDate ? String(l.startDate).slice(0, 10) : null), type: 'date' },
      to: { get: l => (l.endDate ? String(l.endDate).slice(0, 10) : null), type: 'date' },
      amount: { get: l => (l.leaveType === 'permission' ? Number(l.hours) || 0 : Number(l.totalDays) || 0), type: 'number' },
      reason: { get: l => l.reason, type: 'text' },
      status: { get: l => l.status, type: 'text' },
    },
  });

  return (
    <div className={embedded ? 'p-5' : 'p-6'}>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex rounded-md border border-slate-300 overflow-hidden">
          {FILTERS.map(([k, label]) => (
            <button key={k || 'all'} onClick={() => setStatus(k)}
              className={`px-3.5 py-1.5 text-[13px] font-medium
                ${status === k ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="relative w-full max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name or ID…"
            className="w-full pl-9 pr-3 py-2 text-[14px] border border-slate-200 rounded-lg bg-white
                       focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200" />
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="text-right">
            <p className="text-[13px] font-semibold text-slate-600">{shown.length} request{shown.length === 1 ? '' : 's'}</p>
            <DirectScopeNote scope={scope.scope} />
          </div>
          <ScopeSwitch ctl={scope} />
          {filers.canFile && (
            <button type="button" onClick={() => setAdding(true)} className={addButtonClass}>
              <Plus size={14} /> Add Request
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        {loading ? <Spinner /> : shown.length === 0 ? (
          <Empty icon={FileText}
            title={rows.length === 0
              ? `No ${status || ''} leave on record for your team`.replace('  ', ' ')
              : 'No request matches that search'}
            sub={rows.length === 0
              ? 'Requests appear here as soon as somebody who reports to you applies.'
              : 'Clear the search to see every request.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {COLUMNS.map(([k, h]) => (
                    <SortableTh key={k} sort={sort} k={k} className="px-5 py-2.5 text-left text-[12px] font-medium text-slate-500 uppercase tracking-wider">
                      {h}
                    </SortableTh>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sort.sorted.map(l => (
                  <tr key={l._id} className="hover:bg-slate-50/70 cursor-pointer focus:outline-none focus:bg-blue-50/60"
                    tabIndex={0} role="button"
                    onClick={() => openDetail(l)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(l); } }}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar person={l.employee} size={30} />
                        <div className="min-w-0">
                          <p className="text-[14px] font-medium text-slate-800 truncate">
                            {l.employee?.firstName} {l.employee?.lastName}
                          </p>
                          <p className="text-[12px] text-slate-400 font-mono">{l.employee?.employeeId || '—'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-[14px] text-slate-600">
                      {LEAVE_LABEL[l.leaveType] || l.leaveType}
                    </td>
                    <td className="px-5 py-3 text-[14px] text-slate-600">{fmtDay(l.startDate, { day: '2-digit', month: 'short' })}</td>
                    <td className="px-5 py-3 text-[14px] text-slate-600">{fmtDay(l.endDate, { day: '2-digit', month: 'short' })}</td>
                    <td className="px-5 py-3 text-[14px] font-medium text-slate-700">{amountLabel(l, timeFormat)}</td>
                    <td className="px-5 py-3 text-[13px] text-slate-500 max-w-[240px]">
                      <span className="block truncate" title={l.reason || ''}>{l.reason || '—'}</span>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-[12px] font-semibold px-2 py-0.5 rounded-full capitalize
                        ${STATUS_STYLE[l.status] || 'bg-slate-100 text-slate-500'}`}
                        title={l.status === 'rejected' && l.rejectionReason ? l.rejectionReason : undefined}>
                        {l.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {adding && (
        <LeaveRequestDialog
          mode="apply"
          people={filers.people}
          peopleLoading={filers.loading}
          types={types}
          onClose={() => setAdding(false)}
          onSaved={() => setReload(n => n + 1)}
        />
      )}

      {detail && (
        <LeaveDetailModal
          leave={detail}
          kind="leave"
          balance={detail.status === 'pending' ? detailBalance : undefined}
          onClose={closeDetail}
          canAct={detail.status === 'pending' && !!detail.canAct && detail.employee?._id !== user?._id}
          onApprove={(x, comment) => { closeDetail(); action(x._id, 'approved', comment); }}
          onApproveAll={canApproveAll && detail.status === 'pending' && !!detail.canAct
            ? (x, comment) => { if (confirm('Approve all remaining levels for this request? This skips any other pending approvers.')) { closeDetail(); action(x._id, 'approved', comment, true); } }
            : undefined}
          onReject={(x, comment) => { closeDetail(); action(x._id, 'rejected', comment); }}
        />
      )}
    </div>
  );
}
