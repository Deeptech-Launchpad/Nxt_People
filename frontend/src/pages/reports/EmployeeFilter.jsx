import React, { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import api from '../../utils/api';

// Multi-select employee filter for the multi-employee table reports — Booked &
// Balance, Leave Type Summary, LOP, Payroll export.
//
// The chip names who is selected rather than only counting them: unlike the
// dimension chips, "which two people" is the whole point of this filter, and a
// bare count would mean reopening the list to find out.
//
// `value` is an array of employee objects. Whole objects rather than ids so the
// chip can render a name without a second lookup; callers send `_id` on.
//
// `multiple={false}` keeps the single-object contract for Presence Hours
// Break-up, which is a one-employee drilldown rather than a filtered table —
// picking two people there has no meaning.
//
// `compact` shows the employee id alone instead of "Employee : ID Full Name".
// It is for the breadcrumb, where the full label grew wide enough to run into
// the centred period navigator; the id is what identifies the row anyway, and
// the full name is one hover away.
export default function EmployeeFilter({ value, onChange, multiple = true, compact = false }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  const selected = Array.isArray(value) ? value : value ? [value] : [];

  useEffect(() => {
    // An empty query lists the first page rather than nothing — the reference
    // opens straight to a browsable list, and requiring a search term first
    // hides the filter from anyone who does not know a name to type.
    const t = setTimeout(() => {
      api.get(`/employees?limit=25${query.trim() ? `&search=${encodeURIComponent(query.trim())}` : ''}`)
        .then(r => setResults(r.data.data || []))
        .catch(() => setResults([]));
    }, query.trim() ? 250 : 0);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const onClick = e => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const toggle = emp => {
    const has = selected.some(e => e._id === emp._id);
    if (!multiple) { onChange(has ? null : emp); setOpen(false); return; }
    onChange(has ? selected.filter(e => e._id !== emp._id) : [...selected, emp]);
  };

  const clear = () => onChange(multiple ? [] : null);

  const summary = selected
    .map(e => `${e.employeeId || ''} ${e.firstName} ${e.lastName}`.trim())
    .join(', ');

  return (
    <div className="relative" ref={boxRef}>
      <div
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-[13px] border transition-colors whitespace-nowrap ${
          selected.length ? 'bg-blue-50 border-blue-300 text-blue-700 font-medium' : 'bg-white border-slate-300 text-slate-600 hover:border-slate-400'
        }`}
      >
        <button onClick={() => setOpen(o => !o)} className={`flex items-center gap-1.5 ${compact ? 'max-w-[130px]' : 'max-w-[260px]'}`}>
          <span className="truncate" title={summary || 'Employee'}>
            {!selected.length
              ? 'Employee'
              : compact
                ? (selected[0].employeeId || `${selected[0].firstName} ${selected[0].lastName}`)
                : `Employee : ${summary}`}
          </span>
          {multiple && selected.length > 0 && (
            <span className="bg-blue-600 text-white text-[10px] font-bold rounded px-1.5 py-0.5 leading-none flex-shrink-0">
              {selected.length}
            </span>
          )}
        </button>
        {selected.length > 0 && (
          <button onClick={clear} aria-label="Clear employee filter" className="text-blue-400 hover:text-blue-700 flex-shrink-0">
            <X size={13} />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-72 bg-white border border-slate-200 rounded-lg shadow-lg">
          <div className="p-2">
            <input
              value={query} onChange={e => setQuery(e.target.value)} placeholder="Search" autoFocus
              className="w-full border border-slate-200 rounded px-3 py-1.5 text-[13px] focus:outline-none focus:border-blue-400"
            />
          </div>
          <div className="max-h-60 overflow-y-auto pb-1">
            {results.length === 0 ? (
              <p className="px-3 py-3 text-[13px] text-slate-500">No results found</p>
            ) : results.map(emp => (
              <label key={emp._id} className="flex items-center gap-2.5 px-3 py-1.5 text-[13px] text-slate-700 hover:bg-slate-50 cursor-pointer transition-colors">
                <input
                  type="checkbox" checked={selected.some(e => e._id === emp._id)} onChange={() => toggle(emp)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 flex-shrink-0"
                />
                <span className="w-6 h-6 rounded-full bg-slate-200 text-slate-600 text-[10px] font-semibold flex items-center justify-center flex-shrink-0">
                  {(emp.firstName?.[0] || '')}{(emp.lastName?.[0] || '')}
                </span>
                <span className="truncate" title={`${emp.employeeId} ${emp.firstName} ${emp.lastName}`}>
                  <span className="text-slate-400 mr-1">{emp.employeeId}</span>
                  {emp.firstName} {emp.lastName}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
