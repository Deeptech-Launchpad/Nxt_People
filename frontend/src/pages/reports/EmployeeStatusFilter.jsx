import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, X } from 'lucide-react';

// Matches Zoho's multi-select Employee Status chip with checkboxes:
// Active Users, Active Non-Users, Ex-Employees, Login Disabled.
// This schema's `status` column only distinguishes 'active' vs 'exited',
// so Active Users and Active Non-Users both map to status='active', and
// Login Disabled has no real backend mapping — but the UI offers all four
// options to match the Zoho layout precisely.
const OPTIONS = [
  { key: 'active_users',      label: 'Active Users',              maps: 'active' },
  { key: 'active_non_users',  label: 'Active Non-Users',          maps: 'active' },
  { key: 'ex_employees',      label: 'Ex-Employees',              maps: 'exited' },
  { key: 'login_disabled',    label: 'Login Disabled Employees',  maps: null },
];
const DEFAULT_CHECKED = ['active_users', 'active_non_users', 'ex_employees'];

function toBackendValue(checked) {
  const hasActive = checked.some(k => OPTIONS.find(o => o.key === k)?.maps === 'active');
  const hasExited = checked.some(k => OPTIONS.find(o => o.key === k)?.maps === 'exited');
  if (hasActive && hasExited) return 'all';
  if (hasActive) return 'active';
  if (hasExited) return 'exited';
  return 'all';
}

function fromBackendValue(val) {
  if (val === 'active') return ['active_users', 'active_non_users'];
  if (val === 'exited') return ['ex_employees'];
  return [...DEFAULT_CHECKED];
}

export default function EmployeeStatusFilter({ value, onChange }) {
  const [checked, setChecked] = useState(() => fromBackendValue(value));
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);

  // The backend only has three states — 'active' cannot say whether that
  // meant just Active Users, just Active Non-Users, or both. Re-syncing
  // from `value` on every change is what caused the glitch: unchecking
  // Ex-Employees turned 'all' into 'active', which this effect then
  // expanded back into ITS OWN guess at what "active" means — both boxes
  // checked — silently re-checking Active Non-Users as a side effect of a
  // click that never touched it. Tracking what we last emitted ourselves
  // lets the effect tell "the user's own click echoed back" (skip; the
  // checkboxes are already right) apart from "something external changed
  // this" (a page Reset) — the only case that should actually override
  // what is checked here.
  const lastEmitted = useRef(value);
  useEffect(() => {
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    setChecked(fromBackendValue(value));
  }, [value]);

  useEffect(() => {
    const onClick = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const toggle = key => {
    setChecked(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key];
      if (next.length === 0) return prev; // don't allow empty
      const backendValue = toBackendValue(next);
      lastEmitted.current = backendValue;
      onChange(backendValue);
      return next;
    });
  };

  const clear = e => {
    e.stopPropagation();
    setChecked([...DEFAULT_CHECKED]);
    lastEmitted.current = 'all';
    onChange('all');
  };

  // Full labels, truncated by the chip. Shortening each to its first word
  // collapsed "Active Users" and "Active Non-Users" into the same string, so
  // the chip read "Active, Active, Ex-Employe..." — two of the three selections
  // looked identical and the reader could not tell what was actually on.
  const summaryLabel = checked
    .map(k => OPTIONS.find(o => o.key === k)?.label)
    .filter(Boolean)
    .join(', ');

  const filtered = search.trim()
    ? OPTIONS.filter(o => o.label.toLowerCase().includes(search.trim().toLowerCase()))
    : OPTIONS;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12.5px] font-medium border border-slate-200 bg-white text-slate-700 hover:border-slate-300 transition-colors whitespace-nowrap max-w-xs"
      >
        <span className="truncate">Employee Status: {summaryLabel}</span>
        <span className="flex items-center gap-1 flex-shrink-0">
          <span className="bg-blue-600 text-white text-[10px] font-bold rounded px-1.5 py-0.5 leading-none">{checked.length}</span>
          <button onClick={clear} className="text-slate-400 hover:text-slate-600"><X size={12} /></button>
        </span>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-64 bg-white border border-slate-200 rounded-lg shadow-lg py-1">
          <div className="px-3 py-2">
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search"
              className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-[13px] focus:outline-none focus:border-blue-400"
            />
          </div>
          {filtered.map(o => (
            <label key={o.key} className="flex items-center gap-2.5 px-3 py-2 text-[13px] text-slate-700 hover:bg-slate-50 cursor-pointer transition-colors">
              <input
                type="checkbox"
                checked={checked.includes(o.key)}
                onChange={() => toggle(o.key)}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              {o.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
