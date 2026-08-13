import React, { useState, useEffect } from 'react';
import { Filter, ChevronLeft, ChevronRight, Download, RotateCcw } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import api from '../../utils/api';
import { appendDimensionFilters } from '../../utils/reportParams';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';
import FilterToggleButton from './FilterToggleButton';
import StandardFilterRows from './StandardFilterRows';
import AttendanceStatusFilter from './AttendanceStatusFilter';
import HoursComparatorFilter from './HoursComparatorFilter';
import LeaveExportModal from './LeaveExportModal';
import useReportFilters from '../../hooks/useReportFilters';
import { EmployeeCell } from './TableReportPage';
import { ActiveSlice } from './chartLabels';

const todayCA = () => new Date().toLocaleDateString('en-CA');
const shiftDay = (dateStr, delta) => {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + delta);
  return d.toLocaleDateString('en-CA');
};
const fmtTime = t => (t ? new Date(t).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '—');
const fmtHrs = h => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

const STATUS_COLOR = {
  present: '#22c55e', onDuty: '#8b5cf6', paidLeave: '#f59e0b', absent: '#ef4444',
  unpaidLeave: '#e11d48', holiday: '#38bdf8', weekend: '#eab308',
};
const PRESENCE = [
  { key: 'in', label: 'In', color: '#14b8a6' },
  { key: 'out', label: 'Out', color: '#ef4444' },
  { key: 'yetToCheckIn', label: 'Yet to check-in', color: '#f59e0b' },
];

const EXPORT_COLUMNS = [
  { key: 'firstName', header: 'First Name' }, { key: 'lastName', header: 'Last Name' }, { key: 'employeeCode', header: 'Employee ID' },
  { key: 'firstIn', header: 'First In', value: r => fmtTime(r.firstIn) }, { key: 'lastOut', header: 'Last Out', value: r => fmtTime(r.lastOut) },
  { key: 'totalHours', header: 'Total Hours', value: r => fmtHrs(r.totalHours) },
  { key: 'status', header: 'Status' }, { key: 'shiftName', header: 'Shift' },
];
const EXPORT_EXTRA = [{ key: 'department', header: 'Department' }];

