import React, { useState, useEffect } from 'react';
import { Filter } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';

const todayCA = () => new Date().toLocaleDateString('en-CA');
const monthStartCA = () => new Date(new Date().setDate(1)).toLocaleDateString('en-CA');

function EmployeeCell({ row }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0">
        {row.firstName?.[0]}{row.lastName?.[0]}
      </div>
      <div className="min-w-0">
        <p className="text-[14px] font-medium text-slate-800 truncate">{row.firstName} {row.lastName}</p>
        {row.department && <p className="text-[12px] text-slate-400 truncate">{row.department}</p>}
      </div>
    </div>
  );
}

// Generic "fetch an array of rows, render as a configurable table" report
// page — covers every report whose backend endpoint returns { data: [...] }.
// columns: [{ key, header, align, format?(value, row) }]. A column with
// key === 'employee' auto-renders the avatar/name/department cell instead
// of needing a format function repeated on every caller.
export default function TableReportPage({ title, subtitle, endpoint, filterType = 'range', columns, emptyText = 'No data for this period', rowKey }) {
  const [date, setDate] = useState(todayCA());
  const [year, setYear] = useState(new Date().getFullYear());
  const [startDate, setStartDate] = useState(monthStartCA());
  const [endDate, setEndDate] = useState(todayCA());
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterType === 'date') params.set('date', date);
    if (filterType === 'year') params.set('year', year);
    if (filterType === 'range') { params.set('startDate', startDate); params.set('endDate', endDate); }
    api.get(`${endpoint}?${params}`)
      .then(r => setRows(Array.isArray(r.data.data) ? r.data.data : []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  const filters = filterType === 'none' ? null : (
    <>
      {filterType === 'date' && (
        <div>
          <label className="block text-[13px] font-medium text-slate-600 mb-1">Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-1.5 text-[14px] focus:outline-none focus:border-blue-400" />
        </div>
      )}
      {filterType === 'year' && (
        <div>
          <label className="block text-[13px] font-medium text-slate-600 mb-1">Year</label>
          <select value={year} onChange={e => setYear(Number(e.target.value))} className="border border-slate-200 rounded-lg px-3 py-1.5 text-[14px] focus:outline-none focus:border-blue-400">
            {[year, year - 1, year - 2].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      )}
      {filterType === 'range' && (
        <>
          <div>
            <label className="block text-[13px] font-medium text-slate-600 mb-1">From</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-1.5 text-[14px] focus:outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="block text-[13px] font-medium text-slate-600 mb-1">To</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-1.5 text-[14px] focus:outline-none focus:border-blue-400" />
          </div>
        </>
      )}
      <button onClick={load} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
        <Filter size={14} /> Apply
      </button>
    </>
  );

  return (
    <ReportShell title={title} subtitle={subtitle} filters={filters} loading={loading}>
      <div className="overflow-x-auto">
        <table className="w-full text-[14px]">
          <thead className="bg-slate-50 text-[12px] font-bold text-slate-500 uppercase">
            <tr>{columns.map(c => <th key={c.key} className={`px-4 py-2.5 ${c.align === 'right' ? 'text-right' : 'text-left'}`}>{c.header}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {rows.length === 0 ? (
              <tr><td colSpan={columns.length} className="text-center py-10 text-slate-400">{emptyText}</td></tr>
            ) : rows.map((row, i) => (
              <tr key={rowKey ? rowKey(row) : row._id || i}>
                {columns.map(c => (
                  <td key={c.key} className={`px-4 py-2.5 ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}>
                    {c.key === 'employee' ? <EmployeeCell row={row} /> : c.format ? c.format(row[c.key], row) : (row[c.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ReportShell>
  );
}
