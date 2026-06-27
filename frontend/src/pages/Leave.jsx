import React, { useState, useEffect } from 'react';
import { Plus, X, Calendar, Eye } from 'lucide-react';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import BackButton from '../components/BackButton';
import LeaveDetailModal from '../components/LeaveDetailModal';
import CompOffDetailModal from '../components/CompOffDetailModal';

const STATUS_STYLE = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
  cancelled: 'bg-slate-100 text-slate-500'
};
const LEAVE_TYPES = ['casual', 'comp_off', 'unpaid', 'permission'];
const LEAVE_TYPE_LABELS = {
  casual: 'Casual Leave',
  comp_off: 'Compensatory Off',
  unpaid: 'Leave Without Pay',
  permission: 'Permission'
};
const initForm = { leaveType: 'casual', startDate: '', endDate: '', reason: '', isHalfDay: false, halfDayType: 'first_half', startTime: '', endTime: '' };

// Bug #24 fix: parse date-only strings as LOCAL time to avoid off-by-one in IST
function parseLocalDate(dateStr) {
  if (!dateStr) return null;
  if (typeof dateStr !== 'string' || dateStr.includes('T')) return new Date(dateStr);
  return new Date(dateStr + 'T00:00:00');
}

export default function Leave() {
  const { user } = useAuth();
  const [leaves, setLeaves] = useState([]);
  const [balance, setBalance] = useState(null);
  const [balanceCards, setBalanceCards] = useState(null);  // raw cards for the detail modal's balance panel
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(initForm);
  const [saving, setSaving] = useState(false);
  const [detailLeave, setDetailLeave] = useState(null);
  const [compOffs, setCompOffs] = useState([]);
  const [viewCompOff, setViewCompOff] = useState(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/leaves/my'),
      api.get('/leaves/balance'),
      api.get('/comp-off/my'),
    ]).then(([l, b, co]) => {
      setLeaves(l.data.data || []);
      setCompOffs(co.data.data || []);
      const cards = b.data.data || [];
      setBalanceCards(cards);
      const balMap = {};
      cards.forEach(c => { balMap[c.code] = c.available; });
      setBalance(balMap);
    }).catch(console.error).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleApply = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      const isPerm = form.leaveType === 'permission';
      if (isPerm && (!form.startTime || !form.endTime)) {
        setSaving(false);
        return toast.error('Please select start and end time');
      }
      const payload = isPerm
        ? { leaveType: 'permission', startDate: form.startDate, endDate: form.startDate, reason: form.reason, startTime: form.startTime, endTime: form.endTime }
        : form;
      await api.post('/leaves', payload);
      toast.success(isPerm ? 'Permission applied successfully!' : 'Leave applied successfully!');
      setModal(false); setForm(initForm); load();
    } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const handleCancel = async (id) => {
    if (!confirm('Cancel this leave request?')) return;
    try { await api.delete(`/leaves/${id}`); toast.success('Leave cancelled'); load(); }
    catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
  };

  const leaveTypeColors = {
    casual: 'bg-blue-50 text-blue-700 border-blue-200',
    comp_off: 'bg-green-50 text-green-700 border-green-200',
    unpaid: 'bg-slate-50 text-slate-600 border-slate-200',
    permission: 'bg-purple-50 text-purple-700 border-purple-200'
  };

  return (
    <div className="space-y-5">
      {/* Balance cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {LEAVE_TYPES.map(t => (
          <div key={t} className={`rounded-2xl p-5 border ${leaveTypeColors[t]}`}>
            <p className="text-sm font-semibold uppercase tracking-wider mb-2 opacity-70">{LEAVE_TYPE_LABELS[t]}</p>
            {/* Permission is hourly (4h/month); other types are day-based. */}
            <p className="text-4xl font-display font-bold">
              {t === 'permission' ? `${balance?.permission ?? 0}h` : (balance?.[t] === 999 ? '∞' : (balance?.[t] ?? '—'))}
            </p>
            <p className="text-sm mt-1 opacity-60">{t === 'permission' ? 'remaining this month' : 'days remaining'}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <BackButton to="/leave-tracker" label="Leave Tracker" />
            <div className="w-px h-4 bg-slate-200" />
            <h3 className="font-display font-semibold text-slate-800">My Leave Requests</h3>
          </div>
          <button onClick={() => { setForm(initForm); setModal(true); }}
            className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white px-4 py-2.5 rounded-xl text-base font-medium transition-colors shadow-sm shadow-brand-500/25">
            <Plus size={16} /> Apply Leave
          </button>
        </div>

        {loading ? <div className="flex justify-center py-12"><div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" /></div> : (
          <div className="divide-y divide-slate-50">
            {(leaves.length === 0 && compOffs.length === 0) ? (
              <div className="text-center py-16">
                <Calendar size={40} className="text-slate-200 mx-auto mb-3" />
                <p className="text-slate-400 font-medium">No leave requests yet</p>
                <p className="text-slate-300 text-base mt-1">Click "Apply Leave" to submit your first request</p>
              </div>
            ) : (
              <>
                {/* Regular leave requests */}
                {leaves.map(l => {
                  const startDate = parseLocalDate(l.startDate);
                  const endDate = parseLocalDate(l.endDate);
                  return (
                    <div key={l._id} className="p-5 flex items-start justify-between gap-4 hover:bg-slate-50 transition-colors">
                      <div className="flex items-start gap-4">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border ${leaveTypeColors[l.leaveType] || 'bg-slate-50 border-slate-200'}`}>
                          <Calendar size={18} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium text-slate-700 capitalize">{LEAVE_TYPE_LABELS[l.leaveType] || l.leaveType}</p>
                            <span className={`px-2.5 py-0.5 rounded-full text-sm font-medium capitalize ${STATUS_STYLE[l.status]}`}>{l.status}</span>
                          </div>
                          <p className="text-base text-slate-500 mt-1">
                            {startDate?.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}
                            {l.startDate !== l.endDate && ` — ${endDate?.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}`}
                            <span className="text-slate-400 ml-1.5">({l.totalDays} day{l.totalDays !== 1 ? 's' : ''})</span>
                          </p>
                          <p className="text-base text-slate-400 mt-0.5">{l.reason}</p>
                          {l.rejectionReason && (
                            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded px-2 py-1 mt-1.5 w-fit font-medium">
                              Rejection Reason: {l.rejectionReason}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button onClick={() => setDetailLeave(l)} className="flex items-center gap-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-colors">
                          <Eye size={13} /> View
                        </button>
                        {l.status === 'pending' && (
                          <button onClick={() => handleCancel(l._id)} className="text-sm text-red-500 hover:text-red-600 flex items-center gap-1 px-2 py-1.5 rounded-lg hover:bg-red-50 transition-colors">
                            <X size={13} /> Cancel
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {/* Comp-Off requests */}
                {compOffs.map(c => (
                  <div key={c._id} className="p-5 flex items-start justify-between gap-4 hover:bg-slate-50 transition-colors">
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border bg-green-50 border-green-200 text-green-700">
                        <Calendar size={18} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-slate-700">Compensatory Off</p>
                          <span className={`px-2.5 py-0.5 rounded-full text-sm font-medium capitalize ${STATUS_STYLE[c.status] || 'bg-slate-100 text-slate-500'}`}>{c.status}</span>
                        </div>
                        <p className="text-base text-slate-500 mt-1">
                          Comp-off for {c.compOffDate ? parseLocalDate(c.compOffDate)?.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                          <span className="text-slate-400 ml-1.5">({c.daysEarned} day{Number(c.daysEarned) !== 1 ? 's' : ''})</span>
                        </p>
                        <p className="text-base text-slate-400 mt-0.5">Worked on {c.workedDate ? parseLocalDate(c.workedDate)?.toLocaleDateString('en-US', { weekday: 'short', day: '2-digit', month: 'short' }) : '—'}</p>
                        {c.rejectionReason && (
                          <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded px-2 py-1 mt-1.5 w-fit font-medium">
                            Rejection Reason: {c.rejectionReason}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button onClick={() => setViewCompOff(c)} className="flex items-center gap-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-colors">
                        <Eye size={13} /> View
                      </button>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-6 border-b border-slate-100">
              <h3 className="font-display font-semibold text-slate-800 text-xl">Apply Leave</h3>
              <button onClick={() => setModal(false)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600"><X size={16} /></button>
            </div>
            <form onSubmit={handleApply} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1.5">Leave Type</label>
                <select value={form.leaveType} onChange={e => setForm({ ...form, leaveType: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400">
                  {LEAVE_TYPES.map(t => <option key={t} value={t}>{LEAVE_TYPE_LABELS[t]}</option>)}
                </select>
              </div>
              {/* Show available balance for selected leave type */}
              {balance && form.leaveType !== 'unpaid' && (
                <p className="text-sm text-slate-500 -mt-2">
                  {form.leaveType === 'permission'
                    ? <>Remaining this month: <span className="font-semibold text-brand-600">{balance.permission ?? 0}h</span> of 4h</>
                    : <>Available: <span className="font-semibold text-brand-600">{balance[form.leaveType] ?? 0} day(s)</span></>}
                </p>
              )}
              {form.leaveType === 'permission' ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1.5">Date</label>
                    <input type="date" value={form.startDate} min={new Date().toLocaleDateString('en-CA')} onChange={e => setForm({ ...form, startDate: e.target.value, endDate: e.target.value })} required className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-slate-600 mb-1.5">Start Time</label>
                      <input type="time" value={form.startTime} onChange={e => setForm({ ...form, startTime: e.target.value })} required className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-600 mb-1.5">End Time</label>
                      <input type="time" value={form.endTime} onChange={e => setForm({ ...form, endTime: e.target.value })} required className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400" />
                    </div>
                  </div>
                  <p className="text-[13px] text-purple-600 -mt-1">Permission is hourly — up to 4 hours per month, no carry-forward.</p>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={form.isHalfDay} onChange={e => setForm({ ...form, isHalfDay: e.target.checked })} className="w-4 h-4 rounded accent-brand-600" />
                      <span className="text-base text-slate-600">Half Day</span>
                    </label>
                    {form.isHalfDay && (
                      <select value={form.halfDayType} onChange={e => setForm({ ...form, halfDayType: e.target.value })} className="border border-slate-200 rounded-lg px-2 py-1.5 text-base focus:outline-none focus:border-brand-400">
                        <option value="first_half">First Half</option><option value="second_half">Second Half</option>
                      </select>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-slate-600 mb-1.5">From</label>
                      {/* Block past-dated leave requests at the UI level. Local
                          date in YYYY-MM-DD so the input accepts it directly. */}
                      <input type="date" value={form.startDate} min={new Date().toLocaleDateString('en-CA')} onChange={e => setForm({ ...form, startDate: e.target.value, endDate: e.target.value > form.endDate ? e.target.value : form.endDate })} required className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-600 mb-1.5">To</label>
                      <input type="date" value={form.endDate} min={form.startDate || new Date().toLocaleDateString('en-CA')} onChange={e => setForm({ ...form, endDate: e.target.value })} required className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400" />
                    </div>
                  </div>
                </>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1.5">Reason</label>
                <textarea value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} required rows={3} placeholder="Reason for leave..." className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400 resize-none" />
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setModal(false)} className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-base font-medium hover:bg-slate-50 transition-colors">Cancel</button>
                <button type="submit" disabled={saving} className="flex-1 bg-brand-600 hover:bg-brand-500 text-white py-2.5 rounded-xl text-base font-medium transition-colors disabled:opacity-60">
                  {saving ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {detailLeave && (
        <LeaveDetailModal
          leave={detailLeave}
          balance={balanceCards}
          onClose={() => setDetailLeave(null)}
          onCancel={(x) => { setDetailLeave(null); handleCancel(x._id); }}
        />
      )}

      {viewCompOff && (
        <CompOffDetailModal
          item={viewCompOff}
          canAct={false}
          onClose={() => setViewCompOff(null)}
        />
      )}
    </div>
  );
}
