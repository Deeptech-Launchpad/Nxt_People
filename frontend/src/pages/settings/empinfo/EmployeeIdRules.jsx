import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, X, Pencil, Trash2, GripVertical } from 'lucide-react';
import api from '../../../utils/api';

/* Settings -> Employee Information -> Policy -> Employee ID.
 *
 * An ID is [prefix segments] + a zero-padded counter + [suffix segments].
 * A segment is either a literal or a field resolved from the employee being
 * created, which is what lets ANXT2600164 be described as "ANXT" + joining
 * year + counter rather than hard-coded in a helper.
 *
 * The preview comes from the SERVER, using the same function that generates
 * the real ID. A preview computed separately in the browser is a second
 * implementation that will eventually disagree with the first, and it would
 * disagree silently.
 */
const COLORS = ['#38bdf8', '#a78bfa', '#34d399', '#fbbf24', '#f87171', '#f472b6', '#94a3b8'];
const input = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-[14.5px] focus:outline-none focus:border-brand-400';

function SegmentBox({ label, segments, onChange, fields }) {
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState('custom');
  const [value, setValue] = useState('');

  const add = () => {
    const v = kind === 'custom' ? value.trim() : value;
    if (!v) return;
    onChange([...segments, { type: kind, value: v }]);
    setValue(''); setAdding(false);
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[14px] font-medium text-slate-700">{label}</span>
        <button onClick={() => { setAdding(true); setKind('custom'); setValue(''); }}
          className="w-6 h-6 flex items-center justify-center border border-brand-300 rounded text-brand-600 hover:bg-brand-50">
          <Plus size={13} />
        </button>
      </div>

      <div className="border-2 border-dashed border-slate-200 rounded-lg p-3 min-h-[76px] flex flex-wrap gap-2 items-start">
        {segments.length === 0 && !adding && (
          <span className="text-[13.5px] text-slate-300">No {label.toLowerCase()} segments</span>
        )}
        {segments.map((s, i) => (
          <span key={i}
            title={s.type === 'field' ? (fields.find(f => f.value === s.value)?.label || s.value) : 'Literal text'}
            className="inline-flex items-center gap-1.5 bg-slate-100 rounded px-2 py-1 text-[13.5px] text-slate-700">
            <GripVertical size={11} className="text-slate-400" />
            {s.type === 'field'
              ? <span className="text-brand-700">{fields.find(f => f.value === s.value)?.label || s.value}</span>
              : s.value}
            <button onClick={() => onChange(segments.filter((_, j) => j !== i))}
              className="text-slate-400 hover:text-rose-600"><X size={12} /></button>
          </span>
        ))}

        {adding && (
          <div className="w-full flex flex-wrap gap-2 items-center">
            <select className="border border-slate-200 rounded px-2 py-1 text-[13.5px] focus:outline-none"
              value={kind} onChange={e => { setKind(e.target.value); setValue(''); }}>
              <option value="custom">Custom text</option>
              <option value="field">Field</option>
            </select>
            {kind === 'custom' ? (
              <input autoFocus className="border border-slate-200 rounded px-2 py-1 text-[13.5px] focus:outline-none focus:border-brand-400"
                value={value} placeholder="e.g. ANXT"
                onChange={e => setValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') add(); if (e.key === 'Escape') setAdding(false); }} />
            ) : (
              <select autoFocus className="border border-slate-200 rounded px-2 py-1 text-[13.5px] focus:outline-none"
                value={value} onChange={e => setValue(e.target.value)}>
                <option value="">Choose a field</option>
                {fields.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            )}
            <button onClick={add} className="text-[13.5px] text-brand-600 hover:text-brand-700 font-medium">Add</button>
            <button onClick={() => setAdding(false)} className="text-[13.5px] text-slate-400 hover:text-slate-600">Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}

function RuleEditor({ rule, fields, onClose, onSaved }) {
  const [form, setForm] = useState(() => rule || {
    name: '', code: '', color: COLORS[0], startingNumber: 1, placeholderDigits: 1,
    prefix: [], suffix: [], reusePerCombination: false, isDefault: false, isActive: true,
  });
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);

  // Ask the server what this renders to, debounced, so the panel always shows
  // what generation would actually produce.
  useEffect(() => {
    const t = setTimeout(() => {
      api.post('/employee-info-settings/id-rules/preview', {
        ...form, sample: { joiningDate: new Date().toISOString().slice(0, 10) },
      })
        .then(r => setPreview(r.data.data))
        .catch(() => setPreview(null));
    }, 250);
    return () => clearTimeout(t);
  }, [form]);

  const save = async () => {
    if (!form.name.trim()) return toast.error('Give the rule a name');
    setSaving(true);
    try {
      if (rule?._id) await api.put(`/employee-info-settings/id-rules/${rule._id}`, form);
      else await api.post('/employee-info-settings/id-rules', form);
      toast.success(rule ? 'Rule updated' : 'Rule added');
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not save that rule');
    } finally { setSaving(false); }
  };

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-slate-50 rounded-2xl w-full max-w-4xl shadow-2xl my-4 flex flex-col max-h-[94vh]">
        <div className="flex items-center justify-between px-6 py-4 bg-white rounded-t-2xl border-b border-slate-100">
          <h3 className="font-display font-semibold text-slate-800 text-xl">
            {rule ? 'Edit rule' : 'Add Rule'}
          </h3>
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
            <X size={19} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <h4 className="text-[16px] font-semibold text-slate-800 mb-4">Configure Rule</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="block text-[14px] font-medium text-slate-700 mb-1.5">
                  Rule name <span className="text-rose-500">*</span>
                </label>
                <input className={input} value={form.name} placeholder="Enter rule name"
                  onChange={e => set('name', e.target.value)} />
              </div>
              <div>
                <label className="block text-[14px] font-medium text-slate-700 mb-1.5">Rule Code</label>
                <input className={input} value={form.code || ''} onChange={e => set('code', e.target.value)} />
              </div>
              <div>
                <label className="block text-[14px] font-medium text-slate-700 mb-1.5">Colour</label>
                <div className="flex gap-1.5">
                  {COLORS.map(c => (
                    <button key={c} onClick={() => set('color', c)}
                      className={`w-7 h-7 rounded ${form.color === c ? 'ring-2 ring-offset-1 ring-slate-400' : ''}`}
                      style={{ background: c }} />
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5 max-w-md">
              <div>
                <label className="block text-[14px] font-medium text-slate-700 mb-1.5">Starting number for ID</label>
                <input type="number" min="0" className={input} value={form.startingNumber}
                  onChange={e => set('startingNumber', e.target.value)} />
              </div>
              <div>
                <label className="block text-[14px] font-medium text-slate-700 mb-1.5">Placeholder digits</label>
                <select className={input} value={form.placeholderDigits}
                  onChange={e => set('placeholderDigits', Number(e.target.value))}>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <SegmentBox label="Prefix" segments={form.prefix} fields={fields}
                onChange={v => set('prefix', v)} />
              <SegmentBox label="Suffix" segments={form.suffix} fields={fields}
                onChange={v => set('suffix', v)} />
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <h4 className="text-[16px] font-semibold text-slate-800 mb-3">Conditions</h4>
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={form.reusePerCombination}
                onChange={e => set('reusePerCombination', e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-slate-300 accent-brand-600" />
              <span className="text-[14.5px] text-slate-700">
                Reuse starting number for each unique combination of prefix and suffix.
                {/* Worth spelling out: with it on, ANXT25 and ANXT26 each begin
                    at 1, so the number alone is no longer unique. */}
                <span className="block text-[13px] text-slate-400 mt-0.5">
                  Each distinct prefix/suffix counts from the starting number separately.
                </span>
              </span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer mt-3">
              <input type="checkbox" checked={form.isDefault}
                onChange={e => set('isDefault', e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 accent-brand-600" />
              <span className="text-[14.5px] text-slate-700">Use this rule when generating IDs</span>
            </label>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <h4 className="text-[16px] font-semibold text-slate-800 mb-3">Preview</h4>
            {preview ? (
              <div className="text-center">
                <div className="inline-block bg-amber-50 border border-amber-100 rounded-lg px-8 py-2.5 text-[16px] text-slate-800 font-medium">
                  {preview.example || '—'}
                </div>
                <p className="text-[13.5px] text-slate-500 mt-2">
                  {preview.parts.map((p, i) => (
                    <span key={i}>
                      {i > 0 && <span className="text-slate-300"> · </span>}
                      <span className="text-slate-700">{p.label}</span>
                      <span className="text-slate-400"> — {p.kind}</span>
                    </span>
                  ))}
                </p>
              </div>
            ) : (
              <p className="text-[14px] text-slate-400 text-center">Building preview…</p>
            )}
          </div>
        </div>

        <div className="flex gap-3 px-6 py-4 bg-white rounded-b-2xl border-t border-slate-100">
          <button onClick={save} disabled={saving}
            className="bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white px-6 py-2.5 rounded-xl text-[15px] font-medium">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={onClose}
            className="border border-slate-200 text-slate-600 px-6 py-2.5 rounded-xl text-[15px] hover:bg-slate-50">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function Toggle({ on, onChange }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => onChange(!on)}
      className={`w-11 h-6 rounded-full transition-colors flex-shrink-0 relative ${on ? 'bg-brand-600' : 'bg-slate-300'}`}>
      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  );
}

export default function EmployeeIdRules() {
  const [state, setState] = useState({ rows: [], fields: [], enabled: false });
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);   // null | 'new' | rule

  const load = () => {
    setLoading(true);
    api.get('/employee-info-settings/id-rules')
      .then(r => setState({ rows: r.data.data || [], fields: r.data.fields || [], enabled: !!r.data.enabled }))
      .catch(err => toast.error(err.response?.data?.message || 'Could not load rules'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const toggle = async (v) => {
    setState(s => ({ ...s, enabled: v }));
    try { await api.patch('/employee-info-settings/id-rules/enabled', { enabled: v }); toast.success('Saved'); }
    catch (err) { setState(s => ({ ...s, enabled: !v })); toast.error(err.response?.data?.message || 'Could not save'); }
  };

  const remove = async (row) => {
    try { await api.delete(`/employee-info-settings/id-rules/${row._id}`); toast.success('Rule removed'); load(); }
    catch (err) { toast.error(err.response?.data?.message || 'Could not remove that rule'); }
  };

  return (
    <div className="max-w-4xl space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <Toggle on={state.enabled} onChange={toggle} />
          <div>
            <h3 className="text-[16px] font-semibold text-slate-800">Generate employee ID based on configured rules</h3>
            <p className="text-[14px] text-slate-500 mt-0.5">
              Create rules for generating employee IDs based on your organization needs.
            </p>
            {/* Say what happens when it is off, rather than leaving the screen
                looking like it does nothing. */}
            {!state.enabled && (
              <p className="text-[13px] text-slate-400 mt-1.5">
                While this is off, new IDs continue to come from the built-in sequence.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button onClick={() => setEditing('new')}
          className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white px-4 h-10 rounded-lg text-[15px] font-medium">
          <Plus size={16} /> Add Rule
        </button>
      </div>

      <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
        <table className="w-full text-[15px]">
          <thead className="bg-slate-50 text-slate-500 text-[13.5px]">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">Rule Name</th>
              <th className="px-4 py-2.5 text-left font-medium w-[200px]">Last Generated Id</th>
              <th className="px-4 py-2.5 text-left font-medium w-[130px]">Status</th>
              <th className="px-4 py-2.5 w-24" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="py-14 text-center">
                <div className="inline-block w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
              </td></tr>
            ) : state.rows.length === 0 ? (
              <tr><td colSpan={4} className="py-14 text-center text-slate-400">No rules yet.</td></tr>
            ) : state.rows.map(r => (
              <tr key={r._id} className="border-t border-slate-100">
                <td className="px-4 py-2.5">
                  <span className="inline-flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: r.color }} />
                    <span className="text-slate-800">{r.name}</span>
                    {r.isDefault && (
                      <span className="text-[12px] bg-brand-50 text-brand-700 rounded px-1.5 py-0.5">in use</span>
                    )}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-slate-600">{r.lastGeneratedId || <span className="text-slate-300">—</span>}</td>
                <td className="px-4 py-2.5">
                  <span className={`text-[13px] px-2 py-0.5 rounded-full font-medium ${
                    r.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                    {r.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-1">
                    <button onClick={() => setEditing(r)} title="Edit"
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
                      <Pencil size={15} />
                    </button>
                    <button onClick={() => remove(r)} title="Delete"
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <RuleEditor
          rule={editing === 'new' ? null : editing}
          fields={state.fields}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}
