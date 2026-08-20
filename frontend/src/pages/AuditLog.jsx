import React, { useEffect, useState, useCallback } from 'react';
import { History, ChevronDown, ChevronRight, Filter, RotateCw } from 'lucide-react';
import api from '../utils/api';

// Who changed what, and when.
//
// Configuration changes were recorded nowhere until now: somebody could alter
// the rule that decides whether a day counts as present — and so eventually
// what people are paid — and nothing anywhere said who or what. The records
// exist now; this is where they are read.
//
// A row shows the summary. Expanding shows every field that moved, with the
// value it came from beside the value it went to, because "the policy was
// saved" is never the question anyone actually has.

const fmt = (v) => {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (typeof v === 'object') return JSON.stringify(v);
  if (v === '') return '(blank)';
  return String(v);
};

const when = (iso) => new Date(iso).toLocaleString('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
});

const ACTION_STYLE = {
  CREATE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  UPDATE: 'bg-blue-50 text-blue-700 border-blue-200',
  DELETE: 'bg-rose-50 text-rose-700 border-rose-200',
  APPROVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECT: 'bg-amber-50 text-amber-700 border-amber-200',
};

export default function AuditLog() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState({});
  const [filters, setFilters] = useState({ resource: '', action: '', from: '', to: '' });
  const [resources, setResources] = useState([]);

  const LIMIT = 50;

  const load = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    for (const [k, v] of Object.entries(filters)) if (v) q.set(k, v);
    api.get(`/audit?${q.toString()}`)
      .then(r => { setRows(r.data.data || []); setTotal(r.data.total || 0); })
      .catch(() => { setRows([]); setTotal(0); })
      .finally(() => setLoading(false));
  }, [page, filters]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api.get('/audit/summary')
      .then(r => setResources([...new Set((r.data.data || []).map(x => x.resource))].sort()))
      .catch(() => setResources([]));
  }, []);

  const setFilter = (k, v) => { setPage(1); setFilters(f => ({ ...f, [k]: v })); };

  const pages = Math.max(1, Math.ceil(total / LIMIT));
  const inputClass = 'text-[13.5px] rounded-md border border-slate-300 px-2.5 py-1.5 bg-white';

  return (
    <div className="bg-white min-h-[calc(100vh-8rem)]">
      <div className="px-6 py-4 border-b border-slate-200">
        <div className="flex items-center gap-2.5">
          <History size={18} className="text-slate-500" />
          <h1 className="text-[17px] font-semibold text-slate-800">Change history</h1>
        </div>
        <p className="text-[13px] text-slate-500 mt-1 max-w-[640px]">
          Every change an administrator makes to configuration, and who made it. Expand a
          row to see each setting that moved and what it moved from.
        </p>
      </div>

      <div className="px-6 py-3 border-b border-slate-200 flex flex-wrap items-center gap-3">
        <Filter size={15} className="text-slate-400" />
        <select value={filters.resource} onChange={e => setFilter('resource', e.target.value)}
          aria-label="Filter by area" className={inputClass}>
          <option value="">All areas</option>
          {resources.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={filters.action} onChange={e => setFilter('action', e.target.value)}
          aria-label="Filter by action" className={inputClass}>
          <option value="">All actions</option>
          {['CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT'].map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <label className="flex items-center gap-2 text-[13px] text-slate-500">
          From
          <input type="date" value={filters.from} onChange={e => setFilter('from', e.target.value)}
            className={inputClass} />
        </label>
        <label className="flex items-center gap-2 text-[13px] text-slate-500">
          To
          <input type="date" value={filters.to} onChange={e => setFilter('to', e.target.value)}
            className={inputClass} />
        </label>
        <button onClick={load}
          className="flex items-center gap-1.5 border border-slate-200 hover:bg-slate-50 px-3 py-1.5 rounded-md text-[13px] font-medium text-slate-600">
          <RotateCw size={14} /> Refresh
        </button>
        <span className="text-[12.5px] text-slate-400 ml-auto">
          {loading ? 'Loading…' : `${total} change${total === 1 ? '' : 's'}`}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[14px] min-w-[760px]">
          <thead>
            <tr className="text-left text-[11.5px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
              <th className="w-8"></th>
              <th className="px-4 py-2.5 font-medium">When</th>
              <th className="px-4 py-2.5 font-medium">Who</th>
              <th className="px-4 py-2.5 font-medium">Action</th>
              <th className="px-4 py-2.5 font-medium">Area</th>
              <th className="px-4 py-2.5 font-medium">What changed</th>
            </tr>
          </thead>
          <tbody>
            {!loading && rows.length === 0 && (
              <tr><td colSpan={6} className="py-12 text-center text-slate-400">
                No changes recorded for these filters.
              </td></tr>
            )}
            {rows.map(r => {
              const fields = r.changes?.fields || [];
              const isOpen = !!open[r._id];
              const who = r.actor?.firstName
                ? `${r.actor.firstName} ${r.actor.lastName || ''}`.trim()
                : (r.actor?.email || 'Unknown');
              return (
                <React.Fragment key={r._id}>
                  <tr className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="pl-4">
                      {fields.length > 0 && (
                        <button
                          onClick={() => setOpen(o => ({ ...o, [r._id]: !o[r._id] }))}
                          aria-label={isOpen ? 'Hide details' : 'Show details'}
                          className="text-slate-400 hover:text-slate-700">
                          {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap tabular-nums">{when(r.createdAt)}</td>
                    <td className="px-4 py-2.5">
                      <div className="text-slate-800">{who}</div>
                      <div className="text-[12px] text-slate-400">{r.actor?.role || ''}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-[11.5px] font-medium px-2 py-0.5 rounded border ${
                        ACTION_STYLE[r.action] || 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                        {r.action}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{r.resource}</td>
                    <td className="px-4 py-2.5 text-slate-500">
                      {r.changes?.summary || (fields.length ? `${fields.length} field(s)` : '—')}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-slate-100 bg-slate-50">
                      <td></td>
                      <td colSpan={5} className="px-4 py-3">
                        <table className="text-[13px]">
                          <tbody>
                            {fields.map((f, i) => (
                              <tr key={i}>
                                <td className="pr-6 py-1 font-mono text-slate-600 align-top">{f.field}</td>
                                <td className="pr-3 py-1 text-slate-400 align-top tabular-nums">{fmt(f.from)}</td>
                                <td className="pr-3 py-1 text-slate-400 align-top">&rarr;</td>
                                <td className="py-1 text-slate-800 font-medium align-top tabular-nums">{fmt(f.to)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 py-4">
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
            className="border border-slate-200 disabled:opacity-40 hover:bg-slate-50 px-3 py-1.5 rounded-md text-[13px]">
            Previous
          </button>
          <span className="text-[13px] text-slate-500 tabular-nums">Page {page} of {pages}</span>
          <button disabled={page >= pages} onClick={() => setPage(p => p + 1)}
            className="border border-slate-200 disabled:opacity-40 hover:bg-slate-50 px-3 py-1.5 rounded-md text-[13px]">
            Next
          </button>
        </div>
      )}
    </div>
  );
}
