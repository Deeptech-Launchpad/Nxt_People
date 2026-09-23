import React, { useState, useEffect, useRef } from 'react';
import { CheckCircle, CheckCheck, XCircle, Clock, Home, RefreshCw, Gift, Search, Eye, Briefcase, ChevronLeft, ChevronRight } from 'lucide-react';
import { useLocation, useSearchParams } from 'react-router-dom';
import api from '../utils/api';
import toast from 'react-hot-toast';
import LeaveDetailModal from '../components/LeaveDetailModal';
import { actionNote } from '../components/ApprovalTimeline';
import LeaveRequestDialog from './moreservices/leavetracker/LeaveRequestDialog';
import { useAuth } from '../context/AuthContext';
import usePolling from '../hooks/usePolling';
import { LEAVE_APPROVALS_BASE, APPROVALS_TABS } from './moreservices/operationsWorkspaces';
import { setWorkspaceBadges, clearWorkspaceBadges } from '../utils/workspaceBadges';
import { useFormat, formatTime } from '../utils/datetime';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const LEAVE_TYPE_LABELS = {
  casual:   'Casual Leave',
  comp_off: 'Compensatory Off',
  unpaid:   'Leave Without Pay',
  permission: 'Permission'
};

// Safe date-only formatter — never renders "Invalid Date" for a blank value.
const fmtDay = (d, opts = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) => {
  if (!d) return '—';
  const dt = new Date(String(d).slice(0, 10) + 'T00:00:00');
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-IN', opts);
};

/**
 * What a request cost, in the unit it is actually measured in.
 *
 * Permission is hourly — `total_days` is 0 on every permission row by
 * design, because the hours live in `hours` with a start and end time. The
 * Approved and Rejected tabs printed total_days for everything, so an
 * approved one-hour permission read "Permission Leave · 0 Days": the one
 * number on the row was the one thing it could not be. The Permissions tab
 * next door has always rendered these correctly; this is that same line,
 * shared, so the two cannot drift again.
 */
const amountLabel = (l, timeFormat) => {
  if (l.leaveType === 'permission') {
    const hours = Number(l.hours) || 0;
    const window = l.startTime && l.endTime ? ` (${formatTime(l.startTime, timeFormat)}–${formatTime(l.endTime, timeFormat)})` : '';
    return `${hours}h${window}`;
  }
  const days = Number(l.totalDays) || 0;
  return `${days} day${days === 1 ? '' : 's'}`;
};

const decisionLabel = (l) => {
  if (!l.onYourBehalf || !l.behalfByName) return null;
  return `${l.status === 'rejected' ? 'Rejected' : 'Approved'} by ${l.behalfByName} on your behalf`;
};

/* The "N of M levels approved" pill said HOW MANY had signed off but never
 * HOW — a level someone approved on another approver's behalf read exactly
 * like an ordinary approval, and the only place that showed otherwise was
 * inside the detail popup, one request at a time. Reuses ApprovalTimeline's
 * own wording so the two never say it two different ways. */
