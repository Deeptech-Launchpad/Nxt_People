import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clock } from 'lucide-react';
import { useLocaleFormat, formatTime } from '../utils/datetime';

/* A time field that honours the organisation's 12/24-hour setting.
 *
 * Settings → Organization Setup → Organization Policy has carried
 * `locale.timeFormat` for a long time, and every DISPLAYED time already obeys
 * it through utils/datetime. Every field somebody had to TYPE went on showing
 * 24-hour anyway, because a native <input type="time"> renders in the browser's
 * own locale and there is no attribute, property or stylesheet that changes it.
 * The setting was not being ignored; it could not reach that control at all.
 *
 * So this is the control instead, and it is the browser's own picker in shape:
 * three columns — hour, minute, AM/PM — scrolled to what is currently set. An
 * earlier version offered a list of half-hour slots, which decided on the
 * user's behalf that nobody starts at 09:12. They do — one of the permissions
 * on file is 0.57 hours — and a picker that cannot express a real time is worse
 * than no picker.
 *
 * The panel is rendered through a portal, positioned against the input rather
 * than nested inside it. Its first home was an absolutely positioned child,
 * which the day-row table clipped to a two-row sliver: that table needs
 * overflow-hidden for its rounded corners, and overflow-hidden clips a dropdown
 * however high its z-index. Nothing above it can crop a portal.
 *
 * Typing is the faster path and is always available: "9", "930", "9:30",
 * "9:30 pm", "0930" and "21:30" all parse. The columns are for the times of day
 * people prefer to point at.
 *
 * It speaks canonical 24-hour "HH:MM" to its caller and to the API, so nothing
 * downstream has to know which format the org is on. A 24-hour org keeps the
 * native input, which is the better control when there is no AM/PM to
 * disambiguate.
 */

const PAD = (n) => String(n).padStart(2, '0');
const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);          // 1..12
const MINUTES = Array.from({ length: 60 }, (_, i) => i);            // 0..59
const MERIDIEMS = ['AM', 'PM'];

const PANEL_HEIGHT = 208;   // max-h-52, so the flip decision knows the size

/** Anything a person might reasonably type -> "HH:MM", or null. */
export function parseTimeInput(raw, { assumePm = null } = {}) {
  const text = String(raw || '').trim().toLowerCase();
  if (!text) return null;

  const meridiem = /(^|[^a-z])(a|p)\.?m?\.?$/.exec(text);
  const suffix = meridiem ? meridiem[2] : null;
  const digits = text.replace(/[^0-9:]/g, '');
  if (!digits) return null;

  let h;
  let m = 0;

  if (digits.includes(':')) {
    const [hh, mm] = digits.split(':');
    h = parseInt(hh, 10);
    m = mm === '' ? 0 : parseInt(mm.slice(0, 2), 10);
  } else if (digits.length <= 2) {
    h = parseInt(digits, 10);
  } else {
    // "930" -> 9:30, "0930" -> 09:30, "1345" -> 13:45
    h = parseInt(digits.slice(0, digits.length - 2), 10);
    m = parseInt(digits.slice(-2), 10);
  }

  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (m > 59) return null;

  if (suffix === 'p' && h < 12) h += 12;
  else if (suffix === 'a' && h === 12) h = 0;
  /* No AM/PM typed and an hour that could be either: fall back to what the
   * caller says is likely — an end time after a morning start is an afternoon
   * far more often than a 1am finish. Without a hint, take it literally. */
  else if (!suffix && assumePm === true && h < 12) h += 12;

  if (h > 23) return null;
  return `${PAD(h)}:${PAD(m)}`;
}

/** "13:45" -> { hour12: 1, minute: 45, meridiem: 'PM' } */
function partsOf(value) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value || ''));
  if (!m) return null;
  const h24 = parseInt(m[1], 10);
  return {
    hour12: h24 % 12 || 12,
    minute: parseInt(m[2], 10),
    meridiem: h24 >= 12 ? 'PM' : 'AM',
  };
}

function toValue({ hour12, minute, meridiem }) {
  let h = hour12 % 12;
  if (meridiem === 'PM') h += 12;
  return `${PAD(h)}:${PAD(minute)}`;
}

