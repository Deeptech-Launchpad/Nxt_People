import React, { useState, useEffect } from 'react';
import { Filter, RotateCcw } from 'lucide-react';
import api from '../../utils/api';
import { appendDimensionFilters } from '../../utils/reportParams';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';
import LeaveExportModal from './LeaveExportModal';
import EmployeeStatusFilter from './EmployeeStatusFilter';
import FilterRow from './FilterRow';
import EmployeeFilter from './EmployeeFilter';
import DirectReportsToggle from './DirectReportsToggle';
import UnitToggle from './UnitToggle';
import DateChip from './DateChip';
import PeriodPresetChip from './PeriodPresetChip';
import FilterToggleButton from './FilterToggleButton';
import { EmployeeCell } from './TableReportPage';

const todayCA = () => new Date().toLocaleDateString('en-CA');
const monthStartCA = () => new Date(new Date().setDate(1)).toLocaleDateString('en-CA');
const sum = (rows, key) => rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);

const DAY_EXPORT_COLUMNS = [
  { key: 'firstName', header: 'First Name' }, { key: 'lastName', header: 'Last Name' }, { key: 'employeeCode', header: 'Employee ID' },
  { key: 'casualAllocated', header: 'Casual Allocated' }, { key: 'casualBooked', header: 'Casual Booked' }, { key: 'casualBalance', header: 'Casual Balance' },
  { key: 'absentBooked', header: 'Absent (Days)' }, { key: 'lwpBooked', header: 'Leave Without Pay (Days)' }, { key: 'unpaidTotalBooked', header: 'Unpaid Total (Days)' },
  { key: 'compOffBooked', header: 'Comp-Off Booked' }, { key: 'compOffBalance', header: 'Comp-Off Balance' },
  { key: 'totalBooked', header: 'Total Booked' }, { key: 'totalBalance', header: 'Total Balance' },
];
const HOUR_EXPORT_COLUMNS = [
  { key: 'firstName', header: 'First Name' }, { key: 'lastName', header: 'Last Name' }, { key: 'employeeCode', header: 'Employee ID' },
  { key: 'permissionAllocated', header: 'Permission Allocated (Hrs)' }, { key: 'permissionBooked', header: 'Permission Booked (Hrs)' }, { key: 'permissionBalance', header: 'Permission Balance (Hrs)' },
];
const EXPORT_EXTRA = [{ key: 'department', header: 'Department' }];

