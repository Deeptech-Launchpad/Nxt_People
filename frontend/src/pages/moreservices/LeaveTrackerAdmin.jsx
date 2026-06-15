import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Plus, ChevronLeft, ChevronRight, CheckCircle2, CheckCheck, Clock, XCircle, Search, Filter,
} from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import LeaveDetailModal from '../../components/LeaveDetailModal';
import ApplyLeaveModal from '../../components/ApplyLeaveModal';
import { useAuth } from '../../context/AuthContext';

/* ── Admin Leave Tracker (Super Admin / HR) ───────────────────────────────
 *  Zoho-People-style listing of ALL org leave requests. Read-only over the
 *  existing admin endpoint `GET /leaves` (full-access → every leave). Row →
 *  the existing LeaveDetailModal (details + approval timeline), plus a leave
 *  balance panel for pending requests. No workflow/approval logic changes. */

const STATUS_OPTIONS = [
  { key: 'all',       label: 'All Requests' },
  { key: 'approved',  label: 'Approved' },
  { key: 'pending',   label: 'Pending' },
  { key: 'rejected',  label: 'Rejected' },
  { key: 'cancelled', label: 'Cancelled' },  // app deletes cancelled leaves → typically empty
];

const LEAVE_TYPES = [
  { code: '',           label: 'All Leave Types' },
  { code: 'casual',     label: 'Casual Leave' },
  { code: 'comp_off',   label: 'Compensatory Off' },
  { code: 'permission', label: 'Permission' },
  { code: 'unpaid',     label: 'Leave Without Pay' },
];
const TYPE_LABEL = { casual: 'Casual Leave', comp_off: 'Compensatory Off', permission: 'Permission', unpaid: 'Leave Without Pay' };

const fmt = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

function StatusCell({ status }) {
  if (status === 'approved') return <span className="inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 size={16} /></span>;
  if (status === 'rejected') return <span className="inline-flex items-center gap-1 text-rose-500"><XCircle size={16} /></span>;
  return <span className="inline-flex items-center gap-1 text-amber-500"><Clock size={16} /></span>;
}

