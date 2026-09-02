import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft, ChevronRight, ChevronUp, ChevronDown, MoreHorizontal,
  Columns, Maximize2, Minimize2, Search, X,
} from 'lucide-react';
import CriteriaFilter, { CriteriaChips } from './CriteriaFilter';

/* The list screen that Employees, Departments and Designations all are.
 *
 * Built once because they differ only in columns: writing three of these
 * guarantees the sort behaviour, the paging and the empty state drift apart.
 * The caller supplies columns, the field registry for the filter, and a row
 * renderer; everything else — chrome, selection, paging, sort, the column
 * picker — lives here.
 *
 * Employees additionally freezes its first columns, because the reference
 * repeats Employee ID / First Name / Last Name at every horizontal scroll
 * position. `frozenCount` drives that with sticky offsets measured from the
 * rendered header, since the widths depend on the content.
 */

const PAGE_SIZES = [20, 30, 40, 50, 75, 100, 200];

function ColumnPicker({ columns, hidden, onSave }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(hidden);
  const [q, setQ] = useState('');
  const ref = useRef(null);

  useEffect(() => { if (open) { setDraft(hidden); setQ(''); } }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const shown = q.trim()
    ? columns.filter(c => c.label.toLowerCase().includes(q.trim().toLowerCase()))
    : columns;

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)} title="Choose columns"
        className="w-8 h-8 flex items-center justify-center rounded text-slate-500 hover:bg-slate-200/70">
        <Columns size={16} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 w-[260px] bg-white rounded-xl shadow-2xl border border-slate-200 z-40 flex flex-col">
          <div className="p-2.5 border-b border-slate-100">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search"
                className="w-full border border-slate-200 rounded-lg pl-8 pr-2 py-1.5 text-[13.5px] focus:outline-none focus:border-brand-400" />
            </div>
          </div>
          <div className="max-h-[280px] overflow-y-auto py-1">
            {shown.map(c => (
              <label key={c.key} className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-slate-50 cursor-pointer">
                <input type="checkbox" checked={!draft.includes(c.key)}
                  onChange={() => setDraft(d => d.includes(c.key) ? d.filter(x => x !== c.key) : [...d, c.key])}
                  className="w-4 h-4 rounded border-slate-300 accent-brand-600" />
                <span className="text-[14px] text-slate-700">{c.label}</span>
              </label>
            ))}
          </div>
          <div className="flex gap-2 p-2.5 border-t border-slate-100">
            <button onClick={() => { onSave(draft); setOpen(false); }}
              className="flex-1 bg-brand-600 hover:bg-brand-500 text-white py-1.5 rounded-lg text-[14px] font-medium">
              Save
            </button>
            <button onClick={() => setOpen(false)}
              className="flex-1 border border-slate-200 text-slate-600 py-1.5 rounded-lg text-[14px] hover:bg-slate-50">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ToolbarMenu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const usable = items.filter(Boolean);
  if (!usable.length) return null;
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)} title="More"
        className="w-10 h-10 flex items-center justify-center border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50">
        <MoreHorizontal size={17} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 min-w-[210px] bg-white rounded-xl shadow-2xl border border-slate-200 py-1 z-40">
          {usable.map(it => (
            <button key={it.label} disabled={!!it.disabled} title={it.disabled || undefined}
              onClick={() => { if (it.disabled) return; setOpen(false); it.onClick(); }}
              className={`w-full text-left px-4 py-2 text-[14px] flex items-center gap-2.5
                ${it.disabled ? 'text-slate-300 cursor-not-allowed' : 'text-slate-700 hover:bg-slate-50'}`}>
              {it.icon}{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DataListView({
  columns,                 // [{ key, label, sortable, render, width }]
  rows, total, loading,
  page, limit, onPage, onLimit,
  sort, onSort,
  fields, criteria, onCriteria,      // filter panel
  systemFilters = null,
  hidden = [], onHidden,             // column picker
  frozenCount = 0,
  selectable = false, selected = [], onSelected, selectableRow = () => true,
  rowMenu = null,                    // (row) => [{label, icon, onClick, danger, disabled}]
  toolbarLeft = null, toolbarRight = null, toolbarMenu = [],
  emptyText = 'No records found',
  onRowClick = null,
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = useMemo(() => columns.filter(c => !hidden.includes(c.key)), [columns, hidden]);

  /* Sticky offsets for the frozen columns. Measured rather than assumed: the
   * widths depend on the data, so a hard-coded left offset would misalign the
   * moment somebody has a long name. */
  const headRefs = useRef([]);
  const [offsets, setOffsets] = useState([]);
  useEffect(() => {
    if (!frozenCount) return;
    const next = [];
    let acc = selectable ? 44 : 0;
    for (let i = 0; i < frozenCount; i++) {
      next.push(acc);
      acc += headRefs.current[i]?.getBoundingClientRect().width || 0;
    }
    setOffsets(next);
  }, [frozenCount, selectable, visible.length, rows]);

  const pages = Math.max(1, Math.ceil(total / limit));
  const selectableRows = rows.filter(selectableRow);
  const allPicked = selectableRows.length > 0 && selectableRows.every(r => selected.includes(r._id ?? r.id));
  const idOf = r => r._id ?? r.id;

  const th = (c, i) => {
    const isFrozen = i < frozenCount;
    const active = sort?.by === c.key;
    return (
      <th key={c.key}
        ref={el => { if (isFrozen) headRefs.current[i] = el; }}
        className={`px-4 py-2.5 font-medium text-left whitespace-nowrap bg-slate-50
          ${isFrozen ? 'sticky z-20' : ''}`}
        style={isFrozen ? { left: offsets[i] ?? 0 } : undefined}>
        {c.sortable === false ? c.label : (
          <button onClick={() => onSort(c.key)}
            className={`flex items-center gap-1 hover:text-slate-700 ${active ? 'text-slate-700' : ''}`}>
            {c.label}
            {active && (sort.dir === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
          </button>
        )}
      </th>
    );
  };

  return (
    <div className={expanded ? 'fixed inset-0 z-40 bg-slate-50 p-5 overflow-auto' : ''}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-3 min-w-0">{toolbarLeft}</div>
        <div className="flex items-center gap-2.5">
          {toolbarRight}
          <button onClick={() => setExpanded(e => !e)} title={expanded ? 'Exit full screen' : 'Full screen'}
            className="w-10 h-10 flex items-center justify-center border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50">
            {expanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </button>
          <CriteriaFilter fields={fields} criteria={criteria} onApply={onCriteria} systemFilters={systemFilters} />
          <ToolbarMenu items={toolbarMenu} />
        </div>
      </div>

      <CriteriaChips
        criteria={criteria} fields={fields}
        onRemove={(i) => onCriteria(criteria.filter((_, x) => x !== i))}
        onReset={() => onCriteria([])}
      />

      {selectable && selected.length > 0 && (
        <div className="flex items-center gap-3 bg-brand-50 border border-brand-200 rounded-lg px-3.5 py-2 mb-3 w-fit">
          <span className="text-[15px] text-brand-700 font-medium">{selected.length} selected</span>
          <button onClick={() => onSelected([])} className="text-slate-400 hover:text-slate-600"><X size={15} /></button>
        </div>
      )}

      <div className="border border-slate-200 rounded-xl bg-white overflow-auto">
        <table className="w-full text-[15px] min-w-max border-collapse">
          <thead className="bg-slate-50 text-slate-500 text-[13.5px]">
            <tr>
              <th className="w-10 px-2 py-2.5 bg-slate-50 sticky left-0 z-20">
                {onHidden && <ColumnPicker columns={columns} hidden={hidden} onSave={onHidden} />}
              </th>
              {selectable && (
                <th className="w-10 px-2 py-2.5 bg-slate-50 sticky z-20" style={{ left: 44 }}>
                  <input type="checkbox" checked={allPicked} disabled={selectableRows.length === 0}
                    onChange={() => onSelected(allPicked ? [] : selectableRows.map(idOf))}
                    className="w-4 h-4 rounded border-slate-300 accent-brand-600 disabled:opacity-40" />
                </th>
              )}
              {visible.map(th)}
              {rowMenu && <th className="px-3 py-2.5 bg-slate-50" />}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={visible.length + 3} className="py-16 text-center">
                <div className="inline-block w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
              </td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={visible.length + 3} className="py-16 text-center text-slate-400">{emptyText}</td></tr>
            ) : rows.map(r => {
              const id = idOf(r);
              const picked = selected.includes(id);
              return (
                <tr key={id}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                  className={`border-t border-slate-100 ${picked ? 'bg-brand-50/50' : 'hover:bg-slate-50/70'}
                    ${onRowClick ? 'cursor-pointer' : ''}`}>
                  <td className={`w-10 px-2 py-2.5 sticky left-0 z-10 ${picked ? 'bg-brand-50/50' : 'bg-white'}`}>
                    {rowMenu && <RowDots items={rowMenu(r)} />}
                  </td>
                  {selectable && (
                    <td className={`w-10 px-2 py-2.5 sticky z-10 ${picked ? 'bg-brand-50/50' : 'bg-white'}`} style={{ left: 44 }}
                      onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={picked} disabled={!selectableRow(r)}
                        onChange={() => onSelected(picked ? selected.filter(x => x !== id) : [...selected, id])}
                        className="w-4 h-4 rounded border-slate-300 accent-brand-600 disabled:opacity-30" />
                    </td>
                  )}
                  {visible.map((c, i) => (
                    <td key={c.key}
                      className={`px-4 py-2.5 text-slate-700 whitespace-nowrap
                        ${i < frozenCount ? `sticky z-10 ${picked ? 'bg-brand-50/50' : 'bg-white'}` : ''}`}
                      style={i < frozenCount ? { left: offsets[i] ?? 0 } : undefined}>
                      {c.render ? c.render(r) : (r[c.key] ?? <span className="text-slate-300">—</span>)}
                    </td>
                  ))}
                  {rowMenu && <td className="px-3" />}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mt-3 text-[14px] text-slate-500">
        <span>Total Record Count : <span className="text-brand-600 font-medium">{total}</span></span>
        <div className="flex items-center gap-3">
          <select value={limit} onChange={e => onLimit(Number(e.target.value))} title="Rows per page"
            className="border border-slate-200 rounded-lg px-2 py-1 text-[13.5px] text-slate-600 focus:outline-none focus:border-brand-400">
            {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <div className="flex items-center gap-1.5">
            <button disabled={page <= 1} onClick={() => onPage(page - 1)}
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100 disabled:opacity-40">
              <ChevronLeft size={16} />
            </button>
            <span className="tabular-nums">
              {total === 0 ? 0 : (page - 1) * limit + 1} - {Math.min(page * limit, total)}
            </span>
            <button disabled={page >= pages} onClick={() => onPage(page + 1)}
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-100 disabled:opacity-40">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* The row menu lives at the START of the row in the reference, revealed on
 * hover, which is why it sits in the same sticky cell as the column picker. */
function RowDots({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const [up, setUp] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const usable = (items || []).filter(Boolean);
  if (!usable.length) return null;
  return (
    <div ref={ref} className="relative" onClick={e => e.stopPropagation()}>
      <button
        onClick={() => {
          const r = ref.current?.getBoundingClientRect();
          setUp(!!r && window.innerHeight - r.bottom < 200);
          setOpen(o => !o);
        }}
        className="w-7 h-7 flex items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600">
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className={`absolute left-0 ${up ? 'bottom-full mb-1' : 'top-full mt-1'}
          min-w-[170px] bg-white rounded-xl shadow-2xl border border-slate-200 py-1 z-50`}>
          {usable.map(it => (
            <button key={it.label} disabled={!!it.disabled} title={it.disabled || undefined}
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
