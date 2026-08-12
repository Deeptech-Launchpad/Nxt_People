import React, { useState, useEffect, useRef } from 'react';
import { ChevronUp, X } from 'lucide-react';

const OPERATORS = [['is', 'Is'], ['lt', 'Lesser than'], ['gt', 'Greater than'], ['between', 'Between']];

// Experience is a numeric comparator in Zoho — "Experience : Is / Lesser than
// / Greater than / Between  [n] Year(s)" — not a checkbox list of tenure
// bands. Bands are how the *chart* groups people; the filter works on the raw
// number of years, so "greater than 3" doesn't have to line up with a band
// boundary. `value` is {op, from, to}.
export default function ExperienceFilter({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onClick = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const active = !!value?.op;
  const op = value?.op || 'is';
  const from = value?.from ?? '';
  const to = value?.to ?? '';
  const opLabel = OPERATORS.find(([k]) => k === op)?.[1] || 'Is';

  const set = patch => onChange({ op, from, to, ...patch });

  if (!active) {
    return (
      <button
        onClick={() => onChange({ op: 'is', from: '', to: '' })}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[13px] border border-slate-300 bg-white text-slate-600 hover:border-slate-400 transition-colors whitespace-nowrap"
      >
        Experience
      </button>
    );
  }

  return (
    <div className="relative flex items-center gap-2 px-3 py-1 rounded border border-blue-300 bg-blue-50 text-[13px] whitespace-nowrap" ref={ref}>
      <span className="text-slate-600">Experience :</span>
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1 text-blue-700 font-medium">
        {opLabel} <ChevronUp size={13} className={`transition-transform ${open ? '' : 'rotate-180'}`} />
      </button>
      <input
        type="number" min="0" value={from} onChange={e => set({ from: e.target.value })}
        className="w-12 border border-slate-200 rounded px-1.5 py-0.5 text-[13px] text-center focus:outline-none focus:border-blue-400"
      />
      {op === 'between' && (
        <>
          <span className="text-slate-400">-</span>
          <input
            type="number" min="0" value={to} onChange={e => set({ to: e.target.value })}
            className="w-12 border border-slate-200 rounded px-1.5 py-0.5 text-[13px] text-center focus:outline-none focus:border-blue-400"
          />
        </>
      )}
      <span className="text-slate-500">Year(s)</span>
      <button onClick={() => onChange(null)} title="Clear" className="text-slate-400 hover:text-slate-600">
        <X size={13} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-44 bg-white border border-slate-200 rounded-lg shadow-lg py-1">
          {OPERATORS.map(([k, l]) => (
            <button
              key={k}
              onClick={() => { set({ op: k }); setOpen(false); }}
              className={`w-full text-left px-4 py-2 text-[13px] transition-colors ${op === k ? 'bg-blue-50 text-blue-600 font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}
            >
              {l}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
