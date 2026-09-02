import React from 'react';

/* The All Data dropdown. Every option below "All Data" is a NARROWING of what
 * the caller may already see — the server applies the reporting-line
 * restriction first and these only add to it, so this can never widen access
 * even though it looks like a data-scope switch. */
const OPTIONS = [
  { value: 'all', label: 'All Data' },
  { value: 'reportees_and_me', label: "Reportees + My Data" },
  { value: 'reportees', label: "Reportees' Data" },
  { value: 'direct', label: "Direct Reportees' Data" },
  { value: 'my', label: 'My Data' },
];

export default function ScopeSelect({ value, onChange }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      title="Data scope"
      className="h-10 border border-slate-200 rounded-lg px-3 text-[15px] text-slate-700 bg-white focus:outline-none focus:border-brand-400"
    >
      {OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
