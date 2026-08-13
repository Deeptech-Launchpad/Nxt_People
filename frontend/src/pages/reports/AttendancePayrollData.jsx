import React, { useState, useEffect } from 'react';
import { Download, RotateCcw } from 'lucide-react';
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
import { EmployeeCell } from './TableReportPage';

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

const sum = (rows, key) => rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);
// Hour mode shows HH:MM like Zoho ("248:00"), day mode shows plain numbers.
const fmt = (v, unit) => {
  const n = Number(v) || 0;
  if (unit !== 'hour') return n;
  return `${String(Math.floor(n)).padStart(2, '0')}:${String(Math.round((n % 1) * 60)).padStart(2, '0')}`;
};

// The reference puts a banner row above the leaf headers so "Payable Day(s)"
// straddles its three sub-columns, "Worked Day(s)" its three, and so on. The
// identity block sits under a blank span of the same banner.
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

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

  const filters = (
    <>
      <PeriodFilter options={PERIOD_OPTIONS} selectedKey={periodKey} onSubmit={(v, k) => { setPeriodKey(k); setDateRange(v); }} />
      <label className="flex items-center gap-1.5 px-1 py-1.5 text-[12.5px] text-slate-600 cursor-pointer select-none whitespace-nowrap">
        <input type="checkbox" checked={simple} onChange={e => setSimple(e.target.checked)} className="rounded border-slate-300" />
        Simple summary report
      </label>
      <div className="flex items-center gap-2 ml-auto">
        <button onClick={reset} className="flex items-center gap-2 border border-slate-200 text-slate-600 hover:bg-slate-50 px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
          <RotateCcw size={14} /> Reset
        </button>
      </div>
      {filtersOpen && <StandardFilterRows f={f} />}
    </>
  );

  const u = unit === 'hour' ? 'Hours' : 'Days';

  return (
    <ReportShell menuItems={menuItems} title="Attendance Data for Payroll" subtitle="Payable, worked, paid-off and unpaid-off totals per employee" actions={actions} filters={filters} loading={loading} switcherCategory="Attendance">
      {rows.length === 0 ? (
        <div className="text-center py-16 text-slate-400">No data for this period</div>
      ) : simple ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead className="bg-slate-50 text-[13px] font-medium text-slate-600">
              <tr>
                <th className="text-left px-4 py-2.5">Employee</th>
                <th className="text-right px-4 py-2.5">Payable {u}</th>
                <th className="text-right px-4 py-2.5">Expected Working {u}</th>
                <th className="text-right px-4 py-2.5">Worked {u}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              <tr className="bg-slate-50/60 font-semibold text-slate-700">
                <td className="px-4 py-2.5">Total</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{fmt(sum(rows, 'payableTotal'), unit)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{fmt(sum(rows, 'expectedWorkingDays'), unit)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{fmt(sum(rows, 'workedTotal'), unit)}</td>
              </tr>
              {rows.map(row => (
                <tr key={row._id}>
                  <td className="px-4 py-2.5"><EmployeeCell row={row} /></td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-emerald-700">{fmt(row.payableTotal, unit)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmt(row.expectedWorkingDays, unit)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmt(row.workedTotal, unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead className="bg-slate-50 text-[13px] font-medium text-slate-600">
              <tr>
                <th rowSpan={2} className="text-left px-4 py-2.5 align-bottom">Employee</th>
                {unit === 'hour' && <th rowSpan={2} className="text-right px-4 py-2.5 align-bottom border-l border-slate-200">Total Worked Hours</th>}
                <th rowSpan={2} className="text-right px-4 py-2.5 align-bottom border-l border-slate-200">Expected Payable {u}</th>
                <th colSpan={3} className="text-center px-4 py-1.5 border-l border-slate-200">Payable {u}</th>
                <th rowSpan={2} className="text-right px-4 py-2.5 align-bottom border-l border-slate-200">Expected Working {u}</th>
                <th colSpan={3} className="text-center px-4 py-1.5 border-l border-slate-200">Worked {u}</th>
                <th colSpan={4} className="text-center px-4 py-1.5 border-l border-slate-200">Paid Off</th>
                <th colSpan={3} className="text-center px-4 py-1.5 border-l border-slate-200">Unpaid Off</th>
              </tr>
              <tr>
                <th className="text-right px-4 py-2 border-l border-slate-200">Worked</th>
                <th className="text-right px-4 py-2">Paid Off</th>
                <th className="text-right px-4 py-2">Total</th>
                <th className="text-right px-4 py-2 border-l border-slate-200">Present</th>
                <th className="text-right px-4 py-2">On Duty</th>
                <th className="text-right px-4 py-2">Total</th>
                <th className="text-right px-4 py-2 border-l border-slate-200">Leave</th>
                <th className="text-right px-4 py-2">Holidays</th>
                <th className="text-right px-4 py-2">Weekend</th>
                <th className="text-right px-4 py-2">Total</th>
                <th className="text-right px-4 py-2 border-l border-slate-200">Leave</th>
                <th className="text-right px-4 py-2">Absent</th>
                <th className="text-right px-4 py-2">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              <tr className="bg-slate-50/60 font-semibold text-slate-700">
                <td className="px-4 py-2.5">Total</td>
                {unit === 'hour' && <td className="px-4 py-2.5 text-right tabular-nums border-l border-slate-200">{fmt(sum(rows, 'totalWorkedHours'), unit)}</td>}
                <td className="px-4 py-2.5 text-right tabular-nums border-l border-slate-200">{fmt(sum(rows, 'expectedPayableDays'), unit)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums border-l border-slate-200">{fmt(sum(rows, 'payableWorked'), unit)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{fmt(sum(rows, 'payablePaidOff'), unit)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{fmt(sum(rows, 'payableTotal'), unit)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums border-l border-slate-200">{fmt(sum(rows, 'expectedWorkingDays'), unit)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums border-l border-slate-200">{fmt(sum(rows, 'workedPresent'), unit)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{fmt(sum(rows, 'workedOnDuty'), unit)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{fmt(sum(rows, 'workedTotal'), unit)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums border-l border-slate-200">{fmt(sum(rows, 'paidLeave'), unit)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{fmt(sum(rows, 'paidHolidays'), unit)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{fmt(sum(rows, 'paidWeekend'), unit)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{fmt(sum(rows, 'paidOffTotal'), unit)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums border-l border-slate-200">{fmt(sum(rows, 'unpaidLeave'), unit)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{fmt(sum(rows, 'unpaidAbsent'), unit)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{fmt(sum(rows, 'unpaidTotal'), unit)}</td>
              </tr>
              {rows.map(row => (
                <tr key={row._id}>
                  <td className="px-4 py-2.5"><EmployeeCell row={row} /></td>
                  {unit === 'hour' && <td className="px-4 py-2.5 text-right tabular-nums border-l border-slate-100">{fmt(row.totalWorkedHours, unit)}</td>}
                  <td className="px-4 py-2.5 text-right tabular-nums border-l border-slate-100">{fmt(row.expectedPayableDays, unit)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums border-l border-slate-100">{fmt(row.payableWorked, unit)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmt(row.payablePaidOff, unit)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-emerald-700">{fmt(row.payableTotal, unit)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums border-l border-slate-100">{fmt(row.expectedWorkingDays, unit)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums border-l border-slate-100">{fmt(row.workedPresent, unit)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmt(row.workedOnDuty, unit)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{fmt(row.workedTotal, unit)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums border-l border-slate-100">{fmt(row.paidLeave, unit)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmt(row.paidHolidays, unit)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmt(row.paidWeekend, unit)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{fmt(row.paidOffTotal, unit)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums border-l border-slate-100">{fmt(row.unpaidLeave, unit)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmt(row.unpaidAbsent, unit)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-amber-700">{fmt(row.unpaidTotal, unit)}</td>
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
        meta={[['Start Date', dateRange.start], ['End Date', dateRange.end]]}
        formats={['XLS', 'XLSX', 'CSV']}
        fileStub="Attendance data for payroll"
      />
    </ReportShell>
  );
}
