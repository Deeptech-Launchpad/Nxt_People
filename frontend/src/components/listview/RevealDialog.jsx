import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { X, Eye, ShieldAlert } from 'lucide-react';
import api from '../../utils/api';

/* "Show masked data".
 *
 * The list never carries identity numbers — it only says whether one is on
 * file — so revealing them is a fresh, deliberate request rather than
 * unhiding something the browser already had.
 *
 * Every reveal writes an audit row naming who looked, at whom, and why. The
 * dialog says so before the button, because somebody about to read fifty
 * people's Aadhaar numbers should know it is recorded.
 */
export default function RevealDialog({ employeeIds, onClose, onRevealed }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const reveal = async () => {
    setBusy(true);
    try {
      const r = await api.post('/employee-io/reveal', { employeeIds, reason: reason.trim() });
      onRevealed(r.data.data || []);
      toast.success(`Revealed for ${r.data.data?.length || 0} employee(s)`);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not reveal those numbers');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl p-6">
        <h3 className="font-display font-semibold text-slate-800 text-xl flex items-center gap-2">
          <Eye size={19} /> Show masked data
        </h3>
        <p className="text-[15px] text-slate-500 mt-2">
          Aadhaar, PAN and UAN for the {employeeIds.length} row(s) on this page.
        </p>
        <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-100 rounded-xl px-3.5 py-2.5 mt-3">
          <ShieldAlert size={17} className="text-amber-600 mt-0.5 flex-shrink-0" />
          <p className="text-[13.5px] text-amber-800">
            This is recorded in the audit trail with your name and who you looked at.
          </p>
        </div>
        <label className="block text-[14px] font-medium text-slate-600 mt-4 mb-1.5">Reason (optional)</label>
        <input value={reason} onChange={e => setReason(e.target.value)}
          placeholder="e.g. payroll verification"
          className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-[15px] focus:outline-none focus:border-brand-400" />
        <div className="flex gap-3 mt-5">
          <button onClick={onClose}
            className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-[15px] font-medium hover:bg-slate-50">
            Cancel
          </button>
          <button onClick={reveal} disabled={busy}
            className="flex-1 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white py-2.5 rounded-xl text-[15px] font-medium">
            {busy ? 'Revealing…' : 'Reveal'}
          </button>
        </div>
      </div>
    </div>
  );
}