export default function LeaveTrackerAdmin() {
  const navigate = useNavigate();
  const { user } = useAuth();
  // This admin page is HR / Super Admin only (route-gated); both may Approve All.
  const canApproveAll = ['super_admin', 'hr'].includes(user?.role);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [loading, setLoading] = useState(true);

  const [tab, setTab] = useState('all');
  const [leaveType, setLeaveType] = useState('');
  const [department, setDepartment] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [directory, setDirectory] = useState([]);          // for employee + department filters
  const [detail, setDetail] = useState(null);              // selected leave for modal
  const [detailBalance, setDetailBalance] = useState(null);
  const [showApply, setShowApply] = useState(false);
  const [applyTypes, setApplyTypes] = useState([]);        // leaveTypes for ApplyLeaveModal (self)

  // Directory powers the Employee + Department dropdowns (role-open, basic fields).
  useEffect(() => {
    api.get('/org/directory').then(r => setDirectory(r.data.data || [])).catch(() => {});
    api.get('/leaves/balance').then(r => setApplyTypes(r.data.data || [])).catch(() => {});
  }, []);

  const departments = Array.from(new Set(directory.map(d => d.department).filter(Boolean))).sort();

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (tab !== 'all') params.set('status', tab);
    if (department) params.set('department', department);
    if (employeeId) params.set('employeeId', employeeId);
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    params.set('page', page);
    params.set('limit', limit);
    api.get(`/leaves?${params.toString()}`)
      .then(r => { setRows(r.data.data || []); setTotal(r.data.total || 0); })
      .catch(() => toast.error('Failed to load leave requests'))
      .finally(() => setLoading(false));
  }, [tab, department, employeeId, startDate, endDate, page, limit, leaveType]);

  useEffect(() => { load(); }, [load]);
  // Reset to page 1 whenever a filter changes.
  useEffect(() => { setPage(1); }, [tab, leaveType, department, employeeId, startDate, endDate]);

  // Leave type is the only filter the endpoint doesn't take directly — apply it client-side.
  const visible = leaveType ? rows.filter(l => l.leaveType === leaveType) : rows;

  const openDetail = (l) => {
    setDetail(l);
    setDetailBalance(null);
    if (l.status === 'pending' && l.employee?._id) {
      const yr = new Date(l.startDate).getFullYear();
      api.get(`/leaves/balance?employeeId=${l.employee._id}&year=${yr}`)
        .then(r => setDetailBalance(r.data.data || []))
        .catch(() => setDetailBalance(null));
    }
  };

  // Approve / reject a pending request. Super Admin / HR act via the existing
  // engine's HR-override path — no workflow change. The optional comment reuses
  // rejection_reason on both actions.
  const act = async (id, action, comment, approveAll = false) => {
    try {
      await api.put(`/leaves/${id}/action`, { action, rejectionReason: comment, approveAll });
      toast.success(approveAll ? 'All levels approved' : `${action.charAt(0).toUpperCase() + action.slice(1)} successfully`);
      setDetail(null); setDetailBalance(null); load();
    } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
  };

  // Cancel a pending request (Super Admin / HR). The row is kept with status
  // 'cancelled' (shows under the Cancelled filter), balance refunded server-side.
  const cancelLeave = async (id) => {
    if (!confirm('Cancel this leave request? It will be marked as Cancelled.')) return;
    try {
      await api.put(`/leaves/${id}/cancel`);
      toast.success('Leave cancelled');
      setDetail(null); setDetailBalance(null); load();
    } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col min-h-[calc(100vh-12rem)]">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => navigate('/more-services/operations')} className="text-slate-400 hover:text-slate-700 transition-colors">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h2 className="text-[15px] font-bold text-slate-800">Leave Tracker</h2>
            <p className="text-[12px] text-slate-400">All employee leave requests · {total} record{total !== 1 ? 's' : ''}</p>
          </div>
        </div>
        <button onClick={() => setShowApply(true)} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-[13px] font-semibold transition-colors">
          <Plus size={15} /> Add Request
        </button>
      </div>

      {/* Filters — status is a dropdown (Zoho "All Requests" style), not tabs */}
      <div className="px-6 py-3 flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/50">
        <span className="flex items-center gap-1 text-[12px] text-slate-400 font-medium"><Filter size={13} /> Filters</span>
        <select value={tab} onChange={e => setTab(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-slate-700 bg-white focus:outline-none focus:border-blue-400">
          {STATUS_OPTIONS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <select value={leaveType} onChange={e => setLeaveType(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-1.5 text-[12.5px] bg-white focus:outline-none focus:border-blue-400">
          {LEAVE_TYPES.map(lt => <option key={lt.code} value={lt.code}>{lt.label}</option>)}
        </select>
        <select value={department} onChange={e => setDepartment(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-1.5 text-[12.5px] bg-white focus:outline-none focus:border-blue-400">
          <option value="">All Departments</option>
          {departments.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={employeeId} onChange={e => setEmployeeId(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-1.5 text-[12.5px] bg-white focus:outline-none focus:border-blue-400 max-w-[200px]">
          <option value="">All Employees</option>
          {directory.map(e => <option key={e._id} value={e._id}>{e.firstName} {e.lastName}{e.employeeId ? ` (${e.employeeId})` : ''}</option>)}
        </select>
        <div className="flex items-center gap-1">
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} title="From" className="border border-slate-200 rounded-lg px-2 py-1.5 text-[12.5px] bg-white focus:outline-none focus:border-blue-400" />
          <span className="text-slate-300 text-xs">–</span>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} title="To" className="border border-slate-200 rounded-lg px-2 py-1.5 text-[12.5px] bg-white focus:outline-none focus:border-blue-400" />
        </div>
        {(leaveType || department || employeeId || startDate || endDate) && (
          <button onClick={() => { setLeaveType(''); setDepartment(''); setEmployeeId(''); setStartDate(''); setEndDate(''); }}
            className="text-[12px] text-blue-600 hover:text-blue-700 font-medium ml-1">Clear</button>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3">Employee Name</th>
              <th className="px-5 py-3">Leave Type</th>
              <th className="px-5 py-3">Type</th>
              <th className="px-5 py-3">Leave Period</th>
              <th className="px-5 py-3">Days Taken</th>
              <th className="px-5 py-3">Date of Request</th>
              <th className="px-5 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? (
              <tr><td colSpan={8} className="px-5 py-16 text-center"><div className="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" /></td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={8} className="px-5 py-16 text-center text-slate-400 text-[13px]">No leave requests found</td></tr>
            ) : visible.map(l => (
              <tr key={l._id} className="hover:bg-slate-50/70 transition-colors cursor-pointer" onClick={() => openDetail(l)}>
                <td className="px-5 py-3.5"><StatusCell status={l.status} /></td>
                <td className="px-5 py-3.5">
                  <p className="text-[13px] font-semibold text-slate-700">{l.employee?.firstName} {l.employee?.lastName}</p>
                  <p className="text-[11px] text-slate-400 font-mono">{l.employee?.employeeId}</p>
                </td>
                <td className="px-5 py-3.5 text-[13px] text-slate-600">{TYPE_LABEL[l.leaveType] || l.leaveType}</td>
                <td className="px-5 py-3.5">
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${l.leaveType === 'unpaid' ? 'bg-slate-100 text-slate-600' : 'bg-emerald-50 text-emerald-700'}`}>
                    {l.leaveType === 'unpaid' ? 'Unpaid' : 'Paid'}
                  </span>
                </td>
                <td className="px-5 py-3.5 text-[12.5px] text-slate-600">
                  {l.leaveType === 'permission'
                    ? `${fmt(l.startDate)} · ${(l.startTime || '').slice(0,5)}–${(l.endTime || '').slice(0,5)}`
                    : `${fmt(l.startDate)} – ${fmt(l.endDate)}`}
                </td>
                <td className="px-5 py-3.5 text-[13px] text-slate-600">
                  {l.leaveType === 'permission'
                    ? `${l.hours ?? 0}h`
                    : `${l.totalDays} Day${l.totalDays !== 1 ? 's' : ''}`}
                </td>
                <td className="px-5 py-3.5 text-[12.5px] text-slate-500">{fmt(l.createdAt)}</td>
                <td className="px-5 py-3.5">
                  <div className="flex items-center justify-end gap-1.5">
                    {l.status === 'pending' && (
                      <>
                        <button onClick={(e) => { e.stopPropagation(); act(l._id, 'approved'); }}
                          className="flex items-center gap-1 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold transition-colors">
                          <CheckCircle2 size={13} /> Approve
                        </button>
                        {canApproveAll && (
                          <button onClick={(e) => { e.stopPropagation(); act(l._id, 'approved', undefined, true); }}
                            className="flex items-center gap-1 bg-blue-50 text-blue-600 hover:bg-blue-100 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold transition-colors">
                            <CheckCheck size={13} /> Approve All
                          </button>
                        )}
                        <button onClick={(e) => { e.stopPropagation(); act(l._id, 'rejected'); }}
                          className="flex items-center gap-1 bg-rose-50 text-rose-500 hover:bg-rose-100 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold transition-colors">
                          <XCircle size={13} /> Reject
                        </button>
                      </>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); openDetail(l); }}
                      className="bg-blue-50 text-blue-600 hover:bg-blue-100 px-3.5 py-1.5 rounded-lg text-[12px] font-semibold transition-colors">
                      View
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="px-6 py-3 border-t border-slate-100 flex items-center justify-between">
        <p className="text-[12px] text-slate-500">
          {total === 0 ? '0' : `${(page - 1) * limit + 1}–${Math.min(page * limit, total)}`} of {total}
        </p>
        <div className="flex items-center gap-2">
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40"><ChevronLeft size={15} /></button>
          <span className="text-[12px] text-slate-500">Page {page} / {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40"><ChevronRight size={15} /></button>
        </div>
      </div>

      {/* Detail modal + balance panel for pending. Super Admin / HR can act on
          pending requests (approve/reject with an optional comment); Cancel
          Leave is shown only for the admin's own pending request. */}
      {detail && (
        <LeaveDetailModal
          leave={detail}
          kind="leave"
          balance={detail.status === 'pending' ? detailBalance : undefined}
          canAct={detail.status === 'pending'}
          onApprove={(x, comment) => act(x._id, 'approved', comment)}
          onApproveAll={canApproveAll && detail.status === 'pending' ? (x, comment) => act(x._id, 'approved', comment, true) : undefined}
          onReject={(x, comment) => act(x._id, 'rejected', comment)}
          onCancel={(x) => cancelLeave(x._id)}
          onClose={() => { setDetail(null); setDetailBalance(null); }}
        />
      )}

      {/* Add Request — reuses the existing apply flow (creates for the signed-in user). */}
      {showApply && (
        <ApplyLeaveModal
          leaveTypes={applyTypes}
          onClose={() => setShowApply(false)}
          onSuccess={() => { setShowApply(false); load(); }}
        />
      )}
    </div>
  );
}
