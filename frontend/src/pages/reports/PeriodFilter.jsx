import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';

// "Period ▾" dropdown — matches Zoho's pattern of a chip that opens a list of
// presets, applied by the filter row's Submit button rather than the instant
// you click. `options` is [{key, label, value, group}] — `value` is opaque to
// this component (a year count, a month count, a {start,end} range), so the
// same component drives Headcount's "Last N Years", the trend pages' "Last N
// Months", and Experience Wise Exit's date presets.
//
// `group` puts an option under a section heading (Zoho groups them as YEAR /
// MONTH(S)); ungrouped options render first, unheaded. A `custom` option lets
// the caller expose From/To date fields — this component just reports the
// selection, the caller decides what Custom means.
export default function PeriodFilter({ options, selectedKey, onChange, onSubmit }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onClick = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const current = options.find(o => o.key === selectedKey);

  const pick = (o) => {
    setOpen(false);
    // onChange is the modern callback (caller applies on Submit); onSubmit is
    // kept for the pages that still apply immediately.
    if (onChange) onChange(o.value, o.key);
    else if (onSubmit) onSubmit(o.value, o.key);
  };

  // Preserve declaration order while grouping, so ungrouped options stay on top.
  const groups = [];
  options.forEach(o => {
    const name = o.group || '';
    let g = groups.find(x => x.name === name);
    if (!g) { g = { name, items: [] }; groups.push(g); }
    g.items.push(o);
  });

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded text-[13px] border border-slate-300 bg-white text-slate-700 hover:border-slate-400 transition-colors whitespace-nowrap"
      >
        {/* "Custom", not "—", when the range matches no preset: stepping the
            header's period navigator lands on ranges no preset names, and a
            dash reads as "unset" rather than "set to something specific". */}
        <span className="max-w-[190px] truncate">Period : {current?.label || 'Custom'}</span>
        <ChevronDown size={13} className="text-slate-400 flex-shrink-0" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-64 bg-white border border-slate-200 rounded-lg shadow-lg py-1 max-h-80 overflow-y-auto">
          {groups.map(g => (
            <div key={g.name || '_'}>
              {g.name && (
                <p className="px-4 pt-3 pb-1 text-[11px] font-bold text-slate-400 uppercase tracking-wide">{g.name}</p>
              )}
              {g.items.map(o => (
                <button
                  key={o.key}
                  onClick={() => pick(o)}
                  className={`w-full text-left px-4 py-2 text-[13px] transition-colors ${selectedKey === o.key ? 'bg-blue-50 text-blue-600 font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
