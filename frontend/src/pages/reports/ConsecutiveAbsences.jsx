import React, { useState, useEffect, useRef } from 'react';
import { Filter, RotateCcw, ChevronLeft, ChevronRight } from 'lucide-react';
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
import { EmployeeCell } from './TableReportPage';

import usePersistedOpen from './usePersistedOpen';
const now = new Date();
const y = now.getFullYear(), m = now.getMonth();
const range = (s, e) => ({ start: s.toLocaleDateString('en-CA'), end: e.toLocaleDateString('en-CA') });

const PERIOD_OPTIONS = [
  { key: 'thisMonth', label: 'This Month', value: range(new Date(y, m, 1), new Date(y, m + 1, 0)) },
  { key: 'lastMonth', label: 'Last Month', value: range(new Date(y, m - 1, 1), new Date(y, m, 0)) },
  { key: 'thisYear', label: 'This Year', value: range(new Date(y, 0, 1), new Date(y, 11, 31)) },
];

const fmtDate = d => new Date(d).toLocaleDateString('en-GB');

// Step by the span on screen: a month moves a month, a year a year.
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
const EXPORT_COLUMNS = [
  { key: 'startDate', header: 'From Date', value: r => fmtDate(r.startDate) },
  { key: 'endDate', header: 'To Date', value: r => fmtDate(r.endDate) },
  { key: 'count', header: 'Number of Days' },
];

// The "at least N days" threshold was previously hardcoded to 2 because the
// page never sent minDays — it's now an editable control wired to the query.
export default function ConsecutiveAbsences() {
  const f = useReportFilters();
  const [periodKey, setPeriodKey] = useState('thisMonth');
  const [dateRange, setDateRange] = useState(PERIOD_OPTIONS[0].value);
  const [minDays, setMinDays] = useState(3);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [filtersOpen, setFiltersOpen] = usePersistedOpen(false);
  const [exportOpen, setExportOpen] = useState(false);
  // Two runs per employee across 150 people is a long table; it scrolls inside
  // itself so the page doesn't grow nine thousand pixels.
  const gridRef = useRef(null);
  const gridHeight = useFitToViewport(gridRef, null, [filtersOpen, rows]);

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({
      startDate: dateRange.start, endDate: dateRange.end, minDays: String(minDays || 1), ...f.params(),
    });
    appendDimensionFilters(params, f.dimFilters);
    api.get(`/reports/attendance/consecutive-absences?${params}`)
      .then(r => setRows(Array.isArray(r.data.data) ? r.data.data : []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [dateRange, ...f.deps]);

  const reset = () => {
    setPeriodKey('thisMonth'); setDateRange(PERIOD_OPTIONS[0].value); setMinDays(3); f.reset();
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

  // Runs arrive flat, one per streak; group them so each employee is named once.
  const byEmployee = rows.reduce((acc, row) => {
    const key = row._id;
    let group = acc.find(g => g.key === key);
    if (!group) { group = { key, employee: row, streaks: [] }; acc.push(group); }
    group.streaks.push(row);
    return acc;
  }, []);

  const actions = <FilterToggleButton open={filtersOpen} onClick={() => setFiltersOpen(o => !o)} />;

  const step = n => {
    const next = shiftRange(dateRange, n);
    setDateRange(next);
    setPeriodKey(PERIOD_OPTIONS.find(o => o.value.start === next.start && o.value.end === next.end)?.key || 'custom');
  };

  const periodNav = (
    <div className="flex items-center gap-2">
      <button onClick={() => step(-1)} aria-label="Previous period" className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"><ChevronLeft size={16} /></button>
      <span className="text-[14px] text-slate-700 whitespace-nowrap tabular-nums">{fmtDate(dateRange.start)} - {fmtDate(dateRange.end)}</span>
      <button onClick={() => step(1)} aria-label="Next period" className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"><ChevronRight size={16} /></button>
    </div>
  );

  const filters = filtersOpen ? (
    <>
      <PeriodFilter options={PERIOD_OPTIONS} selectedKey={periodKey} onSubmit={(v, k) => { setPeriodKey(k); setDateRange(v); }} />
      {/* "more than", not "at least" — the reference's threshold is exclusive,
          so 3 lists runs of four days and up. */}
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-[12.5px] text-slate-600 whitespace-nowrap">
        Absent consecutively for more than
        <input
          type="number" min="0" value={minDays}
          onChange={e => setMinDays(Number(e.target.value))}
          className="w-14 border border-slate-200 rounded px-1.5 py-0.5 text-[12.5px] text-center focus:outline-none focus:border-blue-400"
        />
        Day(s)
      </div>
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
    <ReportShell menuItems={menuItems} title="Consecutive Absences" periodNav={periodNav} subtitle="Unbroken absence streaks in the selected period" actions={actions} filters={filters} loading={loading} switcherCategory="Attendance">
      {rows.length === 0 ? (
        <div className="text-center py-16 text-slate-400">No consecutive absence streaks in this period</div>
      ) : (
        <div ref={gridRef} className="overflow-auto" style={gridHeight ? { height: gridHeight } : undefined}>
          <table className="w-full text-[14px] border-collapse">
            <thead className="bg-slate-50 text-[13px] font-medium text-slate-600 sticky top-0 z-20">
              <tr className="border-b border-slate-200">
                <th className="text-left px-4 py-2.5 border-r border-slate-200">Employee</th>
                <th className="text-left px-4 py-2.5 border-r border-slate-200">Absence Period</th>
                <th className="text-left px-4 py-2.5">Number of Days</th>
              </tr>
            </thead>
            <tbody>
              {/* One employee, one name: their runs stack beside it under a
                  single merged cell, as in the reference, rather than repeating
                  the name once per run. */}
              {byEmployee.map(({ key, employee, streaks }) => streaks.map((row, i) => (
                <tr key={`${key}-${row.startDate}`} className={i === streaks.length - 1 ? 'border-b border-slate-200' : ''}>
                  {i === 0 && (
                    <td rowSpan={streaks.length} className="px-4 py-2.5 align-top border-r border-slate-200 border-b border-slate-200">
                      <EmployeeCell row={employee} />
                    </td>
                  )}
                  <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap border-r border-slate-200">
                    {fmtDate(row.startDate)} - {fmtDate(row.endDate)}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-slate-700">{row.count}</td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      )}
      <LeaveExportModal
        open={exportOpen} onClose={() => setExportOpen(false)} rows={rows}
        withIdentity columns={EXPORT_COLUMNS}
        sheetName="Consecutive absences Report"
        meta={[['From Date', fmtDate(dateRange.start)], ['To Date', fmtDate(dateRange.end)]]}
        formats={['XLS', 'XLSX', 'CSV']}
        fileStub="Attendance_ConsecutiveAbsent"
      />
    </ReportShell>
  );
}
