import React, { useEffect, useRef, useState } from 'react';
import { MoreVertical } from 'lucide-react';

/* ── The row "…" menu ───────────────────────────────────────────────────────
 *  The reference puts View / Edit / Delete behind one button at the end of the
 *  row rather than spreading icons across the column, which is why our rows
 *  looked busier than theirs. Approve and Reject stay as icons — they are the
 *  reason somebody opened the page, and burying them costs a click on the one
 *  action that matters.
 *
 *  Items with `disabled` render greyed with their reason as the tooltip, so a
 *  thing we have not built says so instead of failing when pressed.
 * ────────────────────────────────────────────────────────────────────────── */
export default function RowMenu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const [up, setUp] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  // Rows near the bottom of a long table would otherwise open a menu that
  // falls off the viewport with nothing to scroll to.
  const toggle = () => {
    const r = ref.current?.getBoundingClientRect();
    setUp(!!r && window.innerHeight - r.bottom < 200);
    setOpen(o => !o);
  };

  const usable = items.filter(Boolean);
  if (!usable.length) return null;

  return (
    <div ref={ref} className="relative inline-block">
      <button onClick={toggle} title="More" aria-label="More actions"
        className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors
          ${open ? 'bg-slate-100 text-slate-700' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'}`}>
        <MoreVertical size={16} />
      </button>
      {open && (
        <div className={`absolute right-0 ${up ? 'bottom-full mb-1' : 'top-full mt-1'}
          min-w-[160px] bg-white rounded-xl shadow-xl border border-slate-200 py-1 z-40`}>
          {usable.map(it => (
            <button
              key={it.label}
              disabled={!!it.disabled}
              title={it.disabled || undefined}
              onClick={() => { if (it.disabled) return; setOpen(false); it.onClick(); }}
              className={`w-full text-left px-4 py-2 text-[14px] flex items-center gap-2.5
                ${it.disabled ? 'text-slate-300 cursor-not-allowed'
                  : it.danger ? 'text-rose-600 hover:bg-rose-50' : 'text-slate-700 hover:bg-slate-50'}`}>
              {it.icon}{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