const pendingBehalfNote = (levels) => {
  const lvl = (levels || []).find(a => a.status === 'approved' && (a.onBehalf || a.byHr));
  return lvl ? actionNote(lvl) : null;
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
  const fmt = useFormat();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  /* Under Operations the navy bar draws the tabs and owns the active one, so
   * the tab lives in ?tab= there. The other two routes keep their own strip. */
  const inWorkspace = location.pathname === LEAVE_APPROVALS_BASE || location.pathname.startsWith(`${LEAVE_APPROVALS_BASE}/`);
  // Approve All is available to HR / Super Admin and Team Leads (managers).
  // Managers are still scoped server-side to requests they actually approve.
  const canApproveAll = ['admin', 'director', 'hr_admin', 'manager'].includes(user?.role);
  const [data, setData] = useState({ leaves: [], permissions: [], regularizations: [], wfhRequests: [], compOffs: [], onDuty: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [localTab, setLocalTab] = useState(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    return APPROVALS_TABS.some(x => x.id === t) ? t : 'leaves';
  });
  const urlTab = searchParams.get('tab');
  const tab = inWorkspace ? (APPROVALS_TABS.some(x => x.id === urlTab) ? urlTab : 'leaves') : localTab;
  /* `keepParams` for the automatic switches, which must not lose an ?openId=
   * still waiting to be opened. A card click starts clean: carrying openId
   * along would reopen that request's modal every time the tab changed. */
  const setTab = (id, { keepParams = false } = {}) => {
    if (!inWorkspace) { setLocalTab(id); return; }
    if (keepParams) {
      setSearchParams(prev => { const p = new URLSearchParams(prev); p.set('tab', id); return p; }, { replace: true });
    } else {
      setSearchParams({ tab: id });
    }
  };
  const now = new Date();
  const [sumMonth, setSumMonth] = useState(now.getMonth() + 1);
  const [sumYear, setSumYear] = useState(now.getFullYear());
  const [summary, setSummary] = useState(null);
  // Whether the URL itself named a tab. When it did not, the page falls back
  // to 'leaves' regardless of where the pending items actually are — the
  // "Total Pending" card at the top and the tab shown underneath it come
  // from the same payload, but nothing ever pointed the tab at whichever
  // category the total is counting. A Team Incharge whose one pending item
  // was, say, a Permission or a Comp-Off saw "Total Pending: 1" above an
  // empty Leaves tab and read it as a bug in the count — the count was
  // right, it was just sitting one click away with no visual cue that it
  // was somewhere else. Fixed below, once, on the first load only: never
  // fight a tab the person has since clicked into on purpose.
  const hadExplicitTab = useRef(!!new URLSearchParams(window.location.search).get('tab'));
  const autoSwitched = useRef(false);
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
  const [editing, setEditing] = useState(null);
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
        /* The API returns approved and rejected together in one list, already
         * scoped to this month, and the two tabs are that list split by status. */
        const approved = (d.approvedLeaves || []).filter(l => l.status === 'approved');
        const rejected = (d.approvedLeaves || []).filter(l => l.status === 'rejected');
        const permissions = allLeaves.filter(l => l.leaveType === 'permission');
        const leaves = allLeaves.filter(l => l.leaveType !== 'permission');
        const regularizations = d.regularizations || [];
        const wfhRequests = d.wfhRequests || [];
        const compOffs = d.compOffs || [];
        const onDuty = d.onDuty || [];
        setData({
          leaves,
          permissions,
          regularizations,
          wfhRequests,
          compOffs,
          onDuty,
          approvedLeaves: approved,
          rejectedLeaves: rejected,
          total: d.total || 0,
        });

        if (!silent && !hadExplicitTab.current && !autoSwitched.current) {
          autoSwitched.current = true;
          // Action-needed tabs only, in the order their cards appear — never
          // the Approved/Rejected history tabs, which are not what "Total
          // Pending" is counting.
          const byTab = [
            ['leaves', leaves], ['permissions', permissions],
            ['regularizations', regularizations], ['wfh', wfhRequests],
            ['compoff', compOffs], ['onduty', onDuty],
          ];
          const currentIsEmpty = !(byTab.find(([id]) => id === tab)?.[1]?.length);
          if (currentIsEmpty) {
            const firstNonEmpty = byTab.find(([, arr]) => arr.length > 0);
            if (firstNonEmpty) setTab(firstNonEmpty[0], { keepParams: true });
          }
        }
      })
      .catch(err => { if (!silent) toast.error(err.response?.data?.message || 'Failed to load approvals'); })
      .finally(() => { if (!silent) setLoading(false); });
  };

  useEffect(load, []);


  // Picks up newly submitted / approved requests without a manual refresh.
  usePolling(() => load(true), 5000);

  // Month-bound history, so it is fetched when the month changes, not polled.
  useEffect(() => {
    setSummary(null);
    api.get(`/approvals/summary?month=${sumMonth}&year=${sumYear}`)
      .then(res => setSummary(res.data.data || null))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load approval summary'));
  }, [sumMonth, sumYear]);

  const shiftMonth = (delta) => {
    let m = sumMonth + delta, y = sumYear;
    if (m < 1)  { m = 12; y -= 1; }
    if (m > 12) { m = 1;  y += 1; }
    setSumMonth(m); setSumYear(y);
  };

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
    const keep = { keepParams: true };
    if (data.onDuty?.find(o => o._id === openId)) setTab('onduty', keep);
    else if (data.regularizations?.find(r => r._id === openId)) setTab('regularizations', keep);
    else if (data.permissions?.find(p => p._id === openId)) setTab('permissions', keep);
    else if (data.approvedLeaves?.find(l => l._id === openId)) setTab('approvedLeaves', keep);
    else if (data.rejectedLeaves?.find(l => l._id === openId)) setTab('rejectedLeaves', keep);
    else setTab(typeToTab[found.leaveType] || 'leaves', keep);
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

  const tabCounts = {
    leaves: data.leaves?.length,
    permissions: data.permissions?.length,
    approvedLeaves: data.approvedLeaves?.length,
    rejectedLeaves: data.rejectedLeaves?.length,
    regularizations: data.regularizations?.length,
    wfh: data.wfhRequests?.length,
    compoff: data.compOffs?.length,
    onduty: data.onDuty?.length,
  };
  const TABS = APPROVALS_TABS.map(t => [t.id, t.label, tabCounts[t.id]]);

  // Show the badge only if there's at least one item the user hasn't seen
  // yet — i.e. the current count is bigger than what they last viewed. After
  // a hard refresh the seenCounts come back from localStorage, so the badge
  // stays cleared until new items actually arrive.
  const unseenCount = (id) => {
    const currentCount = tabCounts[id] || 0;
    return currentCount > 0 && currentCount > (seenCounts[id] || 0) ? currentCount : 0;
  };

  /* The navy bar has no click handler of ours to mark a tab seen, so arriving
   * on one does it — the same thing clicking it in the in-page strip does. */
  useEffect(() => {
    if (inWorkspace && !loading) markTabSeen(tab, tabCounts[tab] || 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inWorkspace, loading, tab, tabCounts[tab]]);

  const badgeKey = APPROVALS_TABS.map(t => unseenCount(t.id)).join(',');
  useEffect(() => {
    if (!inWorkspace) return;
    setWorkspaceBadges(LEAVE_APPROVALS_BASE, Object.fromEntries(APPROVALS_TABS.map(t => [t.id, unseenCount(t.id)])));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inWorkspace, badgeKey]);
  useEffect(() => {
    if (!inWorkspace) return;
    return () => clearWorkspaceBadges(LEAVE_APPROVALS_BASE);
  }, [inWorkspace]);

  const ActionBtns = ({ endpoint, id, type, canActLeave, status }) => {
    let canAct = false;
    if (endpoint === 'leaves' || endpoint === 'regularizations' || endpoint === 'comp-off' || endpoint === 'wfh' || endpoint === 'on-duty') {
      canAct = status === 'pending' && !!canActLeave;
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
    <div className="p-5 space-y-5">
      {/* Month switcher — governs the approved counts only; Total Pending is
          the live queue and has no month. */}
      <div className="flex items-center justify-end gap-2">
        <button onClick={() => shiftMonth(-1)} className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><ChevronLeft size={15} /></button>
        <span className="text-[15px] font-semibold text-slate-700 w-36 text-center">{MONTHS[sumMonth - 1]} {sumYear}</span>
        <button onClick={() => shiftMonth(1)} className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><ChevronRight size={15} /></button>
      </div>

      {/* Summary cards. The approved counts open no tab: every tab below is a
          pending queue or a list bounded by leave dates, and none of them is
          the set the number counts. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
        {[
          ['Total Pending',           loading ? null : data.total,  'bg-amber-50 text-amber-700'],
          ['Casual Leave Approved',   summary?.casual,              'bg-blue-50 text-blue-700'],
          ['Permissions Approved',    summary?.permissions,         'bg-purple-50 text-purple-700'],
          ['Regularization Approved', summary?.regularizations,     'bg-slate-50 text-slate-600'],
          ['LOP Approved',            summary?.lop,                 'bg-brand-50 text-brand-700'],
          ['WFH Approved',            summary?.wfh,                 'bg-green-50 text-green-700'],
          ['Comp-Off Approved',       summary?.compOff,             'bg-orange-50 text-orange-700'],
          ['On Duty Approved',        summary?.onDuty,              'bg-violet-50 text-violet-700'],
        ].map(([l, v, c]) => (
          <div key={l} className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm transition-colors">
            <p className="text-sm text-slate-500 mb-2">{l}</p>
            <p className={`text-4xl font-display font-bold px-3 py-1 rounded-lg w-fit ${c}`}>{v ?? '—'}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        {/* Tabs — drawn by the navy bar instead when under Operations. */}
        {!inWorkspace && (
        <div className="flex border-b border-slate-100 overflow-x-auto items-center">
          {TABS.map(([id, label, count]) => {
            const currentCount = count || 0;
            const showBadge   = unseenCount(id) > 0;
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
        )}

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
                         {pendingBehalfNote(l.approvalLevels) && (
                           <p className="text-[12.5px] text-amber-700 mt-0.5">{pendingBehalfNote(l.approvalLevels)}</p>
                         )}
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
                         {pendingBehalfNote(p.approvalLevels) && (
                           <p className="text-[12.5px] text-amber-700 mt-0.5">{pendingBehalfNote(p.approvalLevels)}</p>
                         )}
                         <p className="text-base text-slate-500 mt-1 capitalize">
                           Permission · {p.hours}h {p.startTime && p.endTime && `(${fmt.time(p.startTime)}–${fmt.time(p.endTime)})`}
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
                         <p className="text-base text-slate-700 mt-1">
                           {LEAVE_TYPE_LABELS[l.leaveType] || l.leaveType} · {amountLabel(l, fmt.timeFormat)}
                           {l.isHalfDay && <span className="ml-1 text-sm bg-amber-50 text-amber-700 px-1.5 rounded-full">Half Day</span>}
                         </p>
                        <p className="text-base text-slate-600 mt-0.5">
                          {fmtDay(l.startDate, { month: 'short', day: 'numeric' })} – {fmtDay(l.endDate, { month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                        <p className="text-sm text-slate-600 mt-1">{l.reason}</p>
                      </div>
                     </div>
                     <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                       <div className="flex items-center gap-2">
                         <button onClick={() => setDetailLeave(l)} className="flex items-center gap-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-colors">
                           <Eye size={13} /> View
                         </button>
                         <ActionBtns endpoint="leaves" id={l._id} type="Leave" canActLeave={l.canAct} status={l.status} />
                       </div>
                       {decisionLabel(l) && <p className="text-xs text-slate-500 text-right">{decisionLabel(l)}</p>}
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
                         <p className="text-base text-slate-700 mt-1">
                           {LEAVE_TYPE_LABELS[l.leaveType] || l.leaveType} · {amountLabel(l, fmt.timeFormat)}
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
                     <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                       <div className="flex items-center gap-2">
                         <button onClick={() => setDetailLeave(l)} className="flex items-center gap-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-colors">
                           <Eye size={13} /> View
                         </button>
                         <ActionBtns endpoint="leaves" id={l._id} type="Leave" canActLeave={l.canAct} status={l.status} />
                       </div>
                       {decisionLabel(l) && <p className="text-xs text-slate-500 text-right">{decisionLabel(l)}</p>}
                     </div>
                   </div>
                ))}
                <ShowMoreFooter tabId="rejectedLeaves" total={list.length} shown={getVisible('rejectedLeaves', list).length} />
                </>;
            })()}

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
                          {r.checkIn ? `In: ${fmt.time(r.checkIn)}` : ''}{r.checkIn && r.checkOut ? ' · ' : ''}{r.checkOut ? `Out: ${fmt.time(r.checkOut)}` : ''}
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
                        {pendingBehalfNote(w.approvalLevels) && (
                          <p className="text-[12.5px] text-amber-700 mt-0.5">{pendingBehalfNote(w.approvalLevels)}</p>
                        )}
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
                        {pendingBehalfNote(o.approvalLevels) && (
                          <p className="text-[12.5px] text-amber-700 mt-0.5">{pendingBehalfNote(o.approvalLevels)}</p>
                        )}
                        <p className="text-base text-slate-500 mt-1">
                          {o.startDate === o.endDate
                            ? fmtDay(o.startDate, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
                            : `${fmtDay(o.startDate)} – ${fmtDay(o.endDate)}`}
                          {o.unit === 'hours' && o.startTime && (
                            <span className="text-slate-400"> · {fmt.time(o.startTime)} – {fmt.time(o.endTime)}</span>
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
            /* Regularizations have their own shape and are not edited here;
               the modal already withholds the button for them. */
            onEdit={isReg ? undefined : (x) => { setDetailLeave(null); setEditing(x); }}
          />
        );
      })()}

      {/* The same dialog the Leave Tracker uses, so a request looks the same
          wherever it is opened from. In edit mode the employee and the type are
          read-only, so it needs neither list. */}
      {editing && (
        <LeaveRequestDialog
          mode="edit"
          leave={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}
