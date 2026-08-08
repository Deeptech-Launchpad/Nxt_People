import React, { useState, useEffect } from 'react';
import { Download, Filter } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import api from '../utils/api';
import toast from 'react-hot-toast';

const DEPTS = ['All','Engineering','HR','Sales','Marketing','Finance','Design','Product'];
const STATUS_STYLE = { present:'bg-emerald-100 text-emerald-700', absent:'bg-red-100 text-red-700', 'half-day':'bg-blue-100 text-blue-700', leave:'bg-purple-100 text-purple-700' };
const DAILY_COLORS = { Present: '#10b981', Absent: '#ef4444', Leave: '#8b5cf6' };

// "late" isn't its own status anymore — a late employee is still Present;
// the lateness itself now shows in the separate Late/Early column.
const displayStatus = (status) => status === 'late' ? 'present' : status;

// Duration since check-in, formatted like a clock reading (H.MMh) rather than
// a decimal fraction of an hour — 30 minutes reads as "0.30h", not "0.50h".
// Still-open sessions (no check-out yet) count up to "now" instead of
// freezing at 0, so today's in-progress rows show real elapsed time.
const formatDuration = (checkIn, checkOut) => {
  if (!checkIn) return '—';
  const start = new Date(checkIn);
  const end = checkOut ? new Date(checkOut) : new Date();
  const diffMin = Math.max(0, Math.round((end - start) / 60000));
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  return `${h}.${String(m).padStart(2, '0')}h`;
};

// Late = minutes after shift start (already computed server-side). Early =
// minutes checked out before shift end, derived here since it just needs a
// clock-time comparison.
const lateEarly = (r) => {
  if (r.lateMinutes > 0) return { text: `${r.lateMinutes} min`, kind: 'Late' };
  if (r.checkOut && r.shiftEnd) {
    const co = new Date(r.checkOut);
    const coMinutes = co.getHours() * 60 + co.getMinutes();
    const [eh, em] = r.shiftEnd.split(':').map(Number);
    const shiftEndMinutes = eh * 60 + em;
    if (coMinutes < shiftEndMinutes) return { text: `${shiftEndMinutes - coMinutes} min`, kind: 'Early' };
  }
  return null;
};

const todayCA = () => new Date().toLocaleDateString('en-CA');

