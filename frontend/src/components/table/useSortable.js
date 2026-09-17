import { useCallback, useRef, useState } from 'react';

/* Client-side column sorting for a table whose rows are all in memory.
 *
 *   const sort = useSortable(rows, {
 *     id: 'payroll-run',                       // remembers the choice for the session
 *     initial: { key: 'name', dir: 'asc' },    // optional
 *     columns: {
 *       name: 'employeeName',                  // a field name
 *       days: r => r.days,                     // or an accessor
 *       joined: { get: r => r.joiningDate, type: 'date' },  // or both, with a type
 *     },
 *   });
 *   <SortableTh sort={sort} k="name" className="...">Name</SortableTh>
 *   {sort.sorted.map(...)}
 *
 * A key with no entry in `columns` reads row[key]. Without a type the column is
 * inferred from its values: numbers (also "1.5 days", "2h", "₹12,000"), ISO
 * dates, otherwise natural case-insensitive text. Blanks sort last both ways.
 * `apply(rows)` sorts another row set with the same state, for tables split
 * into groups under one header. */

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const NUM_RE = /^(?:₹|rs\.?|inr|\$)?\s*([+-]?(?:\d[\d,]*)?\.?\d+)\s*(?:[a-z%]+\.?\s*)*$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}/;
const BLANKS = new Set(['', '-', '—', '–', 'n/a', 'na']);

const isBlank = v => v == null || (typeof v === 'number' && Number.isNaN(v))
  || (typeof v === 'string' && BLANKS.has(v.trim().toLowerCase()));

function toNumber(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v !== 'string') return NaN;
  const m = v.trim().match(NUM_RE);
  return m ? parseFloat(m[1].replace(/,/g, '')) : NaN;
}

function toTime(v) {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return NaN;
  const s = v.trim();
  const dmy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmy) return new Date(+dmy[3], +dmy[2] - 1, +dmy[1]).getTime();
  return Date.parse(s);
}

function inferType(values) {
  const present = values.filter(v => !isBlank(v));
  if (!present.length) return 'text';
  if (present.every(v => !Number.isNaN(toNumber(v)))) return 'number';
  if (present.every(v => v instanceof Date || (typeof v === 'string' && ISO_RE.test(v.trim())))) return 'date';
  return 'text';
}

function readerFor(columns, key) {
  const def = columns?.[key];
  if (typeof def === 'function') return { get: def };
  if (typeof def === 'string') return { get: r => r?.[def] };
  if (def && typeof def === 'object') {
    const g = def.get ?? def.accessor ?? key;
    return { get: typeof g === 'function' ? g : r => r?.[g], type: def.type };
  }
  return { get: r => r?.[key] };
}

export function sortRows(rows, key, dir, columns) {
  const list = Array.isArray(rows) ? rows : [];
  if (!key) return list;
  const { get, type: declared } = readerFor(columns, key);
  const raw = list.map((r, i) => ({ r, i, v: get(r) }));
  const type = declared || inferType(raw.map(x => x.v));
  const conv = type === 'number' ? toNumber : type === 'date' ? toTime : v => String(v);
  const keyed = raw.map(x => {
    if (isBlank(x.v)) return { ...x, k: null };
    const k = conv(x.v);
    return { ...x, k: typeof k === 'number' && Number.isNaN(k) ? null : k };
  });
  const sign = dir === 'desc' ? -1 : 1;
  keyed.sort((a, b) => {
    if (a.k == null || b.k == null) return a.k == null ? (b.k == null ? a.i - b.i : 1) : -1;
    const c = type === 'text' ? collator.compare(a.k, b.k) : a.k - b.k;
    return c ? c * sign : a.i - b.i;
  });
  return keyed.map(x => x.r);
}

const storageKey = id => `table-sort:${id}`;

function readSaved(id) {
  if (!id) return null;
  try {
    const s = JSON.parse(sessionStorage.getItem(storageKey(id)));
    return s && typeof s.key === 'string' ? s : null;
  } catch { return null; }
}

export default function useSortable(rows, { id, initial, columns } = {}) {
  const [state, setState] = useState(() => readSaved(id) || {
    key: initial?.key ?? null, dir: initial?.dir === 'desc' ? 'desc' : 'asc',
  });

  const toggle = useCallback((key) => {
    setState(prev => {
      const next = prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' };
      if (id) {
        try { sessionStorage.setItem(storageKey(id), JSON.stringify(next)); } catch { /* storage unavailable */ }
      }
      return next;
    });
  }, [id]);

  const columnsRef = useRef(columns);
  columnsRef.current = columns;

  const apply = useCallback(
    list => sortRows(list, state.key, state.dir, columnsRef.current),
    [state.key, state.dir],
  );

  const sorted = apply(rows);

  return { sorted, sortKey: state.key, sortDir: state.dir, toggle, apply };
}
