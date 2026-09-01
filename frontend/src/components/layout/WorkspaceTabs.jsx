import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';

/* ── A tab strip that never runs off the end of the bar ────────────────────
 *  Seven Leave Tracker tabs do not fit beside the global icons, so the last
 *  one truncated to "Excep" and sat underneath the + button. The reference
 *  keeps five and puts the remainder behind a "…", which is what this does.
 *
 *  Measured rather than a fixed count: how many fit depends on the window,
 *  the labels, and which workspace this is. A hidden copy of the full strip
 *  is rendered to measure real label widths, then only what fits is drawn.
 *
 *  The active tab is always pulled into view even when its natural position
 *  is past the fold — the reference does the same, which is why it shows
 *  "Exceptional Working days" while the two tabs before it sit in the menu.
 *  A highlighted tab you cannot see is worse than one out of order.
 * ────────────────────────────────────────────────────────────────────────── */
const MORE_BUTTON_WIDTH = 52;

export default function WorkspaceTabs({ tabs, activeId, onSelect }) {
  const rowRef = useRef(null);
  const measureRef = useRef(null);
  const menuRef = useRef(null);
  const [fitCount, setFitCount] = useState(tabs.length);
  const [menuOpen, setMenuOpen] = useState(false);

  // Re-measure on resize and whenever the tab set changes.
  useLayoutEffect(() => {
    const row = rowRef.current;
    const measure = measureRef.current;
    if (!row || !measure) return;

    const recompute = () => {
      const widths = Array.from(measure.children).map(c => c.getBoundingClientRect().width);
      const available = row.getBoundingClientRect().width;
      if (!widths.length || !available) return;

      let used = 0;
      let n = 0;
      for (let i = 0; i < widths.length; i++) {
        // Every tab but the last has to leave room for the "…" button, since
        // stopping here means there is a remainder to put behind it.
        const reserve = i < widths.length - 1 ? MORE_BUTTON_WIDTH : 0;
        if (used + widths[i] + reserve > available) break;
        used += widths[i];
        n++;
      }
      setFitCount(Math.max(1, n));
    };

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(row);
    return () => ro.disconnect();
  }, [tabs]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e) => { if (!menuRef.current?.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const activeIndex = tabs.findIndex(t => t.id === activeId);
  let visible = tabs.slice(0, fitCount);
  let overflow = tabs.slice(fitCount);

  // Active tab past the fold: trade it with the last visible slot so it stays
  // on screen, and the one it displaced moves into the menu.
  if (activeIndex >= fitCount && fitCount > 0) {
    const displaced = visible[fitCount - 1];
    visible = [...visible.slice(0, fitCount - 1), tabs[activeIndex]];
    overflow = tabs.slice(fitCount).filter(t => t.id !== activeId);
    overflow = [displaced, ...overflow];
  }

  const tabClass = (active) =>
    `h-full px-4 flex items-center text-[16px] border-b-[3px] transition-all duration-150 tracking-[-0.01em] flex-shrink-0 whitespace-nowrap
     ${active ? 'border-blue-400 text-white font-semibold' : 'border-transparent text-white/60 font-medium hover:text-white'}`;

  return (
    <div ref={rowRef} className="flex items-center h-full min-w-0 flex-1 relative">
      {/* Hidden full-width copy, only ever read for its measurements. */}
      <div ref={measureRef} aria-hidden className="absolute invisible pointer-events-none flex whitespace-nowrap" style={{ top: -9999, left: 0 }}>
        {tabs.map(t => <span key={t.id} className={tabClass(false)}>{t.label}</span>)}
      </div>

      {visible.map(t => (
        <button key={t.id} onClick={() => onSelect(t)} className={tabClass(t.id === activeId)}>
          {t.label}
        </button>
      ))}

      {overflow.length > 0 && (
        <div ref={menuRef} className="relative flex-shrink-0">
          <button
            onClick={() => setMenuOpen(o => !o)}
            aria-label="More tabs" title="More"
            className={`h-full px-3 flex items-center border-b-[3px] border-transparent transition-colors
              ${menuOpen ? 'text-white' : 'text-white/60 hover:text-white'}`}
          >
            <MoreHorizontal size={18} />
          </button>
          {menuOpen && (
            <div className="absolute left-0 top-full mt-1 min-w-[220px] bg-white rounded-lg shadow-xl border border-slate-200 py-1 z-50">
              {overflow.map(t => (
                <button
                  key={t.id}
                  onClick={() => { setMenuOpen(false); onSelect(t); }}
                  className={`w-full text-left px-4 py-2.5 text-[14px] hover:bg-slate-50 ${
                    t.id === activeId ? 'text-brand-600 font-medium' : 'text-slate-700'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
