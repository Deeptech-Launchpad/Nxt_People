/**
 * Payroll → Salary Setup (admin only)
 *
 * Admin sees active employees with their current monthly gross + annual
 * CTC; Edit opens a modal to set up/revise a structure two ways: Custom
 * (type basic/HRA/conveyance + any number of named "other" components
 * directly) or From Template (pick a reusable template, type an annual
 * CTC, the template's FIXED/PERCENT_OF_CTC split fills the rest). PF/ESI/
 * Professional Tax are no longer typed in — they're computed from
 * Compliance Settings at generation time; this modal shows a live preview
 * using the same rates, with optional per-employee overrides.
 */
import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Search, Pencil, History, X, IndianRupee, Info, Upload, Download, FileSpreadsheet, Plus, Trash2 } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';

const fmtINR = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(n) || 0);

// Mirrors utils/payroll-calc.js's formulas for a live client-side preview —
// the server is still the source of truth at generation time; this is a
// convenience so the admin isn't setting up a structure blind.
function previewDeductions({ basic, gross, state, pfApplicable, esiApplicable, pfOverride, esiOverride, ptOverride, settings }) {
  if (!settings) return { pf: 0, esi: 0, pt: 0, employerPf: 0, employerEsi: 0 };
  const pf = pfOverride !== '' && pfOverride != null ? Number(pfOverride)
    : pfApplicable ? Math.round(Math.min(basic, settings.pfWageCeiling) * settings.pfRate * 100) / 100 : 0;
  const esi = esiOverride !== '' && esiOverride != null ? Number(esiOverride)
    : (esiApplicable && gross <= settings.esiThreshold) ? Math.round(gross * settings.esiEmployeeRate * 100) / 100 : 0;
  let pt = ptOverride !== '' && ptOverride != null ? Number(ptOverride) : 0;
  if ((ptOverride === '' || ptOverride == null) && Array.isArray(settings.ptSlabs)) {
    const stateSlabs = settings.ptSlabs.find(s => String(s.state || '').toLowerCase() === String(state || '').toLowerCase());
    if (stateSlabs?.slabs?.length) {
      const sorted = [...stateSlabs.slabs].sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));
      const match = sorted.find(s => s.upTo == null || gross <= s.upTo);
      pt = match ? Number(match.amountPerMonth) : 0;
    }
  }
  const employerPfTotal = pfApplicable ? Math.round(Math.min(basic, settings.pfWageCeiling) * settings.pfRate * 100) / 100 : 0;
  const employerEsi = (esiApplicable && gross <= settings.esiThreshold) ? Math.round(gross * settings.esiEmployerRate * 100) / 100 : 0;
  return { pf, esi, pt, employerPf: employerPfTotal, employerEsi };
}

