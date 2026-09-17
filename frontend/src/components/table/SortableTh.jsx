import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';

export function SortIcon({ active, dir }) {
  if (!active) return <ChevronsUpDown size={12} className="shrink-0 text-slate-300 group-hover/sort:text-slate-400" />;
  return dir === 'asc'
    ? <ChevronUp size={13} className="shrink-0" />
    : <ChevronDown size={13} className="shrink-0" />;
}

export default function SortableTh({ sort, k, className = '', children, ...rest }) {
  if (!sort || !k) return <th className={className} {...rest}>{children}</th>;
  const active = sort.sortKey === k;
  return (
    <th className={className} aria-sort={active ? (sort.sortDir === 'asc' ? 'ascending' : 'descending') : 'none'} {...rest}>
      <button type="button" onClick={() => sort.toggle(k)}
        className={`group/sort inline-flex items-center gap-1 align-middle text-inherit hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded-sm ${active ? 'text-slate-800' : ''}`}>
        {children}
        <SortIcon active={active} dir={sort.sortDir} />
      </button>
    </th>
  );
}
