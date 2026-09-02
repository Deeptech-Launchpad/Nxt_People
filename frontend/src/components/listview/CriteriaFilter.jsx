import React, { useEffect, useMemo, useState } from 'react';
import { Filter, X, Search } from 'lucide-react';

/* The filter side panel, as the reference builds it.
 *
 * Ticking a field does NOT toggle a column — it opens a criteria editor
 * underneath that field: an operator and a value. That distinction is the
 * whole shape of this component, and getting it wrong would have produced a
 * column chooser that silently filtered nothing.
 *
 * Applied criteria then appear as chips above the table, each removable, with
 * a Reset beside them.
 *
 * Draft state stays local until Apply, so typing a value does not refetch on
 * every keystroke.
 */

// Which operators make sense for a field's type. Offering "contains" on a date
// produces a filter that can only ever match nothing.
const OPERATORS_FOR = {
  text: [
    { value: 'contains', label: 'Contains' },
    { value: 'is', label: 'Is' },
    { value: 'starts_with', label: 'Starts with' },
    { value: 'is_not', label: 'Is not' },
    { value: 'is_empty', label: 'Is empty' },
    { value: 'is_not_empty', label: 'Is not empty' },
  ],
  date: [
    { value: 'is', label: 'Is' },
    { value: 'before', label: 'Before' },
    { value: 'after', label: 'After' },
    { value: 'between', label: 'Between' },
    { value: 'is_empty', label: 'Is empty' },
  ],
  datetime: [
    { value: 'before', label: 'Before' },
    { value: 'after', label: 'After' },
    { value: 'between', label: 'Between' },
  ],
};
const opsFor = (type) => OPERATORS_FOR[type] || OPERATORS_FOR.text;
const NO_VALUE = new Set(['is_empty', 'is_not_empty']);

const inputClass =
  'w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-[14px] focus:outline-none focus:border-brand-400';

export function CriteriaChips({ criteria, fields, onRemove, onReset }) {
  if (!criteria.length) return null;
  const labelOf = (k) => fields.find(f => f.key === k)?.label || k;
  const opLabel = (f, op) => (opsFor(f?.type).find(o => o.value === op)?.label || op).toLowerCase();

  return (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      {criteria.map((c, i) => {
        const f = fields.find(x => x.key === c.field);
        return (
          <span key={`${c.field}-${i}`}
            className="inline-flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-[14px] text-slate-600">
            <span className="text-slate-500">{labelOf(c.field)}</span>
            <span className="text-slate-400">{opLabel(f, c.operator)}</span>
            {!NO_VALUE.has(c.operator) && (
              <span className="text-slate-800 font-medium">
                {c.value}{c.value2 ? ` – ${c.value2}` : ''}
              </span>
            )}
            <button onClick={() => onRemove(i)} className="text-slate-400 hover:text-rose-600 ml-0.5">
              <X size={13} />
            </button>
          </span>
        );
      })}
      <button onClick={onReset} className="text-[14px] text-brand-600 hover:text-brand-700 ml-1">Reset</button>
    </div>
  );
}