function StructureModal({ employee, onClose, onSaved }) {
  const [mode, setMode] = useState('custom');
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [ctcAnnual, setCtcAnnual] = useState('');
  const [templatePreview, setTemplatePreview] = useState(null);
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState({
    basic: 0, hra: 0, conveyance: 0, otherComponents: [],
    pfApplicable: true, esiApplicable: false,
    pfOverride: '', esiOverride: '', ptOverride: '', notes: '',
  });
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    if (!employee?._id) return;
    setLoading(true);
    Promise.all([
      api.get(`/payroll/admin/employees/${employee._id}/structure`),
      api.get('/payroll/templates'),
      api.get('/payroll/compliance-settings'),
    ]).then(([structRes, tplRes, settingsRes]) => {
      const cur = structRes.data.data?.current;
      if (cur) {
        setForm({
          basic: cur.basic || 0, hra: cur.hra || 0, conveyance: cur.conveyance || 0,
          otherComponents: Array.isArray(cur.otherComponents) ? cur.otherComponents : [],
          pfApplicable: cur.pfApplicable !== false, esiApplicable: !!cur.esiApplicable,
          pfOverride: cur.pfOverride ?? '', esiOverride: cur.esiOverride ?? '', ptOverride: cur.ptOverride ?? '',
          notes: cur.notes || '',
        });
      }
      setHistory(structRes.data.data?.history || []);
      setTemplates(tplRes.data.data || []);
      setSettings(settingsRes.data.data);
    }).catch(err => toast.error(err.response?.data?.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [employee?._id]);

  useEffect(() => {
    if (mode !== 'template' || !templateId || !ctcAnnual) { setTemplatePreview(null); return; }
    api.post(`/payroll/templates/${templateId}/apply-preview`, { ctcAnnual: Number(ctcAnnual) })
      .then(r => setTemplatePreview(r.data.data))
      .catch(() => setTemplatePreview(null));
  }, [mode, templateId, ctcAnnual]);

  const effective = mode === 'template' && templatePreview ? templatePreview : form;
  const otherTotal = (effective.otherComponents || []).reduce((s, c) => s + (Number(c.value) || 0), 0);
  const gross = Number(effective.basic || 0) + Number(effective.hra || 0) + Number(effective.conveyance || 0) + otherTotal;
  const ded = useMemo(() => previewDeductions({
    basic: Number(effective.basic || 0), gross, state: employee.state,
    pfApplicable: form.pfApplicable, esiApplicable: form.esiApplicable,
    pfOverride: form.pfOverride, esiOverride: form.esiOverride, ptOverride: form.ptOverride, settings,
  }), [effective, gross, form.pfApplicable, form.esiApplicable, form.pfOverride, form.esiOverride, form.ptOverride, settings, employee.state]);
  const totals = {
    gross, ded: ded.pf + ded.esi + ded.pt, net: gross - (ded.pf + ded.esi + ded.pt),
    ctc: mode === 'template' && ctcAnnual ? Number(ctcAnnual) : gross * 12 + ded.employerPf * 12,
  };

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setOther = (i, key, v) => setForm(f => ({ ...f, otherComponents: f.otherComponents.map((c, idx) => idx === i ? { ...c, [key]: v } : c) }));
  const addOther = () => setForm(f => ({ ...f, otherComponents: [...f.otherComponents, { name: '', value: 0 }] }));
  const removeOther = (i) => setForm(f => ({ ...f, otherComponents: f.otherComponents.filter((_, idx) => idx !== i) }));

  const onSave = async (e) => {
    e?.preventDefault();
    setSaving(true);
    try {
      const body = mode === 'template'
        ? { mode: 'template', templateId, ctcAnnual: Number(ctcAnnual), pfApplicable: form.pfApplicable, esiApplicable: form.esiApplicable,
            pfOverride: form.pfOverride === '' ? null : Number(form.pfOverride),
            esiOverride: form.esiOverride === '' ? null : Number(form.esiOverride),
            ptOverride: form.ptOverride === '' ? null : Number(form.ptOverride), notes: form.notes }
        : { mode: 'custom', basic: form.basic, hra: form.hra, conveyance: form.conveyance, otherComponents: form.otherComponents,
            pfApplicable: form.pfApplicable, esiApplicable: form.esiApplicable,
            pfOverride: form.pfOverride === '' ? null : Number(form.pfOverride),
            esiOverride: form.esiOverride === '' ? null : Number(form.esiOverride),
            ptOverride: form.ptOverride === '' ? null : Number(form.ptOverride), notes: form.notes };
      const r = await api.put(`/payroll/admin/employees/${employee._id}/structure`, body);
      toast.success('Salary structure saved');
      onSaved?.(r.data.data);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Save failed');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <div>
            <h3 className="text-[17px] font-bold text-slate-800">Salary Structure</h3>
            <p className="text-[14px] text-slate-500 mt-0.5">
              {employee.firstName} {employee.lastName}
              {employee.employeeId && <span className="font-mono text-slate-400 ml-2">{employee.employeeId}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {history.length > 0 && (
              <button type="button" onClick={() => setShowHistory(s => !s)}
                className="flex items-center gap-1.5 text-[14px] text-slate-600 hover:text-slate-800 border border-slate-200 px-2.5 py-1.5 rounded-lg">
                <History size={13} /> History ({history.length})
              </button>
            )}
            <button onClick={onClose} className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600">
              <X size={16} />
            </button>
          </div>
        </div>

        <form onSubmit={onSave} className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-20"><div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
          ) : (
            <div className="p-6 space-y-5">
              <div className="flex gap-2">
                <button type="button" onClick={() => setMode('custom')}
                  className={`flex-1 py-2 rounded-lg text-[14px] font-semibold border ${mode === 'custom' ? 'bg-blue-50 border-blue-400 text-blue-700' : 'border-slate-200 text-slate-500'}`}>
                  Custom Entry
                </button>
                <button type="button" onClick={() => setMode('template')}
                  className={`flex-1 py-2 rounded-lg text-[14px] font-semibold border ${mode === 'template' ? 'bg-blue-50 border-blue-400 text-blue-700' : 'border-slate-200 text-slate-500'}`}>
                  From Template
                </button>
              </div>

              {mode === 'template' ? (
                <div className="space-y-3">
                  <div>
                    <label className="block text-[13px] font-medium text-slate-600 mb-1">Template</label>
                    <select value={templateId} onChange={e => setTemplateId(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[15px] focus:outline-none focus:border-blue-400">
                      <option value="">Select a template…</option>
                      {templates.map(t => <option key={t.id} value={t.id}>{t.name}{t.band ? ` (${t.band})` : ''}</option>)}
                    </select>
                    {templates.length === 0 && <p className="text-[13px] text-amber-600 mt-1">No templates yet — create one under Payroll → Templates.</p>}
                  </div>
                  <FieldRow label="Annual CTC" hint="Total annual cost to company" value={ctcAnnual} onChange={setCtcAnnual} />
                  {templatePreview && (
                    <div className="bg-slate-50 rounded-lg p-3 text-[14px] space-y-1">
                      <p className="font-semibold text-slate-600 mb-1">Preview (monthly)</p>
                      <Line k="Basic" v={fmtINR(templatePreview.basic)} />
                      <Line k="HRA" v={fmtINR(templatePreview.hra)} />
                      <Line k="Conveyance" v={fmtINR(templatePreview.conveyance)} />
                      {(templatePreview.otherComponents || []).map((c, i) => <Line key={i} k={c.name} v={fmtINR(c.value)} />)}
                    </div>
                  )}
                </div>
              ) : (
                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <p className="text-[13px] font-bold text-emerald-700 uppercase tracking-wider mb-3">Monthly Earnings</p>
                    <div className="space-y-3">
                      <FieldRow label="Basic" hint="Typically 30–50% of CTC" value={form.basic} onChange={v => set('basic', v)} />
                      <FieldRow label="HRA" hint="House Rent Allowance" value={form.hra} onChange={v => set('hra', v)} />
                      <FieldRow label="Conveyance" hint="₹1,600/month is tax-free" value={form.conveyance} onChange={v => set('conveyance', v)} />
                    </div>
                    <div className="mt-4">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[13px] font-bold text-slate-600 uppercase tracking-wider">Other Components</p>
                        <button type="button" onClick={addOther} className="text-blue-600 hover:text-blue-800"><Plus size={16} /></button>
                      </div>
                      <div className="space-y-2">
                        {form.otherComponents.map((c, i) => (
                          <div key={i} className="flex gap-2 items-center">
                            <input value={c.name} onChange={e => setOther(i, 'name', e.target.value)} placeholder="e.g. Medical"
                              className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-[14px] focus:outline-none focus:border-blue-400" />
                            <input type="number" min={0} value={c.value} onChange={e => setOther(i, 'value', Number(e.target.value) || 0)}
                              className="w-28 border border-slate-200 rounded-lg px-2 py-1.5 text-[14px] text-right focus:outline-none focus:border-blue-400" />
                            <button type="button" onClick={() => removeOther(i)} className="text-slate-400 hover:text-rose-600"><Trash2 size={14} /></button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div>
                    <p className="text-[13px] font-bold text-red-700 uppercase tracking-wider mb-3">Deductions (computed — override optional)</p>
                    <div className="space-y-3">
                      <PreviewRow label="PF (Employee)" preview={ded.pf} override={form.pfOverride} onChange={v => set('pfOverride', v)} />
                      <PreviewRow label="ESI (Employee)" preview={ded.esi} override={form.esiOverride} onChange={v => set('esiOverride', v)} />
                      <PreviewRow label="Professional Tax" preview={ded.pt} override={form.ptOverride} onChange={v => set('ptOverride', v)} />
                    </div>
                    <p className="text-[13px] font-bold text-slate-600 uppercase tracking-wider mt-6 mb-3">Eligibility</p>
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 text-[15px] text-slate-700 cursor-pointer select-none">
                        <input type="checkbox" checked={form.pfApplicable} onChange={e => set('pfApplicable', e.target.checked)} className="rounded" /> PF applicable
                      </label>
                      <label className="flex items-center gap-2 text-[15px] text-slate-700 cursor-pointer select-none">
                        <input type="checkbox" checked={form.esiApplicable} onChange={e => set('esiApplicable', e.target.checked)} className="rounded" /> ESI applicable
                      </label>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-[13px] font-medium text-slate-600 mb-1.5">Notes (optional)</label>
                <textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)}
                  placeholder="e.g. Effective from next payroll cycle, post-appraisal hike, etc."
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[15px] focus:outline-none focus:border-blue-400 resize-none" />
              </div>

              <div className="bg-slate-50 rounded-xl p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                <Totals label="Monthly Gross" value={totals.gross} color="text-slate-800" />
                <Totals label="Deductions" value={totals.ded} color="text-red-600" />
                <Totals label="Take-Home" value={totals.net} color="text-emerald-700" />
                <Totals label="Annual CTC" value={totals.ctc} color="text-blue-700" emphasis />
              </div>

              {showHistory && history.length > 0 && (
                <div className="border-t border-slate-100 pt-4">
                  <p className="text-[13px] font-bold text-slate-500 uppercase tracking-wider mb-2">Recent Changes</p>
                  <div className="space-y-2 text-[14px]">
                    {history.map(h => (
                      <div key={h.id} className="flex items-center justify-between bg-slate-50 rounded px-3 py-2">
                        <span className="font-medium text-slate-600">{new Date(h.effectiveFrom).toLocaleDateString('en-GB')}</span>
                        <span className="text-slate-700 font-semibold">{fmtINR(h.monthlyGross)} / mo</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-slate-100">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-slate-200 rounded-lg text-[15px] text-slate-600 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving || loading || (mode === 'template' && !templateId)}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-[15px] font-semibold disabled:opacity-60">
              {saving ? 'Saving…' : 'Save Structure'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FieldRow({ label, hint, value, onChange }) {
  return (
    <div>
      <label className="flex items-center justify-between text-[14px] text-slate-600 mb-1">
        <span>{label}</span>
        {hint && <span title={hint} className="text-slate-300 hover:text-slate-500 cursor-help"><Info size={11} /></span>}
      </label>
      <div className="relative">
        <IndianRupee size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input type="number" min={0} step="0.01" value={value || 0}
          onChange={e => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
          className="w-full pl-7 pr-3 py-1.5 border border-slate-200 rounded-lg text-[15px] focus:outline-none focus:border-blue-400 text-right" />
      </div>
    </div>
  );
}

function PreviewRow({ label, preview, override, onChange }) {
  return (
    <div>
      <label className="flex items-center justify-between text-[14px] text-slate-600 mb-1">
        <span>{label}</span>
        <span className="text-[12px] text-slate-400">computed: {fmtINR(preview)}</span>
      </label>
      <div className="relative">
        <IndianRupee size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input type="number" min={0} step="0.01" value={override} placeholder="auto"
          onChange={e => onChange(e.target.value)}
          className="w-full pl-7 pr-3 py-1.5 border border-slate-200 rounded-lg text-[15px] focus:outline-none focus:border-blue-400 text-right" />
      </div>
    </div>
  );
}

function Totals({ label, value, color, emphasis }) {
  return (
    <div>
      <p className="text-[12px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`text-[17px] font-bold ${color} ${emphasis ? 'text-[18px]' : ''}`}>{fmtINR(value)}</p>
    </div>
  );
}
function Line({ k, v, c = 'text-slate-700' }) {
  return <div className="flex items-center justify-between"><span className="text-slate-500">{k}</span><span className={`font-bold ${c}`}>{v}</span></div>;
}

/* ── Page ──────────────────────────────────────────────────────────────── */
export default function PayrollSetup() {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);

  const load = () => {
    setLoading(true);
    api.get('/payroll/admin/employees')
      .then(r => setEmployees(r.data.data || []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load employees'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const filtered = employees.filter(e => {
    if (!search) return true;
    const q = search.toLowerCase();
    return `${e.firstName || ''} ${e.lastName || ''}`.toLowerCase().includes(q)
        || (e.employeeId || '').toLowerCase().includes(q)
        || (e.designation || '').toLowerCase().includes(q)
        || (e.department || '').toLowerCase().includes(q);
  });

  const stats = useMemo(() => {
    const withStructure = employees.filter(e => e.structure);
    const totalCTC = withStructure.reduce((s, e) => s + (e.structure?.ctcAnnual || 0), 0);
    return { total: employees.length, configured: withStructure.length, pending: employees.length - withStructure.length, totalCTC };
  }, [employees]);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-5">
      <div>
        <h1 className="text-[20px] font-bold text-slate-800">Payroll · Salary Setup</h1>
        <p className="text-[15px] text-slate-500 mt-1">Set up each employee's salary — custom entry or from a reusable template.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Employees" value={stats.total} />
        <StatCard label="Structure Set" value={stats.configured} color="text-emerald-700" />
        <StatCard label="Pending Setup" value={stats.pending} color={stats.pending > 0 ? 'text-amber-700' : 'text-slate-500'} />
        <StatCard label="Annual Payroll" value={fmtINR(stats.totalCTC)} color="text-blue-700" small />
      </div>

      <div className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-4 py-3 flex-wrap gap-3">
        <div className="relative w-72">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="text" placeholder="Search by name / ID / role / dept" value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-[15px] focus:outline-none focus:border-blue-400" />
        </div>
        <div className="flex items-center gap-2">
          <BulkUpload onDone={load} />
          <p className="text-[13px] text-slate-500 ml-2">Showing {filtered.length} of {employees.length}</p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-left text-[15px]">
          <thead className="bg-slate-50 text-[13px] font-bold text-slate-600 uppercase tracking-wider">
            <tr>
              <th className="px-4 py-2.5">Employee</th>
              <th className="px-4 py-2.5">Designation</th>
              <th className="px-4 py-2.5 text-right">Monthly Gross</th>
              <th className="px-4 py-2.5 text-right">Annual CTC</th>
              <th className="px-4 py-2.5 w-20"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={5} className="py-10 text-center text-slate-400">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} className="py-10 text-center text-slate-400">No employees match the filter.</td></tr>
            ) : filtered.map(emp => (
              <tr key={emp._id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="font-semibold text-slate-800">{emp.firstName} {emp.lastName}</div>
                  <div className="text-[13px] text-slate-400 font-mono">{emp.employeeId}</div>
                </td>
                <td className="px-4 py-3 text-slate-600">
                  <div>{emp.designation || '—'}</div>
                  <div className="text-[13px] text-slate-400">{emp.department || ''}</div>
                </td>
                <td className="px-4 py-3 text-right font-medium text-slate-700">
                  {emp.structure ? fmtINR(emp.structure.monthlyGross) : <span className="text-amber-600 text-[13px]">Not set up</span>}
                </td>
                <td className="px-4 py-3 text-right font-semibold text-blue-700">{emp.structure ? fmtINR(emp.structure.ctcAnnual) : '—'}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => setEditing(emp)} className="inline-flex items-center gap-1 text-[14px] font-semibold text-blue-600 hover:text-blue-800">
                    <Pencil size={12} /> Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && <StructureModal employee={editing} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  );
}

function StatCard({ label, value, color = 'text-slate-800', small }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3">
      <p className="text-[12px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`mt-1 font-bold ${color} ${small ? 'text-[17px]' : 'text-[20px]'}`}>{value}</p>
    </div>
  );
}

function BulkUpload({ onDone }) {
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);

  const downloadTemplate = async () => {
    try {
      const r = await api.get('/payroll/admin/structure-template', { responseType: 'blob' });
      const u = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = u; a.download = 'salary_structure_template.xlsx'; a.click();
      URL.revokeObjectURL(u);
    } catch (err) { toast.error(err.response?.data?.message || 'Template download failed'); }
  };

  const handleFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const r = await api.post('/payroll/admin/bulk-upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setResult(r.data.results);
      toast.success(`Processed ${r.data.results.processed} rows · ${r.data.results.succeeded} updated`);
      onDone?.();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Upload failed');
    } finally { setUploading(false); e.target.value = ''; }
  };

  return (
    <>
      <button onClick={downloadTemplate} title="Download xlsx template"
        className="flex items-center gap-1.5 border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 px-2.5 py-1.5 rounded-lg text-[14px] font-semibold">
        <Download size={12} /> Template
      </button>
      <button onClick={() => fileRef.current?.click()} disabled={uploading}
        title="Upload a filled template — each row updates one employee's structure"
        className="flex items-center gap-1.5 border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 px-2.5 py-1.5 rounded-lg text-[14px] font-semibold disabled:opacity-60">
        <Upload size={12} /> {uploading ? 'Uploading…' : 'Bulk Upload'}
      </button>
      <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleFile} className="hidden" />
      {result && (
        <div className="absolute z-50 right-6 top-32 bg-white border border-slate-200 rounded-xl shadow-2xl p-4 w-80">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[15px] font-bold text-slate-800 flex items-center gap-2"><FileSpreadsheet size={14} className="text-emerald-600" /> Upload summary</p>
            <button onClick={() => setResult(null)} className="text-slate-400 hover:text-slate-600">✕</button>
          </div>
          <div className="space-y-1 text-[14px]">
            <Line k="Processed" v={result.processed} />
            <Line k="Succeeded" v={result.succeeded} c="text-emerald-700" />
            <Line k="Not found" v={result.notFound?.length || 0} c={result.notFound?.length ? 'text-amber-700' : 'text-slate-500'} />
            <Line k="Errors" v={result.failed?.length || 0} c={result.failed?.length ? 'text-rose-700' : 'text-slate-500'} />
          </div>
          {result.notFound?.length > 0 && (
            <details className="mt-2 text-[13px] text-slate-500">
              <summary className="cursor-pointer">Show missing IDs ({result.notFound.length})</summary>
              <p className="font-mono mt-1 break-words">{result.notFound.join(', ')}</p>
            </details>
          )}
        </div>
      )}
    </>
  );
}
