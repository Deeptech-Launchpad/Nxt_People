import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Search, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';

/* The saved-view dropdown and its Create View builder.
 *
 * A view is a named column set plus criteria, optionally shared. It is NOT the
 * column picker on the header row — that is per-person visibility, and mixing
 * them would mean hiding a column for yourself edited a view other people see.
 *
 * The builder mirrors the reference: name, default flag, permission radios, a
 * dual-list column picker that preserves the order you choose, and a criteria
 * table. Only the owner (or full access) can change a view, which the server
 * enforces too — this UI hides the controls, it does not rely on hiding them.
 */

const OPERATORS = [
  { value: 'contains', label: 'Contains' },
  { value: 'is', label: 'Is' },
  { value: 'is_not', label: 'Is not' },
  { value: 'starts_with', label: 'Starts with' },
  { value: 'before', label: 'Before' },
  { value: 'after', label: 'After' },
  { value: 'is_empty', label: 'Is empty' },
  { value: 'is_not_empty', label: 'Is not empty' },
];

const input = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:border-brand-400';

function CreateViewModal({ module, fields, existing, onClose, onSaved }) {
  const [name, setName] = useState(existing?.name || '');
  const [isDefault, setIsDefault] = useState(!!existing?.isDefault);
  const [visibility, setVisibility] = useState(existing?.visibility || 'private');
  const [chosen, setChosen] = useState(existing?.columns || []);
  const [available, setAvailable] = useState(() =>
    fields.filter(f => !(existing?.columns || []).includes(f.key)).map(f => f.key));
  const [pickedLeft, setPickedLeft] = useState([]);
  const [pickedRight, setPickedRight] = useState([]);
  const [criteria, setCriteria] = useState(existing?.criteria || []);
  const [saving, setSaving] = useState(false);

  const labelOf = k => fields.find(f => f.key === k)?.label || k;

  const move = (keys, toChosen) => {
    if (!keys.length) return;
    if (toChosen) {
      setChosen(c => [...c, ...keys.filter(k => !c.includes(k))]);
      setAvailable(a => a.filter(k => !keys.includes(k)));
      setPickedLeft([]);
    } else {
      setAvailable(a => [...a, ...keys.filter(k => !a.includes(k))]);
      setChosen(c => c.filter(k => !keys.includes(k)));
      setPickedRight([]);
    }
  };

  const save = async () => {
    if (!name.trim()) return toast.error('Give the view a name');
    if (!chosen.length) return toast.error('Choose at least one column');
    setSaving(true);
    try {
      const body = {
        module, name: name.trim(), visibility, isDefault, columns: chosen,
        criteria: criteria.filter(c => c.field && c.operator),
        // Sharing to named people/departments needs pickers we have not built;
        // 'everyone' and 'private' cover both cases the reference offers here.
        shareWith: {},
      };
      if (existing) await api.put(`/saved-views/${existing._id}`, body);
      else await api.post('/saved-views', body);
      toast.success(existing ? 'View updated' : 'View created');
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not save that view');
    } finally { setSaving(false); }
  };

  const listBox = (items, picked, setPicked) => (
    <div className="border border-slate-200 rounded-xl h-[260px] overflow-y-auto bg-white">
      {items.length === 0 && <p className="text-slate-400 text-[14px] text-center py-8">No fields present</p>}
      {items.map(k => (
        <button key={k}
          onClick={() => setPicked(p => p.includes(k) ? p.filter(x => x !== k) : [...p, k])}
          className={`w-full text-left px-3.5 py-2 text-[14px] border-b border-slate-50 last:border-0
            ${picked.includes(k) ? 'bg-brand-50 text-brand-700' : 'text-slate-700 hover:bg-slate-50'}`}>
          {labelOf(k)}
        </button>
      ))}
    </div>
  );

  const arrow = 'w-9 h-8 flex items-center justify-center border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50 text-[13px]';

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="font-display font-semibold text-slate-800 text-xl">
            {existing ? 'Edit View' : 'Create View'}
          </h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div>
            <label className="block text-[14px] font-medium text-slate-600 mb-1.5">
              Specify View Name <span className="text-rose-500">*</span>
            </label>
            <input className={input} value={name} onChange={e => setName(e.target.value)} placeholder="Enter View Name" />
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer">
            <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 accent-brand-600" />
            <span className="text-[14px] text-slate-700">Set as default view</span>
          </label>

          <div>
            <p className="text-[14px] font-medium text-slate-600 mb-2">View Permission</p>
            <div className="space-y-2">
              {[
                { v: 'private', label: 'Only to me' },
                { v: 'everyone', label: 'Allow all employees to access this custom view' },
                { v: 'shared', label: 'Share this view to specific users, departments, roles or locations',
                  disabled: 'Not built yet — needs the people and department pickers' },
              ].map(o => (
                <label key={o.v} className={`flex items-start gap-2.5 ${o.disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                  title={o.disabled || undefined}>
                  <input type="radio" name="visibility" value={o.v} checked={visibility === o.v}
                    disabled={!!o.disabled}
                    onChange={() => setVisibility(o.v)}
                    className="mt-0.5 w-4 h-4 accent-brand-600 disabled:opacity-40" />
                  <span className={`text-[14px] ${o.disabled ? 'text-slate-300' : 'text-slate-700'}`}>{o.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[14px] font-medium text-slate-600 mb-2">Select Columns</p>
            <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-center">
              {listBox(available, pickedLeft, setPickedLeft)}
              <div className="flex flex-col gap-2">
                <button className={arrow} title="Add all" onClick={() => move(available, true)}>»</button>
                <button className={arrow} title="Add" onClick={() => move(pickedLeft, true)}>›</button>
                <button className={arrow} title="Remove" onClick={() => move(pickedRight, false)}>‹</button>
                <button className={arrow} title="Remove all" onClick={() => move(chosen, false)}>«</button>
              </div>
              {listBox(chosen, pickedRight, setPickedRight)}
            </div>
          </div>

          <div>
            <p className="text-[14px] font-medium text-slate-600 mb-2">Criteria</p>
            <div className="space-y-2">
              {criteria.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 text-[13px] flex-shrink-0">
                    {i + 1}
                  </span>
                  <select className={input} value={c.field || ''}
                    onChange={e => setCriteria(cs => cs.map((x, j) => j === i ? { ...x, field: e.target.value } : x))}>
                    <option value="">None</option>
                    {fields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </select>
                  <select className={input} value={c.operator || ''} disabled={!c.field}
                    onChange={e => setCriteria(cs => cs.map((x, j) => j === i ? { ...x, operator: e.target.value } : x))}>
                    <option value="">None</option>
                    {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <input className={input} value={c.value || ''} disabled={!c.operator}
                    onChange={e => setCriteria(cs => cs.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} />
                  <button onClick={() => setCriteria(cs => cs.filter((_, j) => j !== i))}
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 flex-shrink-0">
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              <button onClick={() => setCriteria(cs => [...cs, { field: '', operator: '', value: '' }])}
                className="text-[14px] text-brand-600 hover:text-brand-700 bg-brand-50 px-2.5 py-1 rounded">
                Add new
              </button>
            </div>
          </div>
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-slate-100">
          <button onClick={save} disabled={saving}
            className="bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white px-6 py-2 rounded-lg text-[15px] font-medium">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={onClose}
            className="border border-slate-200 text-slate-600 px-6 py-2 rounded-lg text-[15px] hover:bg-slate-50">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ViewPicker({ module, fields, active, onSelect, defaultLabel }) {
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState([]);
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(null);   // 'create' | view object
  const ref = useRef(null);

  const load = () => {
    api.get(`/saved-views?module=${module}`)
      .then(r => setViews(r.data.data || []))
      .catch(() => {});
  };
  useEffect(load, [module]);

  useEffect(() => {
    if (!open) return;
    const close = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const match = v => !q.trim() || v.name.toLowerCase().includes(q.trim().toLowerCase());
  const publicViews = views.filter(v => v.visibility === 'everyone' && match(v));
  const myViews = views.filter(v => v.visibility !== 'everyone' && v.isMine && match(v));

  return (
    <>
      <div ref={ref} className="relative">
        <div className="flex items-center gap-3">
          <button onClick={() => setOpen(o => !o)}
            className="flex items-center justify-between gap-6 min-w-[210px] border border-slate-200 rounded-lg px-3.5 py-2 bg-white text-[15px] text-slate-700 hover:border-slate-300">
            <span className="truncate">{active?.name || defaultLabel}</span>
            <ChevronDown size={16} className="text-slate-400 flex-shrink-0" />
          </button>
          {active?.isMine && (
            <button onClick={() => setModal(active)} className="text-[14px] text-brand-600 hover:text-brand-700">Edit</button>
          )}
        </div>

        {open && (
          <div className="absolute left-0 top-full mt-1 w-[260px] bg-white rounded-xl shadow-2xl border border-slate-200 z-40">
            <div className="p-2.5 border-b border-slate-100">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={q} onChange={e => setQ(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg pl-8 pr-2 py-1.5 text-[13.5px] focus:outline-none focus:border-brand-400" />
              </div>
            </div>
            <div className="max-h-[260px] overflow-y-auto py-1">
              <p className="px-3.5 py-1 text-[12.5px] text-slate-400">Public views</p>
              <button onClick={() => { onSelect(null); setOpen(false); }}
                className={`w-full text-left px-3.5 py-2 text-[14px] hover:bg-slate-50 ${!active ? 'bg-slate-50 text-brand-600 font-medium' : 'text-slate-700'}`}>
                {defaultLabel}
              </button>
              {publicViews.map(v => (
                <button key={v._id} onClick={() => { onSelect(v); setOpen(false); }}
                  className={`w-full text-left px-3.5 py-2 text-[14px] hover:bg-slate-50 ${active?._id === v._id ? 'text-brand-600 font-medium' : 'text-slate-700'}`}>
                  {v.name}
                </button>
              ))}
              {myViews.length > 0 && (
                <>
                  <p className="px-3.5 py-1 mt-1 text-[12.5px] text-slate-400">My views</p>
                  {myViews.map(v => (
                    <button key={v._id} onClick={() => { onSelect(v); setOpen(false); }}
                      className={`w-full text-left px-3.5 py-2 text-[14px] hover:bg-slate-50 ${active?._id === v._id ? 'text-brand-600 font-medium' : 'text-slate-700'}`}>
                      {v.name}
                    </button>
                  ))}
                </>
              )}
            </div>
            <div className="p-2.5 border-t border-slate-100">
              <button onClick={() => { setOpen(false); setModal('create'); }}
                className="w-full border border-brand-300 text-brand-600 py-1.5 rounded-lg text-[14px] font-medium hover:bg-brand-50">
                Create View
              </button>
            </div>
          </div>
        )}
      </div>

      {modal && (
        <CreateViewModal
          module={module} fields={fields}
          existing={modal === 'create' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}
    </>
  );
}
