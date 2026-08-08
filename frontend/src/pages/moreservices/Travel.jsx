import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Plane, X, Check, Trash2 } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { isApprover } from '../../utils/roles';

const STATUS_COLOR = {
  pending:  'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-600',
};

const VIEW_TABS = ['My Requests', 'All (Admin)'];

export default function Travel() {
  const { user } = useAuth();
  const isAdmin = isApprover(user);

  const [view, setView]         = useState('My Requests');
  const [requests, setRequests] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [modal, setModal]       = useState(false);
  const [saving, setSaving]     = useState(false);
  const [form, setForm]         = useState({ destination: '', purpose: '', fromDate: '', toDate: '', transport: 'Flight' });

  const [rejectModal, setRejectModal] = useState(null); // { id }
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(() => {
    const endpoint = (isAdmin && view === 'All (Admin)') ? '/travel' : '/travel/my';
    setLoading(true);
    api.get(endpoint)
      .then(r => setRequests(r.data.data || []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [view, isAdmin]);

  useEffect(load, [load]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/travel', form);
      toast.success('Travel request submitted!');
      setModal(false);
      setForm({ destination: '', purpose: '', fromDate: '', toDate: '', transport: 'Flight' });
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to submit');
    } finally {
      setSaving(false);
    }
  };

  const handleAction = async (id, action, rejectionReason = null) => {
    try {
      await api.put(`/travel/${id}/action`, { action, rejectionReason });
      toast.success(`Request ${action}d`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed');
    }
  };

  const confirmReject = async () => {
    if (!rejectReason.trim()) return;
    await handleAction(rejectModal.id, 'reject', rejectReason);
    setRejectModal(null);
    setRejectReason('');
  };

  const handleCancel = async (id) => {
    if (!confirm('Cancel this travel request?')) return;
    try {
      await api.delete(`/travel/${id}`);
      toast.success('Cancelled');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed');
    }
  };

  const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  return (
    <div className="p-6 max-w-5xl space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-[17px] font-bold text-slate-800">Travel Requests</h2>
        <button onClick={() => setModal(true)}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[14px] font-semibold px-3.5 py-1.5 rounded-md transition-colors">
          <Plus size={13}/> New Request
        </button>
      </div>

      {isAdmin && (
        <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit">
          {VIEW_TABS.map(t => (
            <button key={t} onClick={() => setView(t)}
              className={`px-4 py-1.5 rounded-md text-[14px] font-medium transition-all ${view === t ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
              {t}
            </button>
          ))}
        </div>
      )}

      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              {(view === 'All (Admin)' ? ['Employee','Destination','Purpose','From','To','Transport','Status','Actions'] : ['Destination','Purpose','From','To','Transport','Status','Actions']).map(h => (
                <th key={h} className="px-4 py-3 text-left text-[13px] font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? (
              <tr><td colSpan={8} className="py-12 text-center text-[15px] text-slate-400">Loading…</td></tr>
            ) : requests.length === 0 ? (
              <tr><td colSpan={8} className="py-14 text-center">
                <Plane size={32} className="text-slate-200 mx-auto mb-3"/>
                <p className="text-[15px] font-semibold text-slate-400">No travel requests yet</p>
                <p className="text-[14px] text-slate-300 mt-1">Click "New Request" to submit one</p>
              </td></tr>
            ) : requests.map(r => (
              <tr key={r._id} className="hover:bg-slate-50 transition-colors">
                {view === 'All (Admin)' && (
                  <td className="px-4 py-3 text-[14px] text-slate-700">
                    {r.employee?.firstName} {r.employee?.lastName}
                    <span className="block text-[12px] text-slate-400">{r.employee?.department}</span>
                  </td>
                )}
                <td className="px-4 py-3 text-[14px] font-medium text-slate-800">{r.destination}</td>
                <td className="px-4 py-3 text-[14px] text-slate-600 max-w-[200px] truncate" title={r.purpose}>{r.purpose || '—'}</td>
                <td className="px-4 py-3 text-[14px] text-slate-600">{fmtDate(r.fromDate)}</td>
                <td className="px-4 py-3 text-[14px] text-slate-600">{fmtDate(r.toDate)}</td>
                <td className="px-4 py-3 text-[14px] text-slate-600">{r.transport || '—'}</td>
                <td className="px-4 py-3">
                  <span className={`text-[13px] font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_COLOR[r.status] || 'bg-slate-100 text-slate-500'}`}>{r.status}</span>
                  {r.status === 'rejected' && r.rejectionReason && (
                    <p className="text-[12px] text-red-500 mt-0.5 max-w-[160px]" title={r.rejectionReason}>{r.rejectionReason}</p>
                  )}
                </td>
                <td className="px-4 py-3">
                  {view === 'All (Admin)' && r.status === 'pending' && isAdmin ? (
                    <div className="flex gap-1">
                      <button onClick={() => handleAction(r._id, 'approve')} title="Approve"
                        className="p-1 rounded hover:bg-emerald-50 text-emerald-600">
                        <Check size={14}/>
                      </button>
                      <button onClick={() => setRejectModal({ id: r._id })} title="Reject"
                        className="p-1 rounded hover:bg-red-50 text-red-500">
                        <X size={14}/>
                      </button>
                    </div>
                  ) : view !== 'All (Admin)' && r.status === 'pending' ? (
                    <button onClick={() => handleCancel(r._id)} title="Cancel"
                      className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500">
                      <Trash2 size={13}/>
                    </button>
                  ) : <span className="text-slate-300">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Plane size={16} className="text-blue-500"/>
                <h3 className="font-semibold text-slate-800">New Travel Request</h3>
              </div>
              <button onClick={() => setModal(false)} className="text-slate-400 hover:text-slate-600"><X size={16}/></button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div>
                <label className="block text-[14px] font-medium text-slate-600 mb-1.5">Destination *</label>
                <input value={form.destination} onChange={e => setForm({ ...form, destination: e.target.value })} required
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:border-blue-400"/>
              </div>
              <div>
                <label className="block text-[14px] font-medium text-slate-600 mb-1.5">Purpose</label>
                <textarea value={form.purpose} onChange={e => setForm({ ...form, purpose: e.target.value })} rows={2}
                  placeholder="Client meeting, conference, etc."
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:border-blue-400 resize-none"/>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[14px] font-medium text-slate-600 mb-1.5">From *</label>
                  <input type="date" value={form.fromDate} onChange={e => setForm({ ...form, fromDate: e.target.value })} required
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:border-blue-400"/>
                </div>
                <div>
                  <label className="block text-[14px] font-medium text-slate-600 mb-1.5">To *</label>
                  <input type="date" value={form.toDate} onChange={e => setForm({ ...form, toDate: e.target.value })} required
                    min={form.fromDate || undefined}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:border-blue-400"/>
                </div>
              </div>
              <div>
                <label className="block text-[14px] font-medium text-slate-600 mb-1.5">Transport</label>
                <select value={form.transport} onChange={e => setForm({ ...form, transport: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:border-blue-400">
                  {['Flight', 'Train', 'Bus', 'Car', 'Other'].map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setModal(false)} className="flex-1 border border-slate-200 text-slate-600 py-2 rounded-lg text-[14px] font-medium hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={saving} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-[14px] font-semibold disabled:opacity-60">
                  {saving ? 'Submitting…' : 'Submit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {rejectModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <div className="flex items-center gap-2"><X size={16} className="text-red-500"/><h3 className="font-semibold text-slate-800">Reject Request</h3></div>
              <button onClick={() => { setRejectModal(null); setRejectReason(''); }} className="text-slate-400 hover:text-slate-600"><X size={16}/></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-[14px] font-medium text-slate-600 mb-1.5">Reason for rejection *</label>
                <textarea rows={3} required value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:border-blue-400 resize-none"/>
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => { setRejectModal(null); setRejectReason(''); }} className="flex-1 border border-slate-200 text-slate-600 py-2 rounded-lg text-[14px] font-medium hover:bg-slate-50">Cancel</button>
                <button type="button" disabled={!rejectReason.trim()} onClick={confirmReject} className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2 rounded-lg text-[14px] font-semibold disabled:opacity-60">
                  Confirm Reject
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
