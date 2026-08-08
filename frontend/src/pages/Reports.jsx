import React, { useState, useEffect } from 'react';
import { Download, Filter, BarChart2 } from 'lucide-react';
import api from '../utils/api';
import toast from 'react-hot-toast';
import BackButton from '../components/BackButton';

const DEPTS = ['All','Engineering','HR','Sales','Marketing','Finance','Design','Product'];
const STATUS_STYLE = { present:'bg-emerald-100 text-emerald-700', late:'bg-amber-100 text-amber-700', absent:'bg-red-100 text-red-700', 'half-day':'bg-blue-100 text-blue-700', leave:'bg-purple-100 text-purple-700' };

export default function Reports() {
  const [records, setRecords] = useState([]);
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('detail');
  const [filters, setFilters] = useState({
    startDate: new Date(new Date().setDate(1)).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
    department: ''
  });

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({ startDate: filters.startDate, endDate: filters.endDate, ...(filters.department && filters.department !== 'All' ? { department: filters.department } : {}) });
    Promise.all([
      api.get(`/reports/attendance?${params}`),
      // Bug #20 fix: pass the same date range to summary so it's not stuck on current month
      api.get(`/reports/summary?${params}`)
    ]).then(([r1, r2]) => { setRecords(r1.data.data); setSummary(r2.data.data); })
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report')).finally(() => setLoading(false));
  };

  useEffect(load, []);

  // Quote-doubles embedded quotes (so a name like Raj "Bunny" Kumar doesn't
  // break the field boundary) and defuses formula injection — a value
  // starting with =, +, -, or @ is interpreted as a formula by Excel/Sheets
  // on open. Mirrors the same escaping the backend's compliance CSV exports
  // already use (routes/payroll.js csvEscape).
  const csvField = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };

  const exportCSV = () => {
    const data = tab === 'detail' ? records : summary;
    if (!data?.length) return toast.error('No data to export for the selected filters');
    let csv;
    if (tab === 'detail') {
      csv = 'Employee,ID,Department,Date,Check In,Check Out,Hours,Status\n' +
        data.map(r => [
          `${r.employee?.firstName} ${r.employee?.lastName}`, r.employee?.employeeId, r.employee?.department,
          new Date(r.date).toLocaleDateString(),
          r.checkIn ? new Date(r.checkIn).toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata' }) : '',
          r.checkOut ? new Date(r.checkOut).toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata' }) : '',
          r.workingHours || 0, r.status,
        ].map(csvField).join(',')).join('\n');
    } else {
      csv = 'Employee,Department,Present,Absent,Late,Total Hours\n' +
        data.map(r => [
          `${r.employee?.firstName} ${r.employee?.lastName}`, r.employee?.department,
          r.present, r.absent, r.late, r.totalHours,
        ].map(csvField).join(',')).join('\n');
    }
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 10);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nxt-people-report-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const fmt = d => d ? new Date(d).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'}) : '—';

  return (
    <div className="space-y-5">
      <div className="pt-5 pb-1">
        <BackButton to="/reports" label="Reports" />
      </div>
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1.5">From</label>
            <input type="date" value={filters.startDate} onChange={e=>setFilters({...filters,startDate:e.target.value})} className="border border-slate-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400"/>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1.5">To</label>
            <input type="date" value={filters.endDate} onChange={e=>setFilters({...filters,endDate:e.target.value})} className="border border-slate-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400"/>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1.5">Department</label>
            <select value={filters.department} onChange={e=>setFilters({...filters,department:e.target.value})} className="border border-slate-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400">
              {DEPTS.map(d=><option key={d}>{d}</option>)}
            </select>
          </div>
          <button onClick={load} disabled={loading}
            className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white px-4 py-2.5 rounded-xl text-base font-medium transition-colors shadow-sm shadow-brand-500/25 disabled:opacity-60">
            <Filter size={15}/> Apply Filters
          </button>
          <button onClick={exportCSV}
            className="flex items-center gap-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 px-4 py-2.5 rounded-xl text-base font-medium transition-colors border border-emerald-200">
            <Download size={15}/> Export CSV
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="border-b border-slate-100 flex">
          {[['detail','Detailed Report'],['summary','Summary Report']].map(([id,label])=>(
            <button key={id} onClick={()=>setTab(id)} className={`px-6 py-4 text-base font-medium border-b-2 transition-colors ${tab===id?'border-brand-600 text-brand-600':'border-transparent text-slate-500 hover:text-slate-700'}`}>{label}</button>
          ))}
        </div>

        {loading ? <div className="flex justify-center py-12"><div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin"/></div> : (
          <div className="overflow-x-auto">
            {tab === 'detail' ? (
              <table className="w-full">
                <thead><tr className="bg-slate-50">{['Employee','Department','Date','Check In','Check Out','Hours','Status'].map(h=><th key={h} className={`px-5 py-3 text-sm font-semibold text-slate-500 uppercase tracking-wider ${h==='Hours' ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-slate-50">
                  {records.length === 0 ? <tr><td colSpan={7} className="text-center py-12 text-slate-400">No records for selected filters</td></tr> :
                  records.map((r,i) => (
                    <tr key={i} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">{r.employee?.firstName?.[0]}{r.employee?.lastName?.[0]}</div>
                          <span className="text-base font-medium text-slate-700">{r.employee?.firstName} {r.employee?.lastName}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-base text-slate-500">{r.employee?.department}</td>
                      <td className="px-5 py-3.5 text-base text-slate-600">{new Date(r.date).toLocaleDateString('en-US',{day:'2-digit',month:'short',year:'numeric'})}</td>
                      <td className="px-5 py-3.5 text-base text-slate-700">{fmt(r.checkIn)}</td>
                      <td className="px-5 py-3.5 text-base text-slate-700">{fmt(r.checkOut)}</td>
                      <td className="px-5 py-3.5 text-base text-slate-700 text-right tabular-nums">{r.workingHours ? `${Number(r.workingHours).toFixed(1)}h` : '—'}</td>
                      <td className="px-5 py-3.5"><span className={`px-2.5 py-1 rounded-full text-sm font-medium capitalize ${STATUS_STYLE[r.status] || 'bg-slate-100 text-slate-600'}`}>{r.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full">
                <thead><tr className="bg-slate-50">{['Employee','Department','Present','Absent','Late','Total Hours'].map(h=><th key={h} className={`px-5 py-3 text-sm font-semibold text-slate-500 uppercase tracking-wider ${['Present','Absent','Late','Total Hours'].includes(h) ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-slate-50">
                  {summary.length === 0 ? <tr><td colSpan={6} className="text-center py-12 text-slate-400">No data available</td></tr> :
                  summary.map((r,i) => (
                    <tr key={i} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white text-sm font-bold">{r.employee?.firstName?.[0]}{r.employee?.lastName?.[0]}</div>
                          <span className="text-base font-medium text-slate-700">{r.employee?.firstName} {r.employee?.lastName}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-base text-slate-500">{r.employee?.department}</td>
                      <td className="px-5 py-3.5 text-right"><span className="text-base font-medium text-emerald-600 tabular-nums">{r.present}</span></td>
                      <td className="px-5 py-3.5 text-right"><span className="text-base font-medium text-red-500 tabular-nums">{r.absent}</span></td>
                      <td className="px-5 py-3.5 text-right"><span className="text-base font-medium text-amber-600 tabular-nums">{r.late}</span></td>
                      <td className="px-5 py-3.5 text-base font-semibold text-brand-600 text-right tabular-nums">{r.totalHours?.toFixed(1)}h</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
