import React, { useState, useEffect } from 'react';
import { Filter, ArrowRight, RotateCcw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
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

const EXPORT_COLUMNS = [
  { key: 'firstName', header: 'First Name' }, { key: 'lastName', header: 'Last Name' }, { key: 'employeeCode', header: 'Employee ID' },
  { key: 'previousPeriodBalance', header: 'Previous Period Balance' }, { key: 'booked', header: 'Booked' }, { key: 'total', header: 'Total' },
  { key: 'waivedOff', header: 'Waived Off' }, { key: 'carryOver', header: 'Carry Over' }, { key: 'reason', header: 'Reason' }, { key: 'lopDays', header: 'LOP' },
];
const EXPORT_EXTRA = [{ key: 'department', header: 'Department' }];

export default function LossOfPay() {
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
  const [payPeriod, setPayPeriod] = useState(null);
  const navigate = useNavigate();

  // Picking a pay period drives the range from its dates; the From/To chips
  // grey out to show they aren't the active control, the same way the period
  // presets do. Clearing it hands the dates back.
  const selectPayPeriod = (p) => {
    setPayPeriod(p);
    if (p) { setStartDate(p.startDate); setEndDate(p.endDate); }
  };

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({
      startDate, endDate, employeeStatus, directReportsOnly: String(directReportsOnly),
      ...(employee ? { employeeId: employee._id } : {}),
    });
    appendDimensionFilters(params, dimFilters);
    api.get(`/reports/leave/lop?${params}`)
      .then(r => setRows(Array.isArray(r.data.data) ? r.data.data : []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [employeeStatus, employee, directReportsOnly, dimFilters]);

  const reset = () => {
    setPayPeriod(null);
    setStartDate(monthStartCA()); setEndDate(todayCA()); setEmployee(null);
    setEmployeeStatus('all'); setDirectReportsOnly(false); setDimFilters({});
  };

  // Export, Print and PDF belong beside the funnel, not inside the filter
  // panel — they are not filter actions and were unreachable until you opened
  // filters. Import and Push To Payroll are deliberately absent: neither
  // exists in this app, and a menu entry that does nothing is worse than none.
  const menuItems = [
    { key: 'export', label: 'Export', onClick: () => setExportOpen(true) },
    { key: 'pdf', label: 'Download as PDF', hint: 'Opens the print dialog — choose "Save as PDF"', onClick: () => window.print() },
    { key: 'print', label: 'Print', onClick: () => window.print() },
  ];

  const actions = (
    <div className="flex items-center gap-2">
      <UnitToggle value={unit} onChange={setUnit} />
      <button onClick={() => navigate('/payroll/run')} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
        Regenerate Report
      </button>
      <FilterToggleButton open={filtersOpen} onClick={() => setFiltersOpen(o => !o)} />
    </div>
  );

  const filters = filtersOpen ? (
    <>
      <PayPeriodChip value={payPeriod} onChange={selectPayPeriod} />
      <PeriodPresetChip onSelect={({ start, end }) => { setPayPeriod(null); setStartDate(start); setEndDate(end); }} />
      <DateChip label="From Date" value={startDate} onChange={setStartDate} disabled={!!payPeriod} />
      <DateChip label="To Date" value={endDate} onChange={setEndDate} disabled={!!payPeriod} />
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
    <ReportShell menuItems={menuItems} title="Loss of Pay Details" subtitle="Unpaid LOP days in the selected period — the same calculation Payroll Run uses" actions={actions} filters={filters} loading={loading} switcherCategory="Leave Tracker">
      {rows.length === 0 ? (
        <div className="text-center py-16 text-slate-400">No LOP days in this period</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead className="bg-slate-50 text-[12px] font-bold text-slate-500 uppercase">
              <tr>
                <th className="text-left px-4 py-2.5">Employee</th>
                <th className="text-right px-4 py-2.5">Booked Absent + Unpaid</th>
                <th className="text-right px-4 py-2.5">Total Previous + Taken</th>
                <th className="text-right px-4 py-2.5">Waived Off</th>
                <th className="text-right px-4 py-2.5">Carry Over</th>
                <th className="text-left px-4 py-2.5">Reason</th>
                <th className="text-right px-4 py-2.5">LOP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              <tr className="bg-slate-50/60 font-semibold text-slate-700">
                <td className="px-4 py-2.5">Total</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'booked')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'total')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'waivedOff')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'carryOver')}</td>
                <td className="px-4 py-2.5"></td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'lopDays')}</td>
              </tr>
              {rows.map(row => (
                <tr key={row._id}>
                  <td className="px-4 py-2.5"><EmployeeCell row={row} /></td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.booked}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.total}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.waivedOff}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.carryOver}</td>
                  <td className="px-4 py-2.5 max-w-xs truncate text-slate-500" title={row.reason}>{row.reason || '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-amber-700">{row.lopDays}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <LeaveExportModal open={exportOpen} onClose={() => setExportOpen(false)} rows={rows} baseColumns={EXPORT_COLUMNS} extraColumns={EXPORT_EXTRA} fileStub={`lop-details_${startDate}_to_${endDate}`} />
    </ReportShell>
  );
}
