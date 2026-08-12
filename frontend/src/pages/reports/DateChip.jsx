import React from 'react';
import { Calendar } from 'lucide-react';

// Compact "📅 From : 01/01/2026" chip — matches Zoho's inline date filter
// style (icon + label + value in one bordered pill). `disabled` greys it out
// the way Zoho does when a Period preset is driving the range instead, so the
// dates stay readable but clearly aren't the active control.
export default function DateChip({ label, value, onChange, disabled = false }) {
  return (
    <label
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded border text-[13px] whitespace-nowrap ${
        disabled
          ? 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed'
          : 'border-slate-300 bg-white cursor-pointer'
      }`}
    >
      <Calendar size={13} className={disabled ? 'text-slate-300 flex-shrink-0' : 'text-slate-400 flex-shrink-0'} />
      <span className={disabled ? 'text-slate-400' : 'text-slate-500'}>{label} :</span>
      <input
        type="date"
        value={value}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
        className={`border-none outline-none bg-transparent text-[13px] w-[112px] p-0 ${disabled ? 'text-slate-400 cursor-not-allowed' : 'text-slate-700'}`}
      />
    </label>
  );
}
