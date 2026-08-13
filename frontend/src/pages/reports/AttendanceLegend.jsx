import React from 'react';
import { X } from 'lucide-react';
import { LEGEND } from './attendanceCodes';

// The footer legend and the full status list, shared by the two calendar grids
// (Employee Present/Absent Status and Muster Roll) so a key on one can never
// disagree with the key on the other.

// Colours for the legend bars. Deliberately the saturated version of each
// code's own cell tint, so a bar reads as the same thing the pill does.
export const BAR_COLOR = {
  P: '#059669', HD: '#0d9488', A: '#dc2626', W: '#d97706', H: '#0284c7',
  CL: '#2563eb', CO: '#9333ea', LWP: '#e11d48', PM: '#0891b2', L: '#7c3aed',
};

// Sits under the grid it explains, not above the filter panel where it competes
// with the controls. The trailing "…" opens the full list, which would
// otherwise only be reachable from a filter panel that starts closed.
export const LegendBar = React.forwardRef(function LegendBar({ onOpenAll }, ref) {
  return (
    <div ref={ref} className="flex items-center gap-x-1 gap-y-1.5 flex-wrap px-4 py-3 border-t border-slate-200 bg-white text-[12.5px] text-slate-600">
      {LEGEND.map(([code, label]) => (
        <span key={code} className="flex items-center gap-2 pr-3 border-r border-slate-200 last:border-r-0">
          <span className="w-[3px] h-4 rounded-sm flex-shrink-0" style={{ background: BAR_COLOR[code] || '#94a3b8' }} />
          <span className="whitespace-nowrap"><span className="font-medium text-slate-700">{code}</span> - {label}</span>
        </span>
      ))}
      <button
        onClick={onOpenAll}
        title="All statuses" aria-label="All statuses"
        className="ml-1 px-2 py-0.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors leading-none text-[15px]"
      >
        …
      </button>
    </div>
  );
});

// The complete code list as a slide-over. The footer bar only has room for one
// line of them.
export function StatusPanel({ onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-900/20" />
      <div onClick={e => e.stopPropagation()} className="relative bg-white w-full max-w-[320px] h-full shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h3 className="text-[15px] font-semibold text-slate-800">Status</h3>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {LEGEND.map(([code, label]) => (
            <div key={code} className="flex items-center gap-3 px-5 py-2.5">
              <span className="w-1 h-5 rounded-sm flex-shrink-0" style={{ background: BAR_COLOR[code] || '#94a3b8' }} />
              <span className="text-[13.5px] text-slate-700">
                <span className="font-medium">{code}</span> - {label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
