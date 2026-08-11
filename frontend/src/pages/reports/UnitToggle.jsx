import React from 'react';

// "Day / Hour" toggle — matches Zoho's unit switcher on Leave Booked and
// Balance, Employee Leave Balance, and Leave Data for Payroll. Day and
// Hour modes show entirely different columns (Hour is Permission-only),
// not the same table with a unit relabeled.
export default function UnitToggle({ value, onChange }) {
  return (
    <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5">
      {[['day', 'Day'], ['hour', 'Hour']].map(([k, l]) => (
        <button key={k} onClick={() => onChange(k)}
          className={`px-3 py-1.5 text-[13px] font-semibold rounded-md transition-colors ${value === k ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-800'}`}>
          {l}
        </button>
      ))}
    </div>
  );
}
