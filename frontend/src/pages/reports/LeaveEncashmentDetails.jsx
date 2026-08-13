import React, { useState, useEffect } from 'react';
import { Filter, RotateCcw, Settings } from 'lucide-react';
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
import FilterToggleButton from './FilterToggleButton';
import PayPeriodChip from './PayPeriodChip';
import { EmployeeCell } from './TableReportPage';

const EXPORT_COLUMNS = [
  { key: 'firstName', header: 'First Name' }, { key: 'lastName', header: 'Last Name' }, { key: 'employeeCode', header: 'Employee ID' },
  { key: 'leaveType', header: 'Leave Type' }, { key: 'days', header: 'Days' }, { key: 'status', header: 'Status' },
  { key: 'reason', header: 'Reason' }, { key: 'createdAt', header: 'Requested' },
];
const EXPORT_EXTRA = [{ key: 'department', header: 'Department' }];
const STATUS_STYLE = { approved: 'bg-emerald-100 text-emerald-700', rejected: 'bg-red-100 text-red-700', pending: 'bg-amber-100 text-amber-700' };
const LEAVE_LABEL = { casual: 'Casual Leave', comp_off: 'Comp-Off', unpaid: 'Leave Without Pay', permission: 'Permission' };

export default function LeaveEncashmentDetails() {
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
  const [payPeriod, setPayPeriod] = useState(null);
  const navigate = useNavigate();

  // Encashment is processed per pay period, so a period with the flag off has
  // nothing to report. Saying that beats an empty table, which reads as data
  // that failed to load. No pay period at all lands here too — that is the case
  // where the guidance matters most, and it used to fall through to a bare
  // "No encashment requests" that read as a broken page.
  const encashmentOff = !payPeriod || !payPeriod.processEncashment;

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({
      employeeStatus, directReportsOnly: String(directReportsOnly),
    });
    appendDimensionFilters(params, dimFilters);
    // Repeated employeeId params — Express parses them into the array the
    // backend's ANY() clause expects.
    employee.forEach(e => params.append('employeeId', e._id));
    api.get(`/reports/leave/encashment?${params}`)
      .then(r => {
        const data = Array.isArray(r.data.data) ? r.data.data : [];
        setRows(data.map(row => ({
          ...row,
          employee: `${row.firstName} ${row.lastName}`,
        })));
      })
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [employeeStatus, employee, directReportsOnly, dimFilters]);

  const reset = () => {
    setEmployee([]); setEmployeeStatus('all'); setDirectReportsOnly(false); setDimFilters({});
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
      <button onClick={load} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
        Regenerate Report
      </button>
      <FilterToggleButton open={filtersOpen} onClick={() => setFiltersOpen(o => !o)} />
    </div>
  );

  const filters = filtersOpen ? (
    <>
      <PayPeriodChip value={payPeriod} onChange={setPayPeriod} />
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
    <ReportShell menuItems={menuItems} title="Leave Encashment Details" subtitle="All leave encashment requests" actions={actions} filters={filters} loading={loading} switcherCategory="Leave Tracker">
      {encashmentOff ? (
        <div className="text-center py-16 px-6">
          <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
            <Settings size={24} className="text-slate-400" strokeWidth={1.6} />
          </div>
          <p className="text-[14px] text-slate-600 max-w-md mx-auto">
            Enable <span className="font-semibold">Process leave encashment</span>{' '}
            {payPeriod
              ? <>on the “{payPeriod.name}” pay period to view Leave encashment details.</>
              : <>in Pay Period settings to view Leave encashment details.</>}
          </p>
          <button
            onClick={() => navigate('/reports/configuration/pay-periods')}
            className="mt-4 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-[14px] font-medium transition-colors"
          >
            Configuration
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 text-slate-400">No encashment requests</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead className="bg-slate-50 text-[12px] font-bold text-slate-500 uppercase">
              <tr>
                <th className="text-left px-4 py-2.5">Employee</th>
                <th className="text-left px-4 py-2.5">Type</th>
                <th className="text-right px-4 py-2.5">Days</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-left px-4 py-2.5">Reason</th>
                <th className="text-left px-4 py-2.5">Requested</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map(row => (
                <tr key={row._id}>
                  <td className="px-4 py-2.5"><EmployeeCell row={row} /></td>
                  <td className="px-4 py-2.5 capitalize">{LEAVE_LABEL[row.leaveType] || row.leaveType}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{row.days}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-[12px] font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_STYLE[row.status] || STATUS_STYLE.pending}`}>{row.status}</span>
                  </td>
                  <td className="px-4 py-2.5 max-w-xs truncate text-slate-500" title={row.reason}>{row.reason || '—'}</td>
                  <td className="px-4 py-2.5 text-slate-600">{new Date(row.createdAt).toLocaleDateString('en-IN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <LeaveExportModal open={exportOpen} onClose={() => setExportOpen(false)} rows={rows} baseColumns={EXPORT_COLUMNS} extraColumns={EXPORT_EXTRA} fileStub="leave-encashment-details" />
    </ReportShell>
  );
}
