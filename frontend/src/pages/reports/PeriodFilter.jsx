import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, Filter } from 'lucide-react';

// "Period ▾" dropdown panel — matches Zoho's pattern of a chip that opens a
// panel of preset options plus an explicit Submit button, rather than a
// plain <select> that reloads the instant you change it. `options` is
// [{key, label, value}] — `value` is opaque to this component (a year
// count, a month count, a {start,end} date range — whatever the caller's
// endpoint needs), so the same component drives Headcount's "Last N
// Years", the Trend pages' "Last N Months", and Experience Wise Exit's
// date-range presets.
export default function PeriodFilter({ options, selectedKey, onSubmit }) {
  const [open, setOpen] = useState(false);
  const [pendingKey, setPendingKey] = useState(selectedKey);
  const ref = useRef(null);

  useEffect(() => { setPendingKey(selectedKey); }, [selectedKey]);

  useEffect(() => {
    const onClick = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const current = options.find(o => o.key === selectedKey);

  const submit = () => {
    const opt = options.find(o => o.key === pendingKey);
    if (opt) onSubmit(opt.value, opt.key);
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium border border-slate-200 bg-white text-slate-700 hover:border-slate-300 transition-colors">
        Period: {current?.label || '—'} <ChevronDown size={13} />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-64 bg-white border border-slate-200 rounded-lg shadow-lg py-2">
          <div className="max-h-72 overflow-y-auto">
            {options.map(o => (
              <button
                key={o.key}
                onClick={() => setPendingKey(o.key)}
                className={`w-full text-left px-3 py-2 text-[13px] transition-colors ${pendingKey === o.key ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className="px-3 pt-2 border-t border-slate-100 mt-1">
            <button onClick={submit} className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors">
              <Filter size={13} /> Submit
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
