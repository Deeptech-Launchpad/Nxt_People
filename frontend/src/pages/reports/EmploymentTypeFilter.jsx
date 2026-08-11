import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';

const OPTIONS = ['Permanent', 'On Contract', 'Trainee', 'Temporary'];

// "Employment Type: All ▾" chip — matches Zoho's filter on Attrition Trend
// and Experience Wise Exit. Options are the real values this app's
// employment_type column actually uses (Permanent/On Contract/Trainee are
// populated today; Temporary is a supported value with no current rows).
export default function EmploymentTypeFilter({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const onClick = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium border border-slate-200 bg-white text-slate-700 hover:border-slate-300 transition-colors">
        Employment Type: {value || 'All'} <ChevronDown size={13} />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-44 bg-white border border-slate-200 rounded-lg shadow-lg py-1">
          <button onClick={() => { onChange(''); setOpen(false); }} className={`w-full text-left px-3 py-2 text-[13px] transition-colors ${!value ? 'text-blue-600 font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}>All</button>
          {OPTIONS.map(o => (
            <button key={o} onClick={() => { onChange(o); setOpen(false); }} className={`w-full text-left px-3 py-2 text-[13px] transition-colors ${value === o ? 'text-blue-600 font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}>{o}</button>
          ))}
        </div>
      )}
    </div>
  );
}
