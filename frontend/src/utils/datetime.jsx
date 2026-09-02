import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import api from './api';

/* One place that decides how a time and a date are written.
 *
 * The weekly log showed a shift as "09:30 - 18:00" and the punches beside it as
 * "01:11 PM" — two conventions on one line — because the shift used the raw
 * database strings and the punches ran through a formatter. And every native
 * <input type="date"> rendered US-style, so 2 September read as 09/02/2026.
 *
 * Both are already an ORGANISATION SETTING: Settings -> Organization Setup ->
 * Organization Policy stores `locale.timeFormat` ('12' | '24') and
 * `locale.dateFormat` (dd/MM/yyyy and friends). Nothing read them. This module
 * does, so the switches stop being decorative and the format cannot drift
 * again — every caller asks here rather than reaching for toLocaleString with
 * its own options.
 */

const DEFAULTS = { timeFormat: '12', dateFormat: 'dd/MM/yyyy' };
const LocaleContext = createContext(DEFAULTS);

export function LocaleProvider({ children }) {
  const [locale, setLocale] = useState(DEFAULTS);

  useEffect(() => {
    api.get('/org-details/policy')
      .then(r => {
        const l = r.data?.data?.locale || {};
        setLocale({
          timeFormat: String(l.timeFormat || DEFAULTS.timeFormat),
          dateFormat: l.dateFormat || DEFAULTS.dateFormat,
        });
      })
      /* A failed read must not blank every date on the page, so the defaults
       * stand — and they are the values the settings screen itself defaults
       * to, not a third opinion. */
      .catch(() => {});
  }, []);

  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export const useLocaleFormat = () => useContext(LocaleContext);

/* ── Pure helpers ────────────────────────────────────────────────────────────
 * Deliberately not hooks, so anything outside React — a column renderer, a
 * sort comparator — can use them. They take the format explicitly; the hook
 * versions below fill it in from the org setting.
 * ─────────────────────────────────────────────────────────────────────────── */

/** "09:30:00" or "09:30" -> "9:30 AM" (or "09:30" when the org is on 24h). */
export function formatTime(value, timeFormat = '12') {
  if (!value) return '';
  const m = String(value).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return String(value);
  let h = parseInt(m[1], 10);
  const min = m[2];
  if (String(timeFormat) === '24') return `${String(h).padStart(2, '0')}:${min}`;
  const suffix = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;                       // 0 -> 12 AM, 13 -> 1 PM
  return `${h}:${min} ${suffix}`;
}

/** An ISO timestamp -> a clock time in the org's format, in IST. */
export function formatInstantTime(iso, timeFormat = '12') {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit',
    hour12: String(timeFormat) !== '24',
    timeZone: 'Asia/Kolkata',
  }).replace(/^0/, String(timeFormat) === '24' ? '0' : '');
}

/** A date (Date, ISO string or yyyy-mm-dd) in the org's date format. */
export function formatDate(value, dateFormat = 'dd/MM/yyyy') {
  if (!value) return '';
  const s = String(value).slice(0, 10);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T00:00:00') : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const MM = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  switch (dateFormat) {
    case 'MM/dd/yyyy': return `${MM}/${dd}/${yyyy}`;
    case 'yyyy-MM-dd': return `${yyyy}-${MM}-${dd}`;
    case 'dd-MM-yyyy': return `${dd}-${MM}-${yyyy}`;
    default:           return `${dd}/${MM}/${yyyy}`;
  }
}

/** A range, e.g. a shift: "9:30 AM - 6:00 PM". */
export function formatTimeRange(from, to, timeFormat = '12') {
  const a = formatTime(from, timeFormat);
  const b = formatTime(to, timeFormat);
  if (!a && !b) return '';
  return `${a} - ${b}`;
}

/* ── Hook versions, which read the org setting ───────────────────────────── */
export function useFormat() {
  const { timeFormat, dateFormat } = useLocaleFormat();
  return useMemo(() => ({
    time: v => formatTime(v, timeFormat),
    instant: v => formatInstantTime(v, timeFormat),
    date: v => formatDate(v, dateFormat),
    range: (a, b) => formatTimeRange(a, b, timeFormat),
    timeFormat, dateFormat,
  }), [timeFormat, dateFormat]);
}

/* ── A date input that SHOWS the org format ───────────────────────────────
 *  <input type="date"> always renders in the browser's locale, which is why
 *  2 September appeared as 09/02/2026 on an en-US machine. There is no
 *  attribute to change that. So the value is displayed as text and the native
 *  picker is kept underneath for choosing — you get the org's format and the
 *  calendar, rather than one or the other.
 * ────────────────────────────────────────────────────────────────────────── */
export function DateField({ value, onChange, className = '', disabled, min, max, placeholder }) {
  const { dateFormat } = useLocaleFormat();
  const shown = value ? formatDate(value, dateFormat) : '';

  return (
    <div className={`relative ${className}`}>
      {/* The real control: transparent text, so the native picker button still
          works and keyboard entry still reaches it. */}
      <input
        type="date" value={value || ''} disabled={disabled} min={min} max={max}
        onChange={e => onChange(e.target.value)}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14.5px]
                   focus:outline-none focus:border-brand-400 text-transparent
                   disabled:bg-slate-50 [color-scheme:light]"
      />
      {/* What the user reads. pointer-events-none so every click lands on the
          input beneath, including the calendar icon. */}
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14.5px] pointer-events-none
                       text-slate-800">
        {shown || <span className="text-slate-400">{placeholder || dateFormat.toLowerCase()}</span>}
      </span>
    </div>
  );
}

/* A time input, same idea. Native time inputs follow the browser locale too,
 * so an org on 24-hour would still see AM/PM on a US machine. */
export function TimeField({ value, onChange, className = '', disabled }) {
  const { timeFormat } = useLocaleFormat();
  const shown = value ? formatTime(value, timeFormat) : '';
  return (
    <div className={`relative ${className}`}>
      <input
        type="time" value={value || ''} disabled={disabled}
        onChange={e => onChange(e.target.value)}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14.5px]
                   focus:outline-none focus:border-brand-400 text-transparent
                   disabled:bg-slate-50 [color-scheme:light]"
      />
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14.5px] pointer-events-none text-slate-800">
        {shown || <span className="text-slate-400">--:--</span>}
      </span>
    </div>
  );
}
