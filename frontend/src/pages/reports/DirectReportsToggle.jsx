import React from 'react';

// "Show only direct reportees" checkbox — lets even full-access roles
// (admin/hr/director) voluntarily narrow a report to their own direct
// reports, on top of the automatic manager-only scoping the backend
// already applies to the 'manager' role.
export default function DirectReportsToggle({ value, onChange }) {
  return (
    <label className="flex items-center gap-2 px-1 text-[13px] text-slate-600 cursor-pointer select-none">
      <input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} className="rounded border-slate-300" />
      Show only direct reportees
    </label>
  );
}
