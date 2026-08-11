import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';

const todayCA = () => new Date().toLocaleDateString('en-CA');
const yesterdayCA = () => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toLocaleDateString('en-CA'); };
const y = new Date().getFullYear();
const m = new Date().getMonth();
const startOfWeek = d => { const r = new Date(d); r.setDate(r.getDate() - r.getDay()); return r; };
const endOfWeek = d => { const r = startOfWeek(d); r.setDate(r.getDate() + 6); return r; };
const lastWeekStart = () => { const d = new Date(); d.setDate(d.getDate() - 7); return startOfWeek(d); };
const lastWeekEnd = () => { const d = new Date(); d.setDate(d.getDate() - 7); return endOfWeek(d); };

const PRESETS = [
  { key: 'yesterday',   label: 'Yesterday',     start: yesterdayCA(),                                                     end: yesterdayCA() },
  { key: 'today',       label: 'Today',         start: todayCA(),                                                         end: todayCA() },
  { key: 'lastWeek',    label: 'Last Week',     start: lastWeekStart().toLocaleDateString('en-CA'),                       end: lastWeekEnd().toLocaleDateString('en-CA') },
  { key: 'thisWeek',    label: 'This Week',     start: startOfWeek(new Date()).toLocaleDateString('en-CA'),               end: endOfWeek(new Date()).toLocaleDateString('en-CA') },
  { key: 'lastMonth',   label: 'Last Month',    start: new Date(y, m - 1, 1).toLocaleDateString('en-CA'),                end: new Date(y, m, 0).toLocaleDateString('en-CA') },
  { key: 'thisMonth',   label: 'This Month',    start: new Date(y, m, 1).toLocaleDateString('en-CA'),                    end: new Date(y, m + 1, 0).toLocaleDateString('en-CA') },
  { key: 'lastYear',    label: 'Last Year',     start: new Date(y - 1, 0, 1).toLocaleDateString('en-CA'),                end: new Date(y - 1, 11, 31).toLocaleDateString('en-CA') },
  { key: 'thisYear',    label: 'This Year',     start: new Date(y, 0, 1).toLocaleDateString('en-CA'),                    end: new Date(y, 11, 31).toLocaleDateString('en-CA') },
  { key: 'custom',      label: 'Custom',        start: null,                                                              end: null },
];

// Compact "Period: This Month ▾" dropdown chip that auto-fills From/To
// dates — matches Zoho's period preset selector exactly. Selecting
// "Custom" doesn't change dates (lets the user type into the date inputs
// themselves). The full Zoho list: Yesterday, Today, Last Week, This
// Week, Last Month, This Month, Last Year, This Year, Custom.
export default function PeriodPresetChip({ onSelect, defaultKey }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(defaultKey || null);
  const ref = useRef(null);
  useEffect(() => {
    const onClick = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);
  const currentLabel = PRESETS.find(p => p.key === current)?.label || 'Custom';
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12.5px] font-medium border border-slate-200 bg-white text-slate-700 hover:border-slate-300 transition-colors whitespace-nowrap">
        Period: {currentLabel} <ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-44 bg-white border border-slate-200 rounded-lg shadow-lg py-1">
          {PRESETS.map(p => (
            <button key={p.key} onClick={() => {
              setCurrent(p.key);
              if (p.start && p.end) onSelect({ start: p.start, end: p.end });
              setOpen(false);
            }}
              className={`w-full text-left px-3 py-1.5 text-[12.5px] transition-colors ${current === p.key ? 'text-blue-600 font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}>{p.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
