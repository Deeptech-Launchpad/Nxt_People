import React, { useState, useEffect } from 'react';
import { Filter, ArrowRight, RotateCcw, ChevronLeft, ChevronRight } from 'lucide-react';
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
import DateChip from './DateChip';
import PeriodPresetChip from './PeriodPresetChip';
import PayPeriodChip from './PayPeriodChip';
import FilterToggleButton from './FilterToggleButton';
import { EmployeeCell } from './TableReportPage';

const todayCA = () => new Date().toLocaleDateString('en-CA');
const monthStartCA = () => new Date(new Date().setDate(1)).toLocaleDateString('en-CA');

const EXPORT_COLUMNS = [
  // The reference's order and wording: Taken rather than Booked, Adjustment
  // rather than Waived Off, and Carry Over carries its trailing space.
  { key: 'previousPeriodBalance', header: 'Previous Pay Period Balance' },
  { key: 'booked', header: 'Taken' },
  { key: 'total', header: 'Total' },
  { key: 'waivedOff', header: 'Adjustment' },
  { key: 'lopDays', header: 'Loss of pay' },
  { key: 'reason', header: 'Reason' },
  { key: 'carryOver', header: 'Carry Over ' },
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
  const [employee, setEmployee] = useState([]);
  const [directReportsOnly, setDirectReportsOnly] = useState(false);
  const [dimFilters, setDimFilters] = useState({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [showExEmployees, setShowExEmployees] = useState(true);
  const [payPeriod, setPayPeriod] = useState(null);
  const [regenOpen, setRegenOpen] = useState(false);

  // This report is computed from source on every request rather than read from
  // a stored copy, so re-running it IS the regeneration — there is no cache to
  // invalidate. What each option must do, then, is change what is being asked
  // for. Both branches now do that. An earlier version reported success for
  // work it had not done: "previous cycle" only moved the dates without
  // reloading, and "resigned users" re-fetched the same unfiltered rows.
  const regenerate = scope => {
    setRegenOpen(false);
    if (scope === 'previous') {
      setPayPeriod(null);
      setStartDate(prevCycle.start);
      setEndDate(prevCycle.end);
      toast.success(`Rebuilt for ${fmtRange(prevCycle.start, prevCycle.end)}`);
      return;
    }
    // "Resigned users" is the exited employee-status filter, which the report
    // already supports — the chip updates too, so the narrowing is visible and
    // clearable rather than silently applied.
    setEmployeeStatus('exited');
    setFiltersOpen(true);
    toast.success(`Rebuilt for resigned users in ${fmtRange(startDate, endDate)}`);
  };

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
    });
    appendDimensionFilters(params, dimFilters);
    // Repeated employeeId params — Express parses them into the array the
    // backend's ANY() clause expects.
    employee.forEach(e => params.append('employeeId', e._id));
    api.get(`/reports/leave/lop?${params}`)
      .then(r => setRows(Array.isArray(r.data.data) ? r.data.data : []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  // startDate/endDate belong here: the header arrows change the range without
  // going through Submit, so leaving them out left the table showing the old
  // month's figures under the new month's heading.
  useEffect(load, [startDate, endDate, employeeStatus, employee, directReportsOnly, dimFilters]);

  const reset = () => {
    setPayPeriod(null);
    setStartDate(monthStartCA()); setEndDate(todayCA()); setEmployee([]);
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

  // The range the report covers belongs in the header, not only inside the
  // filter panel — without it the page gives no indication of what period the
  // figures are for until you open filters. The arrows step whole months,
  // which is how this report is read.
  const shiftMonth = delta => {
    setPayPeriod(null);
    const d = new Date(startDate);
    d.setMonth(d.getMonth() + delta);
    setStartDate(new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString('en-CA'));
    setEndDate(new Date(d.getFullYear(), d.getMonth() + 1, 0).toLocaleDateString('en-CA'));
  };
  const fmtRange = (s, e) =>
    `${new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })} - ${new Date(e).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;

  // The month before the one on screen, named so the dialog can say which
  // dates "previous cycle" actually means.
  const prevCycle = (() => {
    const d = new Date(startDate);
    d.setMonth(d.getMonth() - 1);
    return {
      start: new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString('en-CA'),
      end: new Date(d.getFullYear(), d.getMonth() + 1, 0).toLocaleDateString('en-CA'),
    };
  })();

  const periodNav = (
    <div className="flex items-center gap-2">
      <button onClick={() => shiftMonth(-1)} aria-label="Previous month" className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"><ChevronLeft size={16} /></button>
      <span className="text-[14px] text-slate-700 whitespace-nowrap">{fmtRange(startDate, endDate)}</span>
      <button onClick={() => shiftMonth(1)} aria-label="Next month" className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"><ChevronRight size={16} /></button>
    </div>
  );

  const actions = (
    <div className="flex items-center gap-2">
      <UnitToggle value={unit} onChange={setUnit} />
      {/* This used to navigate to Payroll Run, which left the report entirely
          and started a payroll action nobody asked for. It now does what it
          says: asks which cycle to rebuild, then recomputes this report. */}
      <button onClick={() => setRegenOpen(true)} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
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
    <ReportShell menuItems={menuItems} title="Loss of Pay Details" periodNav={periodNav} subtitle="Unpaid LOP days in the selected period — the same calculation Payroll Run uses" actions={actions} filters={filters} loading={loading} switcherCategory="Leave Tracker">
      {rows.length === 0 ? (
        <div className="text-center py-16 text-slate-400">No employees match these filters</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead className="bg-slate-50 text-[13px] font-medium text-slate-600">
              <tr>
                <th className="text-left px-4 py-2.5">Employee</th>
                <th className="text-right px-4 py-2.5">Previous Pay Period Balance</th>
                <th className="text-right px-4 py-2.5 leading-tight"><div>Booked</div><div className="font-normal text-slate-400">Absent + Unpaid</div></th>
                <th className="text-right px-4 py-2.5 leading-tight"><div>Total</div><div className="font-normal text-slate-400">Previous + Taken</div></th>
                <th className="text-right px-4 py-2.5">Waived Off</th>
                <th className="text-right px-4 py-2.5">Carry Over</th>
                <th className="text-left px-4 py-2.5">Reason</th>
                <th className="text-right px-4 py-2.5">LOP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map(row => (
                <tr key={row._id}>
                  <td className="px-4 py-2.5"><EmployeeCell row={row} /></td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.previousPeriodBalance}</td>
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
      {regenOpen && (
        <RegenerateDialog
          subject="Loss of pay details and leave data for payroll"
          current={fmtRange(startDate, endDate)}
          previous={fmtRange(prevCycle.start, prevCycle.end)}
          onConfirm={regenerate}
          onClose={() => setRegenOpen(false)}
        />
      )}
      <LeaveExportModal
        open={exportOpen} onClose={() => setExportOpen(false)} rows={rows}
        withIdentity identityVariant="leave" columns={EXPORT_COLUMNS}
        sheetName="Leave"
        fileStub={`lop-details_${startDate}_to_${endDate}`}
      />
    </ReportShell>
  );
}
