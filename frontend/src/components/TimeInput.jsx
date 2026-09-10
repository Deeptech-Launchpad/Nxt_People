import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { useLocaleFormat, formatTime } from '../utils/datetime';

/* A time field that honours the organisation's 12/24-hour setting.
 *
 * Settings → Organization Setup → Organization Policy has carried
 * `locale.timeFormat` for a long time, and every DISPLAYED time already obeys
 * it through utils/datetime. Every time somebody had to TYPE went on showing
 * 24-hour anyway, because a native <input type="time"> renders in the browser's
 * own locale and there is no attribute, property or stylesheet that changes it.
 * The setting was not being ignored; it could not reach that control at all.
 *
 * So this is the control instead: a text field showing "09:30 AM" with a
 * dropdown of half-hour steps, exactly the shape Zoho uses. It still speaks
 * canonical 24-hour "HH:MM" to its caller and to the API, so nothing downstream
 * has to know which format the org is on.
 *
 * On a 24-hour org it renders the native input, which is the better control
 * when there is no AM/PM to disambiguate.
 *
 * Typing is accepted as well as picking, because a keyboard is faster than a
 * list of 48 rows: "9", "930", "9:30", "9:30 pm", "0930" and "21:30" all parse.
 */

const PAD = (n) => String(n).padStart(2, '0');

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

/** Every half hour of the day, for the dropdown. */
function slots(stepMinutes) {
  const out = [];
  for (let mins = 0; mins < 24 * 60; mins += stepMinutes) {
    out.push(`${PAD(Math.floor(mins / 60))}:${PAD(mins % 60)}`);
  }
  return out;
}

export default function TimeInput({
  value,                    // "HH:MM" (24h) or ''
  onChange,                 // (value: "HH:MM" | '') => void
  step = 30,                // dropdown granularity, in minutes
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
  const boxRef = useRef(null);
  const listRef = useRef(null);

  const options = useMemo(() => slots(step), [step]);

  // While typing, the field shows what was typed; otherwise the stored value
  // in the org's format. Committing on blur rather than on every keystroke
  // means a half-typed "9:3" is never pushed to the caller as 9:03.
  const display = open ? draft : formatTime(value, timeFormat);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) commit();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  });

  // Scroll the current value into view when the list opens.
  useEffect(() => {
    if (!open || !listRef.current || !value) return;
    listRef.current.querySelector(`[data-t="${value}"]`)
      ?.scrollIntoView({ block: 'center' });
  }, [open, value]);

  const commit = () => {
    setOpen(false);
    const text = draft.trim();
    if (text === '') { if (value) onChange(''); return; }
    const parsed = parseTimeInput(text, { assumePm });
    // Unparseable input reverts rather than clearing — losing a value somebody
    // already set because the last keystroke was a typo is the worse outcome.
    if (parsed) onChange(parsed);
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
    <div ref={boxRef} className="relative">
      <input
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
      <Clock size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-300" />

      {open && (
        <div
          ref={listRef}
          className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg"
        >
          {options.map(t => (
            <button
              key={t}
              type="button"
              data-t={t}
              // mousedown, not click: the input's own blur would close the list
              // before a click ever landed.
              onMouseDown={e => { e.preventDefault(); onChange(t); setOpen(false); }}
              className={`w-full px-3 py-1.5 text-left text-[14px] hover:bg-slate-50
                ${t === value ? 'bg-brand-50 font-medium text-brand-700' : 'text-slate-600'}`}
            >
              {formatTime(t, '12')}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
