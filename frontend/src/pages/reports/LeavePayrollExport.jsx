import React, { useState, useEffect, useRef } from 'react';
import { Filter, ChevronDown, RotateCcw } from 'lucide-react';
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
import PayPeriodChip from './PayPeriodChip';
import FilterToggleButton from './FilterToggleButton';
import { EmployeeCell } from './TableReportPage';

const todayCA = () => new Date().toLocaleDateString('en-CA');
const monthStartCA = () => new Date(new Date().setDate(1)).toLocaleDateString('en-CA');
const sum = (rows, key) => rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);

function ReportTypeDropdown({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const onClick = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12.5px] font-medium border border-slate-200 bg-white text-slate-700 hover:border-slate-300 transition-colors whitespace-nowrap">
        Report Type: {value === 'detailed' ? 'Detailed' : 'Default'} <ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-40 bg-white border border-slate-200 rounded-lg shadow-lg py-1">
          {[['default', 'Default'], ['detailed', 'Detailed']].map(([k, l]) => (
            <button key={k} onClick={() => { onChange(k); setOpen(false); }} className={`w-full text-left px-3 py-1.5 text-[12.5px] transition-colors ${value === k ? 'text-blue-600 font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}>{l}</button>
          ))}
        </div>
      )}
    </div>
  );
}

const unitLabel = (unit, word) => `${word} (${unit === 'hour' ? 'Hrs' : 'Days'})`;

const exportColumns = (reportType, unit) => {
  const base = [
    { key: 'firstName', header: 'First Name' }, { key: 'lastName', header: 'Last Name' }, { key: 'employeeCode', header: 'Employee ID' },
  ];
  if (reportType === 'detailed') {
    return [...base,
      { key: 'totalDays', header: unitLabel(unit, 'Total') }, { key: 'weekendCount', header: unitLabel(unit, 'Weekend') }, { key: 'holidayCount', header: unitLabel(unit, 'Holidays') },
      { key: 'payableDays', header: unitLabel(unit, 'Payable') }, { key: 'onDutyDays', header: unitLabel(unit, 'On Duty') },
      { key: 'leavePaid', header: unitLabel(unit, 'Leave Paid') }, { key: 'leaveUnpaid', header: unitLabel(unit, 'Leave Unpaid') }, { key: 'leaveComp', header: unitLabel(unit, 'Leave Comp-Off') }, { key: 'leaveTotal', header: unitLabel(unit, 'Leave Total') },
      { key: 'lopDays', header: unitLabel(unit, 'Loss of Pay') }, { key: 'paidDays', header: unitLabel(unit, 'Paid') },
    ];
  }
  return [...base, { key: 'totalDays', header: unitLabel(unit, 'Total') }, { key: 'lopDays', header: unitLabel(unit, 'Loss of Pay') }, { key: 'paidDays', header: unitLabel(unit, 'Paid') }];
};
const EXPORT_EXTRA = [{ key: 'department', header: 'Department' }];

export default function LeavePayrollExport() {
  const [startDate, setStartDate] = useState(monthStartCA());
  const [endDate, setEndDate] = useState(todayCA());
  const [payPeriod, setPayPeriod] = useState(null);

  // Picking a pay period drives the range from its dates; clearing it hands
  // the From/To chips back.
  const selectPayPeriod = (p) => {
    setPayPeriod(p);
    if (p) { setStartDate(p.startDate); setEndDate(p.endDate); }
  };
  const [reportType, setReportType] = useState('default');
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
      startDate, endDate, reportType, unit, employeeStatus, directReportsOnly: String(directReportsOnly),
      ...(employee ? { employeeId: employee._id } : {}),
    });
    appendDimensionFilters(params, dimFilters);
    api.get(`/reports/leave/payroll-export?${params}`)
      .then(r => setRows(Array.isArray(r.data.data) ? r.data.data : []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [reportType, unit, employeeStatus, employee, directReportsOnly, dimFilters]);

  const totalLabel = unitLabel(unit, 'Total'), payableLabel = unitLabel(unit, 'Payable'), onDutyLabel = unitLabel(unit, 'On Duty');
  const lopLabel = unitLabel(unit, 'Loss of Pay'), paidLabel = unitLabel(unit, 'Paid');

  const reset = () => {
    setPayPeriod(null);
    setStartDate(monthStartCA()); setEndDate(todayCA()); setReportType('default'); setEmployee(null);
    setEmployeeStatus('all'); setDirectReportsOnly(false); setDimFilters({});
  };

  // Export, Print and PDF belong beside the funnel, not inside the filter
  // panel — they are not filter actions and were unreachable until you opened
  // filters. Permissions is deliberately absent: this app has no per-report
  // access control, and a menu entry that does nothing is worse than none.
  const menuItems = [
    { key: 'export', label: 'Export', onClick: () => setExportOpen(true) },
    { key: 'pdf', label: 'Download as PDF', hint: 'Opens the print dialog — choose "Save as PDF"', onClick: () => window.print() },
    { key: 'print', label: 'Print', onClick: () => window.print() },
  ];

  const actions = (
    <div className="flex items-center gap-2">
      <UnitToggle value={unit} onChange={setUnit} />
      <FilterToggleButton open={filtersOpen} onClick={() => setFiltersOpen(o => !o)} />
    </div>
  );

  const filters = filtersOpen ? (
    <>
      <PayPeriodChip value={payPeriod} onChange={selectPayPeriod} />
      <PeriodPresetChip onSelect={({ start, end }) => { setPayPeriod(null); setStartDate(start); setEndDate(end); }} />
      <DateChip label="From Date" value={startDate} onChange={setStartDate} disabled={!!payPeriod} />
      <DateChip label="To Date" value={endDate} onChange={setEndDate} disabled={!!payPeriod} />
      <ReportTypeDropdown value={reportType} onChange={setReportType} />
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
    <ReportShell menuItems={menuItems} title="Leave Data for Payroll" subtitle="Total, loss of pay, and paid days per employee for the selected pay period" actions={actions} filters={filters} loading={loading} switcherCategory="Leave Tracker">
      {rows.length === 0 ? (
        <div className="text-center py-16 text-slate-400">No data for this period</div>
      ) : reportType === 'detailed' ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead className="bg-slate-50 text-[11px] font-bold text-slate-500 uppercase">
              <tr>
                <th rowSpan={2} className="text-left px-4 py-2.5 align-bottom">Employee</th>
                <th rowSpan={2} className="text-right px-4 py-2.5 align-bottom border-l border-slate-200">{totalLabel}</th>
                <th rowSpan={2} className="text-right px-4 py-2.5 align-bottom">Weekend</th>
                <th rowSpan={2} className="text-right px-4 py-2.5 align-bottom">Holidays</th>
                <th rowSpan={2} className="text-right px-4 py-2.5 align-bottom">{payableLabel}</th>
                <th rowSpan={2} className="text-right px-4 py-2.5 align-bottom">{onDutyLabel}</th>
                <th colSpan={4} className="text-center px-4 py-1.5 border-l border-slate-200">Leave</th>
                <th rowSpan={2} className="text-right px-4 py-2.5 align-bottom border-l border-slate-200">{lopLabel}</th>
                <th rowSpan={2} className="text-right px-4 py-2.5 align-bottom">{paidLabel}</th>
              </tr>
              <tr>
                <th className="text-right px-4 py-2 border-l border-slate-200">Paid</th>
                <th className="text-right px-4 py-2">Unpaid</th>
                <th className="text-right px-4 py-2">Comp</th>
                <th className="text-right px-4 py-2">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              <tr className="bg-slate-50/60 font-semibold text-slate-700">
                <td className="px-4 py-2.5">Total</td>
                <td className="px-4 py-2.5 text-right tabular-nums border-l border-slate-200">{sum(rows, 'totalDays')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'weekendCount')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'holidayCount')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'payableDays')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'onDutyDays')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums border-l border-slate-200">{sum(rows, 'leavePaid')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'leaveUnpaid')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'leaveComp')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'leaveTotal')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums border-l border-slate-200">{sum(rows, 'lopDays')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'paidDays')}</td>
              </tr>
              {rows.map(row => (
                <tr key={row._id}>
                  <td className="px-4 py-2.5"><EmployeeCell row={row} /></td>
                  <td className="px-4 py-2.5 text-right tabular-nums border-l border-slate-100">{row.totalDays}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.weekendCount}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.holidayCount}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.payableDays}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.onDutyDays}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums border-l border-slate-100">{row.leavePaid}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.leaveUnpaid}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.leaveComp}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{row.leaveTotal}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-amber-700 border-l border-slate-100">{row.lopDays}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-emerald-700">{row.paidDays}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead className="bg-slate-50 text-[12px] font-bold text-slate-500 uppercase">
              <tr>
                <th className="text-left px-4 py-2.5">Employee</th>
                <th className="text-right px-4 py-2.5">{totalLabel}</th>
                <th className="text-right px-4 py-2.5">{lopLabel}</th>
                <th className="text-right px-4 py-2.5">{paidLabel}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              <tr className="bg-slate-50/60 font-semibold text-slate-700">
                <td className="px-4 py-2.5">Total</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'totalDays')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'lopDays')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'paidDays')}</td>
              </tr>
              {rows.map(row => (
                <tr key={row._id}>
                  <td className="px-4 py-2.5"><EmployeeCell row={row} /></td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.totalDays}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-amber-700">{row.lopDays}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-emerald-700">{row.paidDays}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <LeaveExportModal open={exportOpen} onClose={() => setExportOpen(false)} rows={rows} baseColumns={exportColumns(reportType, unit)} extraColumns={EXPORT_EXTRA} fileStub={`leave-data-for-payroll_${startDate}_to_${endDate}`} />
    </ReportShell>
  );
}
