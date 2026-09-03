import React, { useState, useEffect } from 'react';
import { Filter, ChevronLeft, ChevronRight, RotateCcw, PieChart as PieIcon, List as ListIcon } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import api from '../../utils/api';
import { appendDimensionFilters } from '../../utils/reportParams';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';
import FilterToggleButton from './FilterToggleButton';
import StandardFilterRows from './StandardFilterRows';
import DateChip from './DateChip';
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
const formatDate = d => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
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

/* Where the people who are working today are working FROM.
 *
 * A second donut rather than more slices on the first: the presence donut
 * answers "who is at their desk right now", and working from home is not a
 * different answer to that question — it is a different question. Splitting
 * "In" into office and home would also have quietly changed what the existing
 * slice means for anybody reading the chart out of habit.
 *
 * Unknown is drawn, never hidden. A punch the geofence could not place is not
 * evidence of anything, and folding it into either side would put a number on
 * screen that nobody could defend. */
const WORK_MODE = [
  { key: 'office', label: 'Office', color: '#2ecfa0' },
  { key: 'wfh', label: 'Working from home', color: '#f0a13c' },
  { key: 'unknown', label: 'Not placed', color: '#c9c9c9' },
];

const EXPORT_COLUMNS = [
  { key: 'firstName', header: 'First Name' }, { key: 'lastName', header: 'Last Name' }, { key: 'employeeCode', header: 'Employee ID' },
  { key: 'firstIn', header: 'First In', value: r => fmtTime(r.firstIn) }, { key: 'lastOut', header: 'Last Out', value: r => fmtTime(r.lastOut) },
  { key: 'totalHours', header: 'Total Hours', value: r => fmtHrs(r.totalHours) },
  { key: 'status', header: 'Status' }, { key: 'shiftName', header: 'Shift' },
  /* Housekeeping and anyone else HR marks for cannot punch, so a blank First
     In on their row reads as a missed check-in rather than as a check-in that
     was never going to happen. They are kept out of the on-screen "Yet to
     check-in" list for that reason; the export still carries them, and this
     column is what stops them looking like absentees in a spreadsheet nobody
     can ask a question of. */
  { key: 'attendanceMarkedByAdmin', header: 'Attendance Recorded By',
    value: r => (r.attendanceMarkedByAdmin ? 'Marked by HR' : 'Self check-in') },
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

  const modePie = WORK_MODE.map(p => ({ ...p, count: data?.workMode?.[p.key] || 0 }));
  const modeTotal = modePie.reduce((n, p) => n + Number(p.count), 0);
  /* With classification switched off nothing is placed, and a chart reading
     "Working from home: 0" would state something the system does not know. */
  const modeOn = !!data?.workMode?.classifyEnabled;

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

  // The date belongs in the header, centred between the breadcrumb and the
  // icons — it is what the page is *of*, not something you narrow it by, and
  // it has to stay reachable while the filter panel is shut. Same slot every
  // other dated report uses.
  const periodNav = (
    <div className="flex items-center gap-2">
      <button onClick={() => setDate(d => shiftDay(d, -1))} aria-label="Previous day" className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"><ChevronLeft size={16} /></button>
      <span className="text-[14px] text-slate-700 whitespace-nowrap tabular-nums">{formatDate(date)}</span>
      <button onClick={() => setDate(d => shiftDay(d, 1))} aria-label="Next day" className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"><ChevronRight size={16} /></button>
    </div>
  );

  const actions = (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5">
        {[['chart', PieIcon, 'Chart'], ['list', ListIcon, 'List']].map(([k, Icon, title]) => (
          // Status and Total Hours have no filter chips on the chart, so
          // leaving them set there would filter the list invisibly the next
          // time you switch back. Going to the chart drops them.
          <button
            key={k} title={title} aria-label={title}
            onClick={() => { setView(k); if (k === 'chart') { setStatus([]); setHours({ mode: 'all', amount: '' }); } }}
            className={`p-1.5 rounded-md transition-colors ${view === k ? 'bg-blue-50 text-blue-600' : 'text-slate-400 hover:text-slate-700'}`}
          >
            <Icon size={17} />
          </button>
        ))}
      </div>
      <FilterToggleButton open={filtersOpen} onClick={() => setFiltersOpen(o => !o)} />
    </div>
  );

  // Nothing shows until the funnel is opened. A filter bar that is always on
  // screen reads as a set of controls you are expected to use before the
  // report means anything, and the reference keeps the whole panel shut.
  const filters = filtersOpen ? (
    <>
      <DateChip label="Date" value={date} onChange={setDate} />
      {/* Status and Total Hours narrow rows, and the chart has no rows to
          narrow — the reference only offers them on the List view. */}
      {view === 'list' && <AttendanceStatusFilter value={status} onChange={setStatus} />}
      {view === 'list' && <HoursComparatorFilter value={hours} onChange={setHours} />}
      <div className="flex items-center gap-2 ml-auto">
        <button onClick={load} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
          <Filter size={14} /> Submit
        </button>
        <button onClick={reset} className="flex items-center gap-2 border border-slate-200 text-slate-600 hover:bg-slate-50 px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
          <RotateCcw size={14} /> Reset
        </button>
      </div>
      <StandardFilterRows f={f} />
    </>
  ) : null;

  return (
    <ReportShell menuItems={menuItems} title="Daily Attendance Status" periodNav={periodNav} subtitle="Attendance status and live presence for a given date" actions={actions} filters={filters} loading={loading} switcherCategory="Attendance">
      {!data ? (
        <div className="text-center py-16 text-slate-400">No data for this date</div>
      ) : view === 'chart' ? (
        // Not a 50/50 split: the status pie carries seven leader-line labels
        // and the presence donut carries three legend rows, so an even grid
        // starved the one that needed the room. Two thirds / one third, as in
        // the reference.
        <div className="grid lg:grid-cols-3 gap-4 p-5">
          <div className="lg:col-span-2 border border-slate-100 rounded-xl p-4">
            <p className="text-[14px] text-slate-700 mb-2">Users - Attendance Status</p>
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <div className="w-full sm:flex-1 min-w-0">
                {statusTotal === 0 ? (
                  <div className="text-center py-16 text-slate-400 text-[13px]">No data</div>
                ) : (
                  <ResponsiveContainer width="100%" height={320}>
                    {/* Seven leader-line labels need room on both flanks — the
                        margins are the label gutters, not padding. */}
                    <PieChart margin={{ top: 12, right: 96, bottom: 12, left: 96 }}>
                      <Pie
                        data={statusPie} dataKey="count" nameKey="label" cx="50%" cy="50%"
                        outerRadius={100} isAnimationActive={false}
                        label={makeSliceLabel(statusTotal, statusPie, 320, (name, value) => `${name},${value}`)}
                        labelLine={false} activeShape={ActiveSlice}
                        onClick={(_, i) => drill(statusPie[i]?.key)} className="cursor-pointer"
                      >
                        {/* A zero slice has no arc, but recharts still strokes
                            its two coincident radii — which drew a white spoke
                            across the pie for every empty status. */}
                        {statusPie.map(s => <Cell key={s.key} fill={s.color} stroke={s.count > 0 ? '#fff' : 'none'} />)}
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
            <p className="text-[14px] text-slate-700 mb-2">Current Day Status</p>
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <div className="w-full sm:flex-1 min-w-0">
                {presenceTotal === 0 ? (
                  <div className="text-center py-16 text-slate-400 text-[13px]">No data</div>
                ) : (
                  <ResponsiveContainer width="100%" height={320}>
                    <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                      <Pie
                        data={presencePie} dataKey="count" nameKey="label" cx="50%" cy="50%"
                        innerRadius={48} outerRadius={74} isAnimationActive={false}
                        activeShape={ActiveSlice} onClick={(_, i) => drill(presencePie[i]?.key)} className="cursor-pointer"
                      >
                        {presencePie.map(p => <Cell key={p.key} fill={p.color} stroke={p.count > 0 ? '#fff' : 'none'} />)}
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
              <div className="w-full sm:w-44 flex-shrink-0 space-y-1.5">
                {presencePie.map(p => (
                  <LegendRow key={p.key} color={p.color} label={p.label} count={p.count} onClick={() => drill(p.key)} />
                ))}
              </div>
            </div>
          </div>

          {/* Full width on its own row: the grid above is two thirds / one
              third and there is no fourth column to sit in. A wide strip also
              suits the shape of the answer — three numbers, read across. */}
          <div className="lg:col-span-3 border border-slate-100 rounded-xl p-4">
            <p className="text-[14px] text-slate-700 mb-2">Where People Are Working</p>
            {!modeOn ? (
              <div className="text-center py-14 px-6">
                <p className="text-[13.5px] text-slate-500">
                  Office and working-from-home are not being recorded yet.
                </p>
                <p className="text-[13px] text-slate-400 mt-1.5">
                  Set the coordinates on a location, then switch classification on under
                  Settings → Attendance → Geo Restriction.
                </p>
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row items-center gap-4">
                <div className="w-full sm:max-w-md min-w-0">
                  {modeTotal === 0 ? (
                    <div className="text-center py-16 text-slate-400 text-[13px]">Nobody has punched today</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={230}>
                      <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                        <Pie
                          data={modePie} dataKey="count" nameKey="label" cx="50%" cy="50%"
                          innerRadius={48} outerRadius={74} isAnimationActive={false}
                          activeShape={ActiveSlice}
                        >
                          {modePie.map(p => <Cell key={p.key} fill={p.color} stroke={p.count > 0 ? '#fff' : 'none'} />)}
                        </Pie>
                        <Tooltip
                          cursor={false}
                          formatter={(value, name) => [`${value} · ${((value / (modeTotal || 1)) * 100).toFixed(1)}%`, name]}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>
                <div className="w-full sm:w-44 flex-shrink-0 space-y-1.5">
                  {modePie.map(p => (
                    <LegendRow key={p.key} color={p.color} label={p.label} count={p.count} />
                  ))}
                  {modePie[2].count > 0 && (
                    /* Said once, where the number is, rather than left as a grey
                       slice somebody has to ask about. */
                    <p className="text-[12px] text-slate-400 pt-1.5 leading-snug">
                      Not placed means the check-in had no usable location — usually a desktop
                      browser, which has no GPS.
                    </p>
                  )}
                </div>
              </div>
            )}
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
                  <td className="px-4 py-2.5 max-w-xs truncate text-slate-700" title={row.status || ''}>
                    {row.status || (row.attendanceMarkedByAdmin ? <span className="text-slate-400 italic">Marked by HR</span> : '—')}
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
        meta={[['Date', formatDate(date)]]}
        formats={['XLS', 'XLSX', 'CSV']}
        fileStub="Daily attendance status"
      />
    </ReportShell>
  );
}
