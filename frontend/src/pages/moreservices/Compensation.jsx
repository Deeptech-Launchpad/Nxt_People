import React, { useState, useEffect, useCallback } from 'react';
import { Plus, DollarSign, X, Check, Trash2, FileText, Upload } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';

const STATUS_TABS = ['All', 'Pending', 'Approved', 'Rejected'];
const STATUS_COLOR = {
  pending:  'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-600',
};
const CLAIM_TYPES = ['Medical', 'Travel', 'Food', 'Equipment', 'Internet', 'Other'];

export default function Compensation() {
  const { user } = useAuth();
  const isAdmin = ['admin', 'manager'].includes(user?.role);

  const [view, setView]     = useState('My Claims');
  const [tab, setTab]       = useState('All');
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(true);

  const [modal, setModal]   = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm]     = useState({ claimType: 'Medical', amount: '', claimDate: '', description: '', receipt: null });

  const load = useCallback(() => {
    const endpoint = (isAdmin && view === 'All (Admin)') ? '/compensation' : '/compensation/my';
    setLoading(true);
    api.get(endpoint)
      .then(r => setClaims(r.data.data || []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [view, isAdmin]);

  useEffect(load, [load]);

  const filtered = tab === 'All' ? claims : claims.filter(c => c.status === tab.toLowerCase());

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('claimType', form.claimType);
      fd.append('amount', form.amount);
      fd.append('claimDate', form.claimDate);
      fd.append('description', form.description || '');
      if (form.receipt) fd.append('receipt', form.receipt);
      await api.post('/compensation', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Claim submitted!');
      setModal(false);
      setForm({ claimType: 'Medical', amount: '', claimDate: '', description: '', receipt: null });
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to submit');
    } finally {
      setSaving(false);
    }
  };

  const handleAction = async (id, action) => {
    let rejectionReason = null;
    if (action === 'reject') {
      rejectionReason = prompt('Reason for rejection?');
      if (!rejectionReason) return;
    }
    try {
      await api.put(`/compensation/${id}/action`, { action, rejectionReason });
      toast.success(`Claim ${action}d`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed');
    }
  };

  const handleCancel = async (id) => {
    if (!confirm('Cancel this claim?')) return;
    try {
      await api.delete(`/compensation/${id}`);
      toast.success('Cancelled');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed');
    }
  };

  const fmtMoney = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  return (
    <div className="p-6 max-w-5xl space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-bold text-slate-800">Compensation Claims</h2>
        <button onClick={() => setModal(true)}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[12.5px] font-semibold px-3.5 py-1.5 rounded-md transition-colors">
          <Plus size={13}/> Add Claim
        </button>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        {isAdmin && (
          <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit">
            {['My Claims', 'All (Admin)'].map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-4 py-1.5 rounded-md text-[12.5px] font-medium transition-all ${view === v ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
                {v}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit ml-auto">
          {STATUS_TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all ${tab === t ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              {(view === 'All (Admin)' ? ['Employee','Type','Amount','Date','Description','Receipt','Status','Actions'] : ['Type','Amount','Date','Description','Receipt','Status','Actions']).map(h => (
                <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? (
              <tr><td colSpan={8} className="py-12 text-center text-[13px] text-slate-400">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="py-12 text-center text-[13px] text-slate-400">No claims found</td></tr>
            ) : filtered.map(c => (
              <tr key={c._id} className="hover:bg-slate-50 transition-colors">
                {view === 'All (Admin)' && (
                  <td className="px-4 py-3 text-[12.5px] text-slate-700">
                    {c.employee?.firstName} {c.employee?.lastName}
                    <span className="block text-[10.5px] text-slate-400">{c.employee?.department}</span>
                  </td>
                )}
                <td className="px-4 py-3 text-[12.5px] font-medium text-slate-800">{c.claimType}</td>
                <td className="px-4 py-3 text-[12.5px] font-bold text-slate-700">{fmtMoney(c.amount)}</td>
                <td className="px-4 py-3 text-[12.5px] text-slate-600">{fmtDate(c.claimDate)}</td>
                <td className="px-4 py-3 text-[12.5px] text-slate-600 max-w-[200px] truncate" title={c.description}>{c.description || '—'}</td>
                <td className="px-4 py-3 text-[12.5px]">
                  {c.receiptUrl ? (
                    <a href={c.receiptUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline inline-flex items-center gap-1">
                      <FileText size={12}/> View
                    </a>
                  ) : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-4 py-3">
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_COLOR[c.status] || 'bg-slate-100'}`}>{c.status}</span>
                  {c.status === 'rejected' && c.rejectionReason && (
                    <p className="text-[10.5px] text-red-500 mt-0.5 max-w-[160px]" title={c.rejectionReason}>{c.rejectionReason}</p>
                  )}
                </td>
                <td className="px-4 py-3">
                  {view === 'All (Admin)' && c.status === 'pending' && isAdmin ? (
                    <div className="flex gap-1">
                      <button onClick={() => handleAction(c._id, 'approve')} title="Approve" className="p-1 rounded hover:bg-emerald-50 text-emerald-600"><Check size={14}/></button>
                      <button onClick={() => handleAction(c._id, 'reject')}  title="Reject"  className="p-1 rounded hover:bg-red-50 text-red-500"><X size={14}/></button>
                    </div>
                  ) : view !== 'All (Admin)' && c.status === 'pending' ? (
                    <button onClick={() => handleCancel(c._id)} title="Cancel" className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500"><Trash2 size={13}/></button>
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
              <div className="flex items-center gap-2"><DollarSign size={16} className="text-blue-500"/><h3 className="font-semibold text-slate-800">Add Compensation Claim</h3></div>
              <button onClick={() => setModal(false)} className="text-slate-400 hover:text-slate-600"><X size={16}/></button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Type *</label>
                <select value={form.claimType} onChange={e => setForm({ ...form, claimType: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[12.5px] focus:outline-none focus:border-blue-400">
                  {CLAIM_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Amount (₹) *</label>
                  <input type="number" min="0" step="0.01" value={form.amount}
                    onChange={e => setForm({ ...form, amount: e.target.value })} required
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[12.5px] focus:outline-none focus:border-blue-400"/>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Claim Date *</label>
                  <input type="date" value={form.claimDate}
                    onChange={e => setForm({ ...form, claimDate: e.target.value })} required
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[12.5px] focus:outline-none focus:border-blue-400"/>
                </div>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Description</label>
                <textarea rows={2} value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[12.5px] focus:outline-none focus:border-blue-400 resize-none"/>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Receipt <span className="text-slate-400 font-normal">(PDF / image, max 5MB, optional)</span></label>
                <label className="border-2 border-dashed border-slate-200 rounded-lg p-4 text-center hover:border-blue-300 transition-colors cursor-pointer block">
                  {form.receipt ? (
                    <div><FileText size={20} className="text-blue-500 mx-auto mb-1"/><p className="text-[12px] font-medium text-slate-700">{form.receipt.name}</p></div>
                  ) : (
                    <div><Upload size={20} className="text-slate-300 mx-auto mb-1"/><p className="text-[12px] text-slate-400">Click to attach</p></div>
                  )}
                  <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png"
                    onChange={e => setForm({ ...form, receipt: e.target.files[0] })}/>
                </label>
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setModal(false)} className="flex-1 border border-slate-200 text-slate-600 py-2 rounded-lg text-[12.5px] font-medium hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={saving} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-[12.5px] font-semibold disabled:opacity-60">
                  {saving ? 'Submitting…' : 'Submit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
