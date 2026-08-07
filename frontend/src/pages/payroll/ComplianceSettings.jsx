/**
 * Payroll → Compliance Settings (admin)
 * Versioned PF/ESI/Professional Tax rates. Every save creates a new
 * effective-dated row rather than editing in place, so past payroll runs
 * stay reproducible against whatever rates were actually in force then.
 */
import React, { useEffect, useState } from 'react';
import { Save, History, Plus, Trash2 } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';

function emptySlabState() {
  return [{ state: '', slabs: [{ upTo: '', amountPerMonth: 0 }] }];
}

export default function ComplianceSettings() {
  const [current, setCurrent] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const [pfRatePct, setPfRatePct] = useState('12');
  const [pfWageCeiling, setPfWageCeiling] = useState('15000');
  const [esiEmployeeRatePct, setEsiEmployeeRatePct] = useState('0.75');
  const [esiEmployerRatePct, setEsiEmployerRatePct] = useState('3.25');
  const [esiThreshold, setEsiThreshold] = useState('21000');
  const [ptSlabs, setPtSlabs] = useState(emptySlabState());
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toLocaleDateString('en-CA'));

  const load = () => {
    setLoading(true);
    Promise.all([api.get('/payroll/compliance-settings'), api.get('/payroll/compliance-settings/history')])
      .then(([curRes, histRes]) => {
        const c = curRes.data.data;
        if (c) {
          setCurrent(c);
          setPfRatePct(String(Number(c.pfRate) * 100));
          setPfWageCeiling(String(c.pfWageCeiling));
          setEsiEmployeeRatePct(String(Number(c.esiEmployeeRate) * 100));
          setEsiEmployerRatePct(String(Number(c.esiEmployerRate) * 100));
          setEsiThreshold(String(c.esiThreshold));
          setPtSlabs(c.ptSlabs?.length ? c.ptSlabs : emptySlabState());
        }
        setHistory(histRes.data.data || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const addState = () => setPtSlabs(s => [...s, { state: '', slabs: [{ upTo: '', amountPerMonth: 0 }] }]);
  const removeState = (i) => setPtSlabs(s => s.filter((_, idx) => idx !== i));
  const setStateName = (i, v) => setPtSlabs(s => s.map((st, idx) => idx === i ? { ...st, state: v } : st));
  const addSlab = (si) => setPtSlabs(s => s.map((st, idx) => idx === si ? { ...st, slabs: [...st.slabs, { upTo: '', amountPerMonth: 0 }] } : st));
  const removeSlab = (si, li) => setPtSlabs(s => s.map((st, idx) => idx === si ? { ...st, slabs: st.slabs.filter((_, j) => j !== li) } : st));
  const setSlabField = (si, li, key, v) => setPtSlabs(s => s.map((st, idx) => idx === si ? { ...st, slabs: st.slabs.map((sl, j) => j === li ? { ...sl, [key]: v } : sl) } : st));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const cleanSlabs = ptSlabs
        .filter(s => s.state.trim())
        .map(s => ({
          state: s.state.trim(),
          slabs: s.slabs.map(sl => ({ upTo: sl.upTo === '' ? null : Number(sl.upTo), amountPerMonth: Number(sl.amountPerMonth) || 0 })),
        }));
      await api.post('/payroll/compliance-settings', {
        pfRate: Number(pfRatePct) / 100,
        pfWageCeiling: Number(pfWageCeiling),
        esiEmployeeRate: Number(esiEmployeeRatePct) / 100,
        esiEmployerRate: Number(esiEmployerRatePct) / 100,
        esiThreshold: Number(esiThreshold),
        ptSlabs: cleanSlabs,
        effectiveFrom,
      });
      toast.success('Compliance settings saved — takes effect for payroll runs from this date onward');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Save failed');
    } finally { setSaving(false); }
  };

  if (loading) return <div className="max-w-3xl mx-auto p-6 text-center text-slate-400 py-16">Loading…</div>;

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[20px] font-bold text-slate-800">Payroll · Compliance Settings</h1>
          <p className="text-[15px] text-slate-500 mt-1">PF, ESI, and Professional Tax rates used across every payroll run.</p>
        </div>
        {history.length > 0 && (
          <button onClick={() => setShowHistory(s => !s)} className="flex items-center gap-1.5 text-[14px] text-slate-600 hover:text-slate-800 border border-slate-200 px-2.5 py-1.5 rounded-lg">
            <History size={13} /> History ({history.length})
          </button>
        )}
      </div>

      <form onSubmit={save} className="bg-white border border-slate-200 rounded-xl p-5 space-y-5">
        <div>
          <p className="text-[13px] font-bold text-slate-600 uppercase tracking-wider mb-3">Provident Fund</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="PF Rate (%)" value={pfRatePct} onChange={setPfRatePct} />
            <Field label="Wage Ceiling (₹)" value={pfWageCeiling} onChange={setPfWageCeiling} />
          </div>
        </div>
        <div>
          <p className="text-[13px] font-bold text-slate-600 uppercase tracking-wider mb-3">ESI</p>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Employee Rate (%)" value={esiEmployeeRatePct} onChange={setEsiEmployeeRatePct} />
            <Field label="Employer Rate (%)" value={esiEmployerRatePct} onChange={setEsiEmployerRatePct} />
            <Field label="Threshold (₹)" value={esiThreshold} onChange={setEsiThreshold} />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[13px] font-bold text-slate-600 uppercase tracking-wider">Professional Tax — per state</p>
            <button type="button" onClick={addState} className="text-blue-600 hover:text-blue-800"><Plus size={16} /></button>
          </div>
          <div className="space-y-3">
            {ptSlabs.map((s, si) => (
              <div key={si} className="border border-slate-200 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <input value={s.state} onChange={e => setStateName(si, e.target.value)} placeholder="State name"
                    className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-[14px] focus:outline-none focus:border-blue-400" />
                  <button type="button" onClick={() => removeState(si)} className="text-slate-400 hover:text-rose-600"><Trash2 size={14} /></button>
                </div>
                <div className="space-y-1.5">
                  {s.slabs.map((sl, li) => (
                    <div key={li} className="flex items-center gap-2 text-[13px]">
                      <span className="text-slate-400 w-24">Gross up to</span>
                      <input value={sl.upTo} onChange={e => setSlabField(si, li, 'upTo', e.target.value)} placeholder="unbounded"
                        className="w-28 border border-slate-200 rounded px-2 py-1 text-right" />
                      <span className="text-slate-400">PT/mo</span>
                      <input type="number" value={sl.amountPerMonth} onChange={e => setSlabField(si, li, 'amountPerMonth', e.target.value)}
                        className="w-24 border border-slate-200 rounded px-2 py-1 text-right" />
                      <button type="button" onClick={() => removeSlab(si, li)} className="text-slate-400 hover:text-rose-600"><Trash2 size={12} /></button>
                    </div>
                  ))}
                  <button type="button" onClick={() => addSlab(si)} className="text-[12px] text-blue-600 hover:underline">+ Add slab</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-[13px] font-medium text-slate-600 mb-1">Effective From</label>
          <input type="date" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-[15px]" />
        </div>

        <div className="flex justify-end pt-2 border-t border-slate-100">
          <button type="submit" disabled={saving} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-[15px] font-semibold disabled:opacity-60">
            <Save size={13} /> {saving ? 'Saving…' : 'Save New Version'}
          </button>
        </div>
      </form>

      {showHistory && history.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-[13px] font-bold text-slate-500 uppercase tracking-wider mb-2">Version History</p>
          <div className="space-y-2 text-[14px]">
            {history.map(h => (
              <div key={h.id} className="flex items-center justify-between bg-slate-50 rounded px-3 py-2">
                <span className="text-slate-600">{new Date(h.effectiveFrom).toLocaleDateString('en-GB')}</span>
                <span className="text-slate-700 font-mono">PF {(Number(h.pfRate) * 100).toFixed(2)}% · ESI {(Number(h.esiEmployeeRate) * 100).toFixed(2)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange }) {
  return (
    <div>
      <label className="block text-[13px] font-medium text-slate-600 mb-1">{label}</label>
      <input type="number" step="0.01" value={value} onChange={e => onChange(e.target.value)}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[15px] focus:outline-none focus:border-blue-400 text-right" />
    </div>
  );
}
