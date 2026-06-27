import React, { useState, useEffect, useCallback } from 'react';
import { Plus, FileCheck, X, Download, Trash2, FileText, Upload } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { isApprover } from '../../utils/roles';

const LETTER_TYPES = [
  { value: 'employment_verification', label: 'Employment Verification' },
  { value: 'salary_certificate',      label: 'Salary Certificate'      },
  { value: 'address_proof',           label: 'Address Proof'           },
  { value: 'bonafide',                label: 'Bonafide Letter'         },
  { value: 'experience',              label: 'Experience Letter'       },
  { value: 'noc',                     label: 'No Objection Certificate'},
  { value: 'relieving',               label: 'Relieving Letter'        },
  { value: 'other',                   label: 'Other'                   },
];
const labelFor = (v) => LETTER_TYPES.find(l => l.value === v)?.label || v;

const STATUS_COLOR = {
  requested:   'bg-amber-100 text-amber-700',
  in_progress: 'bg-blue-100 text-blue-700',
  issued:      'bg-emerald-100 text-emerald-700',
  rejected:    'bg-red-100 text-red-600',
};
const STATUS_LABEL = {
  requested:   'Requested',
  in_progress: 'In Progress',
  issued:      'Issued',
  rejected:    'Rejected',
};

export default function HRLetters() {
  const { user } = useAuth();
  const isAdmin = isApprover(user);

  const [view, setView]       = useState('My Requests');
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);

  const [modal, setModal]     = useState(false);
  const [saving, setSaving]   = useState(false);
  const [form, setForm]       = useState({ letterType: 'employment_verification', purpose: '' });

  const [processModal, setProcessModal] = useState(null); // { record }
  const [processForm, setProcessForm]   = useState({ status: 'in_progress', rejectionReason: '', letter: null });

  const load = useCallback(() => {
    const endpoint = (isAdmin && view === 'All (Admin)') ? '/hr-letters' : '/hr-letters/my';
    setLoading(true);
    api.get(endpoint)
      .then(r => setRecords(r.data.data || []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [view, isAdmin]);

  useEffect(load, [load]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/hr-letters', form);
      toast.success('Letter request submitted!');
      setModal(false);
      setForm({ letterType: 'employment_verification', purpose: '' });
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const handleProcess = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('status', processForm.status);
      if (processForm.status === 'rejected' && processForm.rejectionReason) {
        fd.append('rejectionReason', processForm.rejectionReason);
      }
      if (processForm.letter) fd.append('letter', processForm.letter);
      await api.put(`/hr-letters/${processModal._id}/process`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success(`Marked as ${processForm.status}`);
      setProcessModal(null);
      setProcessForm({ status: 'in_progress', rejectionReason: '', letter: null });
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async (id) => {
    if (!confirm('Cancel this letter request?')) return;
    try {
      await api.delete(`/hr-letters/${id}`);
      toast.success('Cancelled');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed');
    }
  };

  const fmtDate = (iso) => iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

  return (
    <div className="p-6 max-w-5xl space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-bold text-slate-800">HR Letter Requests</h2>
        <button onClick={() => setModal(true)}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[12.5px] font-semibold px-3.5 py-1.5 rounded-md transition-colors">
          <Plus size={13}/> Request Letter
        </button>
      </div>

      {isAdmin && (
        <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit">
          {['My Requests', 'All (Admin)'].map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-4 py-1.5 rounded-md text-[12.5px] font-medium transition-all ${view === v ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
              {v}
            </button>
          ))}
        </div>
      )}

      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              {(view === 'All (Admin)' ? ['Employee','Letter Type','Purpose','Status','Processed','Letter','Actions'] : ['Letter Type','Purpose','Status','Requested','Letter','Actions']).map(h => (
                <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? (
              <tr><td colSpan={7} className="py-12 text-center text-[13px] text-slate-400">Loading…</td></tr>
            ) : records.length === 0 ? (
              <tr><td colSpan={7} className="py-14 text-center">
                <FileCheck size={32} className="text-slate-200 mx-auto mb-3"/>
                <p className="text-[13px] font-semibold text-slate-400">No requests yet</p>
                <p className="text-[12px] text-slate-300 mt-1">Click "Request Letter" to submit one</p>
              </td></tr>
            ) : records.map(r => (
              <tr key={r._id} className="hover:bg-slate-50 transition-colors">
                {view === 'All (Admin)' && (
                  <td className="px-4 py-3 text-[12.5px] text-slate-700">
                    {r.employee?.firstName} {r.employee?.lastName}
                    <span className="block text-[10.5px] text-slate-400">{r.employee?.department}</span>
                  </td>
                )}
                <td className="px-4 py-3 text-[12.5px] font-medium text-slate-800">{labelFor(r.letterType)}</td>
                <td className="px-4 py-3 text-[12.5px] text-slate-600 max-w-[200px] truncate" title={r.purpose}>{r.purpose || '—'}</td>
                <td className="px-4 py-3">
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLOR[r.status]}`}>{STATUS_LABEL[r.status] || r.status}</span>
                  {r.status === 'rejected' && r.rejectionReason && (
                    <p className="text-[10.5px] text-red-500 mt-0.5 max-w-[160px]" title={r.rejectionReason}>{r.rejectionReason}</p>
                  )}
                </td>
                <td className="px-4 py-3 text-[12.5px] text-slate-600">
                  {view === 'All (Admin)' ? (r.processedBy ? `${r.processedBy.firstName} · ${fmtDate(r.processedAt)}` : '—') : fmtDate(r.createdAt)}
                </td>
                <td className="px-4 py-3 text-[12.5px]">
                  {r.letterUrl ? (
                    <a href={r.letterUrl} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1 text-blue-600 hover:underline font-medium">
                      <Download size={12}/> Download
                    </a>
                  ) : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-4 py-3">
                  {view === 'All (Admin)' && isAdmin ? (
                    r.status === 'issued' || r.status === 'rejected' ? (
                      <span className="text-slate-300">—</span>
                    ) : (
                      <button onClick={() => { setProcessModal(r); setProcessForm({ status: 'in_progress', rejectionReason: '', letter: null }); }}
                        className="text-[11.5px] font-semibold text-blue-600 hover:underline">
                        Process
                      </button>
                    )
                  ) : r.status === 'requested' ? (
                    <button onClick={() => handleCancel(r._id)} title="Cancel"
                      className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500"><Trash2 size={13}/></button>
                  ) : <span className="text-slate-300">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Request modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <div className="flex items-center gap-2"><FileCheck size={16} className="text-blue-500"/><h3 className="font-semibold text-slate-800">Request Letter</h3></div>
              <button onClick={() => setModal(false)} className="text-slate-400 hover:text-slate-600"><X size={16}/></button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Letter Type *</label>
                <select value={form.letterType} onChange={e => setForm({ ...form, letterType: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[12.5px] focus:outline-none focus:border-blue-400">
                  {LETTER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Purpose / Reason</label>
                <textarea rows={3} value={form.purpose}
                  onChange={e => setForm({ ...form, purpose: e.target.value })}
                  placeholder="e.g., bank loan application, visa, address change…"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[12.5px] focus:outline-none focus:border-blue-400 resize-none"/>
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setModal(false)} className="flex-1 border border-slate-200 text-slate-600 py-2 rounded-lg text-[12.5px] font-medium hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={saving} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-[12.5px] font-semibold disabled:opacity-60">
                  {saving ? 'Submitting…' : 'Submit Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Admin Process modal */}
      {processModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <div className="flex items-center gap-2"><FileCheck size={16} className="text-blue-500"/><h3 className="font-semibold text-slate-800">Process Request</h3></div>
              <button onClick={() => setProcessModal(null)} className="text-slate-400 hover:text-slate-600"><X size={16}/></button>
            </div>
            <form onSubmit={handleProcess} className="p-5 space-y-4">
              <div className="bg-slate-50 rounded-lg p-3 text-[12.5px]">
                <p><span className="text-slate-500">For: </span><span className="font-semibold">{processModal.employee?.firstName} {processModal.employee?.lastName}</span></p>
                <p><span className="text-slate-500">Type: </span>{labelFor(processModal.letterType)}</p>
                {processModal.purpose && <p className="text-slate-600 mt-1 italic">"{processModal.purpose}"</p>}
              </div>
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Status *</label>
                <select value={processForm.status}
                  onChange={e => setProcessForm({ ...processForm, status: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[12.5px] focus:outline-none focus:border-blue-400">
                  <option value="in_progress">In Progress</option>
                  <option value="issued">Issued</option>
                  <option value="rejected">Rejected</option>
                </select>
              </div>
              {processForm.status === 'rejected' && (
                <div>
                  <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Rejection Reason</label>
                  <textarea rows={2} required value={processForm.rejectionReason}
                    onChange={e => setProcessForm({ ...processForm, rejectionReason: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[12.5px] focus:outline-none focus:border-blue-400 resize-none"/>
                </div>
              )}
              {processForm.status === 'issued' && (
                <div>
                  <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Signed Letter <span className="text-slate-400 font-normal">(PDF/DOC, max 10MB)</span></label>
                  <label className="border-2 border-dashed border-slate-200 rounded-lg p-4 text-center hover:border-blue-300 transition-colors cursor-pointer block">
                    {processForm.letter ? (
                      <div><FileText size={20} className="text-blue-500 mx-auto mb-1"/><p className="text-[12px] font-medium text-slate-700">{processForm.letter.name}</p></div>
                    ) : (
                      <div><Upload size={20} className="text-slate-300 mx-auto mb-1"/><p className="text-[12px] text-slate-400">Click to attach signed letter</p></div>
                    )}
                    <input type="file" className="hidden" accept=".pdf,.doc,.docx"
                      onChange={e => setProcessForm({ ...processForm, letter: e.target.files[0] })}/>
                  </label>
                </div>
              )}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setProcessModal(null)} className="flex-1 border border-slate-200 text-slate-600 py-2 rounded-lg text-[12.5px] font-medium hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={saving} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-[12.5px] font-semibold disabled:opacity-60">
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
