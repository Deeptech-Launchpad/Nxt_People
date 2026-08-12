import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';

const MODES = [['all', 'All'], ['lt', 'Lesser than'], ['gt', 'Greater than']];

// "Total Hours: All / Lesser than / Greater than N" comparator — matches
// Zoho's Total Hours filter. `value` is {mode, amount}.
export default function HoursComparatorFilter({ label = 'Total Hours', value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const onClick = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const mode = value?.mode || 'all';
  const amount = value?.amount ?? '';
  const modeLabel = MODES.find(([k]) => k === mode)?.[1] || 'All';
  const summary = mode === 'all' ? 'All' : `${modeLabel} ${amount || '—'}`;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12.5px] font-medium border transition-colors whitespace-nowrap ${mode !== 'all' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'}`}
      >
        <span className="max-w-[150px] truncate">{label}: {summary}</span> <ChevronDown size={12} className="flex-shrink-0" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-48 bg-white border border-slate-200 rounded-lg shadow-lg py-1">
          {MODES.map(([k, l]) => (
            <button
              key={k}
              onClick={() => { onChange({ mode: k, amount: k === 'all' ? '' : amount }); if (k === 'all') setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-[12.5px] transition-colors ${mode === k ? 'text-blue-600 font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}
            >
              {l}
            </button>
          ))}
          {mode !== 'all' && (
            <div className="px-3 pt-2 pb-1 border-t border-slate-100 mt-1">
              <input
                type="number" min="0" step="0.5" value={amount} autoFocus
                onChange={e => onChange({ mode, amount: e.target.value })}
                placeholder="Hours"
                className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12.5px] focus:outline-none focus:border-blue-400"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
