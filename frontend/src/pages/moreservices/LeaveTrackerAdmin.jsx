import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  // This admin page is HR / Super Admin only (route-gated); both may Approve All.
  const canApproveAll = ['admin', 'director', 'hr_admin'].includes(user?.role);
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

  // If the URL contains ?openId=UUID (from an approval email link), fetch that
  // specific leave and open its detail modal automatically.
  useEffect(() => {
    const openId = searchParams.get('openId');
    if (!openId) return;
    api.get(`/leaves?leaveId=${openId}`)
      .then(r => {
        const l = (r.data.data || [])[0];
        if (!l) return;
        setDetail(l);
        setDetailBalance(null);
        if (l.status === 'pending' && l.employee?._id) {
          const yr = new Date(l.startDate).getFullYear();
          api.get(`/leaves/balance?employeeId=${l.employee._id}&year=${yr}`)
            .then(b => setDetailBalance(b.data.data || []))
            .catch(() => setDetailBalance(null));
        }
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 flex flex-col min-h-[calc(100vh-12rem)]">
      {/* Header */}
      <div className="px-7 py-5 border-b border-slate-100 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => navigate('/more-services/operations')} className="text-slate-400 hover:text-slate-600 transition-colors">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h2 className="text-[18px] font-bold text-slate-900">Leave Tracker</h2>
            <p className="text-[13px] text-slate-500">All employee leave requests · {total} record{total !== 1 ? 's' : ''}</p>
          </div>
        </div>
        <button onClick={() => setShowApply(true)} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg text-[14px] font-semibold transition-colors shadow-sm">
          <Plus size={16} /> Add Request
        </button>
      </div>

      {/* Status Cards Grid */}
      <div className="px-7 py-6 border-b border-slate-100 bg-slate-50">
        <p className="text-[13px] font-semibold text-slate-700 mb-4">Filter by Status</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {STATUS_OPTIONS.map(opt => (
            <button
              key={opt.key}
              onClick={() => { setTab(opt.key); setPage(1); }}
              className={`p-4 rounded-xl border-2 transition-all text-center ${
                tab === opt.key
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
              }`}
            >
              <p className="text-[14px] font-semibold">{opt.label}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Advanced Filters */}
      <div className="px-7 py-4 flex flex-wrap items-center gap-3 border-b border-slate-100 bg-white">
        <span className="flex items-center gap-2 text-[13px] text-slate-600 font-semibold"><Filter size={15} /> Advanced Filters</span>
        <select value={leaveType} onChange={e => setLeaveType(e.target.value)} className="border border-slate-200 rounded-lg px-3.5 py-2 text-[13px] font-medium text-slate-700 bg-white hover:border-slate-300 focus:outline-none focus:border-blue-400 transition-colors">
          {LEAVE_TYPES.map(lt => <option key={lt.code} value={lt.code}>{lt.label}</option>)}
        </select>
        <select value={department} onChange={e => setDepartment(e.target.value)} className="border border-slate-200 rounded-lg px-3.5 py-2 text-[13px] font-medium text-slate-700 bg-white hover:border-slate-300 focus:outline-none focus:border-blue-400 transition-colors">
          <option value="">All Departments</option>
          {departments.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={employeeId} onChange={e => setEmployeeId(e.target.value)} className="border border-slate-200 rounded-lg px-3.5 py-2 text-[13px] font-medium text-slate-700 bg-white hover:border-slate-300 focus:outline-none focus:border-blue-400 transition-colors max-w-xs">
          <option value="">All Employees</option>
          {directory.map(e => <option key={e._id} value={e._id}>{e.firstName} {e.lastName}{e.employeeId ? ` (${e.employeeId})` : ''}</option>)}
        </select>
        <div className="flex items-center gap-2">
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} title="From Date" className="border border-slate-200 rounded-lg px-3 py-2 text-[13px] font-medium bg-white hover:border-slate-300 focus:outline-none focus:border-blue-400 transition-colors" />
          <span className="text-slate-300 text-base">to</span>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} title="To Date" className="border border-slate-200 rounded-lg px-3 py-2 text-[13px] font-medium bg-white hover:border-slate-300 focus:outline-none focus:border-blue-400 transition-colors" />
        </div>
        {(leaveType || department || employeeId || startDate || endDate) && (
          <button onClick={() => { setLeaveType(''); setDepartment(''); setEmployeeId(''); setStartDate(''); setEndDate(''); }}
            className="text-[13px] text-blue-600 hover:text-blue-700 font-semibold transition-colors">Clear All</button>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100 text-[12px] font-bold text-slate-600 uppercase tracking-wider">
              <th className="px-6 py-4">Status</th>
              <th className="px-6 py-4">Employee</th>
              <th className="px-6 py-4">Leave Type</th>
              <th className="px-6 py-4">Category</th>
              <th className="px-6 py-4">Period</th>
              <th className="px-6 py-4">Duration</th>
              <th className="px-6 py-4">Requested On</th>
              <th className="px-6 py-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={8} className="px-6 py-16 text-center"><div className="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" /></td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={8} className="px-6 py-16 text-center text-slate-400 text-[14px]">No leave requests found</td></tr>
            ) : visible.map(l => (
              <tr key={l._id} className="hover:bg-slate-50 transition-colors cursor-pointer border-slate-50" onClick={() => openDetail(l)}>
                <td className="px-6 py-4"><StatusCell status={l.status} /></td>
                <td className="px-6 py-4">
                  <p className="text-[14px] font-semibold text-slate-800">{l.employee?.firstName} {l.employee?.lastName}</p>
                  <p className="text-[12px] text-slate-500 font-mono">{l.employee?.employeeId}</p>
                </td>
                <td className="px-6 py-4 text-[14px] font-medium text-slate-700">{TYPE_LABEL[l.leaveType] || l.leaveType}</td>
                <td className="px-6 py-4">
                  <span className={`text-[12px] font-bold px-2.5 py-1 rounded-full ${l.leaveType === 'unpaid' ? 'bg-slate-100 text-slate-700' : 'bg-emerald-50 text-emerald-700'}`}>
                    {l.leaveType === 'unpaid' ? 'Unpaid' : 'Paid'}
                  </span>
                </td>
                <td className="px-6 py-4 text-[14px] text-slate-700">
                  {l.leaveType === 'permission'
                    ? `${fmt(l.startDate)} · ${(l.startTime || '').slice(0,5)}–${(l.endTime || '').slice(0,5)}`
                    : `${fmt(l.startDate)} – ${fmt(l.endDate)}`}
                </td>
                <td className="px-6 py-4 text-[14px] font-semibold text-slate-700">
                  {l.leaveType === 'permission'
                    ? `${l.hours ?? 0}h`
                    : `${l.totalDays} Day${l.totalDays !== 1 ? 's' : ''}`}
                </td>
                <td className="px-6 py-4 text-[13px] text-slate-600">{fmt(l.createdAt)}</td>
                <td className="px-6 py-4">
                  <div className="flex items-center justify-end gap-2">
                    {l.status === 'pending' && (
                      <>
                        <button onClick={(e) => { e.stopPropagation(); act(l._id, 'approved'); }}
                          className="flex items-center gap-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 px-3 py-1.5 rounded-lg text-[12px] font-bold transition-colors">
                          <CheckCircle2 size={14} /> Approve
                        </button>
                        {canApproveAll && (
                          <button onClick={(e) => { e.stopPropagation(); act(l._id, 'approved', undefined, true); }}
                            className="flex items-center gap-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 px-3 py-1.5 rounded-lg text-[12px] font-bold transition-colors">
                            <CheckCheck size={14} /> Approve All
                          </button>
                        )}
                        <button onClick={(e) => { e.stopPropagation(); act(l._id, 'rejected'); }}
                          className="flex items-center gap-1.5 bg-rose-50 text-rose-600 hover:bg-rose-100 px-3 py-1.5 rounded-lg text-[12px] font-bold transition-colors">
                          <XCircle size={14} /> Reject
                        </button>
                      </>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); openDetail(l); }}
                      className="bg-slate-100 text-slate-700 hover:bg-slate-200 px-4 py-1.5 rounded-lg text-[12px] font-bold transition-colors">
                      View Details
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="px-7 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
        <p className="text-[13px] font-medium text-slate-600">
          {total === 0 ? 'No records' : `Showing ${(page - 1) * limit + 1}–${Math.min(page * limit, total)} of ${total} requests`}
        </p>
        <div className="flex items-center gap-3">
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-white disabled:opacity-40 disabled:text-slate-400 transition-colors" title="Previous page"><ChevronLeft size={16} /></button>
          <span className="text-[13px] font-semibold text-slate-700 min-w-[120px] text-center">Page {page} of {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-white disabled:opacity-40 disabled:text-slate-400 transition-colors" title="Next page"><ChevronRight size={16} /></button>
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
