import React from 'react';
import { Calendar } from 'lucide-react';

// Compact "📅 From Date: 01/01/2026" chip — matches Zoho's inline date
// filter style (icon + label + value in one bordered pill) instead of a
// stacked label-above-a-wide-native-input layout.
export default function DateChip({ label, value, onChange }) {
  return (
    <label className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-[12.5px] cursor-pointer whitespace-nowrap">
      <Calendar size={12} className="text-slate-400 flex-shrink-0" />
      <span className="text-slate-500">{label}:</span>
      <input
        type="date"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="border-none outline-none bg-transparent text-[12.5px] text-slate-700 w-[108px] p-0"
      />
    </label>
  );
}