export default function CriteriaFilter({ fields, criteria, onApply, systemFilters = null }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState([]);
  const [system, setSystem] = useState({});

  // Re-seed each time it opens so the panel always shows what is applied.
  useEffect(() => {
    if (!open) return;
    setDraft(criteria.map(c => ({ ...c })));
    setSearch('');
    setSystem(systemFilters ? { ...systemFilters.value } : {});
  }, [open]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? fields.filter(f => f.label.toLowerCase().includes(q)) : fields;
  }, [fields, search]);

  const rowFor = (key) => draft.find(d => d.field === key);

  const toggle = (f) => {
    setDraft(d => {
      if (d.some(x => x.field === f.key)) return d.filter(x => x.field !== f.key);
      return [...d, { field: f.key, operator: opsFor(f.type)[0].value, value: '', value2: '' }];
    });
  };
  const patch = (key, changes) =>
    setDraft(d => d.map(x => (x.field === key ? { ...x, ...changes } : x)));

  const apply = () => {
    // A ticked field with no value would be accepted and then ignored by the
    // server, which looks like a filter that did nothing. Drop it here so the
    // chips only ever show criteria that are really in force.
    const clean = draft.filter(c => NO_VALUE.has(c.operator) ? true : String(c.value ?? '').trim() !== '');
    onApply(clean, systemFilters ? system : undefined);
    setOpen(false);
  };

  const activeCount = criteria.length +
    (systemFilters ? Object.values(systemFilters.value || {}).filter(Boolean).length : 0);

  return (
    <>
      <button onClick={() => setOpen(true)} title="Filter"
        className={`relative flex items-center justify-center w-10 h-10 border rounded-lg transition-colors
          ${activeCount ? 'border-brand-400 text-brand-600 bg-brand-50' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
        <Filter size={17} />
        {activeCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 bg-brand-600 text-white text-[11px] font-medium rounded-full w-4.5 h-4.5 min-w-[18px] h-[18px] flex items-center justify-center">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          <div className="relative bg-white w-full max-w-[340px] h-full shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-100">
              <h3 className="font-display font-semibold text-slate-800 text-[17px]">Filter</h3>
              <button onClick={() => setOpen(false)}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
                <X size={18} />
              </button>
            </div>

            <div className="px-4 py-3 border-b border-slate-100">
              <div className="relative">
                <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search"
                  className="w-full border border-slate-200 rounded-lg pl-8 pr-2.5 py-2 text-[14px] focus:outline-none focus:border-brand-400" />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3">
              {/* Employees has a System filters block above the field list;
                  Departments and Designations do not. */}
              {systemFilters && !search && (
                <div className="mb-4">
                  <p className="text-[13px] font-semibold text-slate-500 uppercase tracking-wide mb-2">
                    System filters
                  </p>
                  <div className="space-y-3">
                    {systemFilters.fields.map(f => (
                      <div key={f.name}>
                        <label className="block text-[13px] text-slate-500 mb-1">{f.label}</label>
                        {f.options ? (
                          <select className={inputClass} value={system[f.name] || ''}
                            onChange={e => setSystem(s => ({ ...s, [f.name]: e.target.value }))}>
                            <option value="">{f.placeholder || 'All'}</option>
                            {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        ) : (
                          <input className={inputClass} value={system[f.name] || ''} placeholder={f.placeholder || ''}
                            onChange={e => setSystem(s => ({ ...s, [f.name]: e.target.value }))} />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-[13px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Fields</p>
              <div className="space-y-1">
                {shown.map(f => {
                  const row = rowFor(f.key);
                  return (
                    <div key={f.key}>
                      <label className="flex items-center gap-2.5 py-1.5 cursor-pointer">
                        <input type="checkbox" checked={!!row} onChange={() => toggle(f)}
                          className="w-4 h-4 rounded border-slate-300 accent-brand-600" />
                        <span className="text-[14px] text-slate-700">{f.label}</span>
                      </label>
                      {/* The criteria editor, revealed by the tick. */}
                      {row && (
                        <div className="ml-6.5 pl-1 pb-2 space-y-2" style={{ marginLeft: 26 }}>
                          <select className={inputClass} value={row.operator}
                            onChange={e => patch(f.key, { operator: e.target.value })}>
                            {opsFor(f.type).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                          {!NO_VALUE.has(row.operator) && (
                            <div className="flex items-center gap-2">
                              <input
                                type={f.type === 'date' ? 'date' : f.type === 'datetime' ? 'date' : 'text'}
                                className={inputClass} value={row.value || ''}
                                placeholder={f.type === 'text' ? 'Value' : undefined}
                                onChange={e => patch(f.key, { value: e.target.value })} />
                              {row.operator === 'between' && (
                                <>
                                  <span className="text-slate-400 text-[13px]">to</span>
                                  <input type={f.type === 'text' ? 'text' : 'date'} className={inputClass}
                                    value={row.value2 || ''}
                                    onChange={e => patch(f.key, { value2: e.target.value })} />
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {shown.length === 0 && (
                  <p className="text-[14px] text-slate-400 py-4 text-center">No field matches that.</p>
                )}
              </div>
            </div>

            <div className="flex gap-2.5 px-4 py-3.5 border-t border-slate-100">
              <button onClick={apply}
                className="flex-1 bg-brand-600 hover:bg-brand-500 text-white py-2 rounded-lg text-[15px] font-medium">
                Apply
              </button>
              <button onClick={() => { setDraft([]); setSystem({}); onApply([], systemFilters ? {} : undefined); setOpen(false); }}
                className="flex-1 border border-slate-200 text-slate-600 py-2 rounded-lg text-[15px] font-medium hover:bg-slate-50">
                Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
