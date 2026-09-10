import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
 * The panel is a wheel, not a list. Three columns — hour, minute, AM/PM — each
 * scrolling under a fixed band in the middle, and whatever sits in that band IS
 * the value. Scrolling changes it; there are no arrow buttons to press and no
 * scrollbars to look at.
 *
 * Setting a time takes three choices, so the panel does NOT close when one is
 * made. It closes when the person is done with it: outside click, Escape, or
 * Enter.
 *
 * Two earlier versions got this wrong and are worth naming. The first offered a
 * dropdown of half-hour slots, which decided on the user's behalf that nobody
 * starts at 09:12 — one permission on file is 0.57 hours. The second was an
 * absolutely positioned child of the day-row table, which clipped it to a
 * two-row sliver: that table needs overflow-hidden for its corners, and
 * overflow-hidden crops a dropdown however high its z-index. It renders through
 * a portal now, so nothing above it can crop it.
 *
 * Typing stays the fastest path: "9", "930", "9:30", "9:30 pm", "0930" and
 * "21:30" all parse. Arrow keys step the wheel and wrap at both ends.
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

const ITEM_H = 30;          // one row
const VISIBLE = 5;          // rows on screen; odd so one is centred
const PAD_ROWS = (VISIBLE - 1) / 2;
const PANEL_H = ITEM_H * VISIBLE;

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
  return { hour12: h24 % 12 || 12, minute: parseInt(m[2], 10), meridiem: h24 >= 12 ? 'PM' : 'AM' };
}

function toValue({ hour12, minute, meridiem }) {
  let h = hour12 % 12;
  if (meridiem === 'PM') h += 12;
  return `${PAD(h)}:${PAD(minute)}`;
}

/* One wheel.
 *
 * Declared at module scope, not inside the component. Defining it inside meant
 * a new component type on every render, so React unmounted and remounted all
 * three columns every time a digit changed — which threw the scroll position
 * away mid-gesture and made the wheel feel like it was fighting back.
 */
