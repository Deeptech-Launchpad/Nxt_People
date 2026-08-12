import React, { useState, useEffect, useRef } from 'react';
import api from '../../utils/api';

// Chip order matches Zoho's filter row. `businessUnit` has no backing column
// in this schema — the chip is rendered so the row matches the reference
// design, and its list is simply empty, exactly as Zoho renders it for an
// org with no business units configured.
const DIMENSIONS = [
  ['department', 'Department'], ['workLocation', 'Location'], ['designation', 'Designation'],
  ['company', 'Company'], ['businessUnit', 'Business Unit'], ['division', 'Division'],
  ['gender', 'Gender'], ['employmentType', 'Employment Type'], ['experience', 'Experience'],
  ['role', 'Role'], ['shiftId', 'Shift'],
];

// Options arrive either as bare strings (the plain `employees` columns) or as
// {value,label} objects (Shift, where the filter sends a shift_id but the chip
// has to show the shift's name). Normalising here keeps every chip identical.
const normalize = o => (typeof o === 'string' ? { value: o, label: o } : o);

// Multi-select chip: a search box over a checkbox list, matching Zoho. The
// chip itself stays a plain label (Zoho never shows the selection inline) and
// only gains a count badge once something is ticked.
function FilterChip({ label, options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    const onClick = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const opts = options.map(normalize);
  const selected = value || [];
  const filtered = search.trim()
    ? opts.filter(o => o.label.toLowerCase().includes(search.trim().toLowerCase()))
    : opts;

  const toggle = v => onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-[13px] border transition-colors whitespace-nowrap ${selected.length ? 'bg-blue-50 border-blue-300 text-blue-700 font-medium' : 'bg-white border-slate-300 text-slate-600 hover:border-slate-400'}`}
      >
        {label}
        {selected.length > 0 && (
          <span className="bg-blue-600 text-white text-[10px] font-bold rounded px-1.5 py-0.5 leading-none">{selected.length}</span>
        )}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-60 bg-white border border-slate-200 rounded-lg shadow-lg">
          <div className="p-2">
            <input
              value={search} onChange={e => setSearch(e.target.value)} placeholder="Search" autoFocus
              className="w-full border border-slate-200 rounded px-3 py-1.5 text-[13px] focus:outline-none focus:border-blue-400"
            />
          </div>
          <div className="max-h-56 overflow-y-auto pb-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-[12.5px] text-slate-400">No options</p>
            ) : filtered.map(o => (
              <label key={o.value} className="flex items-center gap-2.5 px-3 py-1.5 text-[13px] text-slate-700 hover:bg-slate-50 cursor-pointer transition-colors">
                <input
                  type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 flex-shrink-0"
                />
                <span className="truncate" title={o.label}>{o.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Zoho's dimension filter row. `exclude` hides whichever dimension is
// currently the page's own grouping ("Type") so it isn't offered twice.
// Values are arrays — a dimension with an empty array is simply not filtered.
export default function FilterRow({ value, onChange, exclude = [] }) {
  const [options, setOptions] = useState(null);

  useEffect(() => {
    api.get('/reports/employee/filter-options').then(r => setOptions(r.data.data)).catch(() => setOptions({}));
  }, []);

  if (!options) return null;
  const visible = DIMENSIONS.filter(([key]) => !exclude.includes(key));
  if (visible.length === 0) return null;

  return (
    <>
      {visible.map(([key, label]) => (
        <FilterChip
          key={key} label={label} options={options[key] || []}
          value={value[key] || []} onChange={v => onChange(key, v)}
        />
      ))}
    </>
  );
}
