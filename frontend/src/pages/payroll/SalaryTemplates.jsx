/**
 * Payroll → Salary Templates (admin)
 * Reusable named component sets (e.g. "L2 Engineer") applied to an
 * employee's annual CTC when setting up their structure. Each component is
 * either a flat monthly amount (fixed) or a percentage of annual CTC.
 */
import React, { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, X, Layers } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';

function TemplateModal({ template, onClose, onSaved }) {
  const [name, setName] = useState(template?.name || '');
  const [band, setBand] = useState(template?.band || '');
  const [components, setComponents] = useState(
    template?.components?.length ? template.components.map(c => ({ name: c.name, type: c.type, value: c.value }))
      : [{ name: 'Basic', type: 'percent_of_ctc', value: 40 }, { name: 'HRA', type: 'percent_of_ctc', value: 20 }]
  );
  const [saving, setSaving] = useState(false);

  const setComp = (i, key, v) => setComponents(cs => cs.map((c, idx) => idx === i ? { ...c, [key]: v } : c));
  const addComp = () => setComponents(cs => [...cs, { name: '', type: 'fixed', value: 0 }]);
  const removeComp = (i) => setComponents(cs => cs.filter((_, idx) => idx !== i));

  const save = async (e) => {
    e.preventDefault();
    if (!name.trim()) return toast.error('Template name is required');
    if (components.some(c => !c.name.trim())) return toast.error('Every component needs a name');
    setSaving(true);
    try {
      const body = { name: name.trim(), band: band.trim() || null, components };
      if (template) await api.put(`/payroll/templates/${template.id}`, body);
      else await api.post('/payroll/templates', body);
      toast.success('Template saved');
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Save failed');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-[17px] font-bold text-slate-800">{template ? 'Edit Template' : 'New Salary Template'}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600"><X size={16} /></button>
        </div>
        <form onSubmit={save} className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[13px] font-medium text-slate-600 mb-1">Name</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. L2 Engineer"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[15px] focus:outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-600 mb-1">Band (optional)</label>
              <input value={band} onChange={e => setBand(e.target.value)} placeholder="e.g. L2"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[15px] focus:outline-none focus:border-blue-400" />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[13px] font-bold text-slate-600 uppercase tracking-wider">Components</label>
              <button type="button" onClick={addComp} className="text-blue-600 hover:text-blue-800"><Plus size={16} /></button>
            </div>
            <p className="text-[13px] text-slate-400 mb-2">"Percent of CTC" values are percentage points of annual CTC (e.g. 40 = 40%). "Fixed" values are flat monthly amounts. Name a component "Basic", "HRA", or "Conveyance" to map it to those columns — anything else becomes an "other" component.</p>
            <div className="space-y-2">
              {components.map((c, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input value={c.name} onChange={e => setComp(i, 'name', e.target.value)} placeholder="Name"
                    className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-[14px] focus:outline-none focus:border-blue-400" />
                  <select value={c.type} onChange={e => setComp(i, 'type', e.target.value)}
                    className="border border-slate-200 rounded-lg px-2 py-1.5 text-[14px] bg-white">
                    <option value="percent_of_ctc">% of CTC</option>
                    <option value="fixed">Fixed ₹/mo</option>
                  </select>
                  <input type="number" value={c.value} onChange={e => setComp(i, 'value', Number(e.target.value) || 0)}
                    className="w-24 border border-slate-200 rounded-lg px-2 py-1.5 text-[14px] text-right focus:outline-none focus:border-blue-400" />
                  <button type="button" onClick={() => removeComp(i)} className="text-slate-400 hover:text-rose-600"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-slate-200 rounded-lg text-[15px] text-slate-600 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-[15px] font-semibold disabled:opacity-60">
              {saving ? 'Saving…' : 'Save Template'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function SalaryTemplates() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/payroll/templates').then(r => setTemplates(r.data.data || [])).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const remove = async (id) => {
    if (!confirm('Delete this template? Employees already using it keep their existing structure — only the "based on" link is lost.')) return;
    try {
      await api.delete(`/payroll/templates/${id}`);
      toast.success('Deleted');
      load();
    } catch (err) { toast.error(err.response?.data?.message || 'Delete failed'); }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[20px] font-bold text-slate-800">Payroll · Salary Templates</h1>
          <p className="text-[15px] text-slate-500 mt-1">Reusable component sets for quickly setting up new hires or standardizing bands.</p>
        </div>
        <button onClick={() => setCreating(true)} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-[15px] font-semibold">
          <Plus size={14} /> New Template
        </button>
      </div>

      {loading ? (
        <div className="py-16 text-center text-slate-400">Loading…</div>
      ) : templates.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl py-16 text-center text-slate-400">
          <Layers size={32} className="mx-auto text-slate-300 mb-2" />
          No templates yet. Create one to speed up salary setup.
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {templates.map(t => (
            <div key={t.id} className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-[16px] font-bold text-slate-800">{t.name}</h3>
                  {t.band && <p className="text-[13px] text-slate-400">{t.band}</p>}
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setEditing(t)} className="w-7 h-7 flex items-center justify-center rounded text-slate-500 hover:bg-slate-100"><Pencil size={13} /></button>
                  <button onClick={() => remove(t.id)} className="w-7 h-7 flex items-center justify-center rounded text-rose-500 hover:bg-rose-50"><Trash2 size={13} /></button>
                </div>
              </div>
              <div className="mt-2 space-y-1 text-[13px] text-slate-500">
                {t.components.map((c, i) => (
                  <div key={i} className="flex justify-between">
                    <span>{c.name}</span>
                    <span className="font-mono">{c.type === 'percent_of_ctc' ? `${c.value}% of CTC` : `₹${c.value}/mo`}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <TemplateModal template={editing} onClose={() => { setCreating(false); setEditing(null); }} onSaved={load} />
      )}
    </div>
  );
}
