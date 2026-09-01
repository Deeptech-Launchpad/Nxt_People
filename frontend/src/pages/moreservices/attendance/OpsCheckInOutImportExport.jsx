import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Download, Upload, Search, X } from 'lucide-react';
import api from '../../../utils/api';
import useEmployeeList, { labelOf } from '../leavetracker/useEmployeeList';

/* ── Check-in/out Import & Export ─────────────────────────────────────────
 *  Bulk export of raw attendance, and bulk import to correct or backfill it.
 *  See backend/routes/attendance-import-export.js — import writes through
 *  the same day classification a live check-out uses, so this is a real
 *  write path, not a toy.
 */
const todayStr = () => new Date().toLocaleDateString('en-CA');
const PERIODS = [
  ['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This Week'],
  ['lastweek', 'Last Week'], ['month', 'This Month'], ['lastmonth', 'Last Month'], ['custom', 'Custom'],
];

function periodRange(key) {
  const now = new Date();
  const ymd = (d) => d.toLocaleDateString('en-CA');
  const startOfWeek = (d) => { const x = new Date(d); x.setDate(x.getDate() - x.getDay()); return x; };
  switch (key) {
    case 'today': return { from: ymd(now), to: ymd(now) };
    case 'yesterday': { const y = new Date(now); y.setDate(y.getDate() - 1); return { from: ymd(y), to: ymd(y) }; }
    case 'week': return { from: ymd(startOfWeek(now)), to: ymd(now) };
    case 'lastweek': { const s = startOfWeek(now); const ls = new Date(s); ls.setDate(ls.getDate() - 7);
      const le = new Date(s); le.setDate(le.getDate() - 1); return { from: ymd(ls), to: ymd(le) }; }
    case 'month': return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: ymd(now) };
    case 'lastmonth': { const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const e = new Date(now.getFullYear(), now.getMonth(), 0); return { from: ymd(s), to: ymd(e) }; }
    default: return { from: ymd(now), to: ymd(now) };
  }
}

export default function OpsCheckInOutImportExport() {
  const { people } = useEmployeeList();
  const [period, setPeriod] = useState('month');
  const [custom, setCustom] = useState(periodRange('month'));
  const [empQuery, setEmpQuery] = useState('');
  const [picked, setPicked] = useState(null);
  const [format, setFormat] = useState('xlsx');
  const [downloading, setDownloading] = useState(false);

  const [file, setFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  const range = period === 'custom' ? custom : periodRange(period);
  const matches = empQuery.trim()
    ? people.filter(p => labelOf(p).toLowerCase().includes(empQuery.trim().toLowerCase())).slice(0, 8) : [];

  const download = async () => {
    setDownloading(true);
    try {
      const qs = new URLSearchParams({ from: range.from, to: range.to, format, ...(picked ? { employeeId: picked._id } : {}) });
      const r = await api.get(`/attendance-import-export/export?${qs}`, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `attendance-${range.from}-to-${range.to}.${format === 'csv' ? 'csv' : 'xlsx'}`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Export downloaded');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not export');
    } finally { setDownloading(false); }
  };

  const runImport = async () => {
    if (!file) return toast.error('Choose a file first');
    setImporting(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.post('/attendance-import-export/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setResult(r.data);
      toast.success(r.data.message || 'Import complete');
      setFile(null);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not import that file');
    } finally { setImporting(false); }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Import */}
      <div className="border border-slate-200 rounded-2xl p-6">
        <h3 className="font-display font-semibold text-slate-800 text-[16px] mb-1">Import</h3>
        <p className="text-[13px] text-slate-400 mb-4">
          xls, xlsx or csv, up to 5&nbsp;MB. Columns: Employee Id, Date, First Check-In, Last Check-Out.
          A row that fails is skipped and reported, not silently dropped.
        </p>
        <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-xl py-8 cursor-pointer hover:border-brand-300 transition-colors">
          <Upload size={22} className="text-slate-300 mb-2" />
          <span className="text-[14px] text-slate-500">{file ? file.name : 'Choose a file'}</span>
          <input type="file" accept=".xls,.xlsx,.csv" className="hidden"
            onChange={e => { setFile(e.target.files?.[0] || null); setResult(null); }} />
        </label>
        <button onClick={runImport} disabled={!file || importing}
          className="mt-4 w-full bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white py-2.5 rounded-xl text-[15px] font-medium">
          {importing ? 'Importing…' : 'Import File'}
        </button>

        {result && (
          <div className="mt-4 text-[13.5px]">
            <p className="text-emerald-700 font-medium">{result.updated} row(s) imported</p>
            {result.skipped?.length > 0 && (
              <div className="mt-2 border border-amber-200 bg-amber-50 rounded-xl p-3 max-h-40 overflow-y-auto">
                <p className="text-amber-800 font-medium mb-1">{result.skipped.length} row(s) skipped</p>
                {result.skipped.map((s, i) => (
                  <p key={i} className="text-amber-700">Row {s.row}: {s.reason}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Export */}
      <div className="border border-slate-200 rounded-2xl p-6">
        <h3 className="font-display font-semibold text-slate-800 text-[16px] mb-4">Export</h3>

        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-600 mb-1.5">Period</label>
          <select value={period} onChange={e => { setPeriod(e.target.value); if (e.target.value !== 'custom') setCustom(periodRange(e.target.value)); }}
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-[15px] focus:outline-none focus:border-brand-400">
            {PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>

        {period === 'custom' && (
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1.5">From</label>
              <input type="date" value={custom.from} max={todayStr()} onChange={e => setCustom({ ...custom, from: e.target.value })}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-[15px] focus:outline-none focus:border-brand-400" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1.5">To</label>
              <input type="date" value={custom.to} max={todayStr()} onChange={e => setCustom({ ...custom, to: e.target.value })}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-[15px] focus:outline-none focus:border-brand-400" />
            </div>
          </div>
        )}

        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-600 mb-1.5">Employee (optional — leave blank for everyone)</label>
          {picked ? (
            <div className="flex items-center justify-between border border-slate-200 rounded-xl px-3 py-2.5">
              <span className="text-[15px] text-slate-700">{labelOf(picked)}</span>
              <button onClick={() => setPicked(null)} title="Clear" className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
            </div>
          ) : (
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
              <input value={empQuery} onChange={e => setEmpQuery(e.target.value)} placeholder="Search Employee"
                className="w-full border border-slate-200 rounded-xl pl-9 pr-3 py-2.5 text-[15px] focus:outline-none focus:border-brand-400" />
              {matches.length > 0 && (
                <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-lg">
                  {matches.map(p => (
                    <button key={p._id} onClick={() => { setPicked(p); setEmpQuery(''); }}
                      className="w-full text-left px-3 py-2 text-[14px] text-slate-700 hover:bg-slate-50">
                      {labelOf(p)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mb-5">
          <label className="block text-sm font-medium text-slate-600 mb-1.5">Export as</label>
          <div className="flex gap-4">
            {['xlsx', 'xls', 'csv'].map(f => (
              <label key={f} className="flex items-center gap-1.5 text-[14px] text-slate-700 cursor-pointer">
                <input type="radio" checked={format === f} onChange={() => setFormat(f)} className="accent-brand-600" />
                {f.toUpperCase()}
              </label>
            ))}
          </div>
        </div>

        <button onClick={download} disabled={downloading}
          className="w-full flex items-center justify-center gap-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white py-2.5 rounded-xl text-[15px] font-medium">
          <Download size={16} /> {downloading ? 'Preparing…' : 'Export'}
        </button>
      </div>
    </div>
  );
}
