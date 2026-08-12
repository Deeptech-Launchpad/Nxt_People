import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';

const OPTIONS = ['Permanent', 'On Contract', 'Temporary', 'Trainee'];

// "Employment Type: All ▾" chip — matches Zoho's filter on Attrition Trend
// and Experience Wise Exit. Options are the real values this app's
// employment_type column actually uses (Permanent/On Contract/Trainee are
// populated today; Temporary is a supported value with no current rows).
export default function EmploymentTypeFilter({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    const onClick = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const all = ['All', ...OPTIONS];
  const filtered = search.trim()
    ? all.filter(o => o.toLowerCase().includes(search.trim().toLowerCase()))
    : all;

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 px-3 py-1.5 rounded text-[13px] border border-slate-300 bg-white text-slate-700 hover:border-slate-400 transition-colors whitespace-nowrap">
        Employment Type : {value || 'All'} <ChevronDown size={13} className="text-slate-400" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-56 bg-white border border-slate-200 rounded-lg shadow-lg">
          <div className="p-2">
            <input
              value={search} onChange={e => setSearch(e.target.value)} placeholder="Search" autoFocus
              className="w-full border border-slate-200 rounded px-3 py-1.5 text-[13px] focus:outline-none focus:border-blue-400"
            />
          </div>
          <div className="max-h-56 overflow-y-auto pb-1">
            {filtered.map(o => {
              const isAll = o === 'All';
              const selected = isAll ? !value : value === o;
              return (
                <button
                  key={o}
                  onClick={() => { onChange(isAll ? '' : o); setOpen(false); }}
                  className={`w-full text-left px-4 py-2 text-[13px] transition-colors ${selected ? 'bg-blue-50 text-blue-600 font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}
                >
                  {o}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
