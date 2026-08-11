import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import api from '../../utils/api';

const DIMENSIONS = [
  ['department', 'Department'], ['designation', 'Designation'], ['company', 'Company'],
  ['division', 'Division'], ['workLocation', 'Location'], ['employmentType', 'Employment Type'],
  ['role', 'Role'],
];

function FilterChip({ label, options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onClick = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-[13px] font-medium border transition-colors ${value ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'}`}
      >
        {label}{value ? `: ${value}` : ''} <ChevronDown size={13} />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-56 bg-white border border-slate-200 rounded-lg shadow-lg py-1 max-h-64 overflow-y-auto">
          <button onClick={() => { onChange(''); setOpen(false); }} className="w-full text-left px-3 py-2 text-[13px] text-slate-500 hover:bg-slate-50 transition-colors">All</button>
          {options.map(o => (
            <button key={o} onClick={() => { onChange(o); setOpen(false); }} className="w-full text-left px-3 py-2 text-[13px] text-slate-700 hover:bg-slate-50 transition-colors">{o}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// Secondary narrowing filter row shown on Distribution/Diversity and every
// Leave Tracker report — matches Zoho's row of dimension chips. `exclude`
// hides whichever dimension is currently the page's own grouping ("Type")
// so it isn't offered twice. Business Unit isn't offered — this schema has
// no such column, and a filter chip wired to nothing would be worse than
// not having it.
export default function FilterRow({ value, onChange, exclude = [] }) {
  const [options, setOptions] = useState(null);

  useEffect(() => {
    api.get('/reports/employee/filter-options').then(r => setOptions(r.data.data)).catch(() => setOptions({}));
  }, []);

  if (!options) return null;
  const visible = DIMENSIONS.filter(([key]) => !exclude.includes(key));
  if (visible.length === 0) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap px-4 pt-4">
      {visible.map(([key, label]) => (
        <FilterChip key={key} label={label} options={options[key] || []} value={value[key] || ''} onChange={v => onChange(key, v)} />
      ))}
    </div>
  );
}
