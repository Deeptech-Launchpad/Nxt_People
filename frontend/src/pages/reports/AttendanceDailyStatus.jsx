import React, { useState, useEffect } from 'react';
import { Filter, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
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
import { ActiveSlice, makeSliceLabel } from './chartLabels';

const todayCA = () => new Date().toLocaleDateString('en-CA');
const shiftDay = (dateStr, delta) => {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + delta);
  return d.toLocaleDateString('en-CA');
};
const fmtTime = t => (t ? new Date(t).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '—');
// null is "hours don't apply here" — a full day of leave, a holiday, a weekend.
// It is not the same as a worked day that came to zero, so it prints as a dash.
const fmtHrs = h => (h === null || h === undefined
  ? '-'
  : `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`);

// The reference's muted status palette — pale enough that a pie of seven
// categories stays readable, with the two "something is wrong" states (unpaid
// leave, absent) the only saturated ones.
const STATUS_COLOR = {
  present: '#a9d5a2', onDuty: '#b9a5dd', paidLeave: '#e8871e', absent: '#f4a3a3',
  unpaidLeave: '#ef3f5f', holiday: '#7fc4e8', weekend: '#f7e08a',
};
const TOTAL_COLOR = '#c9c9c9';
const PRESENCE = [
  { key: 'in', label: 'In', color: '#2ecfa0' },
  { key: 'out', label: 'Out', color: '#fb5f5f' },
  { key: 'yetToCheckIn', label: 'Yet to check-in', color: '#f5c451' },
];

const EXPORT_COLUMNS = [
  { key: 'firstName', header: 'First Name' }, { key: 'lastName', header: 'Last Name' }, { key: 'employeeCode', header: 'Employee ID' },
  { key: 'firstIn', header: 'First In', value: r => fmtTime(r.firstIn) }, { key: 'lastOut', header: 'Last Out', value: r => fmtTime(r.lastOut) },
  { key: 'totalHours', header: 'Total Hours', value: r => fmtHrs(r.totalHours) },
  { key: 'status', header: 'Status' }, { key: 'shiftName', header: 'Shift' },
];
const EXPORT_EXTRA = [{ key: 'department', header: 'Department' }];

