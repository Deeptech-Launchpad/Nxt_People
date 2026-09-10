import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, ChevronDown, X } from 'lucide-react';
import { labelOf } from './useEmployeeList';

/* Type-to-search employee picker for the Operations forms.
 *
 * The Apply Leave form used a plain <select> over every active employee. At a
 * hundred and fifty people that is a scroll and nothing else — you cannot type
 * a name, and a native select's own keyboard search only matches from the start
 * of the option text, which here is the employee code. So looking somebody up
 * by name was impossible unless you already knew their number.
 *
 * Four other Operations screens had already solved this, each with its own
 * hand-written filter-and-list. This is that same idiom in one place so the
 * next screen does not need a fifth copy.
 *
 * Matches on code, first name, last name and department, because "who is in
 * Production" is a real way people look somebody up.
 */
export default function EmployeePicker({
  people,
  value,                       // employee _id, or '' for none
  onChange,                    // (id) => void
  loading = false,
  disabled = false,
  required = false,
  placeholder = 'Search by name, code or department',
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const boxRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const selected = useMemo(
    () => people.find(p => String(p._id) === String(value)) || null,
    [people, value]
  );

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return people;
    return people.filter(p =>
      labelOf(p).toLowerCase().includes(needle) ||
      String(p.department || '').toLowerCase().includes(needle)
    );
  }, [q, people]);

  // Closing on an outside click rather than on blur: blur fires before the
  // option's own click handler, which would close the list and swallow the pick.
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) {
        setOpen(false);
        setQ('');
      }
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // A filtered list can be shorter than where the cursor was.
  useEffect(() => { setCursor(0); }, [q]);

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${cursor}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [cursor, open]);

  const pick = (p) => {
    onChange(p._id);
    setOpen(false);
    setQ('');
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, matches.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
    else if (e.key === 'Enter') {
      // Enter inside the search box must not submit the form behind it.
      e.preventDefault();
      if (matches[cursor]) pick(matches[cursor]);
    } else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); setQ(''); }
  };

  const field = 'w-full border border-slate-200 rounded-xl px-3 py-2.5 text-[15px] focus:outline-none focus:border-brand-400';

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      {/* The closed state reads like the select it replaces. */}
      {!open && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => !disabled && setOpen(true)}
          className={`${field} flex items-center justify-between text-left disabled:opacity-60 disabled:cursor-not-allowed`}
        >
          <span className={selected ? 'text-slate-800' : 'text-slate-400'}>
            {selected ? labelOf(selected) : (loading ? 'Loading employees…' : 'Select an employee')}
          </span>
          <span className="flex items-center gap-1.5 flex-shrink-0">
            {selected && !disabled && (
              <span
                role="button"
                tabIndex={-1}
                aria-label="Clear selection"
                onClick={(e) => { e.stopPropagation(); onChange(''); }}
                className="text-slate-300 hover:text-slate-500"
              >
                <X size={15} />
              </span>
            )}
            <ChevronDown size={16} className="text-slate-400" />
          </span>
        </button>
      )}

      {open && (
        <>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
            <input
              ref={inputRef}
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              className={`${field} pl-9`}
            />
          </div>

          <div
            ref={listRef}
            className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg"
          >
            {loading ? (
              <p className="px-3 py-2.5 text-slate-400 text-sm">Loading employees…</p>
            ) : matches.length === 0 ? (
              <p className="px-3 py-2.5 text-slate-400 text-sm">Nobody matches “{q.trim()}”.</p>
            ) : matches.map((p, i) => (
              <button
                key={p._id}
                type="button"
                data-idx={i}
                onMouseEnter={() => setCursor(i)}
                onClick={() => pick(p)}
                className={`w-full text-left px-3 py-2.5 border-b border-slate-50 last:border-0
                  ${i === cursor ? 'bg-brand-50' : 'hover:bg-slate-50'}`}
              >
                <span className="text-slate-700 text-[15px]">{labelOf(p)}</span>
                {p.department && <span className="text-slate-400 text-sm"> · {p.department}</span>}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Keeps the browser's own "please fill this in" behaviour on the form,
          which the button above cannot provide on its own. */}
      {required && (
        <input
          tabIndex={-1}
          aria-hidden="true"
          required
          value={value || ''}
          onChange={() => {}}
          className="sr-only absolute opacity-0 h-0 w-0 pointer-events-none"
        />
      )}
    </div>
  );
}
