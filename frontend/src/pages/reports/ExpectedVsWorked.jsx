import React, { useState, useEffect } from 'react';
import { Download, RotateCcw } from 'lucide-react';
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

const sum = (rows, key) => rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);
const fmtH = h => `${h > 0 ? '+' : ''}${(Number(h) || 0).toFixed(2)}h`;

// HH:MM on the "(Hours)" sheet, fractional on "(Decimal)" — the reference
// ships both. Previous Balance is always 0: this system has no carry-forward
// time bank, so the column exists for column-parity and stays honest.
const hhmm = h => {
  const n = Math.abs(Number(h) || 0);
  const s = `${String(Math.floor(n)).padStart(2, '0')}:${String(Math.round((n % 1) * 60)).padStart(2, '0')}`;
  return (Number(h) || 0) < 0 ? `-${s}` : s;
};
const exportCols = (decimal) => [
  { key: 'previousBalance', header: 'Previous Balance', value: () => (decimal ? '0.00' : '00:00') },
  { key: 'expectedHours', header: 'Expected Hours', value: r => (decimal ? (Number(r.expectedHours) || 0).toFixed(2) : hhmm(r.expectedHours)) },
  { key: 'workedHours', header: 'Payable Hours', value: r => (decimal ? (Number(r.workedHours) || 0).toFixed(2) : hhmm(r.workedHours)) },
  { key: 'variance', header: 'Balance Hours', value: r => (decimal ? (Number(r.variance) || 0).toFixed(2) : hhmm(r.variance)) },
];

// Expected (shift length × working days in range) vs actually logged hours.
// Zoho's version is a carry-forward overtime bank with a Previous Balance
// rolled between pay periods; this system has no time-bank or pay-period
// model, so the report stays an honest single-period comparison rather than
// showing a fabricated balance.
export default function ExpectedVsWorked() {
  const f = useReportFilters();
  const [periodKey, setPeriodKey] = useState('thisMonth');
  const [dateRange, setDateRange] = useState(PERIOD_OPTIONS[0].value);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [workingDays, setWorkingDays] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({ startDate: dateRange.start, endDate: dateRange.end, ...f.params() });
    appendDimensionFilters(params, f.dimFilters);
    api.get(`/reports/attendance/expected-vs-worked?${params}`)
      .then(r => { setRows(Array.isArray(r.data.data) ? r.data.data : []); setWorkingDays(r.data.workingDays || 0); })
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [dateRange, ...f.deps]);

  const reset = () => { setPeriodKey('thisMonth'); setDateRange(PERIOD_OPTIONS[0].value); f.reset(); };
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
      <span className="text-[12.5px] text-slate-500 px-1 py-1.5 whitespace-nowrap">
        Working days in range: <span className="font-semibold text-slate-700">{workingDays}</span>
      </span>
      <div className="flex items-center gap-2 ml-auto">
        <button onClick={reset} className="flex items-center gap-2 border border-slate-200 text-slate-600 hover:bg-slate-50 px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
          <RotateCcw size={14} /> Reset
        </button>
      </div>
      {filtersOpen && <StandardFilterRows f={f} />}
    </>
  );

  return (
    <ReportShell menuItems={menuItems} title="Expected vs Worked Hours" subtitle="Expected hours from shift × working days vs. actual hours logged" actions={actions} filters={filters} loading={loading} switcherCategory="Attendance">
      {rows.length === 0 ? (
        <div className="text-center py-16 text-slate-400">No data for this period</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead className="bg-slate-50 text-[12px] font-bold text-slate-500 uppercase">
              <tr>
                <th className="text-left px-4 py-2.5">Employee</th>
                <th className="text-left px-4 py-2.5">Shift(s)</th>
                <th className="text-right px-4 py-2.5">Expected Hours</th>
                <th className="text-right px-4 py-2.5">Worked Hours</th>
                <th className="text-right px-4 py-2.5">Variance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              <tr className="bg-slate-50/60 font-semibold text-slate-700">
                <td className="px-4 py-2.5">Total</td>
                <td className="px-4 py-2.5"></td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'expectedHours').toFixed(2)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'workedHours').toFixed(2)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{fmtH(sum(rows, 'variance'))}</td>
              </tr>
              {rows.map(row => (
                <tr key={row._id}>
                  <td className="px-4 py-2.5"><EmployeeCell row={row} /></td>
                  <td className="px-4 py-2.5 text-slate-500">{row.shiftName || '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.expectedHours}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.workedHours}</td>
                  <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${row.variance < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{fmtH(row.variance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <LeaveExportModal
        open={exportOpen} onClose={() => setExportOpen(false)} rows={rows}
        withIdentity columns={exportCols(false)} hourColumns={exportCols(true)}
        sheetName="Expected vs Worked"
        meta={[['From Date', dateRange.start], ['To Date', dateRange.end]]}
        formats={['XLS', 'XLSX', 'CSV']}
        fileStub="Expected vs Worked Hours"
      />
    </ReportShell>
  );
}
