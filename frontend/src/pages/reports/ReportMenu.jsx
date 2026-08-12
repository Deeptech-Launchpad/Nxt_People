import React, { useState, useRef, useEffect } from 'react';
import { MoreHorizontal, Upload, FileText, Calendar, Printer } from 'lucide-react';

const ICONS = { export: Upload, pdf: FileText, ics: Calendar, print: Printer };

// The "⋯" overflow menu the reference puts beside the funnel on every report.
// Items are supplied by the page, so a report only ever offers what it can
// actually do — Permissions is deliberately absent, since this app has no
// per-report access control and a menu entry that does nothing is worse than
// no entry at all.
export default function ReportMenu({ items = [] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onClick = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  if (!items.length) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        title="More"
        className="p-2 rounded border border-slate-300 bg-white text-slate-500 hover:text-slate-700 hover:border-slate-400 transition-colors"
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-1 w-56 bg-white border border-slate-200 rounded-lg shadow-lg py-1.5">
          {items.map(item => {
            const Icon = ICONS[item.key] || Upload;
            return (
              <button
                key={item.key}
                onClick={() => { setOpen(false); item.onClick(); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-[14px] text-slate-700 hover:bg-slate-50 transition-colors"
                title={item.hint}
              >
                <Icon size={15} className="text-slate-400 flex-shrink-0" />
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
