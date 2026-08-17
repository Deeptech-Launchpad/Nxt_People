import React, { useState, useEffect } from 'react';
import { Filter, RotateCcw, Settings } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../../utils/api';
import { appendDimensionFilters } from '../../utils/reportParams';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';
import LeaveExportModal from './LeaveExportModal';
import RegenerateDialog from './RegenerateDialog';
import EmployeeStatusFilter from './EmployeeStatusFilter';
import FilterRow from './FilterRow';
import EmployeeFilter from './EmployeeFilter';
import DirectReportsToggle from './DirectReportsToggle';
import UnitToggle from './UnitToggle';
import FilterToggleButton from './FilterToggleButton';
import PayPeriodChip from './PayPeriodChip';
import { EmployeeCell } from './TableReportPage';

const EXPORT_COLUMNS = [
  { key: 'leaveType', header: 'Leave Type', value: r => LEAVE_LABEL[r.leaveType] || r.leaveType },
  { key: 'allocated', header: 'Allocated' },
  { key: 'availed', header: 'Availed' },
  { key: 'balance', header: 'Balance' },
  { key: 'encashed', header: 'Encashed' },
  { key: 'encashable', header: 'Encashable' },
];
const LEAVE_LABEL = { casual: 'Casual Leave', comp_off: 'Comp-Off', unpaid: 'Leave Without Pay', permission: 'Permission' };

const fmtDay = d => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
const cycleLabel = c => `${fmtDay(c.start)} - ${fmtDay(c.end)}`;
// The pay period drives the cycle when one is picked; otherwise the calendar
// month does, which is what this org's single pay period amounts to anyway.
const monthCycle = offset => {
  const n = new Date();
  const s = new Date(n.getFullYear(), n.getMonth() + offset, 1);
  return { start: s.toLocaleDateString('en-CA'), end: new Date(s.getFullYear(), s.getMonth() + 1, 0).toLocaleDateString('en-CA') };
};

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
  const [regenOpen, setRegenOpen] = useState(false);
  const navigate = useNavigate();

  // Encashment is processed per pay period, so a period with the flag off has
  // nothing to report. Saying that beats an empty table, which reads as data
  // that failed to load. No pay period at all lands here too — that is the case
  // where the guidance matters most, and it used to fall through to a bare
  // "No encashment requests" that read as a broken page.
  const encashmentOff = !payPeriod || !payPeriod.processEncashment;

  const cycle = {
    current: payPeriod ? { start: payPeriod.startDate, end: payPeriod.endDate } : monthCycle(0),
    previous: monthCycle(-1),
  };

  // Encashment rows are read from source on every request, so re-running the
  // report is the regeneration. Each option changes what is asked for rather
  // than claiming work it did not do.
  const regenerate = scope => {
    setRegenOpen(false);
    if (scope === 'previous') {
      toast.success(`Rebuilt for ${cycleLabel(cycle.previous)}`);
      load();
      return;
    }
    setEmployeeStatus('exited');
    setFiltersOpen(true);
    toast.success(`Rebuilt for resigned users in ${cycleLabel(cycle.current)}`);
  };

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({
      employeeStatus, directReportsOnly: String(directReportsOnly), unit,
      ...(payPeriod ? { startDate: payPeriod.startDate, endDate: payPeriod.endDate } : {}),
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
  useEffect(load, [employeeStatus, employee, directReportsOnly, dimFilters, unit, payPeriod]);

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
      <button onClick={() => setRegenOpen(true)} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
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
        <div className="text-center py-16 text-slate-400">Nothing is encashable in this period</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[14px] border-collapse">
            <thead className="bg-slate-50 text-[13px] font-medium text-slate-600">
              <tr className="border-b border-slate-200">
                <th className="text-left px-4 py-2.5 border-r border-slate-200">Employee</th>
                <th className="text-left px-4 py-2.5 border-r border-slate-200">Leave Type</th>
                <th className="text-left px-4 py-2.5 border-r border-slate-200">Allocated</th>
                <th className="text-left px-4 py-2.5 border-r border-slate-200">Availed</th>
                <th className="text-left px-4 py-2.5 border-r border-slate-200">Balance</th>
                <th className="text-left px-4 py-2.5 border-r border-slate-200">Encashed</th>
                <th className="text-left px-4 py-2.5">Encashable</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row._id} className="border-b border-slate-200">
                  <td className="px-4 py-2.5 border-r border-slate-200"><EmployeeCell row={row} /></td>
                  <td className="px-4 py-2.5 border-r border-slate-200">{LEAVE_LABEL[row.leaveType] || row.leaveType}</td>
                  <td className="px-4 py-2.5 tabular-nums border-r border-slate-200">{row.allocated}</td>
                  <td className="px-4 py-2.5 tabular-nums border-r border-slate-200">{row.availed}</td>
                  <td className="px-4 py-2.5 tabular-nums border-r border-slate-200">{row.balance}</td>
                  <td className="px-4 py-2.5 tabular-nums border-r border-slate-200">{row.encashed}</td>
                  <td className="px-4 py-2.5 tabular-nums font-semibold text-emerald-700">{row.encashable}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <LeaveExportModal
        open={exportOpen} onClose={() => setExportOpen(false)} rows={rows}
        withIdentity identityVariant="leave" columns={EXPORT_COLUMNS}
        sheetName="Leave" fileStub="leave-encashment-details" />
    </ReportShell>
  );
}
