import React, { useState, useEffect } from 'react';
import { Filter, Download } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';
import LeaveExportModal from './LeaveExportModal';
import EmployeeStatusFilter from './EmployeeStatusFilter';
import FilterRow from './FilterRow';
import FilterToggleButton from './FilterToggleButton';
import EmployeeFilter from './EmployeeFilter';
import DirectReportsToggle from './DirectReportsToggle';
import UnitToggle from './UnitToggle';
import { EmployeeCell } from './TableReportPage';

const todayCA = () => new Date().toLocaleDateString('en-CA');
const monthStartCA = () => new Date(new Date().setDate(1)).toLocaleDateString('en-CA');
const sum = (rows, key) => rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);

const DAY_EXPORT_COLUMNS = [
  { key: 'firstName', header: 'First Name' }, { key: 'lastName', header: 'Last Name' }, { key: 'employeeCode', header: 'Employee ID' },
  { key: 'casualAllocated', header: 'Casual Allocated' }, { key: 'casualBooked', header: 'Casual Booked' }, { key: 'casualBalance', header: 'Casual Balance' },
  { key: 'absentBooked', header: 'Absent (Days)' }, { key: 'lwpBooked', header: 'Leave Without Pay (Days)' }, { key: 'unpaidTotalBooked', header: 'Unpaid Total (Days)' },
  { key: 'compOffBooked', header: 'Comp-Off Booked' }, { key: 'compOffBalance', header: 'Comp-Off Balance' },
];
const HOUR_EXPORT_COLUMNS = [
  { key: 'firstName', header: 'First Name' }, { key: 'lastName', header: 'Last Name' }, { key: 'employeeCode', header: 'Employee ID' },
  { key: 'permissionAllocated', header: 'Permission Allocated (Hrs)' }, { key: 'permissionBooked', header: 'Permission Booked (Hrs)' }, { key: 'permissionBalance', header: 'Permission Balance (Hrs)' },
];
const EXPORT_EXTRA = [{ key: 'department', header: 'Department' }];

// Grouped Paid (Casual) / Unpaid / Compensatory Off columns in Day mode;
// Permission-only Booked/Balance in Hour mode — matches Zoho's Leave
// Booked and Balance table structure, including its Day/Hour unit toggle
// (the two modes show entirely different columns, not a relabeled table).
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

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({
      startDate, endDate, unit, employeeStatus, directReportsOnly: String(directReportsOnly),
      ...(employee ? { employeeId: employee._id } : {}),
      ...Object.fromEntries(Object.entries(dimFilters).filter(([, v]) => v)),
    });
    api.get(`/reports/leave/booked-balance?${params}`)
      .then(r => setRows(Array.isArray(r.data.data) ? r.data.data : []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [unit, employeeStatus, employee, directReportsOnly, dimFilters]);

  const filters = (
    <>
      <div>
        <label className="block text-[13px] font-medium text-slate-600 mb-1">From</label>
        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-1.5 text-[14px] focus:outline-none focus:border-blue-400" />
      </div>
      <div>
        <label className="block text-[13px] font-medium text-slate-600 mb-1">To</label>
        <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-1.5 text-[14px] focus:outline-none focus:border-blue-400" />
      </div>
      <UnitToggle value={unit} onChange={setUnit} />
      {filtersOpen && (
        <>
          <EmployeeFilter value={employee} onChange={setEmployee} />
          <EmployeeStatusFilter value={employeeStatus} onChange={setEmployeeStatus} />
          <DirectReportsToggle value={directReportsOnly} onChange={setDirectReportsOnly} />
        </>
      )}
      <button onClick={load} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
        <Filter size={14} /> Apply
      </button>
      <div className="flex items-center gap-2 ml-auto">
        <button onClick={() => setExportOpen(true)} className="flex items-center gap-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
          <Download size={14} /> Export
        </button>
        <FilterToggleButton open={filtersOpen} onClick={() => setFiltersOpen(o => !o)} />
      </div>
    </>
  );

  return (
    <ReportShell title="Leave Booked and Balance" subtitle="Days booked in the selected period vs. yearly allocation" filters={filters} loading={loading} switcherCategory="Leave Tracker">
      {filtersOpen && <FilterRow value={dimFilters} onChange={(k, v) => setDimFilters(f => ({ ...f, [k]: v }))} />}
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
                <th colSpan={3} className="text-center px-4 py-1.5 border-l border-slate-200">Paid (Casual)</th>
                <th colSpan={3} className="text-center px-4 py-1.5 border-l border-slate-200">Unpaid</th>
                <th colSpan={2} className="text-center px-4 py-1.5 border-l border-slate-200">Compensatory Off</th>
              </tr>
              <tr>
                <th className="text-right px-4 py-2 border-l border-slate-200">Allocated</th>
                <th className="text-right px-4 py-2">Booked</th>
                <th className="text-right px-4 py-2">Balance</th>
                <th className="text-right px-4 py-2 border-l border-slate-200">Absent</th>
                <th className="text-right px-4 py-2">LWP</th>
                <th className="text-right px-4 py-2">Total</th>
                <th className="text-right px-4 py-2 border-l border-slate-200">Booked</th>
                <th className="text-right px-4 py-2">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              <tr className="bg-slate-50/60 font-semibold text-slate-700">
                <td className="px-4 py-2.5">Total</td>
                <td className="px-4 py-2.5 text-right tabular-nums border-l border-slate-200">{sum(rows, 'casualAllocated')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'casualBooked')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'casualBalance')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums border-l border-slate-200">{sum(rows, 'absentBooked')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'lwpBooked')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'unpaidTotalBooked')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums border-l border-slate-200">{sum(rows, 'compOffBooked')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'compOffBalance')}</td>
              </tr>
              {rows.map(row => (
                <tr key={row._id}>
                  <td className="px-4 py-2.5"><EmployeeCell row={row} /></td>
                  <td className="px-4 py-2.5 text-right tabular-nums border-l border-slate-100">{row.casualAllocated}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.casualBooked}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-emerald-700">{row.casualBalance}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums border-l border-slate-100">{row.absentBooked}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.lwpBooked}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{row.unpaidTotalBooked}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums border-l border-slate-100">{row.compOffBooked}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-emerald-700">{row.compOffBalance}</td>
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
