import React, { useEffect, useState } from 'react';
import { Filter, X } from 'lucide-react';

/* ── The filter side panel ──────────────────────────────────────────────────
 *  Every list tab in the reference has one, opened from a funnel beside the
 *  toolbar, sliding in from the right over the table. The fields differ per
 *  tab, so the panel takes a field list rather than hard-coding leave's.
 *
 *  Draft state is local until Apply. Typing in a filter must not refetch on
 *  every keystroke — the reference applies on the button, and so does this.
 *  Cancelling restores whatever was last applied rather than clearing, so
 *  opening the panel to look at the current filter cannot lose it.
 *
 *  `fields` is [{ name, label, type, options?, placeholder? }] where type is
 *  'select' | 'text' | 'date'. A 'daterange' expands into two inputs writing
 *  `fromKey` and `toKey` — named explicitly, because the query parameters an
 *  endpoint already accepts rarely come as a matched From/To pair.
 * ────────────────────────────────────────────────────────────────────────── */
export default function FilterPanel({ fields, value, onApply, className = '' }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value || {});

  // Re-seed the draft each time it opens so it always shows what is applied.
  useEffect(() => { if (open) setDraft(value || {}); }, [open]);

  const activeCount = Object.entries(value || {})
    .filter(([, v]) => v !== '' && v !== undefined && v !== null).length;

  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }));
  const input = 'w-full border border-slate-200 rounded-xl px-3 py-2.5 text-[15px] focus:outline-none focus:border-brand-400';

  const apply = () => {
    // Drop empties so the caller can send the object straight to the query
    // string without producing `?status=&leaveType=`.
    const clean = {};
    for (const [k, v] of Object.entries(draft)) {
      if (v !== '' && v !== undefined && v !== null) clean[k] = v;
    }
    onApply(clean);
    setOpen(false);
  };

  const clear = () => { setDraft({}); onApply({}); setOpen(false); };

  const renderField = (f) => {
    if (f.type === 'daterange') {
      const fromKey = f.fromKey || `${f.name}From`;
      const toKey = f.toKey || `${f.name}To`;
      return (
        <div key={f.name}>
          <label className="block text-sm font-medium text-slate-600 mb-1.5">{f.label}</label>
          <div className="flex items-center gap-2">
            <input type="date" className={input} value={draft[fromKey] || ''}
              onChange={e => set(fromKey, e.target.value)} />
            <span className="text-slate-400 text-sm flex-shrink-0">to</span>
            <input type="date" className={input} value={draft[toKey] || ''}
              onChange={e => set(toKey, e.target.value)} />
          </div>
        </div>
      );
    }
    return (
      <div key={f.name}>
        <label className="block text-sm font-medium text-slate-600 mb-1.5">{f.label}</label>
        {f.type === 'select' ? (
          <select className={input} value={draft[f.name] || ''} onChange={e => set(f.name, e.target.value)}>
            <option value="">{f.placeholder || 'Any'}</option>
            {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : (
          <input type={f.type === 'date' ? 'date' : 'text'} className={input}
            placeholder={f.placeholder || ''} value={draft[f.name] || ''}
            onChange={e => set(f.name, e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') apply(); }} />
        )}
      </div>
    );
  };

  return (
    <>
      <button onClick={() => setOpen(true)} title="Filter"
        className={`relative flex items-center gap-2 border rounded-xl px-3.5 py-2.5 text-[15px] transition-colors
          ${activeCount ? 'border-brand-400 text-brand-600 bg-brand-50' : 'border-slate-200 text-slate-600 hover:bg-slate-50'} ${className}`}>
        <Filter size={16} />
        Filter
        {activeCount > 0 && (
          <span className="ml-0.5 bg-brand-600 text-white text-[12px] font-medium rounded-full w-5 h-5 flex items-center justify-center">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative bg-white w-full max-w-sm h-full shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h3 className="font-display font-semibold text-slate-800 text-lg">Filter</h3>
              <button onClick={() => setOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
              {fields.map(renderField)}
            </div>

            <div className="flex gap-3 px-5 py-4 border-t border-slate-100">
              <button onClick={clear}
                className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-[15px] font-medium hover:bg-slate-50">
                Clear all
              </button>
              <button onClick={apply}
                className="flex-1 bg-brand-600 hover:bg-brand-500 text-white py-2.5 rounded-xl text-[15px] font-medium">
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
