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

const now = new Date();
const y = now.getFullYear(), m = now.getMonth();
const range = (s, e) => ({ start: s.toLocaleDateString('en-CA'), end: e.toLocaleDateString('en-CA') });

const PERIOD_OPTIONS = [
  { key: 'thisMonth', label: 'This Month', value: range(new Date(y, m, 1), new Date(y, m + 1, 0)) },
  { key: 'lastMonth', label: 'Last Month', value: range(new Date(y, m - 1, 1), new Date(y, m, 0)) },
  { key: 'thisYear', label: 'This Year', value: range(new Date(y, 0, 1), new Date(y, 11, 31)) },
];

const fmtDate = d => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });

// A balance runs to thousands of hours, so the hour part is not capped at 24 —
// "4625:35" is a legitimate reading. Negative balances keep their sign.
const hhmm = h => {
  const v = Number(h) || 0;
  const n = Math.abs(v);
  const mins = Math.round((n % 1) * 60);
  const hrs = Math.floor(n) + (mins === 60 ? 1 : 0);
  return `${v < 0 ? '-' : ''}${String(hrs).padStart(2, '0')}:${String(mins === 60 ? 0 : mins).padStart(2, '0')}`;
};

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

// Extra and deficit time are shown apart from the balance, which nets them
// off: three hours short on Monday and three over on Tuesday reads as a quiet
// zero, and that pattern is exactly what somebody would want to see. They only
// appear when the organization measures them — see "Allow overtime and
// deviation" on the Attendance Policy screen.
const BASE_COLUMNS = [
  ['previousBalance', 'Previous Balance'],
  ['expectedHours', 'Expected Hours'],
  ['payableHours', 'Payable Hours'],
  ['balanceHours', 'Balance Hours'],
];
const DEVIATION_COLUMNS = [
  ['overtimeHours', 'Extra Time'],
  ['deficitHours', 'Deficit Time'],
];
const columnsFor = tracked => (tracked ? [...BASE_COLUMNS, ...DEVIATION_COLUMNS] : BASE_COLUMNS);
const exportCols = (decimal, tracked) => columnsFor(tracked).map(([key, header]) => ({
  key, header,
  // Null means the figure is not measured, and rendering that as 0.00 would
  // claim the person worked their hours exactly.
  value: r => (r[key] === null || r[key] === undefined ? ''
    : decimal ? Number(r[key]).toFixed(2) : hhmm(r[key])),
}));

// A running hour ledger: what the period owed, what it paid for, and the
// balance carried in and out. Previous Balance is the same Payable - Expected
// sum over everything before the period rather than a stored bank, so it is
// derived from this system's own attendance and will not match a balance
// accumulated elsewhere.
export default function ExpectedVsWorked() {
  const f = useReportFilters();
  const [periodKey, setPeriodKey] = useState('thisMonth');
  const [dateRange, setDateRange] = useState(PERIOD_OPTIONS[0].value);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [tracked, setTracked] = useState(false);
  const COLUMNS = columnsFor(tracked);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const gridRef = useRef(null);
  const gridHeight = useFitToViewport(gridRef, null, [filtersOpen, rows]);

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({ startDate: dateRange.start, endDate: dateRange.end, ...f.params() });
    appendDimensionFilters(params, f.dimFilters);
    api.get(`/reports/attendance/expected-vs-worked?${params}`)
      .then(r => {
        setRows(Array.isArray(r.data.data) ? r.data.data : []);
        setTracked(r.data.deviationTracked === true);
      })
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [dateRange, ...f.deps]);

  const reset = () => { setPeriodKey('thisMonth'); setDateRange(PERIOD_OPTIONS[0].value); f.reset(); };

  // Export, Print and PDF beside the funnel, matching every other report.
  // Import is deliberately absent: nothing in this app ingests an hours file,
  // and a menu entry that does nothing is worse than no entry.
  const menuItems = [
    { key: 'export', label: 'Export', onClick: () => setExportOpen(true) },
    { key: 'print', label: 'Print', onClick: () => window.print() },
    { key: 'pdf', label: 'Download as PDF', hint: 'Opens the print dialog — choose "Save as PDF"', onClick: () => window.print() },
  ];

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
    <ReportShell menuItems={menuItems} title="Expected vs Worked Hours" periodNav={periodNav} subtitle="Hours owed, hours payable, and the balance carried in and out" actions={actions} filters={filters} loading={loading} switcherCategory="Attendance">
      {rows.length === 0 ? (
        <div className="text-center py-16 text-slate-400">No data for this period</div>
      ) : (
        <div ref={gridRef} className="overflow-auto" style={gridHeight ? { height: gridHeight } : undefined}>
          <table className="w-full text-[14px] border-collapse">
            <thead className="bg-slate-50 text-[13px] font-medium text-slate-600 sticky top-0 z-20">
              <tr className="border-b border-slate-200">
                <th className="text-left px-4 py-2.5 border-r border-slate-200">Employee</th>
                {COLUMNS.map(([key, header]) => (
                  <th key={key} className="text-left px-4 py-2.5 border-r border-slate-200 last:border-r-0 whitespace-nowrap">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row._id} className="border-b border-slate-200">
                  <td className="px-4 py-2.5 border-r border-slate-200"><EmployeeCell row={row} /></td>
                  {COLUMNS.map(([key]) => (
                    // A negative balance is the one figure worth colouring —
                    // it means hours owed, not banked.
                    <td key={key} className={`px-4 py-2.5 tabular-nums border-r border-slate-200 last:border-r-0 ${key === 'balanceHours' && row[key] < 0 ? 'text-red-600' : 'text-slate-700'}`}>
                      {row[key] === null || row[key] === undefined ? '—' : hhmm(row[key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <LeaveExportModal
        open={exportOpen} onClose={() => setExportOpen(false)} rows={rows}
        withIdentity columns={exportCols(false, tracked)} hourColumns={exportCols(true, tracked)}
        sheetName="Expected vs Worked"
        meta={[['From Date', dateRange.start], ['To Date', dateRange.end]]}
        formats={['XLS', 'XLSX', 'CSV']}
        fileStub="Expected vs Worked Hours"
      />
    </ReportShell>
  );
}
