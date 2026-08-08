// dateFormat.js — shared date-only parsing/formatting helpers.
//
// Parsing a "YYYY-MM-DD" string with `new Date(str)` treats it as UTC
// midnight, which shifts a day back for IST (UTC+5:30) users. parseLocalDate
// appends T00:00:00 so it's parsed as local time instead.
export function parseLocalDate(dateStr) {
  if (!dateStr) return null;
  if (typeof dateStr !== 'string' || dateStr.includes('T')) return new Date(dateStr);
  return new Date(dateStr + 'T00:00:00');
}

// Locale-formatted date-only string. Never renders "Invalid Date" for a
// missing/blank/unparseable value — returns '—' instead.
export function fmtDate(d, opts = { day: '2-digit', month: 'short', year: 'numeric' }) {
  const dt = d instanceof Date ? d : parseLocalDate(d);
  if (!dt || Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-IN', opts);
}
