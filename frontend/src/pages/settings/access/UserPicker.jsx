import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';

// The user picker the reference opens in four places — assigning a role,
// assigning a specific role, adding an administrator, and naming an employee
// in an applicability group. One component, because four copies of a searchable
// list of 150 people is four places for the search to behave differently.
//
// Each entry is the employee id and the name on one line and the email under
// it, as the reference has it: two people can share a name, and the id and the
// email are what separate them.

// A stored photo_url that 404s renders as a broken-image glyph, which is what
// several of these rows did. Falling back to the initial on error means a dead
// link looks like no photo rather than like a fault.
const Avatar = ({ user, size = 32 }) => {
  const [broken, setBroken] = useState(false);
  const initial = (user?.name || user?.email || '?').trim().charAt(0).toUpperCase();

  if (!user?.photo || broken) {
    return (
      <div
        className="rounded-full bg-slate-200 text-slate-500 grid place-items-center flex-shrink-0 text-[11px] font-medium"
        style={{ width: size, height: size }}
      >
        {initial}
      </div>
    );
  }
  return (
    <img
      src={user.photo} alt="" width={size} height={size}
      onError={() => setBroken(true)}
      className="rounded-full object-cover flex-shrink-0 bg-slate-200"
      style={{ width: size, height: size }}
    />
  );
};

export { Avatar };

export default function UserPicker({ users, value, onChange, placeholder = 'Select', exclude = [] }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const box = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const away = e => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const pool = useMemo(
    () => users.filter(u => !exclude.includes(u.id)),
    [users, exclude]
  );
  const chosen = pool.find(u => u.id === value);
  const shown = useMemo(() => {
    const t = term.trim().toLowerCase();
    if (!t) return pool;
    return pool.filter(u => `${u.employeeId || ''} ${u.name || ''} ${u.email || ''}`.toLowerCase().includes(t));
  }, [pool, term]);

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => { setOpen(o => !o); setTerm(''); }}
        className="w-full border border-slate-300 rounded-md px-3 py-2 text-[14px] bg-white flex items-center justify-between gap-2 text-left focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
      >
        <span className={chosen ? 'truncate text-slate-800' : 'truncate text-slate-400'}>
          {chosen ? `${chosen.employeeId ? chosen.employeeId + ' - ' : ''}${chosen.name}` : placeholder}
        </span>
        <ChevronDown size={15} className="text-slate-400 flex-shrink-0" />
      </button>

      {open && (
        <div className="absolute z-40 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
            <Search size={14} className="text-slate-400" />
            <input
              autoFocus value={term} onChange={e => setTerm(e.target.value)}
              placeholder="Search"
              className="w-full text-[13.5px] outline-none"
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {shown.length === 0 && <p className="px-3 py-4 text-[13px] text-slate-500 text-center">No matches.</p>}
            {shown.map(u => (
              <button
                key={u.id} type="button"
                onClick={() => { onChange(u.id, u); setOpen(false); }}
                className={`w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-slate-50 ${
                  u.id === value ? 'bg-blue-50' : ''
                }`}
              >
                <Avatar user={u} />
                <span className="min-w-0">
                  <span className="block text-[13.5px] text-slate-800 truncate">
                    {u.employeeId ? `${u.employeeId} - ` : ''}{u.name}
                  </span>
                  <span className="block text-[12.5px] text-slate-500 truncate">{u.email}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
