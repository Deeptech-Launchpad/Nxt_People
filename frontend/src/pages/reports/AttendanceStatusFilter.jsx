import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, X } from 'lucide-react';

// Presence states and attendance statuses, matching Zoho's Status filter on
// Daily Attendance Status. "On Duty" is offered for layout parity but never
// matches anything yet — that leave type isn't modelled in this system.
const OPTIONS = [
  { key: 'in', label: 'In' },
  { key: 'out', label: 'Out' },
  { key: 'yetToCheckIn', label: 'Yet to check-in' },
  { key: 'present', label: 'Present' },
  { key: 'onDuty', label: 'On Duty' },
  { key: 'paidLeave', label: 'Paid Leave' },
  { key: 'absent', label: 'Absent' },
  { key: 'unpaidLeave', label: 'Unpaid Leave' },
  { key: 'holiday', label: 'Holidays' },
  { key: 'weekend', label: 'Weekend' },
];

// Multi-select status chip. `value` is an array of keys; empty = no filter.
export default function AttendanceStatusFilter({ value = [], onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    const onClick = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const toggle = key => onChange(value.includes(key) ? value.filter(k => k !== key) : [...value, key]);
  const filtered = search.trim()
    ? OPTIONS.filter(o => o.label.toLowerCase().includes(search.trim().toLowerCase()))
    : OPTIONS;
  const summary = value.length
    ? OPTIONS.filter(o => value.includes(o.key)).map(o => o.label).join(', ')
    : 'All';

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12.5px] font-medium border transition-colors whitespace-nowrap max-w-xs ${value.length ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'}`}
      >
        <span className="truncate">Status: {summary}</span>
        {value.length > 0 && (
          <span className="flex items-center gap-1 flex-shrink-0">
            <span className="bg-blue-600 text-white text-[10px] font-bold rounded px-1.5 py-0.5 leading-none">{value.length}</span>
            <span onClick={e => { e.stopPropagation(); onChange([]); }} className="text-slate-400 hover:text-slate-600"><X size={12} /></span>
          </span>
        )}
        <ChevronDown size={12} className="flex-shrink-0" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-56 bg-white border border-slate-200 rounded-lg shadow-lg py-1 max-h-72 overflow-y-auto">
          <div className="px-3 py-2">
            <input
              value={search} onChange={e => setSearch(e.target.value)} placeholder="Search"
              className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-[13px] focus:outline-none focus:border-blue-400"
            />
          </div>
          {filtered.map(o => (
            <label key={o.key} className="flex items-center gap-2.5 px-3 py-2 text-[13px] text-slate-700 hover:bg-slate-50 cursor-pointer transition-colors">
              <input type="checkbox" checked={value.includes(o.key)} onChange={() => toggle(o.key)} className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
              {o.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