export default function TimeInput({
  value,
  onChange,
  disabled = false,
  required = false,
  placeholder,
  className = '',
  id,
  /* When the field is an END time, an unqualified "5" almost always means the
     afternoon. Set by the caller because only it knows the field's role. */
  assumePm = null,
}) {
  const { timeFormat } = useLocaleFormat();
  const is12 = String(timeFormat) !== '24';

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [rect, setRect] = useState(null);
  const inputRef = useRef(null);
  const panelRef = useRef(null);
  const colRefs = { hour: useRef(null), minute: useRef(null), meridiem: useRef(null) };

  /* What the columns should highlight when nothing is set yet. A picker that
   * opens on midnight makes every daytime choice a long scroll. */
  const parts = partsOf(value) || { hour12: 9, minute: 0, meridiem: assumePm ? 'PM' : 'AM' };

  // While typing, the field shows what was typed; otherwise the stored value in
  // the org's format. Committing on blur rather than on every keystroke means a
  // half-typed "9:3" is never pushed to the caller as 9:03.
  const display = open ? draft : formatTime(value, timeFormat);

  const commit = () => {
    setOpen(false);
    const text = draft.trim();
    if (text === '') { if (value) onChange(''); return; }
    const parsed = parseTimeInput(text, { assumePm });
    // Unparseable input reverts rather than clearing — losing a value somebody
    // already set because the last keystroke was a typo is the worse outcome.
    if (parsed) onChange(parsed);
  };

  const place = () => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Flip above when there is no room below — a panel that opens off-screen
    // cannot be scrolled to, because it is fixed.
    const below = window.innerHeight - r.bottom;
    setRect({
      left: r.left,
      top: below < PANEL_HEIGHT + 8 ? r.top - PANEL_HEIGHT - 4 : r.bottom + 4,
      width: r.width,
    });
  };

  useLayoutEffect(() => { if (open) place(); }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (inputRef.current?.contains(e.target)) return;
      if (panelRef.current?.contains(e.target)) return;
      commit();
    };
    // Capture, so a scroll inside any ancestor repositions the panel rather
    // than leaving it stranded where the field used to be.
    const onScrollOrResize = () => place();
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  });

  // Each column opens on its current selection rather than at midnight.
  useEffect(() => {
    if (!open) return;
    for (const key of ['hour', 'minute', 'meridiem']) {
      colRefs[key].current?.querySelector('[data-selected="true"]')
        ?.scrollIntoView({ block: 'center' });
    }
  }, [open]);

  const set = (patch) => {
    const next = toValue({ ...parts, ...patch });
    onChange(next);
    setDraft(formatTime(next, timeFormat));
  };

  if (!is12) {
    return (
      <input
        id={id}
        type="time"
        value={value || ''}
        disabled={disabled}
        required={required}
        onChange={e => onChange(e.target.value)}
        className={className}
      />
    );
  }

  const Column = ({ name, items, selected, render }) => (
    <div ref={colRefs[name]} className="w-[52px] overflow-y-auto border-r border-slate-100 last:border-r-0">
      {items.map(item => {
        const isSel = item === selected;
        return (
          <button
            key={item}
            type="button"
            data-selected={isSel}
            // mousedown, not click: the input's blur would close the panel
            // before a click ever landed.
            onMouseDown={e => { e.preventDefault(); set(render.patch(item)); }}
            className={`w-full py-1.5 text-center text-[13px] tabular-nums
              ${isSel ? 'bg-brand-600 text-white font-semibold' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            {render.label(item)}
          </button>
        );
      })}
    </div>
  );

  return (
    <>
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={display}
          disabled={disabled}
          required={required}
          placeholder={placeholder || 'hh:mm AM'}
          onFocus={() => { setDraft(formatTime(value, timeFormat)); setOpen(true); }}
          onChange={e => { setDraft(e.target.value); if (!open) setOpen(true); }}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { e.preventDefault(); setDraft(formatTime(value, timeFormat)); setOpen(false); }
          }}
          className={className}
        />
        <Clock size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-300" />
      </div>

      {open && rect && createPortal(
        <div
          ref={panelRef}
          style={{ position: 'fixed', left: rect.left, top: rect.top, minWidth: Math.max(rect.width, 160) }}
          className="z-[100] flex h-52 rounded-lg border border-slate-200 bg-white shadow-xl"
        >
          <Column name="hour" items={HOURS} selected={parts.hour12}
            render={{ label: PAD, patch: h => ({ hour12: h }) }} />
          <Column name="minute" items={MINUTES} selected={parts.minute}
            render={{ label: PAD, patch: m => ({ minute: m }) }} />
          <Column name="meridiem" items={MERIDIEMS} selected={parts.meridiem}
            render={{ label: x => x, patch: x => ({ meridiem: x }) }} />
        </div>,
        document.body
      )}
    </>
  );
}
