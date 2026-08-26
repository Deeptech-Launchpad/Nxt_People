import React, { useState, useEffect } from 'react';
import { CheckCircle, CheckCheck, XCircle, Clock, Home, RefreshCw, Gift, Search, Eye, Briefcase } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import api from '../utils/api';
import toast from 'react-hot-toast';
import LeaveDetailModal from '../components/LeaveDetailModal';
import { useAuth } from '../context/AuthContext';
import usePolling from '../hooks/usePolling';

const LEAVE_TYPE_LABELS = {
  casual:   'Casual Leave',
  comp_off: 'Compensatory Off',
  unpaid:   'Leave Without Pay',
  permission: 'Permission'
};

// Convert HH:MM or HH:MM:SS (24-hour) to 12-hour AM/PM display.
const fmt12 = (t) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
};

// Safe date-only formatter — never renders "Invalid Date" for a blank value.
const fmtDay = (d, opts = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) => {
  if (!d) return '—';
  const dt = new Date(String(d).slice(0, 10) + 'T00:00:00');
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-IN', opts);
};

// localStorage key for the "last-seen count per tab" persistence. Bump
// the v1 suffix if we ever change the shape of the saved value.
const SEEN_KEY = 'nxt_approvals_seen_v1';

const loadSeen = () => {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') || {}; }
  catch { return {}; }
};
const saveSeen = (obj) => {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(obj)); } catch (_) {}
};

/* `embedded` renders this inside Operations -> Leave Tracker, where the page
 * already has its own heading and back button. Same component either way — a
 * second copy for the tab would be the thing that drifts. */