// Zoho shows attendance status and current-day presence as two separate
// charts, not one mixed pie — the status pie answers "what kind of day is
// this for each person", the presence donut answers "who is at their desk
// right now".
export default function AttendanceDailyStatus() {
  const f = useReportFilters();
  const [date, setDate] = useState(todayCA());
  const [view, setView] = useState('chart');
  const [status, setStatus] = useState([]);
  const [hours, setHours] = useState({ mode: 'all', amount: '' });
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({
      date, ...f.params(),
      ...(hours.mode !== 'all' && hours.amount ? { totalHours: hours.mode, totalHoursValue: hours.amount } : {}),
    });
    appendDimensionFilters(params, f.dimFilters);
    status.forEach(s => params.append('status', s));
    api.get(`/reports/attendance/daily-status?${params}`)
      .then(r => setData(r.data))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [date, status, hours, ...f.deps]);

  const reset = () => { setDate(todayCA()); setStatus([]); setHours({ mode: 'all', amount: '' }); f.reset(); };

  const statusPie = (data?.byStatus || []).filter(s => s.count > 0)
    .map(s => ({ ...s, color: STATUS_COLOR[s.key] || '#94a3b8' }));
  const presencePie = PRESENCE.map(p => ({ ...p, count: data?.presence?.[p.key] || 0 })).filter(p => p.count > 0);

  const actions = (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5">
        {[['chart', 'Chart'], ['list', 'List']].map(([k, l]) => (
          <button key={k} onClick={() => setView(k)}
            className={`px-3 py-1.5 text-[13px] font-semibold rounded-md transition-colors ${view === k ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-800'}`}>{l}</button>
        ))}
      </div>
      <FilterToggleButton open={filtersOpen} onClick={() => setFiltersOpen(o => !o)} />
    </div>
  );

  const filters = (
    <>
      <div className="flex items-center gap-1">
        <button onClick={() => setDate(d => shiftDay(d, -1))} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"><ChevronLeft size={16} /></button>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-1.5 text-[14px] focus:outline-none focus:border-blue-400" />
        <button onClick={() => setDate(d => shiftDay(d, 1))} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"><ChevronRight size={16} /></button>
      </div>
      <AttendanceStatusFilter value={status} onChange={setStatus} />
      <HoursComparatorFilter value={hours} onChange={setHours} />
      <div className="flex items-center gap-2 ml-auto">
        <button onClick={() => setExportOpen(true)} className="flex items-center gap-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
          <Download size={14} /> Export
        </button>
        <button onClick={load} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
          <Filter size={14} /> Apply
        </button>
        <button onClick={reset} className="flex items-center gap-2 border border-slate-200 text-slate-600 hover:bg-slate-50 px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
          <RotateCcw size={14} /> Reset
        </button>
      </div>
      {filtersOpen && <StandardFilterRows f={f} />}
    </>
  );

  return (
    <ReportShell title="Daily Attendance Status" subtitle="Attendance status and live presence for a given date" actions={actions} filters={filters} loading={loading} switcherCategory="Attendance">
      {!data ? (
        <div className="text-center py-16 text-slate-400">No data for this date</div>
      ) : view === 'chart' ? (
        <div className="grid lg:grid-cols-2 gap-4 p-5">
          <div className="border border-slate-100 rounded-xl p-4">
            <p className="text-[13px] font-bold text-slate-500 uppercase mb-2">Users — Attendance Status</p>
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <div className="w-full sm:flex-1 min-w-0">
                {statusPie.length === 0 ? (
                  <div className="text-center py-16 text-slate-400 text-[13px]">No data</div>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart margin={{ top: 16, right: 8, bottom: 8, left: 8 }}>
                      <Pie data={statusPie} dataKey="count" nameKey="label" cx="50%" cy="50%" outerRadius={92} paddingAngle={1} activeShape={ActiveSlice}>
                        {statusPie.map(s => <Cell key={s.key} fill={s.color} />)}
                      </Pie>
                      <Tooltip cursor={false} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div className="w-full sm:w-52 flex-shrink-0 space-y-1.5">
                <div className="flex items-center justify-between text-[13px] pb-1.5 border-b border-slate-100">
                  <span className="text-slate-500">Total Users</span>
                  <span className="font-bold text-slate-800 tabular-nums">{data.totalUsers}</span>
                </div>
                {data.byStatus.map(s => (
                  <div key={s.key} className="flex items-center justify-between text-[13px]">
                    <span className="flex items-center gap-2 text-slate-600">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: STATUS_COLOR[s.key] }} />
                      {s.label}
                    </span>
                    <span className="font-semibold text-slate-800 tabular-nums">{s.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="border border-slate-100 rounded-xl p-4">
            <p className="text-[13px] font-bold text-slate-500 uppercase mb-2">Current Day Status</p>
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <div className="w-full sm:flex-1 min-w-0">
                {presencePie.length === 0 ? (
                  <div className="text-center py-16 text-slate-400 text-[13px]">No data</div>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart margin={{ top: 16, right: 8, bottom: 8, left: 8 }}>
                      <Pie data={presencePie} dataKey="count" nameKey="label" cx="50%" cy="50%" innerRadius={62} outerRadius={92} paddingAngle={1} activeShape={ActiveSlice}>
                        {presencePie.map(p => <Cell key={p.key} fill={p.color} />)}
                      </Pie>
                      <Tooltip cursor={false} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div className="w-full sm:w-52 flex-shrink-0 space-y-1.5">
                {PRESENCE.map(p => (
                  <div key={p.key} className="flex items-center justify-between text-[13px]">
                    <span className="flex items-center gap-2 text-slate-600">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: p.color }} />
                      {p.label}
                    </span>
                    <span className="font-semibold text-slate-800 tabular-nums">{data.presence?.[p.key] || 0}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead className="bg-slate-50 text-[12px] font-bold text-slate-500 uppercase">
              <tr>
                <th className="text-left px-4 py-2.5">Employee</th>
                <th className="text-left px-4 py-2.5">First In</th>
                <th className="text-left px-4 py-2.5">Last Out</th>
                <th className="text-right px-4 py-2.5">Total Hours</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-left px-4 py-2.5">Shift(s)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {data.employees.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-10 text-slate-400">No employees match these filters</td></tr>
              ) : data.employees.map(row => (
                <tr key={row._id}>
                  <td className="px-4 py-2.5"><EmployeeCell row={row} /></td>
                  <td className="px-4 py-2.5">{fmtTime(row.firstIn)}</td>
                  <td className="px-4 py-2.5">{fmtTime(row.lastOut)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmtHrs(row.totalHours)}</td>
                  <td className="px-4 py-2.5">
                    {row.status && (
                      <span className="text-[12px] font-semibold px-2 py-0.5 rounded-full" style={{ background: `${STATUS_COLOR[row.statusKey]}22`, color: STATUS_COLOR[row.statusKey] }}>{row.status}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">{row.shiftName || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {/* This report exports as a vertical label/value sheet, not a table —
          the reference lists the status tallies down column A. */}
      <LeaveExportModal
        open={exportOpen} onClose={() => setExportOpen(false)}
        sheetName="Attendance"
        kv={[
          ['Total Users', data?.totalUsers ?? 0],
          ...(data?.byStatus || []).map(s => [s.label, s.count]),
          ['In', data?.presence?.in ?? 0],
          ['Out', data?.presence?.out ?? 0],
          ['Yet to check-in', data?.presence?.yetToCheckIn ?? 0],
        ]}
        meta={[['Date', date]]}
        formats={['XLS', 'XLSX', 'CSV']}
        fileStub="Daily attendance status"
      />
    </ReportShell>
  );
}
