import React, { useState, useEffect } from 'react';
import { CheckCircle, XCircle, Clock, Home, X, RefreshCw, Gift, Search } from 'lucide-react';
import api from '../utils/api';
import toast from 'react-hot-toast';

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

export default function Approvals() {
  const [data, setData] = useState({ leaves: [], timesheets: [], regularizations: [], wfhRequests: [], compOffs: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('leaves');
  // Last-seen count per tab — persisted to localStorage so the badge
  // stays cleared across refreshes (was previously a stale per-session
  // Set that always re-populated on reload). If new items arrive later
  // and the count exceeds what's stored here, the badge naturally
  // re-appears with the delta.
  const [seenCounts, setSeenCounts] = useState(() => loadSeen());
  const [searchFilter, setSearchFilter] = useState('');
  const [rejectModal, setRejectModal] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [actionLoading, setActionLoading] = useState('');

  // When the user clicks a tab, mark its current count as "seen" and
  // persist. Done as a small helper so the rendering code stays clean.
  const markTabSeen = (tabId, currentCount) => {
    setSeenCounts(prev => {
      const next = { ...prev, [tabId]: currentCount || 0 };
      saveSeen(next);
      return next;
    });
  };

  const load = () => {
    setLoading(true);
    api.get('/approvals/pending')
      .then(res => {
        const d = res.data.data || {};
        const approved = (d.approvedLeaves || []).filter(l => l.status === 'approved');
        const rejected = (d.approvedLeaves || []).filter(l => l.status === 'rejected');
        setData({
          leaves: d.leaves || [],
          timesheets: d.timesheets || [],
          regularizations: d.regularizations || [],
          wfhRequests: d.wfhRequests || [],
          compOffs: d.compOffs || [],
          approvedLeaves: approved,
          rejectedLeaves: rejected,
          total: d.total || 0,
        });
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  // The 'leaves' tab is the default open one — auto-mark it as seen
  // whenever fresh data arrives so the user never sees a badge on the
  // tab they're already looking at.
  useEffect(() => {
    if (!loading) markTabSeen('leaves', data.leaves?.length || 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, data.leaves?.length]);

  const action = async (endpoint, id, act, reason) => {
    setActionLoading(id);
    try {
      await api.put(`/${endpoint}/${id}/action`, { action: act, rejectionReason: reason });
      toast.success(`${act.charAt(0).toUpperCase() + act.slice(1)} successfully`);
      setRejectModal(null); setRejectReason(''); load();
    } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
    finally { setActionLoading(''); }
  };

  const leaveTypeColors = {
    casual: 'bg-blue-50 text-blue-700',
    sick: 'bg-red-50 text-red-700',
    earned: 'bg-emerald-50 text-emerald-700',
    unpaid: 'bg-slate-50 text-slate-600'
  };

  const TABS = [
    ['leaves', 'Leave Requests', data.leaves?.length],
    ['approvedLeaves', 'Approved Leaves', data.approvedLeaves?.length],
    ['rejectedLeaves', 'Rejected Leaves', data.rejectedLeaves?.length],
    ['timesheets', 'Timesheets', data.timesheets?.length],
    ['regularizations', 'Regularizations', data.regularizations?.length],
    ['wfh', 'WFH Requests', data.wfhRequests?.length],
    ['compoff', 'Comp-Off', data.compOffs?.length],
  ];

  const ActionBtns = ({ endpoint, id, type, isManager, isApprovingAuthority, status }) => {
    // If request is already processed or user is just a Reporting Authority
    if ((status && status !== 'pending') || (isManager && !isApprovingAuthority)) {
      const displayStatus = (status && status !== 'pending') ? status : 'Pending';
      const statusColor = displayStatus === 'approved' ? 'text-emerald-600 bg-emerald-50 border-emerald-200' : 
                          displayStatus === 'rejected' ? 'text-red-600 bg-red-50 border-red-200' :
                          'text-slate-500 bg-slate-50 border-slate-200';
      return (
        <div className="flex-shrink-0">
          <span className={`text-[11px] font-medium px-3 py-1.5 rounded-lg border capitalize ${statusColor}`}>
            {displayStatus}
          </span>
        </div>
      );
    }

    // Approving Authority OR both roles — show Approve/Reject
    return (
      <div className="flex items-center gap-2 flex-shrink-0">
        <button onClick={() => action(endpoint, id, 'approved')} disabled={!!actionLoading}
          className="flex items-center gap-1.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50">
          <CheckCircle size={13} /> Approve
        </button>
        <button onClick={() => { setRejectModal({ id, type, endpoint }); setRejectReason(''); }}
          className="flex items-center gap-1.5 bg-red-50 text-red-500 hover:bg-red-100 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors">
          <XCircle size={13} /> Reject
        </button>
      </div>
    );
  };

  const EmptyState = ({ icon: Icon, message }) => (
    <div className="text-center py-16">
      <Icon size={40} className="text-slate-200 mx-auto mb-3" />
      <p className="text-slate-400">{message}</p>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          ['Total Pending', data.total, 'bg-amber-50 text-amber-700'],
          ['Leaves', data.leaves?.length, 'bg-blue-50 text-blue-700'],
          ['Timesheets', data.timesheets?.length, 'bg-brand-50 text-brand-700'],
          ['Regularizations', data.regularizations?.length, 'bg-purple-50 text-purple-700'],
          ['WFH / Comp-Off', (data.wfhRequests?.length || 0) + (data.compOffs?.length || 0), 'bg-indigo-50 text-indigo-700'],
        ].map(([l, v, c]) => (
          <div key={l} className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
            <p className="text-xs text-slate-500 mb-2">{l}</p>
            <p className={`text-3xl font-display font-bold px-3 py-1 rounded-lg w-fit ${c}`}>{v ?? 0}</p>
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
                className={`flex items-center gap-2 px-5 py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex-shrink-0 ${tab === id ? 'border-brand-600 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                {label}
                {showBadge && (
                  <span className={`w-5 h-5 rounded-full text-xs flex items-center justify-center font-bold ${tab === id ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                    {currentCount}
                  </span>
                )}
              </button>
            );
          })}
          <div className="ml-auto flex items-center gap-2 pr-4">
            {['approvedLeaves', 'rejectedLeaves'].includes(tab) && (
              <div className="relative">
                <input
                  type="text"
                  placeholder="Filter by name..."
                  value={searchFilter}
                  onChange={e => setSearchFilter(e.target.value)}
                  className="pl-8 pr-3 py-1.5 w-48 border border-slate-200 rounded-lg text-[13px] outline-none focus:border-brand-400"
                />
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>
            )}
            <button onClick={load} className="p-2 text-slate-400 hover:text-brand-600 transition-colors">
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : (
          <div className="divide-y divide-slate-50">

            {/* Leave Requests */}
            {tab === 'leaves' && (
              data.leaves?.length === 0
                ? <EmptyState icon={CheckCircle} message="No pending leave requests" />
                : data.leaves?.map(l => (
                  <div key={l._id} className="p-5 flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-sm font-bold ${leaveTypeColors[l.leaveType] || 'bg-slate-50 text-slate-600'}`}>
                        {l.leaveType?.[0]?.toUpperCase()}
                      </div>
                       <div>
                         <div className="flex items-center gap-2 flex-wrap">
                           <p className="font-semibold text-slate-700">{l.employee?.firstName} {l.employee?.lastName}</p>
                           <span className="text-xs text-slate-400">{l.employee?.employeeId}</span>
                           <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{l.employee?.department}</span>
                           {l.isManager && !l.isApprovingAuthority && (
                             <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200">
                               Forwarded to Approver
                             </span>
                           )}
                         </div>
                         <p className="text-sm text-slate-500 mt-1 capitalize">
                           {l.leaveType} Leave · {l.totalDays} day{l.totalDays !== 1 ? 's' : ''}
                           {l.isHalfDay && <span className="ml-1 text-xs bg-amber-50 text-amber-700 px-1.5 rounded-full">Half Day</span>}
                         </p>
                        <p className="text-sm text-slate-600 mt-0.5">
                          {new Date(l.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {new Date(l.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                        <p className="text-xs text-slate-400 mt-1">{l.reason}</p>
                      </div>
                     </div>
                     <ActionBtns 
                       endpoint="leaves" 
                       id={l._id} 
                       type="Leave" 
                       isManager={l.isManager}
                       isApprovingAuthority={l.isApprovingAuthority}
                       status={l.status}
                     />
                   </div>
                ))
            )}

            {/* Approved Leaves */}
            {tab === 'approvedLeaves' && (
              data.approvedLeaves?.filter(l => !searchFilter || `${l.employee?.firstName} ${l.employee?.lastName}`.toLowerCase().includes(searchFilter.toLowerCase())).length === 0
                ? <EmptyState icon={CheckCircle} message="No approved leave requests found" />
                : data.approvedLeaves?.filter(l => !searchFilter || `${l.employee?.firstName} ${l.employee?.lastName}`.toLowerCase().includes(searchFilter.toLowerCase())).map(l => (
                  <div key={l._id} className="p-5 flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-sm font-bold ${leaveTypeColors[l.leaveType] || 'bg-slate-50 text-slate-600'}`}>
                        {l.leaveType?.[0]?.toUpperCase()}
                      </div>
                       <div>
                         <div className="flex items-center gap-2 flex-wrap">
                           <p className="font-semibold text-slate-700">{l.employee?.firstName} {l.employee?.lastName}</p>
                           <span className="text-xs text-slate-400">{l.employee?.employeeId}</span>
                           <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{l.employee?.department}</span>
                         </div>
                         <p className="text-sm text-slate-500 mt-1 capitalize">
                           {l.leaveType} Leave · {l.totalDays} day{l.totalDays !== 1 ? 's' : ''}
                           {l.isHalfDay && <span className="ml-1 text-xs bg-amber-50 text-amber-700 px-1.5 rounded-full">Half Day</span>}
                         </p>
                        <p className="text-sm text-slate-600 mt-0.5">
                          {new Date(l.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {new Date(l.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                        <p className="text-xs text-slate-400 mt-1">{l.reason}</p>
                      </div>
                     </div>
                     <ActionBtns 
                       endpoint="leaves" 
                       id={l._id} 
                       type="Leave" 
                       isManager={l.isManager}
                       isApprovingAuthority={l.isApprovingAuthority}
                       status={l.status}
                     />
                   </div>
                ))
            )}

            {/* Rejected Leaves */}
            {tab === 'rejectedLeaves' && (
              data.rejectedLeaves?.filter(l => !searchFilter || `${l.employee?.firstName} ${l.employee?.lastName}`.toLowerCase().includes(searchFilter.toLowerCase())).length === 0
                ? <EmptyState icon={XCircle} message="No rejected leave requests found" />
                : data.rejectedLeaves?.filter(l => !searchFilter || `${l.employee?.firstName} ${l.employee?.lastName}`.toLowerCase().includes(searchFilter.toLowerCase())).map(l => (
                  <div key={l._id} className="p-5 flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-sm font-bold ${leaveTypeColors[l.leaveType] || 'bg-slate-50 text-slate-600'}`}>
                        {l.leaveType?.[0]?.toUpperCase()}
                      </div>
                       <div>
                         <div className="flex items-center gap-2 flex-wrap">
                           <p className="font-semibold text-slate-700">{l.employee?.firstName} {l.employee?.lastName}</p>
                           <span className="text-xs text-slate-400">{l.employee?.employeeId}</span>
                           <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{l.employee?.department}</span>
                         </div>
                         <p className="text-sm text-slate-500 mt-1 capitalize">
                           {l.leaveType} Leave · {l.totalDays} day{l.totalDays !== 1 ? 's' : ''}
                           {l.isHalfDay && <span className="ml-1 text-xs bg-amber-50 text-amber-700 px-1.5 rounded-full">Half Day</span>}
                         </p>
                        <p className="text-sm text-slate-600 mt-0.5">
                          {new Date(l.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {new Date(l.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                        <p className="text-xs text-slate-400 mt-1">{l.reason}</p>
                      </div>
                     </div>
                     <ActionBtns 
                       endpoint="leaves" 
                       id={l._id} 
                       type="Leave" 
                       isManager={l.isManager}
                       isApprovingAuthority={l.isApprovingAuthority}
                       status={l.status}
                     />
                   </div>
                ))
            )}

            {/* Timesheets */}
            {tab === 'timesheets' && (
              data.timesheets?.length === 0
                ? <EmptyState icon={CheckCircle} message="No pending timesheets" />
                : data.timesheets?.map(ts => (
                  <div key={ts._id} className="p-5 flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 bg-brand-50 rounded-xl flex items-center justify-center text-brand-600 font-display font-bold text-sm flex-shrink-0">
                        {ts.totalHours?.toFixed(0)}h
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-slate-700">{ts.employee?.firstName} {ts.employee?.lastName}</p>
                          <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{ts.employee?.department}</span>
                        </div>
                        <p className="text-sm text-slate-500 mt-1">
                          {new Date(ts.weekStartDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {new Date(ts.weekEndDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                        <p className="text-xs text-slate-400 mt-1">{ts.totalHours?.toFixed(1)} total hours{ts.notes ? ` · ${ts.notes}` : ''}</p>
                      </div>
                    </div>
                    <ActionBtns endpoint="timesheets" id={ts._id} type="Timesheet" />
                  </div>
                ))
            )}

            {/* Regularizations */}
            {tab === 'regularizations' && (
              data.regularizations?.length === 0
                ? <EmptyState icon={Clock} message="No pending regularizations" />
                : data.regularizations?.map(r => (
                  <div key={r._id} className="p-5 flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 bg-purple-50 rounded-xl flex items-center justify-center text-purple-600 flex-shrink-0">
                        <Clock size={18} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-slate-700">{r.employee?.firstName} {r.employee?.lastName}</p>
                          <span className="text-xs text-slate-400">{r.employee?.employeeId}</span>
                          <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{r.employee?.department}</span>
                        </div>
                        <p className="text-sm text-slate-500 mt-1">
                          {new Date(r.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {r.checkIn ? `In: ${r.checkIn}` : ''}{r.checkIn && r.checkOut ? ' · ' : ''}{r.checkOut ? `Out: ${r.checkOut}` : ''}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5 max-w-xs">{r.reason}</p>
                      </div>
                    </div>
                    <ActionBtns endpoint="regularizations" id={r._id} type="Regularization" />
                  </div>
                ))
            )}

            {/* WFH Requests */}
            {tab === 'wfh' && (
              data.wfhRequests?.length === 0
                ? <EmptyState icon={Home} message="No pending WFH requests" />
                : data.wfhRequests?.map(w => (
                  <div key={w._id} className="p-5 flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600 flex-shrink-0">
                        <Home size={18} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-slate-700">{w.employee?.firstName} {w.employee?.lastName}</p>
                          <span className="text-xs text-slate-400">{w.employee?.employeeId}</span>
                          <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{w.employee?.department}</span>
                        </div>
                        <p className="text-sm text-slate-500 mt-1">
                          {new Date(w.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5 max-w-xs">{w.reason}</p>
                      </div>
                    </div>
                    <ActionBtns endpoint="wfh" id={w._id} type="WFH" />
                  </div>
                ))
            )}

            {/* Comp-Off Requests */}
            {tab === 'compoff' && (
              data.compOffs?.length === 0
                ? <EmptyState icon={Gift} message="No pending comp-off requests" />
                : data.compOffs?.map(c => (
                  <div key={c._id} className="p-5 flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600 flex-shrink-0">
                        <Gift size={18} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-slate-700">{c.employee?.firstName} {c.employee?.lastName}</p>
                          <span className="text-xs text-slate-400">{c.employee?.employeeId}</span>
                          <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{c.employee?.department}</span>
                        </div>
                        <p className="text-sm text-slate-500 mt-1">
                          Worked on: {new Date(c.workedDate + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {c.daysEarned} day{c.daysEarned !== 1 ? 's' : ''} comp-off earned
                        </p>
                        {c.reason && <p className="text-xs text-slate-400 mt-0.5 max-w-xs">{c.reason}</p>}
                      </div>
                    </div>
                    <ActionBtns endpoint="comp-off" id={c._id} type="Comp-Off" />
                  </div>
                ))
            )}

          </div>
        )}
      </div>

      {/* Reject modal */}
      {rejectModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display font-semibold text-slate-800">Reject {rejectModal.type}</h3>
              <button onClick={() => setRejectModal(null)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600"><X size={16} /></button>
            </div>
            <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={3}
              placeholder="Reason for rejection (optional)..."
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400 resize-none mb-4" />
            <div className="flex gap-3">
              <button onClick={() => setRejectModal(null)} className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-50">Cancel</button>
              <button onClick={() => action(rejectModal.endpoint, rejectModal.id, 'rejected', rejectReason)}
                disabled={!!actionLoading}
                className="flex-1 bg-red-500 hover:bg-red-400 text-white py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-60">
                Confirm Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
