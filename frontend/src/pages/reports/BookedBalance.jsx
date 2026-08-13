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

// The Day table is described rather than hand-written so the Type filter can
// show and hide whole groups. Sub-groups sit under a pay-type banner, matching
// the reference — note Total belongs to Unpaid there (the unpaid total), not to
// the table as a whole.
//
// An unpaid type has no entitlement to draw down, so its balance is the
// negative of what was booked: taking leave without pay puts you in deficit
// rather than consuming an allocation. The reference shows exactly that.
// `|| 0` collapses -0 back to 0 — negating a zero balance otherwise prints
// "-0", which reads as a defect rather than a nil figure.
const negate = key => row => (row[key] === null || row[key] === undefined ? null : -(Number(row[key]) || 0) || 0);
const DAY_GROUPS = [
  {
    key: 'paid', label: 'Paid',
    subs: [{ label: 'Casual Leave', booked: 'casualBooked', balance: 'casualBalance' }],
  },
  {
    key: 'unpaid', label: 'Unpaid',
    subs: [
      { label: 'Absent', booked: 'absentBooked', balance: negate('absentBooked') },
      { label: 'Leave Without Pay', booked: 'lwpBooked', balance: negate('lwpBooked') },
      { label: 'Total', booked: 'unpaidTotalBooked', balance: negate('unpaidTotalBooked') },
    ],
  },
  {
    key: 'comp_off', label: 'Compensatory Off',
    subs: [{ label: 'Compensatory Off', booked: 'compOffBooked', balance: 'compOffBalance' }],
  },
];

// On Duty and Restricted Holidays are offered by the reference but not
// modelled here, so they are left out rather than added as options that
// silently filter to an empty table.
const TYPE_OPTIONS = [['', 'All'], ...DAY_GROUPS.map(g => [g.key, g.label])];

// null means the employee has no allocation for this type at all, which the
// reference prints as N/A. A 0 is a real figure and stays a 0.
const naIfNull = v => (v === null || v === undefined ? 'N/A' : v);
const cellValue = (row, spec) => (typeof spec === 'function' ? spec(row) : row[spec]);
const groupTotal = (rows, spec) => rows.reduce((s, r) => s + (Number(cellValue(r, spec)) || 0), 0);

export default function BookedBalance() {
  const [startDate, setStartDate] = useState(monthStartCA());
  const [endDate, setEndDate] = useState(todayCA());
  const [unit, setUnit] = useState('day');
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [employeeStatus, setEmployeeStatus] = useState('all');
  const [employee, setEmployee] = useState([]);
  const [directReportsOnly, setDirectReportsOnly] = useState(false);
  const [dimFilters, setDimFilters] = useState({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [showExEmployees, setShowExEmployees] = useState(true);
  // Type narrows which pay-type groups the Day table shows. It is purely a
  // column filter — the rows are unchanged, so it does not refetch.
  const [payTypeFilter, setPayTypeFilter] = useState('');

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({
      startDate, endDate, unit, employeeStatus, directReportsOnly: String(directReportsOnly),
    });
    appendDimensionFilters(params, dimFilters);
    // Repeated employeeId params — Express parses them into the array the
    // backend's ANY() clause expects.
    employee.forEach(e => params.append('employeeId', e._id));
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
    setStartDate(monthStartCA()); setEndDate(todayCA()); setEmployee([]);
    setEmployeeStatus('all'); setDirectReportsOnly(false); setDimFilters({});
    setPayTypeFilter('');
  };

  const visibleGroups = payTypeFilter
    ? DAY_GROUPS.filter(g => g.key === payTypeFilter)
    : DAY_GROUPS;

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
      {/* Hour mode shows only Permission, which has no groups to narrow. */}
      {unit === 'day' && (
        <label className="flex items-center gap-2 border border-slate-200 rounded-lg px-3 py-1.5 text-[13.5px] text-slate-600 bg-white">
          <span className="text-slate-500">Type :</span>
          <select
            value={payTypeFilter}
            onChange={e => setPayTypeFilter(e.target.value)}
            className="bg-transparent text-slate-700 focus:outline-none cursor-pointer"
          >
            {TYPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      )}
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
            <thead className="bg-slate-50 text-[13px] font-medium text-slate-600">
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
            <thead className="bg-slate-50 text-[13px] font-medium text-slate-600">
              <tr>
                <th rowSpan={3} className="text-left px-4 py-2.5 align-bottom">Employee</th>
                {visibleGroups.map(g => (
                  <th key={g.key} colSpan={g.subs.length * 2} className="text-center px-4 py-1.5 border-l border-slate-200">
                    {g.label}
                  </th>
                ))}
              </tr>
              <tr>
                {visibleGroups.flatMap(g => g.subs.map((s, i) => (
                  <th key={`${g.key}-${s.label}`} colSpan={2}
                    className={`text-center px-4 py-1.5 ${i === 0 ? 'border-l border-slate-200' : ''}`}>
                    {s.label}
                  </th>
                )))}
              </tr>
              <tr>
                {visibleGroups.flatMap(g => g.subs.flatMap((s, i) => ([
                  <th key={`${g.key}-${s.label}-b`} className={`text-right px-4 py-2 ${i === 0 ? 'border-l border-slate-200' : ''}`}>Booked</th>,
                  <th key={`${g.key}-${s.label}-l`} className="text-right px-4 py-2">Balance</th>,
                ])))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map(row => (
                <tr key={row._id}>
                  <td className="px-4 py-2.5"><EmployeeCell row={row} /></td>
                  {visibleGroups.flatMap(g => g.subs.flatMap((s, i) => {
                    const balance = cellValue(row, s.balance);
                    return [
                      <td key={`${g.key}-${s.label}-b`} className={`px-4 py-2.5 text-right tabular-nums ${i === 0 ? 'border-l border-slate-100' : ''}`}>
                        {naIfNull(cellValue(row, s.booked))}
                      </td>,
                      // A negative balance is a deficit, not a surplus, so it
                      // must not wear the same green as an unused allocation.
                      <td key={`${g.key}-${s.label}-l`}
                        className={`px-4 py-2.5 text-right tabular-nums font-semibold ${Number(balance) < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                        {naIfNull(balance)}
                      </td>,
                    ];
                  }))}
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