export default function Approvals({ embedded = false }) {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  // Approve All is available to HR / Super Admin and Team Leads (managers).
  // Managers are still scoped server-side to requests they actually approve.
  const canApproveAll = ['admin', 'director', 'hr_admin', 'manager'].includes(user?.role);
  const [data, setData] = useState({ leaves: [], permissions: [], timesheets: [], regularizations: [], wfhRequests: [], compOffs: [], onDuty: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    const valid = ['leaves','permissions','approvedLeaves','rejectedLeaves','timesheets','regularizations','wfh','compoff','onduty'];
    return valid.includes(t) ? t : 'leaves';
  });
  // Last-seen count per tab — persisted to localStorage so the badge
  // stays cleared across refreshes (was previously a stale per-session
  // Set that always re-populated on reload). If new items arrive later
  // and the count exceeds what's stored here, the badge naturally
  // re-appears with the delta.
  const [seenCounts, setSeenCounts] = useState(() => loadSeen());
  const [searchFilter, setSearchFilter] = useState('');
  const [detailLeave, setDetailLeave] = useState(null);  // leave shown in the detail/timeline modal
  const [detailBalance, setDetailBalance] = useState(null); // balance cards for the detail modal
  const [detailWfh, setDetailWfh] = useState(null);
  const [actionLoading, setActionLoading] = useState('');
  const [rejectModal, setRejectModal] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const PAGE_SIZE = 25;
  const [visibleCounts, setVisibleCounts] = useState({});
  const getVisible = (tabId, arr) => (arr || []).slice(0, visibleCounts[tabId] || PAGE_SIZE);
  const showMore = (tabId) => setVisibleCounts(prev => ({ ...prev, [tabId]: (prev[tabId] || PAGE_SIZE) + PAGE_SIZE }));

  // When the user clicks a tab, mark its current count as "seen" and
  // persist. Done as a small helper so the rendering code stays clean.
  const markTabSeen = (tabId, currentCount) => {
    setSeenCounts(prev => {
      const next = { ...prev, [tabId]: currentCount || 0 };
      saveSeen(next);
      return next;
    });
  };

  const load = (silent = false) => {
    if (!silent) setLoading(true);
    api.get('/approvals/pending')
      .then(res => {
        const d = res.data.data || {};
        const allLeaves = d.leaves || [];
        const approved = (d.approvedLeaves || []).filter(l => l.status === 'approved');
        const rejected = (d.approvedLeaves || []).filter(l => l.status === 'rejected');
        // Separate permission leaves from other leave types
        const permissions = allLeaves.filter(l => l.leaveType === 'permission');
        const leaves = allLeaves.filter(l => l.leaveType !== 'permission');
        setData({
          leaves,
          permissions,
          timesheets: d.timesheets || [],
          regularizations: d.regularizations || [],
          wfhRequests: d.wfhRequests || [],
          compOffs: d.compOffs || [],
          onDuty: d.onDuty || [],
          approvedLeaves: approved,
          rejectedLeaves: rejected,
          total: d.total || 0,
        });
      })
      .catch(err => { if (!silent) toast.error(err.response?.data?.message || 'Failed to load approvals'); })
      .finally(() => { if (!silent) setLoading(false); });
  };

  useEffect(load, []);

  // Picks up newly submitted / approved requests without a manual refresh.
  usePolling(() => load(true), 5000);

  /* ── Auto-open modal from ?openId= URL param (email/notification deep-link) ── */
  useEffect(() => {
    const openId = searchParams.get('openId');
    if (!openId || loading) return;
    const allItems = [
      ...data.leaves,
      ...(data.permissions || []),
      ...(data.regularizations || []),
      ...(data.approvedLeaves || []),
      ...(data.rejectedLeaves || []),
      ...(data.wfhRequests || []),
      ...(data.compOffs || []),
      ...(data.onDuty || []),
    ];
    const found = allItems.find(item => item._id === openId);
    if (!found) return;
    const typeToTab = { permission: 'permissions' };
    if (data.onDuty?.find(o => o._id === openId)) setTab('onduty');
    else if (data.regularizations?.find(r => r._id === openId)) setTab('regularizations');
    else if (data.permissions?.find(p => p._id === openId)) setTab('permissions');
    else if (data.approvedLeaves?.find(l => l._id === openId)) setTab('approvedLeaves');
    else if (data.rejectedLeaves?.find(l => l._id === openId)) setTab('rejectedLeaves');
    else setTab(typeToTab[found.leaveType] || 'leaves');
    setDetailLeave(found);
    setDetailBalance(null);
    if (found.status === 'pending' && found.employee?._id) {
      api.get(`/leaves/balance?employeeId=${found.employee._id}&year=${new Date(found.startDate || Date.now()).getFullYear()}`)
        .then(r => setDetailBalance(r.data.data || []))
        .catch(() => setDetailBalance(null));
    }
  }, [loading, searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // The 'leaves' tab is the default open one — auto-mark it as seen
  // whenever fresh data arrives so the user never sees a badge on the
  // tab they're already looking at.
  useEffect(() => {
    if (!loading) markTabSeen('leaves', data.leaves?.length || 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, data.leaves?.length]);

  const action = async (endpoint, id, act, reason, approveAll = false) => {
    setActionLoading(id);
    try {
      await api.put(`/${endpoint}/${id}/action`, { action: act, rejectionReason: reason, approveAll });
      toast.success(approveAll ? 'All levels approved' : `${act.charAt(0).toUpperCase() + act.slice(1)} successfully`);
      load();
    } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
    finally { setActionLoading(''); }
  };

  const leaveTypeColors = {
    casual: 'bg-blue-50 text-blue-700',
    comp_off: 'bg-green-50 text-green-700',
    unpaid: 'bg-slate-50 text-slate-600',
    permission: 'bg-purple-50 text-purple-700'
  };

  const TABS = [
    ['leaves', 'Leave Requests', data.leaves?.length],
    ['permissions', 'Permissions', data.permissions?.length],
    ['approvedLeaves', 'Approved Leaves', data.approvedLeaves?.length],
    ['rejectedLeaves', 'Rejected Leaves', data.rejectedLeaves?.length],
    ['timesheets', 'Timesheets', data.timesheets?.length],
    ['regularizations', 'Regularizations', data.regularizations?.length],
    ['wfh', 'WFH Requests', data.wfhRequests?.length],
    ['compoff', 'Comp-Off', data.compOffs?.length],
    ['onduty', 'On Duty', data.onDuty?.length],
  ];

  const ActionBtns = ({ endpoint, id, type, canActLeave, status }) => {
    let canAct = false;
    if (endpoint === 'leaves' || endpoint === 'regularizations' || endpoint === 'comp-off' || endpoint === 'wfh' || endpoint === 'on-duty') {
      canAct = status === 'pending' && !!canActLeave;
    } else if (endpoint === 'timesheets') {
      canAct = status === 'submitted' && !!canActLeave;
    } else {
      canAct = (status === 'pending' || status === 'submitted');
    }

    if (!canAct) {
      const displayStatus = status || 'Pending';
      const statusColor = displayStatus === 'approved' ? 'text-emerald-600 bg-emerald-50 border-emerald-200' : 
                          displayStatus === 'rejected' ? 'text-red-600 bg-red-50 border-red-200' :
                          'text-slate-500 bg-slate-50 border-slate-200';
      return (
        <div className="flex-shrink-0">
          <span className={`text-[13px] font-medium px-3 py-1.5 rounded-lg border capitalize ${statusColor}`}>
            {displayStatus}
          </span>
        </div>
      );
    }

    // Show Approve/Reject buttons
    return (
      <div className="flex items-center gap-2 flex-shrink-0">
        <button onClick={() => action(endpoint, id, 'approved')} disabled={!!actionLoading}
          className="flex items-center gap-1.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
          <CheckCircle size={13} /> Approve
        </button>
        {/* Approve every remaining level at once (leaves + comp-offs + wfh) — HR/SA + Team Leads. */}
        {(endpoint === 'leaves' || endpoint === 'comp-off' || endpoint === 'wfh') && canApproveAll && (
          <button onClick={() => { if (confirm('Approve all remaining levels for this request? This skips any other pending approvers.')) action(endpoint, id, 'approved', undefined, true); }} disabled={!!actionLoading}
            className="flex items-center gap-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
            <CheckCheck size={13} /> Approve All
          </button>
        )}
        <button onClick={() => { setRejectModal({ endpoint, id }); setRejectReason(''); }} disabled={!!actionLoading}
          className="flex items-center gap-1.5 bg-red-50 text-red-500 hover:bg-red-100 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
          <XCircle size={13} /> Reject
        </button>
      </div>
    );
  };

  const EmptyState = ({ icon: Icon, message }) => (
    <div className="text-center py-16">
      <Icon size={40} className="text-slate-200 mx-auto mb-3" />
      <p className="text-slate-600">{message}</p>
    </div>
  );

  const ShowMoreFooter = ({ tabId, total, shown }) => shown >= total ? null : (
    <div className="p-4 text-center">
      <button onClick={() => showMore(tabId)} className="text-brand-600 hover:text-brand-700 text-sm font-semibold">
        Show more ({total - shown} remaining)
      </button>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
        {[
          ['Total Pending',   data.total,                    'bg-amber-50 text-amber-700',  null],
          ['Leaves',          data.leaves?.length,           'bg-blue-50 text-blue-700',    'leaves'],
          ['Permissions',     data.permissions?.length,      'bg-purple-50 text-purple-700','permissions'],
          ['Timesheets',      data.timesheets?.length,       'bg-brand-50 text-brand-700',  'timesheets'],
          ['Regularizations', data.regularizations?.length,  'bg-slate-50 text-slate-600',  'regularizations'],
          ['WFH Requests',    data.wfhRequests?.length,      'bg-green-50 text-green-700',  'wfh'],
          ['Comp-Off',        data.compOffs?.length,         'bg-orange-50 text-orange-700','compoff'],
          ['On Duty',         data.onDuty?.length,           'bg-violet-50 text-violet-700','onduty'],
        ].map(([l, v, c, tabId]) => (
          <div
            key={l}
            onClick={() => tabId && setTab(tabId)}
            className={`bg-white rounded-2xl p-4 border border-slate-100 shadow-sm transition-colors ${tabId ? 'cursor-pointer hover:border-slate-300 hover:shadow-md' : ''}`}
          >
            <p className="text-sm text-slate-500 mb-2">{l}</p>
            <p className={`text-4xl font-display font-bold px-3 py-1 rounded-lg w-fit ${c}`}>{v ?? 0}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        {/* Tabs */}
        <div className="flex border-b border-slate-100 overflow-x-auto items-center">
          {TABS.map(([id, label, count]) => {
            // Show the badge only if there's at least one item the user
            // hasn't seen yet — i.e. the current count is bigger than
            // what they last viewed. After a hard refresh the seenCounts
            // come back from localStorage, so the badge stays cleared
            // until new items actually arrive.
            const currentCount = count || 0;
            const seen        = seenCounts[id] || 0;
            const showBadge   = currentCount > 0 && currentCount > seen;
            return (
              <button key={id} onClick={() => { setTab(id); markTabSeen(id, currentCount); setSearchFilter(''); }}
                className={`flex items-center gap-2 px-5 py-4 text-base font-medium border-b-2 transition-colors whitespace-nowrap flex-shrink-0 ${tab === id ? 'border-brand-600 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                {label}
                {showBadge && (
                  <span className={`w-5 h-5 rounded-full text-sm flex items-center justify-center font-bold ${tab === id ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                    {currentCount}
                  </span>
                )}
              </button>
            );
          })}
          <div className="ml-auto flex items-center gap-2 pr-4 flex-shrink-0">
            <button onClick={load} className="p-2 text-slate-400 hover:text-brand-600 transition-colors">
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        {['approvedLeaves', 'rejectedLeaves'].includes(tab) && (
          <div className="px-5 py-3 border-b border-slate-100">
            <div className="relative w-64">
              <input
                type="text"
                placeholder="Filter by name..."
                value={searchFilter}
                onChange={e => setSearchFilter(e.target.value)}
                className="pl-8 pr-3 py-1.5 w-full border border-slate-200 rounded-lg text-[15px] outline-none focus:border-brand-400"
              />
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-600" />
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12"><div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : (
          <div className="divide-y divide-slate-50">

            {/* Leave Requests */}
            {tab === 'leaves' && (
              data.leaves?.length === 0
                ? <EmptyState icon={CheckCircle} message="No pending leave requests" />
                : <>
                {getVisible('leaves', data.leaves).map(l => (
                  <div key={l._id} className="p-5 flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-base font-bold ${leaveTypeColors[l.leaveType] || 'bg-slate-50 text-slate-600'}`}>
                        {l.leaveType?.[0]?.toUpperCase()}
                      </div>
                       <div>
                         <div className="flex items-center gap-2 flex-wrap">
                           <p className="font-semibold text-slate-700">{l.employee?.firstName} {l.employee?.lastName}</p>
                           <span className="text-sm text-slate-600">{l.employee?.employeeId}</span>
                           <span className="text-sm bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full">{l.employee?.department}</span>
                           {l.status === 'pending' && l.approvalLevels?.length > 0 && (
                              <span className="text-[12px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200">
                                {l.approvalLevels.filter(a => a.status === 'approved').length} of {l.approvalLevels.length} level{l.approvalLevels.length !== 1 ? 's' : ''} approved
                              </span>
                            )}
                         </div>
                         <p className="text-base text-slate-700 mt-1 capitalize">
                           {l.leaveType} Leave · {l.totalDays} day{l.totalDays !== 1 ? 's' : ''}
                           {l.isHalfDay && <span className="ml-1 text-sm bg-amber-50 text-amber-700 px-1.5 rounded-full">Half Day</span>}
                         </p>
                        <p className="text-base text-slate-600 mt-0.5">
                          {fmtDay(l.startDate, { month: 'short', day: 'numeric' })} – {fmtDay(l.endDate, { month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                        <p className="text-sm text-slate-600 mt-1">{l.reason}</p>
                      </div>
                     </div>
                     <div className="flex items-center gap-2 flex-shrink-0">
                       <button onClick={() => {
                         setDetailLeave(l); setDetailBalance(null);
                         if (l.status === 'pending' && l.employee?._id) {
                           api.get(`/leaves/balance?employeeId=${l.employee._id}&year=${new Date(l.startDate || Date.now()).getFullYear()}`)
                             .then(r => setDetailBalance(r.data.data || [])).catch(() => setDetailBalance(null));
                         }
                       }} className="flex items-center gap-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-colors">
                         <Eye size={13} /> View
                       </button>
                       <ActionBtns endpoint="leaves" id={l._id} type="Leave" canActLeave={l.canAct && l.employee?._id !== user?._id} status={l.status} />
                     </div>
                   </div>
                ))}
                <ShowMoreFooter tabId="leaves" total={data.leaves.length} shown={getVisible('leaves', data.leaves).length} />
                </>
            )}

            {/* Permissions */}
            {tab === 'permissions' && (
              data.permissions?.length === 0
                ? <EmptyState icon={CheckCircle} message="No pending permission requests" />
                : <>
                {getVisible('permissions', data.permissions).map(p => (
                  <div key={p._id} className="p-5 flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-base font-bold ${leaveTypeColors[p.leaveType] || 'bg-slate-50 text-slate-600'}`}>
                        {p.leaveType?.[0]?.toUpperCase()}
                      </div>
                       <div>
                         <div className="flex items-center gap-2 flex-wrap">
                           <p className="font-semibold text-slate-700">{p.employee?.firstName} {p.employee?.lastName}</p>
                           <span className="text-sm text-slate-600">{p.employee?.employeeId}</span>
                           <span className="text-sm bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{p.employee?.department}</span>
                           {p.status === 'pending' && p.approvalLevels?.length > 0 && (
                              <span className="text-[12px] font-semibold px-2 py-0.5 rounded-full bg-purple-50 text-purple-600 border border-purple-200">
                                {p.approvalLevels.filter(a => a.status === 'approved').length} of {p.approvalLevels.length} level{p.approvalLevels.length !== 1 ? 's' : ''} approved
                              </span>
                            )}
                         </div>
                         <p className="text-base text-slate-500 mt-1 capitalize">
                           Permission · {p.hours}h {p.startTime && p.endTime && `(${fmt12(p.startTime)}–${fmt12(p.endTime)})`}
                         </p>
                        <p className="text-base text-slate-600 mt-0.5">
                          {fmtDay(p.startDate, { month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                        <p className="text-sm text-slate-400 mt-1">{p.reason}</p>
                      </div>
                     </div>
                     <div className="flex items-center gap-2 flex-shrink-0">
                       <button onClick={() => {
                         setDetailLeave(p); setDetailBalance(null);
                         if (p.status === 'pending' && p.employee?._id) {
                           api.get(`/leaves/balance?employeeId=${p.employee._id}&year=${new Date(p.startDate || Date.now()).getFullYear()}`)
                             .then(r => setDetailBalance(r.data.data || [])).catch(() => setDetailBalance(null));
                         }
                       }} className="flex items-center gap-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-colors">
                         <Eye size={13} /> View
                       </button>
                       <ActionBtns endpoint="leaves" id={p._id} type="Permission" canActLeave={p.canAct && p.employee?._id !== user?._id} status={p.status} />
                     </div>
                   </div>
                ))}
                <ShowMoreFooter tabId="permissions" total={data.permissions.length} shown={getVisible('permissions', data.permissions).length} />
                </>
            )}

            {/* Approved Leaves */}
            {tab === 'approvedLeaves' && (() => {
              const list = data.approvedLeaves?.filter(l => !searchFilter || `${l.employee?.firstName} ${l.employee?.lastName}`.toLowerCase().includes(searchFilter.toLowerCase())) || [];
              return list.length === 0
                ? <EmptyState icon={CheckCircle} message="No approved leave requests found" />
                : <>
                {getVisible('approvedLeaves', list).map(l => (
                  <div key={l._id} className="p-5 flex items-start justify-between gap-4 overflow-hidden">
                    <div className="flex items-start gap-4 min-w-0">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-base font-bold ${leaveTypeColors[l.leaveType] || 'bg-slate-50 text-slate-600'}`}>
                        {l.leaveType?.[0]?.toUpperCase()}
                      </div>
                       <div>
                         <div className="flex items-center gap-2 flex-wrap">
                           <p className="font-semibold text-slate-700">{l.employee?.firstName} {l.employee?.lastName}</p>
                           <span className="text-sm text-slate-600">{l.employee?.employeeId}</span>
                           <span className="text-sm bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full">{l.employee?.department}</span>
                         </div>
                         <p className="text-base text-slate-700 mt-1 capitalize">
                           {l.leaveType} Leave · {l.totalDays} day{l.totalDays !== 1 ? 's' : ''}
                           {l.isHalfDay && <span className="ml-1 text-sm bg-amber-50 text-amber-700 px-1.5 rounded-full">Half Day</span>}
                         </p>
                        <p className="text-base text-slate-600 mt-0.5">
                          {fmtDay(l.startDate, { month: 'short', day: 'numeric' })} – {fmtDay(l.endDate, { month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                        <p className="text-sm text-slate-600 mt-1">{l.reason}</p>
                      </div>
                     </div>
                     <div className="flex items-center gap-2 flex-shrink-0">
                       <button onClick={() => setDetailLeave(l)} className="flex items-center gap-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-colors">
                         <Eye size={13} /> View
                       </button>
                       <ActionBtns endpoint="leaves" id={l._id} type="Leave" canActLeave={l.canAct} status={l.status} />
                     </div>
                   </div>
                ))}
                <ShowMoreFooter tabId="approvedLeaves" total={list.length} shown={getVisible('approvedLeaves', list).length} />
                </>;
            })()}

            {/* Rejected Leaves */}
            {tab === 'rejectedLeaves' && (() => {
              const list = data.rejectedLeaves?.filter(l => !searchFilter || `${l.employee?.firstName} ${l.employee?.lastName}`.toLowerCase().includes(searchFilter.toLowerCase())) || [];
              return list.length === 0
                ? <EmptyState icon={XCircle} message="No rejected leave requests found" />
                : <>
                {getVisible('rejectedLeaves', list).map(l => (
                  <div key={l._id} className="p-5 flex items-start justify-between gap-4 overflow-hidden">
                    <div className="flex items-start gap-4 min-w-0">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-base font-bold ${leaveTypeColors[l.leaveType] || 'bg-slate-50 text-slate-600'}`}>
                        {l.leaveType?.[0]?.toUpperCase()}
                         </div>
                       <div>
                         <div className="flex items-center gap-2 flex-wrap">
                           <p className="font-semibold text-slate-700">{l.employee?.firstName} {l.employee?.lastName}</p>
                           <span className="text-sm text-slate-600">{l.employee?.employeeId}</span>
                           <span className="text-sm bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full">{l.employee?.department}</span>
                         </div>
                         <p className="text-base text-slate-700 mt-1 capitalize">
                           {l.leaveType} Leave · {l.totalDays} day{l.totalDays !== 1 ? 's' : ''}
                           {l.isHalfDay && <span className="ml-1 text-sm bg-amber-50 text-amber-700 px-1.5 rounded-full">Half Day</span>}
                         </p>
                        <p className="text-base text-slate-600 mt-0.5">
                          {fmtDay(l.startDate, { month: 'short', day: 'numeric' })} – {fmtDay(l.endDate, { month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                        <p className="text-sm text-slate-600 mt-1">{l.reason}</p>
                        {l.rejectionReason && (
                          <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded px-2.5 py-1.5 mt-2 font-medium w-fit">
                            Rejection Reason: {l.rejectionReason}
                          </p>
                        )}
                      </div>
                     </div>
                     <div className="flex items-center gap-2 flex-shrink-0">
                       <button onClick={() => setDetailLeave(l)} className="flex items-center gap-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-colors">
                         <Eye size={13} /> View
                       </button>
                       <ActionBtns endpoint="leaves" id={l._id} type="Leave" canActLeave={l.canAct} status={l.status} />
                     </div>
                   </div>
                ))}
                <ShowMoreFooter tabId="rejectedLeaves" total={list.length} shown={getVisible('rejectedLeaves', list).length} />
                </>;
            })()}

            {/* Timesheets */}
            {tab === 'timesheets' && (
              data.timesheets?.length === 0
                ? <EmptyState icon={CheckCircle} message="No pending timesheets" />
                : <>
                {getVisible('timesheets', data.timesheets).map(ts => (
                  <div key={ts._id} className="p-5 flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 bg-brand-50 rounded-xl flex items-center justify-center text-brand-600 font-display font-bold text-base flex-shrink-0">
                        {ts.totalHours?.toFixed(0)}h
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-slate-700">{ts.employee?.firstName} {ts.employee?.lastName}</p>
                          <span className="text-sm bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{ts.employee?.department}</span>
                        </div>
                        <p className="text-base text-slate-500 mt-1">
                          {new Date(ts.weekStartDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {new Date(ts.weekEndDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                        <p className="text-sm text-slate-400 mt-1">{ts.totalHours?.toFixed(1)} total hours{ts.notes ? ` · ${ts.notes}` : ''}</p>
                      </div>
                    </div>
                    <ActionBtns endpoint="timesheets" id={ts._id} type="Timesheet" canActLeave={ts.employee?._id !== user?._id} status={ts.status} />
                  </div>
                ))}
                <ShowMoreFooter tabId="timesheets" total={data.timesheets.length} shown={getVisible('timesheets', data.timesheets).length} />
                </>
            )}

            {/* Regularizations */}
            {tab === 'regularizations' && (
              data.regularizations?.length === 0
                ? <EmptyState icon={Clock} message="No pending regularizations" />
                : <>
                {getVisible('regularizations', data.regularizations).map(r => (
                  <div key={r._id} className="p-5 flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 bg-purple-50 rounded-xl flex items-center justify-center text-purple-600 flex-shrink-0">
                        <Clock size={18} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-slate-700">{r.employee?.firstName} {r.employee?.lastName}</p>
                          <span className="text-sm text-slate-600">{r.employee?.employeeId}</span>
                          <span className="text-sm bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{r.employee?.department}</span>
                        </div>
                        <p className="text-base text-slate-600 mt-1">
                          {fmtDay(r.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                        <p className="text-sm text-slate-600 mt-0.5">
                          {r.checkIn ? `In: ${fmt12(r.checkIn)}` : ''}{r.checkIn && r.checkOut ? ' · ' : ''}{r.checkOut ? `Out: ${fmt12(r.checkOut)}` : ''}
                        </p>
                        <p className="text-sm text-slate-600 mt-0.5 max-w-xs">{r.reason}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button onClick={() => setDetailLeave(r)} className="flex items-center gap-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-colors">
                        <Eye size={13} /> View
                      </button>
                      <ActionBtns endpoint="regularizations" id={r._id} type="Regularization" canActLeave={r.canAct && r.employee?._id !== user?._id} status={r.status} />
                    </div>
                  </div>
                ))}
                <ShowMoreFooter tabId="regularizations" total={data.regularizations.length} shown={getVisible('regularizations', data.regularizations).length} />
                </>
            )}

            {/* WFH Requests */}
            {tab === 'wfh' && (
              data.wfhRequests?.length === 0
                ? <EmptyState icon={Home} message="No pending WFH requests" />
                : <>
                {getVisible('wfh', data.wfhRequests).map(w => (
                  <div key={w._id} className="p-5 flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600 flex-shrink-0">
                        <Home size={18} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-slate-700">{w.employee?.firstName} {w.employee?.lastName}</p>
                          <span className="text-sm text-slate-600">{w.employee?.employeeId}</span>
                          <span className="text-sm bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{w.employee?.department}</span>
                          {w.status === 'pending' && w.approvalLevels?.length > 0 && (
                            <span className="text-[12px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-200">
                              {w.approvalLevels.filter(a => a.status === 'approved').length} of {w.approvalLevels.length} level{w.approvalLevels.length !== 1 ? 's' : ''} approved
                            </span>
                          )}
                        </div>
                        <p className="text-base text-slate-500 mt-1">
                          {fmtDay(w.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                        </p>
                        <p className="text-sm text-slate-400 mt-0.5 max-w-xs">{w.reason}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button onClick={() => setDetailWfh(w)} className="flex items-center gap-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-colors">
                        <Eye size={13} /> View
                      </button>
                      <ActionBtns endpoint="wfh" id={w._id} type="WFH" canActLeave={w.canAct && w.employee?._id !== user?._id} status={w.status} />
                    </div>
                  </div>
                ))}
                <ShowMoreFooter tabId="wfh" total={data.wfhRequests.length} shown={getVisible('wfh', data.wfhRequests).length} />
                </>
            )}

            {/* On Duty — work done away from the usual place of work. Not
                leave: the day is payable and counts as worked. */}
            {tab === 'onduty' && (
              data.onDuty?.length === 0
                ? <EmptyState icon={Briefcase} message="No pending on duty requests" />
                : <>
                {getVisible('onduty', data.onDuty).map(o => (
                  <div key={o._id} className="p-5 flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 bg-violet-50 rounded-xl flex items-center justify-center text-violet-600 flex-shrink-0">
                        <Briefcase size={18} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-slate-700">{o.employee?.firstName} {o.employee?.lastName}</p>
                          <span className="text-sm text-slate-600">{o.employee?.employeeId}</span>
                          <span className="text-sm bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{o.employee?.department}</span>
                          <span className="text-[12px] font-semibold px-2 py-0.5 rounded-full bg-violet-50 text-violet-600 border border-violet-200">
                            {o.requestType === 'work_from_home' ? 'Work from home' : 'Client visit'}
                          </span>
                          {o.status === 'pending' && o.approvalLevels?.length > 0 && (
                            <span className="text-[12px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-200">
                              {o.approvalLevels.filter(a => a.status === 'approved').length} of {o.approvalLevels.length} level{o.approvalLevels.length !== 1 ? 's' : ''} approved
                            </span>
                          )}
                        </div>
                        <p className="text-base text-slate-500 mt-1">
                          {o.startDate === o.endDate
                            ? fmtDay(o.startDate, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
                            : `${fmtDay(o.startDate)} – ${fmtDay(o.endDate)}`}
                          {o.unit === 'hours' && o.startTime && (
                            <span className="text-slate-400"> · {String(o.startTime).slice(0, 5)} – {String(o.endTime).slice(0, 5)}</span>
                          )}
                        </p>
                        {o.reason && <p className="text-sm text-slate-400 mt-0.5 max-w-xs">{o.reason}</p>}
                      </div>
                    </div>
                    <ActionBtns endpoint="on-duty" id={o._id} type="On Duty" canActLeave={o.canAct && o.employee?._id !== user?._id} status={o.status} />
                  </div>
                ))}
                <ShowMoreFooter tabId="onduty" total={data.onDuty.length} shown={getVisible('onduty', data.onDuty).length} />
                </>
            )}

            {/* Comp-Off Requests */}
            {tab === 'compoff' && (
              data.compOffs?.length === 0
                ? <EmptyState icon={Gift} message="No pending comp-off requests" />
                : <>
                {getVisible('compoff', data.compOffs).map(c => (
                  <div key={c._id} className="p-5 flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600 flex-shrink-0">
                        <Gift size={18} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-slate-700">{c.employee?.firstName} {c.employee?.lastName}</p>
                          <span className="text-sm text-slate-600">{c.employee?.employeeId}</span>
                          <span className="text-sm bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{c.employee?.department}</span>
                        </div>
                        <p className="text-base text-slate-500 mt-1">
                          Worked on: {fmtDay(c.workedDate)}
                        </p>
                        {c.compOffDate && (
                          <p className="text-base text-slate-500 mt-0.5">
                            Comp-off requested for: <span className="font-medium text-slate-700">{fmtDay(c.compOffDate)}</span>
                          </p>
                        )}
                        <p className="text-sm text-slate-400 mt-0.5">
                          {c.daysEarned} day{c.daysEarned !== 1 ? 's' : ''} comp-off earned
                          {c.expiresAt ? ` · valid till ${fmtDay(c.expiresAt, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
                        </p>
                        {c.reason && <p className="text-sm text-slate-400 mt-0.5 max-w-xs">{c.reason}</p>}
                      </div>
                    </div>
                    <ActionBtns endpoint="comp-off" id={c._id} type="Comp-Off" canActLeave={c.canAct && c.employee?._id !== user?._id} status={c.status} />
                  </div>
                ))}
                <ShowMoreFooter tabId="compoff" total={data.compOffs.length} shown={getVisible('compoff', data.compOffs).length} />
                </>
            )}

          </div>
        )}
      </div>

      {/* WFH detail + approval timeline modal */}
      {detailWfh && (
        <LeaveDetailModal
          leave={detailWfh}
          kind="wfh"
          onClose={() => setDetailWfh(null)}
          canAct={detailWfh.status === 'pending' && !!detailWfh.canAct && detailWfh.employee?._id !== user?._id}
          onApprove={(x, comment) => { setDetailWfh(null); action('wfh', x._id, 'approved', comment); }}
          onApproveAll={canApproveAll && detailWfh.status === 'pending' && !!detailWfh.canAct
            ? (x, comment) => { if (confirm('Approve all remaining levels for this request? This skips any other pending approvers.')) { setDetailWfh(null); action('wfh', x._id, 'approved', comment, true); } }
            : undefined}
          onReject={(x, comment) => { setDetailWfh(null); action('wfh', x._id, 'rejected', comment); }}
        />
      )}

      {rejectModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-6">
            <h3 className="font-display font-semibold text-slate-800 mb-4">Reject Request</h3>
            <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={3} placeholder="Reason (optional)..."
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400 resize-none mb-4" />
            <div className="flex gap-3">
              <button onClick={() => setRejectModal(null)} className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-base font-medium hover:bg-slate-50">Cancel</button>
              <button onClick={() => { action(rejectModal.endpoint, rejectModal.id, 'rejected', rejectReason); setRejectModal(null); }} disabled={!!actionLoading}
                className="flex-1 bg-red-500 hover:bg-red-400 text-white py-2.5 rounded-xl text-base font-medium transition-colors disabled:opacity-60">
                Confirm Reject
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Leave details + approval timeline modal */}
      {detailLeave && (() => {
        // One modal for both request kinds — leaves vs regularizations are
        // distinguished by the presence of a leaveType, routing actions to the
        // correct endpoint (no workflow change). The optional comment typed in
        // the modal footer is forwarded as rejectionReason on approve OR reject.
        const isReg = !detailLeave.leaveType;
        const endpoint = isReg ? 'regularizations' : 'leaves';
        return (
          <LeaveDetailModal
            leave={detailLeave}
            kind={isReg ? 'regularization' : 'leave'}
            balance={!isReg && detailLeave.status === 'pending' ? detailBalance : undefined}
            onClose={() => { setDetailLeave(null); setDetailBalance(null); }}
            canAct={detailLeave.status === 'pending' && !!detailLeave.canAct && detailLeave.employee?._id !== user?._id}
            onApprove={(x, comment) => { setDetailLeave(null); action(endpoint, x._id, 'approved', comment); }}
            onApproveAll={!isReg && canApproveAll && detailLeave.status === 'pending' && !!detailLeave.canAct
              ? (x, comment) => { if (confirm('Approve all remaining levels for this request? This skips any other pending approvers.')) { setDetailLeave(null); action(endpoint, x._id, 'approved', comment, true); } }
              : undefined}
            onReject={(x, comment) => { setDetailLeave(null); action(endpoint, x._id, 'rejected', comment); }}
          />
        );
      })()}
    </div>
  );
}