export default function BookedBalance() {
  const [startDate, setStartDate] = useState(monthStartCA());
  const [endDate, setEndDate] = useState(todayCA());
  const [unit, setUnit] = useState('day');
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [employeeStatus, setEmployeeStatus] = useState('all');
  const [employee, setEmployee] = useState(null);
  const [directReportsOnly, setDirectReportsOnly] = useState(false);
  const [dimFilters, setDimFilters] = useState({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [showExEmployees, setShowExEmployees] = useState(true);

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({
      startDate, endDate, unit, employeeStatus, directReportsOnly: String(directReportsOnly),
      ...(employee ? { employeeId: employee._id } : {}),
    });
    appendDimensionFilters(params, dimFilters);
    api.get(`/reports/leave/booked-balance?${params}`)
      .then(r => {
        const raw = Array.isArray(r.data.data) ? r.data.data : [];
        const enriched = raw.map(row => ({
          ...row,
          totalBooked: (Number(row.casualBooked) || 0) + (Number(row.absentBooked) || 0) + (Number(row.lwpBooked) || 0) + (Number(row.compOffBooked) || 0),
          totalBalance: (Number(row.casualBalance) || 0) + (Number(row.compOffBalance) || 0),
        }));
        setRows(enriched);
      })
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [unit, employeeStatus, employee, directReportsOnly, dimFilters]);

  const reset = () => {
    setStartDate(monthStartCA()); setEndDate(todayCA()); setEmployee(null);
    setEmployeeStatus('all'); setDirectReportsOnly(false); setDimFilters({});
  };

  // The export modal existed but nothing opened it — there was no entry point
  // on the page at all, so the report could not be exported.
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

  const filters = filtersOpen ? (
    <>
      <PeriodPresetChip onSelect={({ start, end }) => { setStartDate(start); setEndDate(end); }} />
      <DateChip label="From Date" value={startDate} onChange={setStartDate} />
      <DateChip label="To Date" value={endDate} onChange={setEndDate} />
      <EmployeeFilter value={employee} onChange={setEmployee} />
      <DirectReportsToggle value={directReportsOnly} onChange={setDirectReportsOnly} />
      <FilterRow value={dimFilters} onChange={(k, v) => setDimFilters(f => ({ ...f, [k]: v }))} />
      <div className="flex items-center gap-2 ml-auto">
        <button onClick={load} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
          <Filter size={14} /> Submit
        </button>
        <button onClick={reset} className="flex items-center gap-2 border border-slate-200 text-slate-600 hover:bg-slate-50 px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
          <RotateCcw size={14} /> Reset
        </button>
      </div>
      <div className="w-full flex flex-wrap items-center gap-2">
        <EmployeeStatusFilter value={employeeStatus} onChange={setEmployeeStatus} />
        <label className="flex items-center gap-1.5 px-1 py-1.5 text-[12.5px] text-slate-600 cursor-pointer select-none whitespace-nowrap">
          <input type="checkbox" checked={showExEmployees} onChange={e => setShowExEmployees(e.target.checked)} className="rounded border-slate-300 text-blue-600" />
          Show selective ex-employees
        </label>
      </div>
    </>
  ) : null;

  return (
    <ReportShell menuItems={menuItems} title="Leave Booked and Balance" subtitle="Days booked in the selected period vs. yearly allocation" actions={actions} filters={filters} loading={loading} switcherCategory="Leave Tracker">
      {rows.length === 0 ? (
        <div className="text-center py-16 text-slate-400">No data for this period</div>
      ) : unit === 'hour' ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead className="bg-slate-50 text-[11px] font-bold text-slate-500 uppercase">
              <tr>
                <th className="text-left px-4 py-2.5">Employee</th>
                <th colSpan={3} className="text-center px-4 py-1.5 border-l border-slate-200">Permission</th>
              </tr>
              <tr>
                <th></th>
                <th className="text-right px-4 py-2 border-l border-slate-200">Allocated</th>
                <th className="text-right px-4 py-2">Booked</th>
                <th className="text-right px-4 py-2">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              <tr className="bg-slate-50/60 font-semibold text-slate-700">
                <td className="px-4 py-2.5">Total</td>
                <td className="px-4 py-2.5 text-right tabular-nums border-l border-slate-200">{sum(rows, 'permissionAllocated')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'permissionBooked')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'permissionBalance')}</td>
              </tr>
              {rows.map(row => (
                <tr key={row._id}>
                  <td className="px-4 py-2.5"><EmployeeCell row={row} /></td>
                  <td className="px-4 py-2.5 text-right tabular-nums border-l border-slate-100">{row.permissionAllocated}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.permissionBooked}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-emerald-700">{row.permissionBalance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead className="bg-slate-50 text-[11px] font-bold text-slate-500 uppercase">
              <tr>
                <th rowSpan={2} className="text-left px-4 py-2.5 align-bottom">Employee</th>
                <th colSpan={2} className="text-center px-4 py-1.5 border-l border-slate-200">Paid</th>
                <th colSpan={5} className="text-center px-4 py-1.5 border-l border-slate-200">Unpaid</th>
                <th colSpan={2} className="text-center px-4 py-1.5 border-l border-slate-200">Compensatory Off</th>
                <th colSpan={2} className="text-center px-4 py-1.5 border-l border-slate-200">Total</th>
              </tr>
              <tr>
                <th className="text-right px-4 py-2 border-l border-slate-200">Booked</th>
                <th className="text-right px-4 py-2">Balance</th>
                <th className="text-right px-4 py-2 border-l border-slate-200">Absent</th>
                <th className="text-right px-4 py-2">LWP Booked</th>
                <th className="text-right px-4 py-2">LWP Balance</th>
                <th className="text-right px-4 py-2">Unpaid Total</th>
                <th className="text-right px-4 py-2">Unpaid Balance</th>
                <th className="text-right px-4 py-2 border-l border-slate-200">Booked</th>
                <th className="text-right px-4 py-2">Balance</th>
                <th className="text-right px-4 py-2 border-l border-slate-200">Booked</th>
                <th className="text-right px-4 py-2">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              <tr className="bg-slate-50/60 font-semibold text-slate-700">
                <td className="px-4 py-2.5">Total</td>
                <td className="px-4 py-2.5 text-right tabular-nums border-l border-slate-200">{sum(rows, 'casualBooked')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'casualBalance')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums border-l border-slate-200">{sum(rows, 'absentBooked')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'lwpBooked')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">N/A</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'unpaidTotalBooked')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">N/A</td>
                <td className="px-4 py-2.5 text-right tabular-nums border-l border-slate-200">{sum(rows, 'compOffBooked')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'compOffBalance')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums border-l border-slate-200">{sum(rows, 'totalBooked')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'totalBalance')}</td>
              </tr>
              {rows.map(row => (
                <tr key={row._id}>
                  <td className="px-4 py-2.5"><EmployeeCell row={row} /></td>
                  <td className="px-4 py-2.5 text-right tabular-nums border-l border-slate-100">{row.casualBooked}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-emerald-700">{row.casualBalance}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums border-l border-slate-100">{row.absentBooked}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.lwpBooked}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-400">N/A</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{row.unpaidTotalBooked}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-400">N/A</td>
                  <td className="px-4 py-2.5 text-right tabular-nums border-l border-slate-100">{row.compOffBooked}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-emerald-700">{row.compOffBalance}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums border-l border-slate-100 font-semibold">{row.totalBooked}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-emerald-700">{row.totalBalance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <LeaveExportModal open={exportOpen} onClose={() => setExportOpen(false)} rows={rows} baseColumns={unit === 'hour' ? HOUR_EXPORT_COLUMNS : DAY_EXPORT_COLUMNS} extraColumns={EXPORT_EXTRA} fileStub={`leave-booked-balance_${startDate}_to_${endDate}`} />
    </ReportShell>
  );
}
