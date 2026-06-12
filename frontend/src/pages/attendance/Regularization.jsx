import React, { useState, useEffect } from 'react';
import { Plus, X, CheckCircle, XCircle, Clock, AlertTriangle, Send, Eye } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { isApprover } from '../../utils/roles';
import LeaveDetailModal from '../../components/LeaveDetailModal';

function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

const STATUS_STYLE = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
};

export default function Regularization() {
  const { user } = useAuth();
  const [myRequests, setMyRequests] = useState([]);
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ date: new Date().toLocaleDateString('en-CA'), checkIn: '', checkOut: '', reason: '' });
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const [detailReq, setDetailReq] = useState(null);  // request shown in the detail/timeline modal
  const [tab, setTab] = useState(user?.role === 'employee' ? 'my' : 'pending');

  const load = () => {
    setLoading(true);
    const calls = [api.get('/regularizations/my')];
    if (isApprover(user)) calls.push(api.get('/regularizations/pending'));
    Promise.all(calls).then(([myRes, pendingRes]) => {
      setMyRequests(myRes.data.data || []);
      if (pendingRes) setPending(pendingRes.data.data || []);
    }).catch(console.error).finally(() => setLoading(false));
  };

  useEffect(load, []);

  useEffect(() => {
    if (!modal) return;
    if (!form.date) return;

    const targetDate = form.date;

    api.get(`/attendance/by-date?date=${targetDate}`)
      .then(res => {
        const record = res.data.data;
        if (record) {
          setForm(prev => ({
            ...prev,
            checkIn: record.checkIn ? formatTime(record.checkIn) : '',
            checkOut: record.checkOut ? formatTime(record.checkOut) : '',
          }));
        } else {
          setForm(prev => ({
            ...prev,
            checkIn: '',
            checkOut: '',
          }));
        }
      })
      .catch(() => {
        setForm(prev => ({ ...prev, checkIn: '', checkOut: '' }));
      });
  }, [form.date, modal]);

  const handleSubmit = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      await api.post('/regularizations', form);
      toast.success('Regularization request submitted!');
      setModal(false); setForm({ date: new Date().toLocaleDateString('en-CA'), checkIn: '', checkOut: '', reason: '' });
      load();
    } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const handleAction = async (id, action, reason) => {
    setActionLoading(id);
    try {
      await api.put(`/regularizations/${id}/action`, { action, rejectionReason: reason });
      toast.success(`Request ${action}`);
      load();
    } catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
    finally { setActionLoading(''); }
  };

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <div>
            <h3 className="font-display font-semibold text-slate-800">Attendance Regularization</h3>
            <p className="text-slate-400 text-sm mt-0.5">Request correction for missed check-in or check-out</p>
          </div>
          <button onClick={() => {
            setForm(prev => ({ ...prev, checkIn: '', checkOut: '', reason: '' }));
            setModal(true);
          }} className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors shadow-sm shadow-brand-500/25">
            <Plus size={16} /> New Request
          </button>
        </div>

        {isApprover(user) && (
          <div className="flex border-b border-slate-100">
            {[['my', 'My Requests'], ['pending', `Team Pending (${pending.length})`]].map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)}
                className={`px-6 py-3.5 text-sm font-medium border-b-2 transition-colors ${tab === id ? 'border-brand-600 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                {label}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12"><div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : (
          <div className="divide-y divide-slate-50">
            {(tab === 'my' ? myRequests : pending).length === 0 ? (
              <div className="text-center py-16"><AlertTriangle size={32} className="text-slate-200 mx-auto mb-3" /><p className="text-slate-400">No requests found</p></div>
            ) : (tab === 'my' ? myRequests : pending).map(r => (
              <div key={r._id} className="p-5 flex items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 bg-brand-50 rounded-xl flex items-center justify-center text-brand-600 flex-shrink-0">
                    <Clock size={18} />
                  </div>
                  <div>
                    {tab === 'pending' && <p className="font-semibold text-slate-700">{r.employee?.firstName} {r.employee?.lastName} <span className="text-xs text-slate-400">({r.employee?.employeeId})</span></p>}
                    <p className="font-medium text-slate-700 text-sm">{new Date(r.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {r.checkIn ? `Check-in: ${r.checkIn}` : 'No check-in specified'}
                      {r.checkOut ? ` · Check-out: ${r.checkOut}` : ''}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5 max-w-sm truncate">Reason: {r.reason}</p>
                    {r.rejectionReason && <p className="text-xs text-red-500 mt-0.5">Rejected: {r.rejectionReason}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium capitalize ${STATUS_STYLE[r.status]}`}>{r.status}</span>
                  <button onClick={() => setDetailReq(r)} className="flex items-center gap-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors">
                    <Eye size={13} /> View
                  </button>
                  {tab === 'pending' && r.status === 'pending' && r.canAct && (
                    <>
                      <button onClick={() => handleAction(r._id, 'approved')} disabled={!!actionLoading}
                        className="flex items-center gap-1.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50">
                        <CheckCircle size={13} /> Approve
                      </button>
                      <button onClick={() => handleAction(r._id, 'rejected')} disabled={!!actionLoading}
                        className="flex items-center gap-1.5 bg-red-50 text-red-500 hover:bg-red-100 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50">
                        <XCircle size={13} /> Reject
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Submit Modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-6 border-b border-slate-100">
              <h3 className="font-display font-semibold text-slate-800 text-lg">Request Regularization</h3>
              <button onClick={() => setModal(false)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600"><X size={16} /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Date *</label>
                <input type="date" value={form.date} onChange={e => { const v = e.target.value; setForm(prev => ({ ...prev, date: v })); }} required
                  max={new Date().toLocaleDateString('en-CA')}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Correct Check-In</label>
                  <input type="time" value={form.checkIn} onChange={e => { const v = e.target.value; setForm(prev => ({ ...prev, checkIn: v })); }}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Correct Check-Out</label>
                  <input type="time" value={form.checkOut} onChange={e => { const v = e.target.value; setForm(prev => ({ ...prev, checkOut: v })); }}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Reason *</label>
                <textarea value={form.reason} onChange={e => { const v = e.target.value; setForm(prev => ({ ...prev, reason: v })); }} required rows={3}
                  placeholder="Explain why your attendance needs correction..."
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400 resize-none" />
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

      {/* Request details + approval timeline modal */}
      {detailReq && (
        <LeaveDetailModal
          leave={detailReq}
          kind="regularization"
          onClose={() => setDetailReq(null)}
          canAct={tab === 'pending' && detailReq.status === 'pending' && !!detailReq.canAct}
          onApprove={(x, comment) => { setDetailReq(null); handleAction(x._id, 'approved', comment); }}
          onReject={(x, comment) => { setDetailReq(null); handleAction(x._id, 'rejected', comment); }}
        />
      )}
    </div>
  );
}