// A legend entry is the other handle on the same slice: same colour, same
// count, and the same drill into the list. Rendered as a button so it is
// reachable by keyboard, not only by hitting a thin arc with the mouse.
function LegendRow({ color, label, count, onClick }) {
  return (
    <button
      onClick={onClick} title={`Show ${label}`}
      className="w-full flex items-center justify-between text-[13px] group"
    >
      <span className="flex items-center gap-2 text-slate-600 min-w-0">
        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
        <span className="truncate group-hover:text-blue-600 group-hover:underline">{label}</span>
      </span>
      <span className="font-semibold text-slate-800 tabular-nums group-hover:text-blue-600">{count}</span>
    </button>
  );
}

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

  // Every status stays in the chart data even at zero, because the reference
  // labels all seven — "Absent,0" is an answer, and dropping the slice turns
  // it into a question about whether the report ran at all.
  const statusPie = (data?.byStatus || []).map(s => ({ ...s, color: STATUS_COLOR[s.key] || '#94a3b8' }));
  const statusTotal = statusPie.reduce((n, s) => n + Number(s.count), 0);
  const presencePie = PRESENCE.map(p => ({ ...p, count: data?.presence?.[p.key] || 0 }));
  const presenceTotal = presencePie.reduce((n, p) => n + Number(p.count), 0);

  // Every slice and every legend row is a way into the list behind it — the
  // chart says how many, the list says who. Clicking applies that status as
  // the Status filter and switches to List, which is what the reference does.
  const drill = key => { setStatus(key ? [key] : []); setView('list'); };

  // Export, Print and PDF belong beside the funnel, not inside the filter
  // panel — they are not filter actions and were unreachable until you opened
  // filters. Same menu the Leave Tracker reports use.
  const menuItems = [
    { key: 'export', label: 'Export', onClick: () => setExportOpen(true) },
    { key: 'print', label: 'Print', onClick: () => window.print() },
    { key: 'pdf', label: 'Download as PDF', hint: 'Opens the print dialog — choose "Save as PDF"', onClick: () => window.print() },
  ];

  const actions = (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5">
        {[['chart', 'Chart'], ['list', 'List']].map(([k, l]) => (
          // Status and Total Hours have no filter chips on the chart, so
          // leaving them set there would filter the list invisibly the next
          // time you switch back. Going to the chart drops them.
          <button key={k} onClick={() => { setView(k); if (k === 'chart') { setStatus([]); setHours({ mode: 'all', amount: '' }); } }}
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
      {/* Status and Total Hours narrow rows, and the chart has no rows to
          narrow — the reference only offers them on the List view. */}
      {view === 'list' && <AttendanceStatusFilter value={status} onChange={setStatus} />}
      {view === 'list' && <HoursComparatorFilter value={hours} onChange={setHours} />}
      <div className="flex items-center gap-2 ml-auto">
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
    <ReportShell menuItems={menuItems} title="Daily Attendance Status" subtitle="Attendance status and live presence for a given date" actions={actions} filters={filters} loading={loading} switcherCategory="Attendance">
      {!data ? (
        <div className="text-center py-16 text-slate-400">No data for this date</div>
      ) : view === 'chart' ? (
        <div className="grid lg:grid-cols-2 gap-4 p-5">
          <div className="border border-slate-100 rounded-xl p-4">
            <p className="text-[13px] font-bold text-slate-500 uppercase mb-2">Users — Attendance Status</p>
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <div className="w-full sm:flex-1 min-w-0">
                {statusTotal === 0 ? (
                  <div className="text-center py-16 text-slate-400 text-[13px]">No data</div>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    {/* Seven leader-line labels need room on both flanks, so the
                        pie itself stays modest — the labels are the reading, the
                        area only ranks them. */}
                    <PieChart margin={{ top: 12, right: 72, bottom: 12, left: 72 }}>
                      <Pie
                        data={statusPie} dataKey="count" nameKey="label" cx="50%" cy="50%"
                        outerRadius={64} isAnimationActive={false}
                        label={makeSliceLabel(statusTotal, statusPie, 300, (name, value) => `${name},${value}`)}
                        labelLine={false} activeShape={ActiveSlice}
                        onClick={(_, i) => drill(statusPie[i]?.key)} className="cursor-pointer"
                      >
                        {statusPie.map(s => <Cell key={s.key} fill={s.color} />)}
                      </Pie>
                      <Tooltip cursor={false} formatter={(value, name) => [value, name]} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div className="w-full sm:w-48 flex-shrink-0 space-y-1.5">
                <LegendRow color={TOTAL_COLOR} label="Total Users" count={data.totalUsers} onClick={() => drill(null)} />
                {statusPie.map(s => (
                  <LegendRow key={s.key} color={s.color} label={s.label} count={s.count} onClick={() => drill(s.key)} />
                ))}
              </div>
            </div>
          </div>

          <div className="border border-slate-100 rounded-xl p-4">
            <p className="text-[13px] font-bold text-slate-500 uppercase mb-2">Current Day Status</p>
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <div className="w-full sm:flex-1 min-w-0">
                {presenceTotal === 0 ? (
                  <div className="text-center py-16 text-slate-400 text-[13px]">No data</div>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart margin={{ top: 12, right: 12, bottom: 12, left: 12 }}>
                      <Pie
                        data={presencePie} dataKey="count" nameKey="label" cx="50%" cy="50%"
                        innerRadius={66} outerRadius={98} isAnimationActive={false}
                        activeShape={ActiveSlice} onClick={(_, i) => drill(presencePie[i]?.key)} className="cursor-pointer"
                      >
                        {presencePie.map(p => <Cell key={p.key} fill={p.color} />)}
                      </Pie>
                      {/* The reference labels this donut by share, not headcount —
                          "Out, 75.47%" — because the question it answers is how
                          much of the floor has already gone home. */}
                      <Tooltip
                        cursor={false}
                        formatter={(value, name) => [`${((value / (presenceTotal || 1)) * 100).toFixed(2)}%`, name]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div className="w-full sm:w-48 flex-shrink-0 space-y-1.5">
                {presencePie.map(p => (
                  <LegendRow key={p.key} color={p.color} label={p.label} count={p.count} onClick={() => drill(p.key)} />
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead className="bg-slate-50 text-[13px] font-medium text-slate-600">
              <tr>
                <th className="text-left px-4 py-2.5">Employee</th>
                <th className="text-left px-4 py-2.5">First In</th>
                <th className="text-left px-4 py-2.5">Last Out</th>
                <th className="text-left px-4 py-2.5">Total Hours</th>
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
                  <td className="px-4 py-2.5 tabular-nums">{fmtHrs(row.totalHours)}</td>
                  {/* Plain text, not a coloured pill: the cell names the day's
                      actual leave records, which run long enough that a pill
                      would wrap into a block of colour. */}
                  <td className="px-4 py-2.5 max-w-xs truncate text-slate-700" title={row.status || ''}>{row.status || '—'}</td>
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
