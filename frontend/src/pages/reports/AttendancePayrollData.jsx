import React, { useState, useEffect, useRef } from 'react';
import { RotateCcw, Filter, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '../../utils/api';
import { appendDimensionFilters } from '../../utils/reportParams';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';
import FilterToggleButton from './FilterToggleButton';
import StandardFilterRows from './StandardFilterRows';
import PeriodFilter from './PeriodFilter';
import UnitToggle from './UnitToggle';
import LeaveExportModal from './LeaveExportModal';
import useReportFilters from '../../hooks/useReportFilters';
import useFitToViewport from '../../hooks/useFitToViewport';
import { EmployeeCell } from './TableReportPage';
import useSortable from '../../components/table/useSortable';
import SortableTh from '../../components/table/SortableTh';

import usePersistedOpen from './usePersistedOpen';
const now = new Date();
const y = now.getFullYear(), m = now.getMonth();
const range = (s, e) => ({ start: s.toLocaleDateString('en-CA'), end: e.toLocaleDateString('en-CA') });
const startOfWeek = d => { const r = new Date(d); r.setDate(r.getDate() - r.getDay()); return r; };
const endOfWeek = d => { const r = startOfWeek(d); r.setDate(r.getDate() + 6); return r; };

const PERIOD_OPTIONS = [
  { key: 'thisWeek', label: 'This Week', value: range(startOfWeek(now), endOfWeek(now)) },
  { key: 'lastWeek', label: 'Last Week', value: range(new Date(startOfWeek(now).getTime() - 7 * 86400000), new Date(startOfWeek(now).getTime() - 86400000)) },
  { key: 'thisMonth', label: 'This Month', value: range(new Date(y, m, 1), new Date(y, m + 1, 0)) },
  { key: 'lastMonth', label: 'Last Month', value: range(new Date(y, m - 1, 1), new Date(y, m, 0)) },
];

// Hour mode shows HH:MM like Zoho ("248:00"), day mode shows plain numbers.
const fmt = (v, unit) => {
  const n = Number(v) || 0;
  if (unit !== 'hour') return n;
  return `${String(Math.floor(n)).padStart(2, '0')}:${String(Math.round((n % 1) * 60)).padStart(2, '0')}`;
};
const fmtDate = d => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
const addDays = (ymd, n) => { const d = new Date(ymd); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };

// Sixteen numeric columns under a two-level header need ruling, or the eye
// loses which group a figure belongs to halfway across.
const CELL = 'px-4 py-2.5 whitespace-nowrap border-r border-slate-200 last:border-r-0 text-center tabular-nums';
const HEAD = 'px-4 py-2.5 whitespace-nowrap border-r border-slate-200 last:border-r-0 font-medium';

// The reference puts a banner row above the leaf headers so "Payable Day(s)"
// straddles its three sub-columns, "Worked Day(s)" its three, and so on. The
// identity block sits under a blank span of the same banner.
const NUMERIC_KEYS = ['expectedPayableDays', 'payableWorked', 'payablePaidOff', 'payableTotal', 'expectedWorkingDays',
  'workedPresent', 'workedOnDuty', 'workedTotal', 'paidLeave', 'paidHolidays', 'paidWeekend', 'paidOffTotal',
  'unpaidLeave', 'unpaidAbsent', 'unpaidTotal'];
const SORT_COLUMNS = {
  employee: r => `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim(),
  ...Object.fromEntries(NUMERIC_KEYS.map(k => [k, { get: r => r[k], type: 'number' }])),
};

const exportColumns = (simple, unit) => {
  const u = unit === 'hour' ? 'Hour(s)' : 'Day(s)';
  if (simple) {
    return [
      { key: 'payableTotal', header: `Payable ${u}` },
      { key: 'expectedWorkingDays', header: `Expected Working ${u}` },
      { key: 'workedTotal', header: `Worked ${u}` },
    ];
  }
  return [
    { key: 'expectedPayableDays', header: `Expected Payable ${u}` },
    { key: 'payableWorked', header: `Worked ${u}` },
    { key: 'payablePaidOff', header: `Paid Off ${u}` },
    { key: 'payableTotal', header: 'Total' },
    { key: 'expectedWorkingDays', header: `Expected Working ${u}` },
    { key: 'workedPresent', header: 'Present' },
    { key: 'workedOnDuty', header: 'On Duty' },
    { key: 'workedTotal', header: 'Total' },
    { key: 'paidLeave', header: 'Leave' },
    { key: 'paidHolidays', header: 'Holidays' },
    { key: 'paidWeekend', header: 'Weekend' },
    { key: 'paidOffTotal', header: 'Total' },
    { key: 'unpaidLeave', header: 'Leave' },
    { key: 'unpaidAbsent', header: 'Absent' },
    { key: 'unpaidTotal', header: 'Total' },
  ];
};

// identityWidth is however many identity columns the dialog ends up writing;
// the banner leaves that span blank, then labels each metric group.
const exportGroups = (simple, unit, identityWidth) => {
  if (simple) return null;
  const u = unit === 'hour' ? 'Hour(s)' : 'Day(s)';
  return [
    { label: null, span: identityWidth + 1 },   // identity + Expected Payable
    { label: `Payable ${u}`, span: 3 },
    { label: null, span: 1 },                   // Expected Working
    { label: `Worked ${u}`, span: 3 },
    { label: `Paid Off ${u}`, span: 4 },
    { label: `Unpaid Off ${u}`, span: 3 },
  ];
};

// Grouped payroll summary — Payable / Expected / Worked / Paid Off / Unpaid
// Off per employee, in Day or Hour mode. "Simple summary report" collapses it
// to the three headline totals, matching Zoho's checkbox.
export default function AttendancePayrollData() {
  const f = useReportFilters();
  const [periodKey, setPeriodKey] = useState('thisWeek');
  const [dateRange, setDateRange] = useState(PERIOD_OPTIONS[0].value);
  const [unit, setUnit] = useState('day');
  const [simple, setSimple] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [filtersOpen, setFiltersOpen] = usePersistedOpen(false);
  const [exportOpen, setExportOpen] = useState(false);
  // Sixteen columns wide and 150 rows deep: the grid scrolls inside itself so
  // its horizontal scrollbar stays on screen instead of stranding at the foot
  // of a page you have to scroll six thousand pixels to reach.
  const gridRef = useRef(null);
  const gridHeight = useFitToViewport(gridRef, null, [filtersOpen, simple, unit, rows]);
  const sort = useSortable(rows, { id: 'reports-attendance-payroll-data', columns: SORT_COLUMNS });

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({
      startDate: dateRange.start, endDate: dateRange.end, unit, simple: String(simple), ...f.params(),
    });
    appendDimensionFilters(params, f.dimFilters);
    api.get(`/reports/attendance/payroll-export?${params}`)
      .then(r => setRows(Array.isArray(r.data.data) ? r.data.data : []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [dateRange, unit, simple, ...f.deps]);

  const reset = () => {
    setPeriodKey('thisWeek'); setDateRange(PERIOD_OPTIONS[0].value);
    setUnit('day'); setSimple(false); f.reset();
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

  const actions = (
    <div className="flex items-center gap-2">
      <UnitToggle value={unit} onChange={setUnit} />
      <FilterToggleButton open={filtersOpen} onClick={() => setFiltersOpen(o => !o)} />
    </div>
  );

  const step = n => {
    const span = Math.round((new Date(dateRange.end) - new Date(dateRange.start)) / 86400000) + 1;
    const next = { start: addDays(dateRange.start, n * span), end: addDays(dateRange.end, n * span) };
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
      <label className="flex items-center gap-1.5 px-1 py-1.5 text-[12.5px] text-slate-600 cursor-pointer select-none whitespace-nowrap">
        <input type="checkbox" checked={simple} onChange={e => setSimple(e.target.checked)} className="rounded border-slate-300" />
        Simple summary report
      </label>
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

  const u = unit === 'hour' ? 'Hours' : 'Days';

  return (
    <ReportShell menuItems={menuItems} title="Attendance Data for Payroll" periodNav={periodNav} subtitle="Payable, worked, paid-off and unpaid-off totals per employee" actions={actions} filters={filters} loading={loading} switcherCategory="Attendance">
      {rows.length === 0 ? (
        <div className="text-center py-16 text-slate-400">No data for this period</div>
      ) : simple ? (
        <div ref={gridRef} className="overflow-auto" style={gridHeight ? { height: gridHeight } : undefined}>
          <table className="w-full text-[14px] border-collapse">
            <thead className="bg-slate-50 text-[13px] text-slate-600 sticky top-0 z-20">
              <tr className="border-b border-slate-200">
                <SortableTh sort={sort} k="employee" className={`text-left ${HEAD}`}>Employee</SortableTh>
                <SortableTh sort={sort} k="payableTotal" className={`text-center ${HEAD}`}>Payable {u}</SortableTh>
                <SortableTh sort={sort} k="expectedWorkingDays" className={`text-center ${HEAD}`}>Expected Working {u}</SortableTh>
                <SortableTh sort={sort} k="workedTotal" className={`text-center ${HEAD}`}>Worked {u}</SortableTh>
              </tr>
            </thead>
            <tbody>
              {sort.sorted.map(row => (
                <tr key={row._id} className="border-b border-slate-200">
                  <td className={`${CELL} text-left`}><EmployeeCell row={row} /></td>
                  <td className={CELL}>{fmt(row.payableTotal, unit)}</td>
                  <td className={CELL}>{fmt(row.expectedWorkingDays, unit)}</td>
                  <td className={CELL}>{fmt(row.workedTotal, unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={gridRef} className="overflow-auto" style={gridHeight ? { height: gridHeight } : undefined}>
          <table className="w-full text-[14px] border-collapse">
            <thead className="bg-slate-50 text-[13px] text-slate-600 sticky top-0 z-20">
              <tr className="border-b border-slate-200">
                <SortableTh sort={sort} k="employee" rowSpan={2} className={`text-left align-bottom ${HEAD}`}>Employee</SortableTh>
                {/* Expected Payable is a Day-mode column in the reference; the
                    Hour view opens straight onto Payable Hours. */}
                {unit !== 'hour' && <SortableTh sort={sort} k="expectedPayableDays" rowSpan={2} className={`text-center align-bottom ${HEAD}`}>Expected Payable {u}</SortableTh>}
                <th colSpan={3} className={`text-center ${HEAD} border-b border-slate-200`}>Payable {u}</th>
                <SortableTh sort={sort} k="expectedWorkingDays" rowSpan={2} className={`text-center align-bottom ${HEAD}`}>Expected Working {u}</SortableTh>
                <th colSpan={3} className={`text-center ${HEAD} border-b border-slate-200`}>Worked {u}</th>
                <th colSpan={4} className={`text-center ${HEAD} border-b border-slate-200`}>Paid Off</th>
                <th colSpan={3} className={`text-center ${HEAD} border-b border-slate-200`}>Unpaid Off</th>
              </tr>
              <tr className="border-b border-slate-200">
                <SortableTh sort={sort} k="payableWorked" className={`text-center ${HEAD}`}>Worked {u}</SortableTh>
                <SortableTh sort={sort} k="payablePaidOff" className={`text-center ${HEAD}`}>Paid Off</SortableTh>
                <SortableTh sort={sort} k="payableTotal" className={`text-center ${HEAD}`}>Total</SortableTh>
                <SortableTh sort={sort} k="workedPresent" className={`text-center ${HEAD}`}>Present</SortableTh>
                <SortableTh sort={sort} k="workedOnDuty" className={`text-center ${HEAD}`}>On Duty</SortableTh>
                <SortableTh sort={sort} k="workedTotal" className={`text-center ${HEAD}`}>Total</SortableTh>
                <SortableTh sort={sort} k="paidLeave" className={`text-center ${HEAD}`}>Leave</SortableTh>
                <SortableTh sort={sort} k="paidHolidays" className={`text-center ${HEAD}`}>Holidays</SortableTh>
                <SortableTh sort={sort} k="paidWeekend" className={`text-center ${HEAD}`}>Weekend</SortableTh>
                <SortableTh sort={sort} k="paidOffTotal" className={`text-center ${HEAD}`}>Total</SortableTh>
                <SortableTh sort={sort} k="unpaidLeave" className={`text-center ${HEAD}`}>Leave</SortableTh>
                <SortableTh sort={sort} k="unpaidAbsent" className={`text-center ${HEAD}`}>Absent</SortableTh>
                <SortableTh sort={sort} k="unpaidTotal" className={`text-center ${HEAD}`}>Total</SortableTh>
              </tr>
            </thead>
            <tbody>
              {sort.sorted.map(row => (
                <tr key={row._id} className="border-b border-slate-200">
                  <td className={`${CELL} text-left`}><EmployeeCell row={row} /></td>
                  {unit !== 'hour' && <td className={CELL}>{fmt(row.expectedPayableDays, unit)}</td>}
                  <td className={CELL}>{fmt(row.payableWorked, unit)}</td>
                  <td className={CELL}>{fmt(row.payablePaidOff, unit)}</td>
                  <td className={CELL}>{fmt(row.payableTotal, unit)}</td>
                  <td className={CELL}>{fmt(row.expectedWorkingDays, unit)}</td>
                  <td className={CELL}>{fmt(row.workedPresent, unit)}</td>
                  <td className={CELL}>{fmt(row.workedOnDuty, unit)}</td>
                  <td className={CELL}>{fmt(row.workedTotal, unit)}</td>
                  <td className={CELL}>{fmt(row.paidLeave, unit)}</td>
                  <td className={CELL}>{fmt(row.paidHolidays, unit)}</td>
                  <td className={CELL}>{fmt(row.paidWeekend, unit)}</td>
                  <td className={CELL}>{fmt(row.paidOffTotal, unit)}</td>
                  <td className={CELL}>{fmt(row.unpaidLeave, unit)}</td>
                  <td className={CELL}>{fmt(row.unpaidAbsent, unit)}</td>
                  <td className={CELL}>{fmt(row.unpaidTotal, unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <LeaveExportModal
        open={exportOpen} onClose={() => setExportOpen(false)} rows={rows}
        withIdentity columns={exportColumns(simple, unit)}
        groups={w => exportGroups(simple, unit, w)}
        sheetName="Attendance Data"
        meta={[['Start Date', fmtDate(dateRange.start)], ['End Date', fmtDate(dateRange.end)]]}
        formats={['XLS', 'XLSX', 'CSV']}
        fileStub="Attendance data for payroll"
      />
    </ReportShell>
  );
}
