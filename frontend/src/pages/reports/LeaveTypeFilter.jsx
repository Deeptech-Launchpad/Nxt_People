import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';

const OPTIONS = [['casual', 'Casual Leave'], ['comp_off', 'Comp-Off'], ['unpaid', 'Leave Without Pay'], ['permission', 'Permission']];

// "Leave type: All ▾" chip — narrows Daily Leave Status / Resource
// Availability to one specific leave type, matching Zoho's filter row.
export default function LeaveTypeFilter({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const onClick = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);
  const label = OPTIONS.find(([k]) => k === value)?.[1] || 'All';
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium border border-slate-200 bg-white text-slate-700 hover:border-slate-300 transition-colors">
        Leave type: {label} <ChevronDown size={13} />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-48 bg-white border border-slate-200 rounded-lg shadow-lg py-1">
          <button onClick={() => { onChange(''); setOpen(false); }} className={`w-full text-left px-3 py-2 text-[13px] transition-colors ${!value ? 'text-blue-600 font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}>All</button>
          {OPTIONS.map(([k, l]) => (
            <button key={k} onClick={() => { onChange(k); setOpen(false); }} className={`w-full text-left px-3 py-2 text-[13px] transition-colors ${value === k ? 'text-blue-600 font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}>{l}</button>
          ))}
        </div>
      )}
    </div>
  );
}