export default function Reports() {
  const [records, setRecords] = useState([]);
  const [summary, setSummary] = useState([]);
  const [daily, setDaily] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('detail');
  const [filters, setFilters] = useState({
    startDate: new Date(new Date().setDate(1)).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
    department: ''
  });
  const [dailyDate, setDailyDate] = useState(todayCA());

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

  const loadDaily = () => {
    setLoading(true);
    const params = new URLSearchParams({ date: dailyDate, ...(filters.department && filters.department !== 'All' ? { department: filters.department } : {}) });
    api.get(`/reports/daily?${params}`)
      .then(r => setDaily(r.data))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);
  useEffect(() => { if (tab === 'daily' && !daily) loadDaily(); }, [tab]);

  const applyFilters = () => tab === 'daily' ? loadDaily() : load();

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
      csv = 'Employee,ID,Department,Date,Check In,Check Out,Hours,Status,Late/Early\n' +
        data.map(r => {
          const le = lateEarly(r);
          return [
            `${r.employee?.firstName} ${r.employee?.lastName}`, r.employee?.employeeId, r.employee?.department,
            new Date(r.date).toLocaleDateString(),
            r.checkIn ? new Date(r.checkIn).toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata' }) : '',
            r.checkOut ? new Date(r.checkOut).toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata' }) : '',
            formatDuration(r.checkIn, r.checkOut), displayStatus(r.status),
            le ? `${le.text} (${le.kind})` : '',
          ].map(csvField).join(',');
        }).join('\n');
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

  const dailyPieData = daily ? [
    { name: 'Present', value: daily.counts.present },
    { name: 'Absent', value: daily.counts.absent },
    { name: 'Leave', value: daily.counts.leave },
  ].filter(d => d.value > 0) : [];

  return (
    <div className="space-y-5 pt-5">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <div className="flex flex-wrap gap-3 items-end">
          {tab === 'daily' ? (
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1.5">Date</label>
              <input type="date" value={dailyDate} onChange={e=>setDailyDate(e.target.value)} className="border border-slate-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400"/>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1.5">From</label>
                <input type="date" value={filters.startDate} onChange={e=>setFilters({...filters,startDate:e.target.value})} className="border border-slate-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400"/>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1.5">To</label>
                <input type="date" value={filters.endDate} onChange={e=>setFilters({...filters,endDate:e.target.value})} className="border border-slate-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400"/>
              </div>
            </>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1.5">Department</label>
            <select value={filters.department} onChange={e=>setFilters({...filters,department:e.target.value})} className="border border-slate-200 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:border-brand-400">
              {DEPTS.map(d=><option key={d}>{d}</option>)}
            </select>
          </div>
          <button onClick={applyFilters} disabled={loading}
            className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white px-4 py-2.5 rounded-xl text-base font-medium transition-colors shadow-sm shadow-brand-500/25 disabled:opacity-60">
            <Filter size={15}/> Apply Filters
          </button>
          {tab !== 'daily' && (
            <button onClick={exportCSV}
              className="flex items-center gap-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 px-4 py-2.5 rounded-xl text-base font-medium transition-colors border border-emerald-200">
              <Download size={15}/> Export CSV
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="border-b border-slate-100 flex">
          {[['detail','Detailed Report'],['summary','Summary Report'],['daily','Daily Report']].map(([id,label])=>(
            <button key={id} onClick={()=>setTab(id)} className={`px-6 py-4 text-base font-medium border-b-2 transition-colors ${tab===id?'border-brand-600 text-brand-600':'border-transparent text-slate-500 hover:text-slate-700'}`}>{label}</button>
          ))}
        </div>

        {loading ? <div className="flex justify-center py-12"><div className="w-6 h-6 border-4 border-brand-500 border-t-transparent rounded-full animate-spin"/></div> : (
          <div className="overflow-x-auto">
            {tab === 'detail' && (
              <table className="w-full">
                <thead><tr className="bg-slate-50">{['Employee','Department','Date','Check In','Check Out','Hours','Status','Late/Early'].map(h=><th key={h} className={`px-5 py-3 text-sm font-semibold text-slate-500 uppercase tracking-wider ${h==='Hours' ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-slate-50">
                  {records.length === 0 ? <tr><td colSpan={8} className="text-center py-12 text-slate-400">No records for selected filters</td></tr> :
                  records.map((r,i) => {
                    const status = displayStatus(r.status);
                    const le = lateEarly(r);
                    return (
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
                      <td className="px-5 py-3.5 text-base text-slate-700 text-right tabular-nums">{formatDuration(r.checkIn, r.checkOut)}</td>
                      <td className="px-5 py-3.5"><span className={`px-2.5 py-1 rounded-full text-sm font-medium capitalize ${STATUS_STYLE[status] || 'bg-slate-100 text-slate-600'}`}>{status}</span></td>
                      <td className="px-5 py-3.5">{le ? <span className={`px-2.5 py-1 rounded-full text-sm font-medium ${le.kind === 'Late' ? 'bg-amber-100 text-amber-700' : 'bg-sky-100 text-sky-700'}`}>{le.text} ({le.kind})</span> : <span className="text-slate-300 text-sm">—</span>}</td>
                    </tr>
                  );})}
                </tbody>
              </table>
            )}

            {tab === 'summary' && (
              <table className="w-full table-fixed">
                <colgroup>
                  <col className="w-[30%]" /><col className="w-[20%]" /><col className="w-[12%]" /><col className="w-[12%]" /><col className="w-[12%]" /><col className="w-[14%]" />
                </colgroup>
                <thead><tr className="bg-slate-50">{['Employee','Department','Present','Absent','Late','Total Hours'].map(h=><th key={h} className={`px-4 py-3 text-sm font-semibold text-slate-500 uppercase tracking-wider ${['Present','Absent','Late','Total Hours'].includes(h) ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-slate-50">
                  {summary.length === 0 ? <tr><td colSpan={6} className="text-center py-12 text-slate-400">No data available</td></tr> :
                  summary.map((r,i) => (
                    <tr key={i} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">{r.employee?.firstName?.[0]}{r.employee?.lastName?.[0]}</div>
                          <span className="text-base font-medium text-slate-700 truncate">{r.employee?.firstName} {r.employee?.lastName}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-base text-slate-500 truncate">{r.employee?.department}</td>
                      <td className="px-4 py-3.5 text-right"><span className="text-base font-medium text-emerald-600 tabular-nums">{r.present}</span></td>
                      <td className="px-4 py-3.5 text-right"><span className="text-base font-medium text-red-500 tabular-nums">{r.absent}</span></td>
                      <td className="px-4 py-3.5 text-right"><span className="text-base font-medium text-amber-600 tabular-nums">{r.late}</span></td>
                      <td className="px-4 py-3.5 text-base font-semibold text-brand-600 text-right tabular-nums">{r.totalHours?.toFixed(1)}h</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {tab === 'daily' && (
              !daily || dailyPieData.length === 0 ? (
                <div className="text-center py-16 text-slate-400">No attendance data for this date</div>
              ) : (
                <div className="p-6 space-y-6">
                  <ResponsiveContainer width="100%" height={280}>
                    <PieChart>
                      <Pie data={dailyPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={95} label={({name, value, percent}) => `${name}: ${value} (${(percent*100).toFixed(0)}%)`}>
                        {dailyPieData.map(entry => <Cell key={entry.name} fill={DAILY_COLORS[entry.name] || '#94a3b8'} />)}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 px-2">
                    <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 text-center">
                      <p className="text-sm text-emerald-700 font-medium">Present</p>
                      <p className="text-2xl font-bold text-emerald-700 mt-1">{daily.counts.present}</p>
                    </div>
                    <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-center">
                      <p className="text-sm text-red-600 font-medium">Absent</p>
                      <p className="text-2xl font-bold text-red-600 mt-1">{daily.counts.absent}</p>
                    </div>
                    <div className="bg-purple-50 border border-purple-100 rounded-xl p-4 text-center">
                      <p className="text-sm text-purple-700 font-medium">Leave</p>
                      <p className="text-2xl font-bold text-purple-700 mt-1">{daily.counts.leave}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4 px-2">
                    <div className="bg-sky-50 border border-sky-100 rounded-xl p-4 text-center">
                      <p className="text-sm text-sky-700 font-medium">Checked In (still working)</p>
                      <p className="text-2xl font-bold text-sky-700 mt-1">{daily.counts.checkedIn}</p>
                    </div>
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center">
                      <p className="text-sm text-slate-600 font-medium">Checked Out</p>
                      <p className="text-2xl font-bold text-slate-700 mt-1">{daily.counts.checkedOut}</p>
                    </div>
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}
