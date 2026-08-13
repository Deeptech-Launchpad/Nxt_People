import React, { useState, useEffect, useRef } from 'react';
import { RotateCcw, Filter, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '../../utils/api';
import { appendDimensionFilters } from '../../utils/reportParams';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';
import FilterToggleButton from './FilterToggleButton';
import StandardFilterRows from './StandardFilterRows';
import PeriodFilter from './PeriodFilter';
import LeaveExportModal from './LeaveExportModal';
import useReportFilters from '../../hooks/useReportFilters';
import useFitToViewport from '../../hooks/useFitToViewport';
import { codeStyle, weekendColumns, WEEKEND_HATCH } from './attendanceCodes';
import { LegendBar, StatusPanel } from './AttendanceLegend';

const now = new Date();
const y = now.getFullYear(), m = now.getMonth();
const range = (s, e) => ({ start: s.toLocaleDateString('en-CA'), end: e.toLocaleDateString('en-CA') });
const startOfWeek = d => { const r = new Date(d); r.setDate(r.getDate() - r.getDay()); return r; };

const PERIOD_OPTIONS = [
  { key: 'today', label: 'Today', value: range(now, now) },
  { key: 'thisWeek', label: 'This Week', value: range(startOfWeek(now), new Date(startOfWeek(now).getTime() + 6 * 86400000)) },
  { key: 'thisMonth', label: 'This Month', value: range(new Date(y, m, 1), new Date(y, m + 1, 0)) },
  { key: 'yesterday', label: 'Yesterday', value: range(new Date(y, m, now.getDate() - 1), new Date(y, m, now.getDate() - 1)) },
  { key: 'lastWeek', label: 'Last Week', value: range(new Date(startOfWeek(now).getTime() - 7 * 86400000), new Date(startOfWeek(now).getTime() - 86400000)) },
  { key: 'lastMonth', label: 'Last Month', value: range(new Date(y, m - 1, 1), new Date(y, m, 0)) },
];

const fmtDate = d => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });

// "Aug 2026" when the range is exactly one calendar month, the range itself
// otherwise — a month is how this grid is normally read.
const periodLabel = ({ start, end }) => {
  const s = new Date(start), e = new Date(end);
  const monthEnd = new Date(e.getFullYear(), e.getMonth() + 1, 0);
  if (s.getDate() === 1 && e.getDate() === monthEnd.getDate() && s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
    return s.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }
  return start === end ? fmtDate(start) : `${fmtDate(start)} - ${fmtDate(end)}`;
};

// Step by the span on screen: a month moves a month, a week a week, a day a day.
const shiftRange = ({ start, end }, n) => {
  const s = new Date(start), e = new Date(end);
  const monthEnd = new Date(e.getFullYear(), e.getMonth() + 1, 0);
  if (s.getDate() === 1 && e.getDate() === monthEnd.getDate() && s.getMonth() === e.getMonth()) {
    const t = new Date(s.getFullYear(), s.getMonth() + n, 1);
    return range(t, new Date(t.getFullYear(), t.getMonth() + 1, 0));
  }
  const span = Math.round((e - s) / 86400000) + 1;
  const shift = d => { const r = new Date(d); r.setDate(r.getDate() + n * span); return r; };
  return range(shift(s), shift(e));
};

// The reference's Muster Roll is a Shift/Status pair per day under a merged
// day banner, then six roll-up columns. Codes are counted client-side because
// the grid the page already renders carries everything needed.
const dayHeader = d => {
  const dt = new Date(d);
  return `${dt.getDate()} - ${dt.toLocaleDateString('en-US', { month: 'short' })}`;
};
const isPaidOff = c => ['H', 'W'].includes(c) || ['CL', 'CO', 'PM'].includes(String(c).replace(/^[\d.]+/, '').split('/')[0]);

const musterColumns = (dayLabels) => {
  const cols = [];
  dayLabels.forEach((d, i) => {
    cols.push({ key: `shift_${i}`, header: 'Shift', value: r => r.days[i]?.shift || '' });
    cols.push({ key: `status_${i}`, header: 'Status', value: r => r.days[i]?.code || '' });
  });
  const count = (r, pred) => r.days.filter(x => x.code && x.code !== '-' && pred(x.code)).length;
  cols.push({ key: 'workedDays', header: 'Worked Days', value: r => count(r, c => c === 'P' || c === 'HD') });
  cols.push({ key: 'weekend', header: 'Weekend', value: r => count(r, c => c === 'W') });
  cols.push({ key: 'holidays', header: 'Holidays', value: r => count(r, c => c === 'H') });
  cols.push({ key: 'paidOff', header: 'Paid Off ', value: r => count(r, isPaidOff) });
  cols.push({ key: 'unpayable', header: 'Unpayable Days', value: r => count(r, c => c === 'A' || String(c).startsWith('LWP')) });
  cols.push({ key: 'payable', header: 'Payable Days', value: r => count(r, c => c === 'P' || c === 'HD' || isPaidOff(c)) });
  return cols;
};

