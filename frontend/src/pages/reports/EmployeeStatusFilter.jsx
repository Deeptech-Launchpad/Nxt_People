import React from 'react';

const OPTIONS = [['all', 'All'], ['active', 'Active'], ['exited', 'Exited']];

// Active/Exited employee filter chip — mirrors Zoho's Employee Status
// filter (Active Users / Ex-Employees). This app has no separate "Active
// Non-User" or "Login Disabled" concept, so only the two real distinctions
// this schema can make are offered, plus "All" to match prior behavior.
export default function EmployeeStatusFilter({ value, onChange }) {
  return (
    <div>
      <label className="block text-[13px] font-medium text-slate-600 mb-1">Employee Status</label>
      <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5">
        {OPTIONS.map(([k, l]) => (
          <button key={k} onClick={() => onChange(k)}
            className={`px-3 py-1.5 text-[13px] font-semibold rounded-md transition-colors ${value === k ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-800'}`}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}
