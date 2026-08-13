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
import DateChip from './DateChip';
import PeriodPresetChip from './PeriodPresetChip';
import FilterToggleButton from './FilterToggleButton';
import { EmployeeCell } from './TableReportPage';

const LEAVE_LABEL = { casual: 'Casual Leave', comp_off: 'Comp-Off', unpaid: 'Leave Without Pay', permission: 'Permission' };
const sum = (rows, key) => rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);
const y = new Date().getFullYear();

const EXPORT_COLUMNS = [
  { key: 'firstName', header: 'First Name' }, { key: 'lastName', header: 'Last Name' }, { key: 'employeeCode', header: 'Employee ID' },
  { key: 'openingBalance', header: 'Opening Balance' }, { key: 'granted', header: 'Granted' }, { key: 'booked', header: 'Booked (Days)' },
  { key: 'bookedHours', header: 'Booked (Hours)' }, { key: 'closingBalance', header: 'Closing Balance' }, { key: 'lapsed', header: 'Lapsed' },
];
const EXPORT_EXTRA = [{ key: 'department', header: 'Department' }];

export default function LeaveTypeSummary() {
  const [available, setAvailable] = useState([]);
  const [selection, setSelection] = useState(null);
  const [startDate, setStartDate] = useState(new Date(y, 0, 1).toLocaleDateString('en-CA'));
  const [endDate, setEndDate] = useState(new Date(y, 11, 31).toLocaleDateString('en-CA'));
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [employeeStatus, setEmployeeStatus] = useState('all');
  const [employee, setEmployee] = useState(null);
  const [directReportsOnly, setDirectReportsOnly] = useState(false);
  const [dimFilters, setDimFilters] = useState({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [showExEmployees, setShowExEmployees] = useState(true);

  useEffect(() => {
    api.get('/reports/leave/types-available')
      .then(r => {
        const list = r.data.data || [];
        setAvailable(list);
        if (list.length) setSelection({ leaveType: list[0].leaveType, year: list[0].year });
        else setLoading(false);
      })
      .catch(err => { toast.error(err.response?.data?.message || 'Failed to load report'); setLoading(false); });
  }, []);

  useEffect(() => {
    if (!selection) return;
    setLoading(true);
    const params = new URLSearchParams({
      leaveType: selection.leaveType, year: selection.year, startDate, endDate, employeeStatus, directReportsOnly: String(directReportsOnly),
      ...(employee ? { employeeId: employee._id } : {}),
    });
    appendDimensionFilters(params, dimFilters);
    api.get(`/reports/leave/type-summary?${params}`)
      .then(r => setRows(Array.isArray(r.data.data) ? r.data.data : []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  }, [selection, startDate, endDate, employeeStatus, employee, directReportsOnly, dimFilters]);

  const reset = () => {
    setEmployee(null); setEmployeeStatus('all'); setDirectReportsOnly(false); setDimFilters({});
    setStartDate(new Date(y, 0, 1).toLocaleDateString('en-CA'));
    setEndDate(new Date(y, 11, 31).toLocaleDateString('en-CA'));
  };

  const leaveTypeLabel = selection
    ? `${LEAVE_LABEL[selection.leaveType] || selection.leaveType} ${selection.year !== y ? selection.year : ''}`
    : '';

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
      <span className="text-[14px] font-medium text-slate-600">Leave type: <span className="text-slate-800">{leaveTypeLabel || '—'}</span></span>
      <FilterToggleButton open={filtersOpen} onClick={() => setFiltersOpen(o => !o)} />
    </div>
  );

  const filters = filtersOpen ? (
    <>
      <PeriodPresetChip defaultKey="thisYear" onSelect={({ start, end }) => { setStartDate(start); setEndDate(end); }} />
      <DateChip label="From Date" value={startDate} onChange={setStartDate} />
      <DateChip label="To Date" value={endDate} onChange={setEndDate} />
      <EmployeeFilter value={employee} onChange={setEmployee} />
      <DirectReportsToggle value={directReportsOnly} onChange={setDirectReportsOnly} />
      <FilterRow value={dimFilters} onChange={(k, v) => setDimFilters(f => ({ ...f, [k]: v }))} />
      <div className="flex items-center gap-2 ml-auto">
        <button className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-[14px] font-medium transition-colors"
          onClick={() => { /* triggers via useEffect */ }}>
          <Filter size={14} /> Submit
        </button>
        <button onClick={reset} className="flex items-center gap-2 border border-slate-200 text-slate-600 hover:bg-slate-50 px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
          <RotateCcw size={14} /> Reset
        </button>
      </div>
      <div className="w-full flex flex-wrap items-center gap-2">
        <div>
          <select
            value={selection ? `${selection.leaveType}|${selection.year}` : ''}
            onChange={e => { const [leaveType, yr] = e.target.value.split('|'); setSelection({ leaveType, year: Number(yr) }); }}
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-[14px] focus:outline-none focus:border-blue-400 min-w-[200px]"
          >
            {available.map(a => (
              <option key={`${a.leaveType}|${a.year}`} value={`${a.leaveType}|${a.year}`}>{LEAVE_LABEL[a.leaveType] || a.leaveType} {a.year}</option>
            ))}
          </select>
        </div>
        <EmployeeStatusFilter value={employeeStatus} onChange={setEmployeeStatus} />
        <label className="flex items-center gap-1.5 px-1 py-1.5 text-[12.5px] text-slate-600 cursor-pointer select-none whitespace-nowrap">
          <input type="checkbox" checked={showExEmployees} onChange={e => setShowExEmployees(e.target.checked)} className="rounded border-slate-300 text-blue-600" />
          Show selective ex-employees
        </label>
      </div>
    </>
  ) : null;

  return (
    <ReportShell menuItems={menuItems} title="Leave Type Wise Summary" subtitle="Per-employee ledger for the selected leave type and year" actions={actions} filters={filters} loading={loading} switcherCategory="Leave Tracker">
      {!available.length ? (
        <div className="text-center py-16 text-slate-400">No leave records yet</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead className="bg-slate-50 text-[12px] font-bold text-slate-500 uppercase">
              <tr>
                <th className="text-left px-4 py-2.5">Employee</th>
                <th className="text-right px-4 py-2.5">Opening Balance</th>
                <th className="text-right px-4 py-2.5">Granted</th>
                <th className="text-right px-4 py-2.5">Booked</th>
                <th className="text-right px-4 py-2.5">Closing Balance</th>
                <th className="text-right px-4 py-2.5">Lapsed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              <tr className="bg-slate-50/60 font-semibold text-slate-700">
                <td className="px-4 py-2.5">Total</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'openingBalance')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'granted')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'booked')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'closingBalance')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{sum(rows, 'lapsed')}</td>
              </tr>
              {rows.map(row => (
                <tr key={row._id}>
                  <td className="px-4 py-2.5"><EmployeeCell row={row} /></td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.openingBalance}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.granted ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.booked}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-emerald-700">{row.closingBalance ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.lapsed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <LeaveExportModal open={exportOpen} onClose={() => setExportOpen(false)} rows={rows} baseColumns={EXPORT_COLUMNS} extraColumns={EXPORT_EXTRA} fileStub={`leave-type-summary_${selection?.leaveType}_${selection?.year}`} />
    </ReportShell>
  );
}
