import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';

const todayCA = () => new Date().toLocaleDateString('en-CA');
const y = new Date().getFullYear();
const m = new Date().getMonth();

const PRESETS = [
  { key: 'thisMonth',  label: 'This Month',  start: new Date(y, m, 1).toLocaleDateString('en-CA'),         end: new Date(y, m + 1, 0).toLocaleDateString('en-CA') },
  { key: 'lastMonth',  label: 'Last Month',  start: new Date(y, m - 1, 1).toLocaleDateString('en-CA'),     end: new Date(y, m, 0).toLocaleDateString('en-CA') },
  { key: 'thisYear',   label: 'This Year',   start: new Date(y, 0, 1).toLocaleDateString('en-CA'),         end: new Date(y, 11, 31).toLocaleDateString('en-CA') },
  { key: 'lastYear',   label: 'Last Year',   start: new Date(y - 1, 0, 1).toLocaleDateString('en-CA'),     end: new Date(y - 1, 11, 31).toLocaleDateString('en-CA') },
  { key: 'last3Months', label: 'Last 3 Months', start: new Date(y, m - 3, new Date().getDate()).toLocaleDateString('en-CA'), end: todayCA() },
  { key: 'last6Months', label: 'Last 6 Months', start: new Date(y, m - 6, new Date().getDate()).toLocaleDateString('en-CA'), end: todayCA() },
];

// Compact "Period: This Month ▾" dropdown chip that auto-fills From/To
// dates — matches Zoho's period preset selector. Selecting a preset calls
// onSelect({ start, end }) so the parent can update its date state.
export default function PeriodPresetChip({ onSelect }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(null);
  const ref = useRef(null);
  useEffect(() => {
    const onClick = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12.5px] font-medium border border-slate-200 bg-white text-slate-700 hover:border-slate-300 transition-colors whitespace-nowrap">
        Period: {current || 'Custom'} <ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-44 bg-white border border-slate-200 rounded-lg shadow-lg py-1">
          {PRESETS.map(p => (
            <button key={p.key} onClick={() => { setCurrent(p.label); onSelect({ start: p.start, end: p.end }); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-[12.5px] transition-colors ${current === p.label ? 'text-blue-600 font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}>{p.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
