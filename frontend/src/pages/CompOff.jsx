import React, { useState, useEffect } from 'react';
import { Plus, X, CheckCircle, XCircle, Gift, Send, AlertTriangle } from 'lucide-react';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';

const STATUS_STYLE = { pending: 'bg-amber-100 text-amber-700', approved: 'bg-emerald-100 text-emerald-700', rejected: 'bg-red-100 text-red-700' };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function CompOff() {
  const { user } = useAuth();
  const [myRequests, setMyRequests] = useState([]);
  const [pending, setPending] = useState([]);
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [rejectModal, setRejectModal] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [form, setForm] = useState({ workedDate: '', reason: '', daysEarned: 1 });
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const [tab, setTab] = useState(user?.role === 'employee' ? 'my' : 'pending');

  const load = () => {
    setLoading(true);
    const calls = [api.get('/comp-off/my')];
    if (user?.role !== 'employee') calls.push(api.get('/comp-off/pending'));
    Promise.all(calls).then(([myRes, pendingRes]) => {
      setMyRequests(myRes.data.data || []);
      setBalance(myRes.data.balance || 0);
      if (pendingRes) setPending(pendingRes.data.data || []);
    }).catch(console.error).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleSubmit = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      await api.post('/comp-off', form);
      toast.success('Comp-off request submitted!');
      setModal(false); setForm({ workedDate: '', reason: '', daysEarned: 1 }); load();
    } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const handleAction = async (id, action, reason) => {
    setActionLoading(id);
    try {
      await api.put(`/comp-off/${id}/action`, { action, rejectionReason: reason });
      toast.success(`Comp-off ${action}`);
      setRejectModal(null); setRejectReason(''); load();
    } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
    finally { setActionLoading(''); }
  };

  const displayList = tab === 'my' ? myRequests : pending;

  return (
    <div className="space-y-5">
      {/* Balance card */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-gradient-to-br from-indigo-500 to-indigo-700 rounded-2xl p-5 text-white">
          <p className="text-indigo-200 text-sm font-medium">Available Balance</p>
          <p className="text-4xl font-display font-bold mt-1">{balance.toFixed(1)}</p>
          <p className="text-indigo-300 text-sm mt-0.5">comp-off days</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
          <p className="text-slate-400 text-sm">Total Earned</p>
          <p className="text-2xl font-display font-bold text-slate-800 mt-1">
            {myRequests.filter(r => r.status === 'approved').reduce((s, r) => s + parseFloat(r.daysEarned), 0).toFixed(1)}
          </p>
          <p className="text-slate-400 text-xs mt-0.5">from approved requests</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
          <p className="text-slate-400 text-sm">Pending Approval</p>
          <p className="text-2xl font-display font-bold text-slate-800 mt-1">
            {myRequests.filter(r => r.status === 'pending').length}
          </p>
          <p className="text-slate-400 text-xs mt-0.5">requests awaiting</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <div>
            <h3 className="font-display font-semibold text-slate-800">Compensatory Off</h3>
            <p className="text-slate-400 text-sm mt-0.5">Claim comp-off for working on weekends or holidays</p>
          </div>
          <button onClick={() => setModal(true)} className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors shadow-sm shadow-brand-500/25">
            <Plus size={16} /> Apply Comp-Off
          </button>
        </div>
        {user?.role !== 'employee' && (
          <div className="flex border-b border-slate-100">
            {[['my', 'My Requests'], ['pending', `Team Pending (${pending.length})`]].map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)} className={`px-6 py-3.5 text-sm font-medium border-b-2 transition-colors ${tab === id ? 'border-brand-600 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>{label}</button>
            ))}
          </div>
        )}
        {loading ? <div className="flex justify-center py-12"><div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" /></div> : (
          <div className="divide-y divide-slate-50">
            {displayList.length === 0 ? (
              <div className="text-center py-16"><Gift size={32} className="text-slate-200 mx-auto mb-3" /><p className="text-slate-400">No comp-off requests</p></div>
            ) : displayList.map(r => (
              <div key={r._id} className="p-5 flex items-center justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600 flex-shrink-0">
                    <Gift size={18} />
                  </div>
                  <div>
                    {tab === 'pending' && <p className="font-semibold text-slate-700 text-sm">{r.employee?.firstName} {r.employee?.lastName} <span className="text-xs text-slate-400">· {r.employee?.department}</span></p>}
                    <p className="font-medium text-slate-700 text-sm">
                      Worked on {new Date(r.workedDate + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}
                      <span className="ml-2 text-xs text-slate-400">({DAYS[new Date(r.workedDate + 'T00:00:00').getDay()]})</span>
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">{r.reason} · {r.daysEarned} day{r.daysEarned !== 1 ? 's' : ''}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium capitalize ${STATUS_STYLE[r.status]}`}>{r.status}</span>
                  {tab === 'pending' && r.status === 'pending' && (
                    <>
                      <button onClick={() => handleAction(r._id, 'approved')} disabled={!!actionLoading} className="flex items-center gap-1.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"><CheckCircle size={13} /> Approve</button>
                      <button onClick={() => { setRejectModal(r._id); setRejectReason(''); }} className="flex items-center gap-1.5 bg-red-50 text-red-500 hover:bg-red-100 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"><XCircle size={13} /> Reject</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-6 border-b border-slate-100">
              <h3 className="font-display font-semibold text-slate-800 text-lg">Apply for Comp-Off</h3>
              <button onClick={() => setModal(false)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600"><X size={16} /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Date You Worked *</label>
                <input type="date" value={form.workedDate} onChange={e => setForm({ ...form, workedDate: e.target.value })} required max={new Date().toLocaleDateString('en-CA')} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Days to Claim *</label>
                <select value={form.daysEarned} onChange={e => setForm({ ...form, daysEarned: parseFloat(e.target.value) })} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400">
                  <option value={0.5}>Half Day (0.5)</option>
                  <option value={1}>Full Day (1)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Reason *</label>
                <textarea value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} required rows={3} placeholder="Why did you work on this day?" className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400 resize-none" />
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setModal(false)} className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={saving} className="flex-1 bg-brand-600 hover:bg-brand-500 text-white py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
                  <Send size={14} />{saving ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {rejectModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-6">
            <h3 className="font-display font-semibold text-slate-800 mb-4">Reject Comp-Off</h3>
            <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={3} placeholder="Reason (optional)..." className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400 resize-none mb-4" />
            <div className="flex gap-3">
              <button onClick={() => setRejectModal(null)} className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-50">Cancel</button>
              <button onClick={() => handleAction(rejectModal, 'rejected', rejectReason)} disabled={!!actionLoading} className="flex-1 bg-red-500 hover:bg-red-400 text-white py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-60">Confirm Reject</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
