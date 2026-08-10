import React, { useState, useEffect, useMemo } from 'react';
import { Download, Filter, ArrowUpDown, Search, X } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import * as XLSX from 'xlsx';
import api from '../utils/api';
import toast from 'react-hot-toast';

const DEPTS = ['All','Engineering','HR','Sales','Marketing','Finance','Design','Product'];
const STATUS_STYLE = { present:'bg-emerald-100 text-emerald-700', absent:'bg-red-100 text-red-700', 'half-day':'bg-blue-100 text-blue-700', leave:'bg-purple-100 text-purple-700' };
const DAILY_CATEGORIES = [
  { key: 'checked-in',      name: 'Checked In',       color: '#0ea5e9' },
  { key: 'checked-out',     name: 'Checked Out',      color: '#10b981' },
  { key: 'leave',           name: 'Leave',            color: '#8b5cf6' },
  { key: 'yet-to-check-in', name: 'Yet To Check In',  color: '#f59e0b' },
  { key: 'absent',          name: 'Absent',           color: '#ef4444' },
];

// "late" isn't its own status anymore — a late employee is still Present;
// the lateness itself now shows in the separate Late/Early column.
const displayStatus = (status) => status === 'late' ? 'present' : status;

// Clock-style duration display (H.MMh) rather than a decimal fraction of an
// hour — 30 minutes reads as "0.30h", not "0.50h".
const clockHours = (decimalHours) => {
  const totalMin = Math.max(0, Math.round((parseFloat(decimalHours) || 0) * 60));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}.${String(m).padStart(2, '0')}h`;
};

// Hours for a Detailed Report row. A still-open session only counts up to
// "now" when it's TODAY's row — that's the one case where "still working"
// is real. A past day with no check-out is a forgotten checkout, not a
// 20+ hour shift; the nightly auto-absent cron (server.js) closes those out
// to working_hours=0 by the next morning, so past rows always trust the
// stored value instead of racing the clock against a stale check-in.
const formatDuration = (r) => {
  if (!r.checkIn) return '—';
  if (!r.checkOut && new Date(r.date).toLocaleDateString('en-CA') === todayCA()) {
    const diffMin = Math.max(0, Math.round((new Date() - new Date(r.checkIn)) / 60000));
    return `${Math.floor(diffMin / 60)}.${String(diffMin % 60).padStart(2, '0')}h`;
  }
  return clockHours(r.workingHours);
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

// % of working days present out of (present + absent) — null when there's
// no data either way, so a genuinely blank row doesn't read as "0%".
const attendanceRate = (r) => {
  const total = (r.present || 0) + (r.absent || 0);
  return total > 0 ? (r.present / total) * 100 : null;
};

// Clickable, sortable Summary Report column header.
function SortableTh({ field, label, align = 'right', sortField, sortDir, onSort }) {
  const active = sortField === field;
  return (
    <th
      onClick={() => onSort(field)}
      className={`px-4 py-3 text-sm font-semibold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap transition-colors ${active ? 'text-brand-600' : 'text-slate-500 hover:text-slate-700'} ${align === 'left' ? 'text-left' : 'text-right'}`}
    >
      <span className={`inline-flex items-center gap-1 ${align === 'left' ? '' : 'justify-end w-full'}`}>
        {label}
        <ArrowUpDown size={12} className={active ? 'text-brand-600' : 'text-slate-300'} />
      </span>
    </th>
  );
}

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
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [summarySearch, setSummarySearch] = useState('');
  const [sortField, setSortField] = useState(null);
  const [sortDir, setSortDir] = useState('desc');
  const [empDrilldown, setEmpDrilldown] = useState(null); // { empName, status, dates: [] }

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
      .then(r => { setDaily(r.data); setSelectedCategory(null); })
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);
  useEffect(() => { if (tab === 'daily' && !daily) loadDaily(); }, [tab]);

  const applyFilters = () => tab === 'daily' ? loadDaily() : load();

  const exportFile = () => {
    const data = tab === 'detail' ? records : filteredSummary;
    if (!data?.length) return toast.error('No data to export for the selected filters');
    let rows;
    if (tab === 'detail') {
      rows = [
        ['Employee', 'ID', 'Department', 'Date', 'Check In', 'Check Out', 'Hours', 'Status', 'Late/Early'],
        ...data.map(r => {
          const le = lateEarly(r);
          return [
            `${r.employee?.firstName} ${r.employee?.lastName}`, r.employee?.employeeId, r.employee?.department,
            new Date(r.date).toLocaleDateString(),
            r.checkIn ? new Date(r.checkIn).toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata' }) : '',
            r.checkOut ? new Date(r.checkOut).toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata' }) : '',
            formatDuration(r), displayStatus(r.status),
            le ? `${le.text} (${le.kind})` : '',
          ];
        }),
      ];
    } else {
      rows = [
        ['Employee', 'Department', 'Present', 'Absent', 'Late', 'Permission Hours', 'Total Hours', 'Attendance %'],
        ...data.map(r => {
          const rate = attendanceRate(r);
          return [
            `${r.employee?.firstName} ${r.employee?.lastName}`, r.employee?.department,
            r.present, r.absent, r.late, clockHours(r.permissionHours), r.totalHours,
            rate == null ? '' : `${rate.toFixed(0)}%`,
          ];
        }),
      ];
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, tab === 'detail' ? 'Detailed Report' : 'Summary Report');
    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `nxt-people-report-${stamp}.xlsx`);
  };

  const fmt = d => d ? new Date(d).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'}) : '—';

  const toggleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const filteredSummary = useMemo(() => {
    let rows = summary.filter(r => {
      if (!summarySearch) return true;
      const name = `${r.employee?.firstName || ''} ${r.employee?.lastName || ''}`.toLowerCase();
      return name.includes(summarySearch.toLowerCase());
    });
    if (sortField) {
      rows = [...rows].sort((a, b) => {
        const va = sortField === 'rate' ? (attendanceRate(a) ?? -1) : (a[sortField] ?? 0);
        const vb = sortField === 'rate' ? (attendanceRate(b) ?? -1) : (b[sortField] ?? 0);
        return sortDir === 'asc' ? va - vb : vb - va;
      });
    }
    return rows;
  }, [summary, summarySearch, sortField, sortDir]);

  // Present/Absent cells in the Summary table are clickable — this pulls the
  // matching dates straight from the already-fetched Detailed Report data
  // for the same date range, so no extra API call is needed.
  const openEmpDrilldown = (r, status) => {
    const empId = r.employee?._id;
    const empName = `${r.employee?.firstName || ''} ${r.employee?.lastName || ''}`.trim();
    const dates = records
      .filter(rec => rec.employee?._id === empId && displayStatus(rec.status) === status)
      .map(rec => rec.date)
      .sort((a, b) => new Date(b) - new Date(a));
    setEmpDrilldown({ empName, status, dates });
  };

  const countKey = { 'checked-in': 'checkedIn', 'checked-out': 'checkedOut', leave: 'leave', 'yet-to-check-in': 'yetToCheckIn', absent: 'absent' };
  const dailyPieData = daily ? DAILY_CATEGORIES
    .map(c => ({ ...c, value: daily.counts[countKey[c.key]] || 0 }))
    .filter(d => d.value > 0) : [];
  const drilldownList = daily && selectedCategory ? daily.data.filter(d => d.status === selectedCategory) : [];

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
            <button onClick={exportFile}
              className="flex items-center gap-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 px-4 py-2.5 rounded-xl text-base font-medium transition-colors border border-emerald-200">
              <Download size={15}/> Export Excel
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
                      <td className="px-5 py-3.5 text-base text-slate-700 text-right tabular-nums">{formatDuration(r)}</td>
                      <td className="px-5 py-3.5"><span className={`px-2.5 py-1 rounded-full text-sm font-medium capitalize ${STATUS_STYLE[status] || 'bg-slate-100 text-slate-600'}`}>{status}</span></td>
                      <td className="px-5 py-3.5">{le ? <span className={`px-2.5 py-1 rounded-full text-sm font-medium ${le.kind === 'Late' ? 'bg-amber-100 text-amber-700' : 'bg-sky-100 text-sky-700'}`}>{le.text} ({le.kind})</span> : <span className="text-slate-300 text-sm">—</span>}</td>
                    </tr>
                  );})}
                </tbody>
              </table>
            )}

            {tab === 'summary' && (
              <>
                <div className="px-5 pt-4 pb-1">
                  <div className="relative w-full max-w-xs">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={summarySearch}
                      onChange={e => setSummarySearch(e.target.value)}
                      placeholder="Search employee..."
                      className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-brand-400"
                    />
                  </div>
                </div>
                <table className="w-full table-fixed">
                  <colgroup>
                    <col className="w-[22%]" /><col className="w-[15%]" /><col className="w-[9%]" /><col className="w-[9%]" /><col className="w-[9%]" /><col className="w-[12%]" /><col className="w-[12%]" /><col className="w-[12%]" />
                  </colgroup>
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="px-4 py-3 text-sm font-semibold text-slate-500 uppercase tracking-wider text-left">Employee</th>
                      <th className="px-4 py-3 text-sm font-semibold text-slate-500 uppercase tracking-wider text-left">Department</th>
                      <SortableTh field="present" label="Present" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                      <SortableTh field="absent" label="Absent" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                      <SortableTh field="late" label="Late" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                      <SortableTh field="permissionHours" label="Permission Hrs" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                      <SortableTh field="totalHours" label="Total Hours" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                      <SortableTh field="rate" label="Attendance %" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {filteredSummary.length === 0 ? <tr><td colSpan={8} className="text-center py-12 text-slate-400">No data available</td></tr> :
                    filteredSummary.map((r,i) => {
                      const rate = attendanceRate(r);
                      const lowAttendance = rate !== null && rate < 75;
                      const rateColor = rate === null ? 'text-slate-400' : rate >= 90 ? 'text-emerald-600' : rate >= 75 ? 'text-amber-600' : 'text-red-600';
                      return (
                      <tr key={i} className={`hover:bg-slate-50 transition-colors ${lowAttendance ? 'bg-red-50/40' : ''}`}>
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">{r.employee?.firstName?.[0]}{r.employee?.lastName?.[0]}</div>
                            <span className="text-base font-medium text-slate-700 truncate">{r.employee?.firstName} {r.employee?.lastName}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-base text-slate-500 truncate">{r.employee?.department}</td>
                        <td className="px-4 py-3.5 text-right">
                          <button onClick={() => openEmpDrilldown(r, 'present')} disabled={!r.present}
                            className="text-base font-medium text-emerald-600 tabular-nums hover:underline disabled:no-underline disabled:cursor-default">
                            {r.present}
                          </button>
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <button onClick={() => openEmpDrilldown(r, 'absent')} disabled={!r.absent}
                            className="text-base font-medium text-red-500 tabular-nums hover:underline disabled:no-underline disabled:cursor-default">
                            {r.absent}
                          </button>
                        </td>
                        <td className="px-4 py-3.5 text-right"><span className="text-base font-medium text-amber-600 tabular-nums">{r.late}</span></td>
                        <td className="px-4 py-3.5 text-right"><span className="text-base font-medium text-violet-600 tabular-nums">{clockHours(r.permissionHours)}</span></td>
                        <td className="px-4 py-3.5 text-base font-semibold text-brand-600 text-right tabular-nums">{r.totalHours?.toFixed(1)}h</td>
                        <td className={`px-4 py-3.5 text-right text-base font-semibold tabular-nums ${rateColor}`}>{rate === null ? '—' : `${rate.toFixed(0)}%`}</td>
                      </tr>
                    );})}
                  </tbody>
                </table>
              </>
            )}

            {tab === 'daily' && (
              !daily || dailyPieData.length === 0 ? (
                <div className="text-center py-16 text-slate-400">No attendance data for this date</div>
              ) : (
                <div className="p-6">
                  <div className="flex flex-col lg:flex-row gap-8 items-center lg:items-start">
                    <div className="w-full lg:flex-1 lg:min-w-0">
                      <ResponsiveContainer width="100%" height={320}>
                        <PieChart>
                          <Pie data={dailyPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={65} outerRadius={115}
                               label={({percent}) => `${(percent*100).toFixed(0)}%`}>
                            {dailyPieData.map(entry => (
                              <Cell
                                key={entry.key}
                                fill={entry.color}
                                style={{ cursor: 'pointer', outline: 'none' }}
                                stroke={selectedCategory === entry.key ? '#1e293b' : '#fff'}
                                strokeWidth={selectedCategory === entry.key ? 2 : 1}
                                onClick={() => setSelectedCategory(entry.key === selectedCategory ? null : entry.key)}
                              />
                            ))}
                          </Pie>
                          <Tooltip formatter={(value, name) => [value, name]} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>

                    <div className="w-full lg:w-72 flex-shrink-0 space-y-2">
                      {dailyPieData.map(entry => (
                        <button
                          key={entry.key}
                          onClick={() => setSelectedCategory(entry.key === selectedCategory ? null : entry.key)}
                          className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-colors ${selectedCategory === entry.key ? 'border-brand-400 bg-brand-50' : 'border-slate-200 hover:bg-slate-50'}`}
                        >
                          <span className="flex items-center gap-2 text-base font-medium text-slate-700">
                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: entry.color }} />
                            {entry.name}
                          </span>
                          <span className="text-base font-bold text-slate-800 tabular-nums">{entry.value}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {selectedCategory && (
                    <div className="mt-8 border-t border-slate-100 pt-6">
                      <p className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
                        {DAILY_CATEGORIES.find(c => c.key === selectedCategory)?.name} — {drilldownList.length} {drilldownList.length === 1 ? 'employee' : 'employees'}
                      </p>
                      <div className="divide-y divide-slate-50 border border-slate-100 rounded-xl overflow-hidden">
                        {drilldownList.length === 0 ? (
                          <div className="px-4 py-6 text-center text-slate-400 text-base">No employees in this category</div>
                        ) : drilldownList.map(emp => (
                          <div key={emp._id} className="flex items-center justify-between px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">{emp.firstName?.[0]}{emp.lastName?.[0]}</div>
                              <div>
                                <p className="text-base font-medium text-slate-700">{emp.firstName} {emp.lastName}</p>
                                <p className="text-sm text-slate-400">{emp.department || '—'}</p>
                              </div>
                            </div>
                            {(emp.checkIn || emp.checkOut) && (
                              <div className="text-sm text-slate-500 text-right">
                                {emp.checkIn && <div>In: {fmt(emp.checkIn)}</div>}
                                {emp.checkOut && <div>Out: {fmt(emp.checkOut)}</div>}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            )}
          </div>
        )}
      </div>

      {empDrilldown && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setEmpDrilldown(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
              <div>
                <p className="text-base font-bold text-slate-800">{empDrilldown.empName}</p>
                <p className="text-sm text-slate-500 capitalize">{empDrilldown.status} days — {empDrilldown.dates.length}</p>
              </div>
              <button onClick={() => setEmpDrilldown(null)} className="text-slate-400 hover:text-slate-600"><X size={18}/></button>
            </div>
            <div className="overflow-y-auto divide-y divide-slate-50">
              {empDrilldown.dates.length === 0 ? (
                <div className="px-5 py-8 text-center text-slate-400 text-base">No matching days</div>
              ) : empDrilldown.dates.map((d, i) => (
                <div key={i} className="px-5 py-3 text-base text-slate-700">
                  {new Date(d).toLocaleDateString('en-US', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
