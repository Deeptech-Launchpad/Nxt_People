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
import { codeStyle, weekendColumns, WEEKEND_HATCH } from './attendanceCodes';
import { LegendBar, StatusPanel } from './AttendanceLegend';
import useFitToViewport from '../../hooks/useFitToViewport';

const now = new Date();
const y = now.getFullYear(), m = now.getMonth();
const range = (s, e) => ({ start: s.toLocaleDateString('en-CA'), end: e.toLocaleDateString('en-CA') });
const startOfWeek = d => { const r = new Date(d); r.setDate(r.getDate() - r.getDay()); return r; };

// The reference's full preset list, in its order. Today and Yesterday collapse
// the grid to a single column, which is a legitimate way to ask "who was in".
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
// otherwise. A month is what this report is normally read by, and naming it
// beats printing its first and last day back at you.
const periodLabel = ({ start, end }) => {
  const s = new Date(start), e = new Date(end);
  const monthEnd = new Date(e.getFullYear(), e.getMonth() + 1, 0);
  const isWholeMonth = s.getDate() === 1 && e.getDate() === monthEnd.getDate()
    && s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();
  if (isWholeMonth) return s.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
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

// One column per day, headed "1 - Aug". Note this differs from Resource
// Availability's "01 Aug (Sat)" — the reference uses two different date
// header conventions and they aren't interchangeable.
const dayColumns = dayLabels => dayLabels.map((d, i) => {
  const dt = new Date(d);
  return {
    key: `d${i}`,
    header: `${dt.getDate()} - ${dt.toLocaleDateString('en-US', { month: 'short' })}`,
    value: r => (r.days[i] && r.days[i] !== '-' ? r.days[i] : ''),
  };
});

const GRID_LEGEND = [[
  ['P', 'Present'], ['A', 'Absent'], ['H', 'Holidays'], ['W', 'Weekend'],
  ['CL', 'Casual Leave'], ['CO', 'Compensatory Off'], ['PM', 'Permission'], ['LWP', 'Leave Without Pay'],
]];

// Employee × date grid of attendance codes — the report Zoho calls Employee
// Present/Absent Status. Our previous "summary" tab was an aggregate table,
// which is a different report entirely.
export default function PresentAbsentStatus() {
  const f = useReportFilters();
  const [periodKey, setPeriodKey] = useState('thisMonth');
  const [dateRange, setDateRange] = useState(PERIOD_OPTIONS.find(o => o.key === 'thisMonth').value);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [unit, setUnit] = useState('day');

  // The grid ends exactly above the legend, which ends exactly above the app's
  // fixed bottom bar — measured, not guessed. Shared with Muster Roll.
  const gridRef = useRef(null);
  const legendRef = useRef(null);
  const gridMax = useFitToViewport(gridRef, legendRef, [filtersOpen, unit, data]);

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({ startDate: dateRange.start, endDate: dateRange.end, ...f.params() });
    appendDimensionFilters(params, f.dimFilters);
    api.get(`/reports/attendance/present-absent?${params}`)
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

  // Export, Print and PDF belong beside the funnel, not inside the filter
  // panel — they are not filter actions and were unreachable until you opened
  // filters. Same menu the Leave Tracker reports use.
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

  // The period this grid is *of*, named in the header and reachable whether or
  // not the filter panel is open.
  const periodNav = (
    <div className="flex items-center gap-2">
      <button onClick={() => step(-1)} aria-label="Previous period" className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"><ChevronLeft size={16} /></button>
      <span className="text-[14px] text-slate-700 whitespace-nowrap">{periodLabel(dateRange)}</span>
      <button onClick={() => step(1)} aria-label="Next period" className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"><ChevronRight size={16} /></button>
    </div>
  );

  const actions = (
    <div className="flex items-center gap-2">
      {/* Two readings of one grid: what each day *was*, and how long it ran. */}
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
    <ReportShell menuItems={menuItems} title="Employee Present/Absent Status" periodNav={periodNav} subtitle="Day-by-day attendance grid for the selected period" actions={actions} filters={filters} loading={loading} switcherCategory="Attendance">
      {!data || data.data.length === 0 ? (
        <div className="text-center py-16 text-slate-400">No data for this period</div>
      ) : (
        <>
        {/* The grid scrolls inside a bounded box rather than growing the page.
            With 150+ rows the horizontal scrollbar and the legend sat at the
            end of the table, which meant both disappeared the moment you
            scrolled — exactly when you need them. Bounding the height keeps
            the scrollbar, the legend and the column headings all on screen. */}
        <div ref={gridRef} className="overflow-auto" style={gridMax ? { height: gridMax } : undefined}>
          <table className="text-[13px] border-collapse">
            <thead className="bg-slate-50 text-[13px] font-medium text-slate-600 sticky top-0 z-20">
              <tr>
                <th className="text-left px-3 py-2.5 sticky left-0 bg-slate-50 z-30 whitespace-nowrap border-r border-slate-200">Employee</th>
                {data.dayLabels.map((d, i) => {
                  const dd = new Date(d);
                  return (
                    // "Aug 01" over "Sat" — month first, as in the reference.
                    <th key={d} style={weekendCols.has(i) ? WEEKEND_HATCH : undefined}
                      className={`px-2 py-2.5 text-center leading-tight border-r border-slate-200 whitespace-nowrap bg-slate-50 ${unit === 'hour' ? 'min-w-[92px]' : 'w-14'}`}>
                      <div>{dd.toLocaleDateString('en-US', { month: 'short' })} {String(dd.getDate()).padStart(2, '0')}</div>
                      <div className="text-slate-400 font-normal normal-case">{dd.toLocaleDateString('en-US', { weekday: 'short' })}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {data.data.map(emp => (
                <tr key={emp._id} className="border-b border-slate-200 hover:bg-slate-50">
                  {/* No department line — the reference names the employee and
                      nothing else, and the dimension filters already narrow by
                      department when that is the question. */}
                  <td className="px-3 py-2 sticky left-0 bg-white whitespace-nowrap border-r border-slate-200">
                    <span className="text-slate-800">
                      {emp.employeeCode && <span className="text-slate-400 mr-1.5">{emp.employeeCode}</span>}
                      {emp.firstName} {emp.lastName}
                      {emp.exitDate && <span className="ml-1.5 text-[12px] text-slate-400">( Exit Date - {new Date(emp.exitDate).toLocaleDateString('en-IN')} )</span>}
                    </span>
                  </td>
                  {emp.days.map((code, i) => {
                    const hours = emp.hours?.[i];
                    const shown = unit === 'hour' ? hours : code;
                    return (
                      <td key={i} style={weekendCols.has(i) ? WEEKEND_HATCH : undefined}
                        className="px-1 py-2 text-center border-r border-slate-200">
                        {shown && shown !== '-'
                          ? unit === 'hour'
                            ? <span className="text-[11px] tabular-nums text-slate-700 whitespace-nowrap">{shown}</span>
                            : <span className={`inline-block min-w-8 px-1 rounded text-[10px] font-semibold py-0.5 ${codeStyle(code)}`}>{code}</span>
                          : <span className="text-slate-300">-</span>}
                      </td>
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
        withIdentity columns={dayColumns(data?.dayLabels || [])}
        legend={GRID_LEGEND}
        sheetName="Present status"
        meta={[['Start Date', fmtDate(dateRange.start)], ['End Date', fmtDate(dateRange.end)]]}
        formats={['XLS', 'XLSX', 'CSV']}
        fileStub="Employee present_absent status"
      />
    </ReportShell>
  );
}