function Wheel({ items, value, onPick, render, label, active, onActivate, stepRef }) {
  const ref = useRef(null);
  const settling = useRef(null);
  const index = Math.max(0, items.indexOf(value));

  /* The arrow keys are pressed while the TEXT INPUT holds focus — picking a
   * value uses preventDefault so the field keeps it, which is what lets someone
   * keep typing. So the input drives the wheels rather than each wheel
   * listening for keys it will never receive. This is the handle it drives. */
  if (stepRef) {
    stepRef.current = (delta) => {
      const next = items[(index + delta + items.length) % items.length];
      onPick(next);
    };
  }

  // Follow the value when it changes from outside — typing, or the field being
  // opened — without fighting a scroll the user is in the middle of.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const target = index * ITEM_H;
    if (Math.abs(el.scrollTop - target) > 1) el.scrollTop = target;
  }, [index]);

  /* Whatever ends up under the band is the value. Read after the scroll comes
   * to rest rather than on every frame: committing mid-gesture would fire a
   * dozen changes for one flick and make the parent re-render through all of
   * them. */
  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    clearTimeout(settling.current);
    settling.current = setTimeout(() => {
      const i = Math.min(items.length - 1, Math.max(0, Math.round(el.scrollTop / ITEM_H)));
      if (items[i] !== value) onPick(items[i]);
    }, 90);
  };

  useEffect(() => () => clearTimeout(settling.current), []);

  // Wraps at both ends: past 12 is 1, 59 is 00, and PM steps back to AM.
  const step = (delta) => onPick(items[(index + delta + items.length) % items.length]);

  return (
    <div
      ref={ref}
      role="listbox"
      aria-label={label}
      tabIndex={0}
      onScroll={onScroll}
      onKeyDown={e => {
        if (e.key === 'ArrowDown') { e.preventDefault(); step(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
      }}
      onMouseDown={onActivate}
      className={`scrollbar-none w-[58px] overflow-y-auto outline-none snap-y snap-mandatory
        ${active ? 'bg-brand-50/40' : ''}`}
      style={{ height: PANEL_H, scrollBehavior: 'smooth' }}
    >
      {/* Half a panel of blank above and below, so the first and last items can
          reach the middle band. */}
      <div style={{ height: ITEM_H * PAD_ROWS }} />
      {items.map(item => (
        <button
          key={item}
          type="button"
          // mousedown, not click: the input's blur would close the panel before
          // a click ever landed.
          onMouseDown={e => { e.preventDefault(); onPick(item); }}
          style={{ height: ITEM_H }}
          className={`snap-center w-full text-center tabular-nums transition-colors
            ${item === value
              ? 'text-[14px] font-bold text-brand-800'
              : 'text-[13px] text-slate-600 hover:text-slate-900 hover:bg-slate-50'}`}
        >
          {render(item)}
        </button>
      ))}
      <div style={{ height: ITEM_H * PAD_ROWS }} />
    </div>
  );
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
  /** Marks the field as wrong — the caller owns the message. */
  invalid = false,
}) {
  const { timeFormat } = useLocaleFormat();
  const is12 = String(timeFormat) !== '24';

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [rect, setRect] = useState(null);
  const inputRef = useRef(null);
  const panelRef = useRef(null);
  /* Which wheel the arrow keys drive. Clicking or scrolling a column makes it
   * the one, and Left/Right walk between them — so a time can be set from the
   * keyboard alone without ever leaving the field. */
  const [activeCol, setActiveCol] = useState('hour');
  const steppers = { hour: useRef(null), minute: useRef(null), meridiem: useRef(null) };

  /* What the wheels should show when nothing is set yet. A picker that opens on
   * midnight makes every daytime choice a long scroll. */
  const parts = partsOf(value) || { hour12: 9, minute: 0, meridiem: assumePm ? 'PM' : 'AM' };

  const display = open ? draft : formatTime(value, timeFormat);

  const commit = useCallback(() => {
    setOpen(false);
    const text = draft.trim();
    if (text === '') { if (value) onChange(''); return; }
    const parsed = parseTimeInput(text, { assumePm });
    // Unparseable input reverts rather than clearing — losing a value somebody
    // already set because the last keystroke was a typo is the worse outcome.
    if (parsed) onChange(parsed);
  }, [draft, value, onChange, assumePm]);

  const place = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Flip above when there is no room below — a fixed panel that opens
    // off-screen cannot be scrolled to.
    const below = window.innerHeight - r.bottom;
    setRect({
      left: r.left,
      top: below < PANEL_H + 12 ? r.top - PANEL_H - 6 : r.bottom + 6,
      width: r.width,
    });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (inputRef.current?.contains(e.target)) return;
      if (panelRef.current?.contains(e.target)) return;
      commit();
    };
    const reposition = () => place();
    document.addEventListener('mousedown', onDown);
    // Capture, so a scroll in any ancestor moves the panel with the field
    // rather than leaving it where the field used to be.
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, commit, place]);

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
          onFocus={() => { setDraft(formatTime(value, timeFormat)); setActiveCol('hour'); setOpen(true); }}
          onChange={e => { setDraft(e.target.value); if (!open) setOpen(true); }}
          onKeyDown={e => {
            const cols = ['hour', 'minute', 'meridiem'];
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { e.preventDefault(); setDraft(formatTime(value, timeFormat)); setOpen(false); }
            else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              if (!open) { setOpen(true); return; }
              e.preventDefault();
              steppers[activeCol].current?.(e.key === 'ArrowDown' ? 1 : -1);
            } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
              if (!open) return;
              e.preventDefault();
              const i = cols.indexOf(activeCol);
              setActiveCol(cols[(i + (e.key === 'ArrowRight' ? 1 : -1) + cols.length) % cols.length]);
            }
          }}
          className={`${className} ${invalid ? 'border-rose-300 focus:border-rose-400' : ''}`}
        />
        <Clock size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-300" />
      </div>

      {open && rect && createPortal(
        <div
          ref={panelRef}
          style={{ position: 'fixed', left: rect.left, top: rect.top }}
          className="z-[100] rounded-lg border border-slate-200 bg-white shadow-xl"
        >
          <div className="relative flex">
            {/* The band. Whatever sits inside it is the value. */}
            <div
              className="pointer-events-none absolute inset-x-0 z-10 border-y-2 border-brand-500 bg-brand-500/10"
              style={{ top: ITEM_H * PAD_ROWS, height: ITEM_H }}
            />
            <Wheel label="Hour" items={HOURS} value={parts.hour12} render={PAD}
              onPick={h => set({ hour12: h })}
              active={activeCol === 'hour'} onActivate={() => setActiveCol('hour')}
              stepRef={steppers.hour} />
            <Wheel label="Minute" items={MINUTES} value={parts.minute} render={PAD}
              onPick={m => set({ minute: m })}
              active={activeCol === 'minute'} onActivate={() => setActiveCol('minute')}
              stepRef={steppers.minute} />
            <Wheel label="AM or PM" items={MERIDIEMS} value={parts.meridiem} render={x => x}
              onPick={x => set({ meridiem: x })}
              active={activeCol === 'meridiem'} onActivate={() => setActiveCol('meridiem')}
              stepRef={steppers.meridiem} />
          </div>
          <button
            type="button"
            onMouseDown={e => { e.preventDefault(); commit(); }}
            className="w-full border-t border-slate-100 py-1.5 text-[12px] font-medium text-brand-600 hover:bg-slate-50"
          >
            Done
          </button>
        </div>,
        document.body
      )}
    </>
  );
}
