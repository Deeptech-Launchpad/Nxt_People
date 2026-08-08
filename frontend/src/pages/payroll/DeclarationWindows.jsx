/**
 * Payroll → Declaration Windows (admin)
 * Per-financial-year gate controlling whether employees can submit/revise
 * their tax declaration. isOpen is the quick toggle; opensAt/closesAt (if
 * set) are also actually enforced on submission.
 */
import React, { useEffect, useState } from 'react';
import { Plus, ToggleLeft, ToggleRight, X } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { currentFY, fmtDateTime } from './_shared';

const FY_PATTERN = /^\d{4}-\d{2}$/;

function WindowModal({ onClose, onSaved }) {
  const [financialYear, setFinancialYear] = useState(currentFY());
  const [isOpen, setIsOpen] = useState(true);
  const [opensAt, setOpensAt] = useState('');
  const [closesAt, setClosesAt] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    if (!FY_PATTERN.test(financialYear.trim())) {
      return toast.error('Financial year must be in the form YYYY-YY, e.g. 2026-27');
    }
    if (opensAt && closesAt && new Date(closesAt) <= new Date(opensAt)) {
      return toast.error('Closes At must be after Opens At');
    }
    setSaving(true);
    try {
      await api.post('/payroll/declaration-windows', {
        financialYear, isOpen,
        opensAt: opensAt ? new Date(opensAt).toISOString() : null,
        closesAt: closesAt ? new Date(closesAt).toISOString() : null,
      });
      toast.success('Window saved');
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Save failed');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-[17px] font-bold text-slate-800">Declaration Window</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600"><X size={16} /></button>
        </div>
        <form onSubmit={save} className="p-6 space-y-3">
          <div>
            <label className="block text-[13px] font-medium text-slate-600 mb-1">Financial Year</label>
            <input value={financialYear} onChange={e => setFinancialYear(e.target.value)} placeholder="2026-27" pattern="\d{4}-\d{2}" title="Format: YYYY-YY, e.g. 2026-27" required
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[15px] focus:outline-none focus:border-blue-400" />
          </div>
          <label className="flex items-center gap-2 text-[15px] text-slate-700 cursor-pointer select-none">
            <input type="checkbox" checked={isOpen} onChange={e => setIsOpen(e.target.checked)} className="rounded" /> Open for submission
          </label>
          <div>
            <label className="block text-[13px] font-medium text-slate-600 mb-1">Opens At (optional)</label>
            <input type="datetime-local" value={opensAt} onChange={e => setOpensAt(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[15px]" />
          </div>
          <div>
            <label className="block text-[13px] font-medium text-slate-600 mb-1">Closes At (optional)</label>
            <input type="datetime-local" value={closesAt} onChange={e => setClosesAt(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[15px]" />
          </div>
          <p className="text-[12px] text-slate-400">If Opens/Closes At are left blank, only the "Open for submission" toggle controls access.</p>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-slate-200 rounded-lg text-[15px] text-slate-600 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-[15px] font-semibold disabled:opacity-60">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// A window is only genuinely "open" right now if isOpen is true AND (when
// set) the current moment actually falls inside [opensAt, closesAt] — the
// toggle alone doesn't tell the whole story.
function isActuallyOpen(w) {
  if (!w.isOpen) return false;
  const now = new Date();
  if (w.opensAt && now < new Date(w.opensAt)) return false;
  if (w.closesAt && now > new Date(w.closesAt)) return false;
  return true;
}

export default function DeclarationWindows() {
  const [windows, setWindows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [togglingId, setTogglingId] = useState(null);

  const load = () => {
    setLoading(true);
    api.get('/payroll/declaration-windows')
      .then(r => setWindows(r.data.data || []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load declaration windows'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const toggle = async (id) => {
    if (togglingId) return;
    setTogglingId(id);
    try {
      await api.put(`/payroll/declaration-windows/${id}/toggle`);
      load();
    } catch (err) { toast.error(err.response?.data?.message || 'Toggle failed'); }
    finally { setTogglingId(null); }
  };

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[20px] font-bold text-slate-800">Payroll · Declaration Windows</h1>
          <p className="text-[15px] text-slate-500 mt-1">Control when employees can submit or revise their tax declaration, per financial year.</p>
        </div>
        <button onClick={() => setCreating(true)} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-[15px] font-semibold">
          <Plus size={14} /> New Window
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
        {loading ? (
          <div className="py-10 text-center text-slate-400">Loading…</div>
        ) : windows.length === 0 ? (
          <div className="py-12 text-center text-slate-400">No declaration windows configured yet.</div>
        ) : windows.map(w => {
          const open = isActuallyOpen(w);
          return (
          <div key={w.id} className="px-4 py-3 flex items-center justify-between">
            <div>
              <p className="font-semibold text-slate-800">FY {w.financialYear}</p>
              <p className="text-[13px] text-slate-500">
                {w.opensAt ? `Opens ${fmtDateTime(w.opensAt)}` : 'No open-date restriction'}
                {w.closesAt ? ` · Closes ${fmtDateTime(w.closesAt)}` : ''}
                {w.isOpen && !open && <span className="text-amber-600"> · toggle is on, but not accepting submissions right now</span>}
              </p>
            </div>
            <button onClick={() => toggle(w.id)} disabled={togglingId === w.id}
              className={`flex items-center gap-1.5 text-[14px] font-semibold px-3 py-1.5 rounded-lg disabled:opacity-60 ${open ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100' : 'text-slate-500 bg-slate-100 hover:bg-slate-200'}`}>
              {w.isOpen ? <ToggleRight size={16} /> : <ToggleLeft size={16} />} {w.isOpen ? 'Open' : 'Closed'}
            </button>
          </div>
          );
        })}
      </div>

      {creating && <WindowModal onClose={() => setCreating(false)} onSaved={load} />}
    </div>
  );
}
