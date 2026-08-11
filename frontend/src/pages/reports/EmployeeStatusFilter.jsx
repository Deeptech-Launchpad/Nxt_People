import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';

const OPTIONS = [['all', 'All'], ['active', 'Active'], ['exited', 'Exited']];

// Compact "Employee Status: All ▾" dropdown chip — mirrors Zoho's Employee
// Status filter (Active Users / Ex-Employees) and matches the same dense
// pill styling every other filter chip in the row uses, instead of a
// bulky always-expanded 3-button segmented control. This app has no
// separate "Active Non-User" or "Login Disabled" concept, so only the two
// real distinctions this schema can make are offered, plus "All".
export default function EmployeeStatusFilter({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const onClick = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);
  const label = OPTIONS.find(([k]) => k === value)?.[1] || 'All';
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12.5px] font-medium border border-slate-200 bg-white text-slate-700 hover:border-slate-300 transition-colors whitespace-nowrap">
        Employee Status: {label} <ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-36 bg-white border border-slate-200 rounded-lg shadow-lg py-1">
          {OPTIONS.map(([k, l]) => (
            <button key={k} onClick={() => { onChange(k); setOpen(false); }} className={`w-full text-left px-3 py-1.5 text-[12.5px] transition-colors ${value === k ? 'text-blue-600 font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}>{l}</button>
          ))}
        </div>
      )}
    </div>
  );
}