// Each day's banner straddles its Shift+Status pair; the six roll-ups sit
// under a blank span, as does the identity block.
const musterGroups = (dayLabels, identityWidth) => [
  { label: null, span: identityWidth },
  ...dayLabels.map(d => ({ label: dayHeader(d), span: 2 })),
  { label: null, span: 6 },
];

const MUSTER_LEGEND = [[
  ['P', 'Present'], ['A', 'Absent'], ['H', 'Holidays'], ['W', 'Weekend'],
  ['CL', 'Casual Leave'], ['CO', 'Compensatory Off'], ['PM', 'Permission'], ['LWP', 'Leave Without Pay'],
]];

// Muster Roll pairs the rostered Shift with the resulting Status under each
// date — that pairing is what distinguishes it from Present/Absent Status,
// which shows status alone.
export default function MusterRoll() {
  const f = useReportFilters();
  const [periodKey, setPeriodKey] = useState('thisMonth');
  const [dateRange, setDateRange] = useState(PERIOD_OPTIONS.find(o => o.key === 'thisMonth').value);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [unit, setUnit] = useState('day');
  const gridRef = useRef(null);
  const legendRef = useRef(null);
  const gridHeight = useFitToViewport(gridRef, legendRef, [filtersOpen, unit, data]);

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({ startDate: dateRange.start, endDate: dateRange.end, ...f.params() });
    appendDimensionFilters(params, f.dimFilters);
    api.get(`/reports/attendance/muster-roll?${params}`)
      .then(r => setData(r.data))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [dateRange, ...f.deps]);

  const reset = () => {
    setPeriodKey('thisMonth');
    setDateRange(PERIOD_OPTIONS.find(o => o.key === 'thisMonth').value);
    f.reset();
  };

  // Export, Print and PDF beside the funnel, matching every other report.
  // Import on Expected vs Worked is deliberately absent: nothing in this app
  // ingests an hours file, and a menu entry that does nothing is worse than
  // no entry.
  const menuItems = [
    { key: 'export', label: 'Export', onClick: () => setExportOpen(true) },
    { key: 'print', label: 'Print', onClick: () => window.print() },
    { key: 'pdf', label: 'Download as PDF', hint: 'Opens the print dialog — choose "Save as PDF"', onClick: () => window.print() },
  ];

  const weekendCols = weekendColumns(data?.data);

  const step = n => {
    const next = shiftRange(dateRange, n);
    setDateRange(next);
    setPeriodKey(PERIOD_OPTIONS.find(o => o.value.start === next.start && o.value.end === next.end)?.key || 'custom');
  };

  const periodNav = (
    <div className="flex items-center gap-2">
      <button onClick={() => step(-1)} aria-label="Previous period" className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"><ChevronLeft size={16} /></button>
      <span className="text-[14px] text-slate-700 whitespace-nowrap">{periodLabel(dateRange)}</span>
      <button onClick={() => step(1)} aria-label="Next period" className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"><ChevronRight size={16} /></button>
    </div>
  );

  const actions = (
    <div className="flex items-center gap-2">
      {/* Two readings of one grid: what each day was, and how long it ran. */}
      <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5">
        {[['day', 'Day'], ['hour', 'Hour']].map(([k, l]) => (
          <button key={k} onClick={() => setUnit(k)}
            className={`px-3 py-1.5 text-[13px] font-semibold rounded-md transition-colors ${unit === k ? 'bg-blue-50 text-blue-600' : 'text-slate-400 hover:text-slate-700'}`}>{l}</button>
        ))}
      </div>
      <FilterToggleButton open={filtersOpen} onClick={() => setFiltersOpen(o => !o)} />
    </div>
  );

  const filters = filtersOpen ? (
    <>
      <PeriodFilter options={PERIOD_OPTIONS} selectedKey={periodKey} onSubmit={(v, k) => { setPeriodKey(k); setDateRange(v); }} />
      <button
        onClick={() => setStatusOpen(true)}
        className="px-3 py-1.5 rounded text-[13px] border border-slate-300 bg-white text-slate-600 hover:border-slate-400 transition-colors whitespace-nowrap"
      >
        Status
      </button>
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
    <ReportShell menuItems={menuItems} title="Muster Roll" periodNav={periodNav} subtitle="Rostered shift and resulting status, day by day" actions={actions} filters={filters} loading={loading} switcherCategory="Attendance">
      {!data || data.data.length === 0 ? (
        <div className="text-center py-16 text-slate-400">No data for this period</div>
      ) : (
        <>
        {/* The grid scrolls inside a bounded box so its horizontal scrollbar and
            the legend stay on screen however far down the rows you are. */}
        <div ref={gridRef} className="overflow-auto" style={gridHeight ? { height: gridHeight } : undefined}>
          <table className="text-[13px] border-collapse">
            <thead className="bg-slate-50 text-[13px] font-medium text-slate-600 sticky top-0 z-20">
              <tr>
                <th rowSpan={2} className="text-left px-3 py-2.5 sticky left-0 bg-slate-50 z-30 whitespace-nowrap align-bottom border-r border-slate-200">Employee</th>
                {data.dayLabels.map((d, i) => {
                  const dd = new Date(d);
                  return (
                    // "Aug 01" over "Sat" — month first, as in the reference.
                    <th key={d} colSpan={2} style={weekendCols.has(i) ? WEEKEND_HATCH : undefined}
                      className="px-1.5 py-1.5 text-center border-r border-slate-200 leading-tight bg-slate-50 whitespace-nowrap">
                      <div>{dd.toLocaleDateString('en-US', { month: 'short' })} {String(dd.getDate()).padStart(2, '0')}</div>
                      <div className="text-slate-400 font-normal normal-case">{dd.toLocaleDateString('en-US', { weekday: 'short' })}</div>
                    </th>
                  );
                })}
              </tr>
              <tr>
                {data.dayLabels.map((d, i) => (
                  <React.Fragment key={d}>
                    <th style={weekendCols.has(i) ? WEEKEND_HATCH : undefined} className="px-1.5 py-1.5 text-center font-medium text-slate-400 border-r border-slate-200 bg-slate-50">Shift</th>
                    <th style={weekendCols.has(i) ? WEEKEND_HATCH : undefined} className="px-1.5 py-1.5 text-center font-medium text-slate-400 border-r border-slate-200 bg-slate-50">Status</th>
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.data.map(emp => (
                <tr key={emp._id} className="border-b border-slate-200 hover:bg-slate-50">
                  {/* Name only — the reference carries no department here, and
                      the dimension filters already narrow by it. */}
                  <td className="px-3 py-2 sticky left-0 bg-white whitespace-nowrap border-r border-slate-200">
                    <span className="text-slate-800">
                      {emp.employeeCode && <span className="text-slate-400 mr-1.5">{emp.employeeCode}</span>}
                      {emp.firstName} {emp.lastName}
                      {emp.exitDate && <span className="ml-1.5 text-[12px] text-slate-400">( Exit Date - {new Date(emp.exitDate).toLocaleDateString('en-IN')} )</span>}
                    </span>
                  </td>
                  {emp.days.map((cell, i) => {
                    const shown = unit === 'hour' ? cell.hours : cell.code;
                    return (
                      <React.Fragment key={i}>
                        <td style={weekendCols.has(i) ? WEEKEND_HATCH : undefined}
                          className="px-1.5 py-2 text-center text-[10px] text-slate-500 border-r border-slate-200 max-w-[70px] truncate" title={cell.shift || ''}>
                          {cell.shift || '—'}
                        </td>
                        {/* The reference truncates a composite code and shows the
                            whole thing on hover — 00:30(PM)/07:30(P) never fits
                            a 60px column. */}
                        <td style={weekendCols.has(i) ? WEEKEND_HATCH : undefined}
                          className="px-1 py-2 text-center border-r border-slate-200" title={shown && shown !== '-' ? shown : undefined}>
                          {shown && shown !== '-'
                            ? unit === 'hour'
                              ? <span className="text-[10px] tabular-nums text-slate-700 whitespace-nowrap">{shown}</span>
                              : <span className={`inline-block min-w-8 px-1 rounded text-[10px] font-semibold py-0.5 ${codeStyle(cell.code)}`}>{cell.code}</span>
                            : <span className="text-slate-300">-</span>}
                        </td>
                      </React.Fragment>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <LegendBar ref={legendRef} onOpenAll={() => setStatusOpen(true)} />
        </>
      )}
      {statusOpen && <StatusPanel onClose={() => setStatusOpen(false)} />}
      <LeaveExportModal
        open={exportOpen} onClose={() => setExportOpen(false)} rows={data?.data || []}
        withIdentity
        columns={musterColumns(data?.dayLabels || [])}
        groups={w => musterGroups(data?.dayLabels || [], w)}
        legend={MUSTER_LEGEND}
        sheetName="Muster roll"
        meta={[['Start Date', dateRange.start], ['End Date', dateRange.end]]}
        formats={['XLS', 'XLSX', 'CSV']}
        fileStub="Attendance_Musterroll_Report"
      />
    </ReportShell>
  );
}
