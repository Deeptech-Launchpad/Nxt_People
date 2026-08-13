import React, { useState, useEffect } from 'react';
import { Filter, Download, RotateCcw } from 'lucide-react';
import api from '../../utils/api';
import { appendDimensionFilters } from '../../utils/reportParams';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';
import FilterToggleButton from './FilterToggleButton';
import StandardFilterRows from './StandardFilterRows';
import PeriodFilter from './PeriodFilter';
import LeaveExportModal from './LeaveExportModal';
import useReportFilters from '../../hooks/useReportFilters';
import { EmployeeCell } from './TableReportPage';

const now = new Date();
const y = now.getFullYear(), m = now.getMonth();
const range = (s, e) => ({ start: s.toLocaleDateString('en-CA'), end: e.toLocaleDateString('en-CA') });

const PERIOD_OPTIONS = [
  { key: 'thisMonth', label: 'This Month', value: range(new Date(y, m, 1), new Date(y, m + 1, 0)) },
  { key: 'lastMonth', label: 'Last Month', value: range(new Date(y, m - 1, 1), new Date(y, m, 0)) },
  { key: 'thisYear', label: 'This Year', value: range(new Date(y, 0, 1), new Date(y, 11, 31)) },
];

const fmtDate = d => new Date(d).toLocaleDateString('en-GB');
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

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

  const actions = <FilterToggleButton open={filtersOpen} onClick={() => setFiltersOpen(o => !o)} />;

  const filters = (
    <>
      <PeriodFilter options={PERIOD_OPTIONS} selectedKey={periodKey} onSubmit={(v, k) => { setPeriodKey(k); setDateRange(v); }} />
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-[12.5px] text-slate-600 whitespace-nowrap">
        Absent consecutively for at least
        <input
          type="number" min="1" value={minDays}
          onChange={e => setMinDays(Number(e.target.value))}
          className="w-14 border border-slate-200 rounded px-1.5 py-0.5 text-[12.5px] text-center focus:outline-none focus:border-blue-400"
        />
        day(s)
      </div>
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
    <ReportShell menuItems={menuItems} title="Consecutive Absences" subtitle="Unbroken absence streaks in the selected period" actions={actions} filters={filters} loading={loading} switcherCategory="Attendance">
      {rows.length === 0 ? (
        <div className="text-center py-16 text-slate-400">No consecutive absence streaks in this period</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead className="bg-slate-50 text-[13px] font-medium text-slate-600">
              <tr>
                <th className="text-left px-4 py-2.5">Employee</th>
                <th className="text-left px-4 py-2.5">Absence Period</th>
                <th className="text-right px-4 py-2.5">Number of Days</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map((row, i) => (
                <tr key={`${row._id}-${row.startDate}-${i}`}>
                  <td className="px-4 py-2.5"><EmployeeCell row={row} /></td>
                  <td className="px-4 py-2.5 text-slate-600">{fmtDate(row.startDate)} - {fmtDate(row.endDate)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-red-600">{row.count}</td>
                </tr>
              ))}
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
