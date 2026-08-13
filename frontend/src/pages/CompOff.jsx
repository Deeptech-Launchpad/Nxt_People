import React, { useState, useEffect } from 'react';
import { Plus, X, CheckCircle, XCircle, Gift, Send, CheckCheck, ChevronDown, ChevronUp, Eye } from 'lucide-react';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import BackButton from '../components/BackButton';
import { isApprover } from '../utils/roles';
import ApprovalTimeline from '../components/ApprovalTimeline';
import CompOffDetailModal from '../components/CompOffDetailModal';

const STATUS_STYLE = { pending: 'bg-amber-100 text-amber-700', approved: 'bg-emerald-100 text-emerald-700', rejected: 'bg-red-100 text-red-700' };

// Safe date formatter — never renders "Invalid Date" for a missing/blank value.
const fmtDate = (d, opts = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) => {
  if (!d) return '—';
  const dt = new Date(String(d).slice(0, 10) + 'T00:00:00');
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-IN', opts);
};
// Local YYYY-MM-DD (no timezone shift) for the date input bounds.
const ymd = (dt) => dt.toLocaleDateString('en-CA');

export default function CompOff() {
  const { user } = useAuth();
  const [myRequests, setMyRequests] = useState([]);
  const [pending, setPending] = useState([]);
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [rejectModal, setRejectModal] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [form, setForm] = useState({ workedDate: '', compOffDate: '', reason: '', daysEarned: 1 });
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const [tab, setTab] = useState(user?.role === 'team_member' ? 'my' : 'pending');
  const [expanded, setExpanded] = useState(null); // request id whose timeline is open
  const [viewItem, setViewItem] = useState(null); // item open in CompOffDetailModal

  // Validity window is configured under Configuration → Compensatory Off, so
  // the form's bounds and copy follow the setting instead of restating 3.
  const [expiryMonths, setExpiryMonths] = useState(3);
  useEffect(() => {
    api.get('/settings')
      .then(r => setExpiryMonths(parseInt(r.data.data?.compOffExpiryMonths, 10) || 3))
      .catch(() => {});
  }, []);

  const canApproveAll = ['admin', 'director', 'manager', 'hr_admin'].includes(user?.role);
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86400000);
  const earliestWorkedDate = new Date(today.getFullYear(), today.getMonth() - expiryMonths, today.getDate());
  const monthsLabel = `${expiryMonths} month${expiryMonths === 1 ? '' : 's'}`;

  const load = () => {
    setLoading(true);
    const calls = [api.get('/comp-off/my')];
    if (isApprover(user)) calls.push(api.get('/comp-off/pending'));
    Promise.all(calls).then(([myRes, pendingRes]) => {
      setMyRequests(myRes.data.data || []);
      setBalance(myRes.data.balance || 0);
      if (pendingRes) setPending(pendingRes.data.data || []);
    }).catch(err => toast.error(err.response?.data?.message || 'Failed to load comp-off requests')).finally(() => setLoading(false));
  };

  useEffect(() => { if (user !== undefined) load(); }, [user?.role]);
  useEffect(() => { if (user?.role === 'team_member') setTab('my'); }, [user?.role]);

  const handleSubmit = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      await api.post('/comp-off', form);
      toast.success('Comp-off request submitted!');
      setModal(false); setForm({ workedDate: '', compOffDate: '', reason: '', daysEarned: 1 }); load();
    } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const handleAction = async (id, action, reason, approveAll = false) => {
    setActionLoading(id);
    try {
      await api.put(`/comp-off/${id}/action`, { action, rejectionReason: reason, approveAll });
      toast.success(approveAll ? 'All levels approved' : `Comp-off ${action}`);
      setRejectModal(null); setRejectReason(''); load();
    } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
    finally { setActionLoading(''); }
  };

  const displayList = tab === 'my' ? myRequests : pending;

  return (
    <div className="space-y-5">
      <div className="pt-5 pb-1">
        <BackButton to="/leave-tracker" label="Leave Tracker" />
      </div>
      {/* Balance cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
        <div className="rounded-2xl p-5 border bg-green-50 text-green-700 border-green-200">
          <p className="text-sm font-semibold uppercase tracking-wider mb-2 opacity-70">Available Balance</p>
          <p className="text-4xl font-display font-bold">{balance.toFixed(1)}</p>
          <p className="text-sm mt-1 opacity-60">comp-off days (within validity)</p>
        </div>
        <div className="rounded-2xl p-5 border bg-blue-50 text-blue-700 border-blue-200">
          <p className="text-sm font-semibold uppercase tracking-wider mb-2 opacity-70">Total Earned</p>
          <p className="text-4xl font-display font-bold">
            {myRequests.filter(r => r.status === 'approved').reduce((s, r) => s + parseFloat(r.daysEarned), 0).toFixed(1)}
          </p>
          <p className="text-sm mt-1 opacity-60">from approved requests</p>
        </div>
        <div className="rounded-2xl p-5 border bg-amber-50 text-amber-700 border-amber-200">
          <p className="text-sm font-semibold uppercase tracking-wider mb-2 opacity-70">Pending Approval</p>
          <p className="text-4xl font-display font-bold">
            {myRequests.filter(r => r.status === 'pending').length}
          </p>
          <p className="text-sm mt-1 opacity-60">requests awaiting</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <div>
            <h3 className="font-display font-semibold text-slate-800">Compensatory Off</h3>
            <p className="text-slate-400 text-base mt-0.5">Work a weekend or holiday, earn a comp-off, use it within {monthsLabel}</p>
          </div>
          <button onClick={() => setModal(true)} className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white px-4 py-2.5 rounded-xl text-base font-medium transition-colors shadow-sm shadow-brand-500/25">
            <Plus size={16} /> Apply Comp-Off
          </button>
        </div>
        {isApprover(user) && (
          <div className="flex border-b border-slate-100">
            {[['my', 'My Requests'], ['pending', `Team Pending (${pending.length})`]].map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)} className={`px-6 py-3.5 text-base font-medium border-b-2 transition-colors ${tab === id ? 'border-brand-600 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>{label}</button>
            ))}
          </div>
        )}
        {loading ? <div className="flex justify-center py-12"><div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" /></div> : (
          <div className="divide-y divide-slate-50">
            {displayList.length === 0 ? (
              <div className="text-center py-16"><Gift size={32} className="text-slate-200 mx-auto mb-3" /><p className="text-slate-400">No comp-off requests</p></div>
            ) : displayList.map(r => {
              const canAct = r.canAct === true;
              const isExpanded = expanded === r._id;
              const hasLevels = Array.isArray(r.approvalLevels) && r.approvalLevels.length > 0;
              return (
              <div key={r._id} className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600 flex-shrink-0">
                      <Gift size={18} />
                    </div>
                    <div>
                      {tab === 'pending' && <p className="font-semibold text-slate-700 text-base">{r.employee?.firstName} {r.employee?.lastName} <span className="text-sm text-slate-400">· {r.employee?.department}</span></p>}
                      <p className="font-medium text-slate-700 text-base">Worked on {fmtDate(r.workedDate, { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}</p>
                      <p className="text-sm text-slate-500 mt-0.5">Comp-off requested for <span className="font-medium text-slate-700">{fmtDate(r.compOffDate)}</span></p>
                      {r.reason && <p className="text-sm text-slate-400 mt-0.5">{r.reason} · {r.daysEarned} day{Number(r.daysEarned) !== 1 ? 's' : ''}</p>}
                      {r.expiresAt && (
                        <p className={`text-[13px] mt-0.5 ${r.expired ? 'text-rose-500 font-medium' : 'text-slate-400'}`}>
                          {r.expired ? 'Expired' : 'Valid till'} {fmtDate(r.expiresAt, { day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`text-sm px-2.5 py-1 rounded-full font-medium capitalize ${STATUS_STYLE[r.status] || 'bg-slate-100 text-slate-500'}`}>{r.status}</span>
                    <button onClick={() => setViewItem(r)} className="flex items-center gap-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors">
                      <Eye size={13} /> View
                    </button>
                    {hasLevels && (
                      <button onClick={() => setExpanded(isExpanded ? null : r._id)} className="text-slate-400 hover:text-slate-700 p-1" title="Approval timeline">
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>
                    )}
                    {tab === 'pending' && r.status === 'pending' && canAct && r.employee?._id !== user?._id && (
                      <>
                        <button onClick={() => handleAction(r._id, 'approved')} disabled={!!actionLoading} className="flex items-center gap-1.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"><CheckCircle size={13} /> Approve</button>
                        {canApproveAll && (
                          <button onClick={() => handleAction(r._id, 'approved', undefined, true)} disabled={!!actionLoading} className="flex items-center gap-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"><CheckCheck size={13} /> Approve All</button>
                        )}
                        <button onClick={() => { setRejectModal(r._id); setRejectReason(''); }} className="flex items-center gap-1.5 bg-red-50 text-red-500 hover:bg-red-100 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"><XCircle size={13} /> Reject</button>
                      </>
                    )}
                  </div>
                </div>
                {isExpanded && hasLevels && (
                  <div className="mt-4 pl-14">
                    <ApprovalTimeline leave={r} />
                  </div>
                )}
              </div>
            );})}
          </div>
        )}
      </div>

      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-slate-100 flex-shrink-0">
              <h3 className="font-display font-semibold text-slate-800 text-xl">Apply for Comp-Off</h3>
              <button onClick={() => setModal(false)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600"><X size={16} /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1.5">Worked Date (weekend / holiday) *</label>
                <input type="date" value={form.workedDate} onChange={e => setForm({ ...form, workedDate: e.target.value })} required min={ymd(earliestWorkedDate)} max={ymd(today)} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400" />
                <p className="text-[13px] text-slate-400 mt-1">Must be a weekend or holiday you actually worked, within the last {monthsLabel}.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1.5">Reason / Work Details *</label>
                <textarea value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} required rows={2} placeholder="What did you work on that day?" className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400 resize-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1.5">Requested Comp-Off Date *</label>
                <input type="date" value={form.compOffDate} onChange={e => setForm({ ...form, compOffDate: e.target.value })} required min={ymd(tomorrow)} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400" />
                <p className="text-[13px] text-slate-400 mt-1">A future working day, within {monthsLabel} of the worked date.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1.5">Days to Claim *</label>
                <select value={form.daysEarned} onChange={e => setForm({ ...form, daysEarned: parseFloat(e.target.value) })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400">
                  <option value={0.5}>Half Day (0.5)</option>
                  <option value={1}>Full Day (1)</option>
                </select>
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setModal(false)} className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-base font-medium hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={saving} className="flex-1 bg-brand-600 hover:bg-brand-500 text-white py-2.5 rounded-xl text-base font-medium transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
                  <Send size={14} />{saving ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {viewItem && (
        <CompOffDetailModal
          item={viewItem}
          canAct={tab === 'pending' && viewItem.canAct === true && viewItem.employee?._id !== user?._id}
          canApproveAll={canApproveAll}
          onClose={() => setViewItem(null)}
          onApprove={(r) => { setViewItem(null); handleAction(r._id, 'approved'); }}
          onApproveAll={(r) => { setViewItem(null); handleAction(r._id, 'approved', undefined, true); }}
          onReject={(r) => { setViewItem(null); setRejectModal(r._id); setRejectReason(''); }}
        />
      )}

      {rejectModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-6">
            <h3 className="font-display font-semibold text-slate-800 mb-4">Reject Comp-Off</h3>
            <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={3} placeholder="Add an optional comment for this rejection (not required)..." className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400 resize-none mb-4" />
            <div className="flex gap-3">
              <button onClick={() => setRejectModal(null)} className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-base font-medium hover:bg-slate-50">Cancel</button>
              <button onClick={() => handleAction(rejectModal, 'rejected', rejectReason)} disabled={!!actionLoading} className="flex-1 bg-red-500 hover:bg-red-400 text-white py-2.5 rounded-xl text-base font-medium transition-colors disabled:opacity-60">Confirm Reject</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
