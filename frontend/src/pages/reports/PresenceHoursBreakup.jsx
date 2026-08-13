import React, { useState, useEffect } from 'react';
import { RotateCcw } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';
import FilterToggleButton from './FilterToggleButton';
import EmployeeFilter from './EmployeeFilter';
import PeriodFilter from './PeriodFilter';
import UnitToggle from './UnitToggle';
import HoursComparatorFilter from './HoursComparatorFilter';
import LeaveExportModal from './LeaveExportModal';

const now = new Date();
const y = now.getFullYear(), m = now.getMonth();
const range = (s, e) => ({ start: s.toLocaleDateString('en-CA'), end: e.toLocaleDateString('en-CA') });
const startOfWeek = d => { const r = new Date(d); r.setDate(r.getDate() - r.getDay()); return r; };
const endOfWeek = d => { const r = startOfWeek(d); r.setDate(r.getDate() + 6); return r; };

const PERIOD_OPTIONS = [
  { key: 'today', label: 'Today', value: range(now, now) },
  { key: 'yesterday', label: 'Yesterday', value: range(new Date(y, m, now.getDate() - 1), new Date(y, m, now.getDate() - 1)) },
  { key: 'thisWeek', label: 'This Week', value: range(startOfWeek(now), endOfWeek(now)) },
  { key: 'lastWeek', label: 'Last Week', value: range(new Date(startOfWeek(now).getTime() - 7 * 86400000), new Date(startOfWeek(now).getTime() - 86400000)) },
  { key: 'thisMonth', label: 'This Month', value: range(new Date(y, m, 1), new Date(y, m + 1, 0)) },
  { key: 'lastMonth', label: 'Last Month', value: range(new Date(y, m - 1, 1), new Date(y, m, 0)) },
];

const SUMMARY_KEYS = [
  ['payableDays', 'Payable'], ['present', 'Present'], ['onDuty', 'On Duty'], ['paidLeave', 'PaidLeave'],
  ['holiday', 'Holidays'], ['weekend', 'Weekend'], ['absent', 'Absent'], ['unpaidLeave', 'UnpaidLeave'],
];
const STATUS_COLOR = {
  present: 'text-emerald-600', paidLeave: 'text-amber-600', holiday: 'text-sky-600',
  weekend: 'text-yellow-600', absent: 'text-red-600', unpaidLeave: 'text-rose-600', onDuty: 'text-violet-600',
};

const fmtTime = t => (t ? new Date(t).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '-');
const fmtHrs = h => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

// Unlike every other export, Date leads here — it sits before the identity
// block in the reference. Columns this system doesn't capture (punch source,
// notes, shift allowance, time zone) are emitted blank rather than dropped,
// so the sheet lines up with the reference column-for-column.
const presenceColumns = (emp, decimal) => [
  { key: 'date', header: 'Date' },
  { key: 'employeeCode', header: 'Employee Id', value: () => emp?.employeeCode || '' },
  { key: 'employeeName', header: 'Employee Name', value: () => `${emp?.firstName || ''} ${emp?.lastName || ''}`.trim() },
  { key: 'email', header: 'Email ID', value: () => emp?.email || '' },
  { key: 'reportingTo', header: 'Reporting To', value: () => emp?.reportingTo || '' },
  { key: 'department', header: 'Department', value: () => emp?.department || '' },
  { key: 'designation', header: 'Designation', value: () => emp?.designation || '' },
  { key: 'workLocation', header: 'Location', value: () => emp?.workLocation || '' },
  { key: 'role', header: 'Role', value: () => emp?.role || '' },
  { key: 'checkIn', header: 'Check-in', value: r => fmtTime(r.firstIn) },
  { key: 'checkInSource', header: 'Check-in Source', value: () => '' },
  { key: 'checkOut', header: 'Check-out', value: r => fmtTime(r.lastOut) },
  { key: 'checkOutSource', header: 'Check-out Source', value: () => '' },
  { key: 'checkInNotes', header: 'Check-in Notes', value: () => '' },
  { key: 'checkOutNotes', header: 'Check-out Notes', value: () => '' },
  { key: 'earlyEntry', header: 'Early Entry', value: () => '-' },
  { key: 'lateEntry', header: 'Late Entry', value: () => '-' },
  { key: 'earlyExit', header: 'Early Exit', value: () => '-' },
  { key: 'lateExit', header: 'Late Exit', value: () => '-' },
  { key: 'checkInLocation', header: 'Check-in Location', value: () => '' },
  { key: 'checkOutLocation', header: 'Check-out Location', value: () => '' },
  { key: 'totalHours', header: 'Total Hours', value: r => (decimal ? (Number(r.totalHours) || 0).toFixed(2) : fmtHrs(r.totalHours)) },
  { key: 'payableHours', header: 'Payable Hours', value: r => (decimal ? (Number(r.payableHours) || 0).toFixed(2) : fmtHrs(r.payableHours)) },
  { key: 'status', header: 'Status' },
  { key: 'coreExpected', header: 'Expected', value: () => '-' },
  { key: 'coreWorked', header: 'Worked  ', value: () => '-' },
  { key: 'coreDeviation', header: 'Deviation', value: () => '-' },
  { key: 'shiftName', header: 'Shift(s)' },
  { key: 'shiftAllowance', header: 'Shift Allowance', value: () => '' },
  { key: 'totalShiftAllowance', header: 'Total Shift Allowance', value: () => '' },
  { key: 'timeZone', header: 'Time zone', value: () => '' },
];

// "Core Hours" straddles Expected / Worked / Deviation (columns 25-27).
const PRESENCE_GROUPS = [
  { label: null, span: 24 },
  { label: 'Core Hours', span: 3 },
  { label: null, span: 4 },
];

// Single-employee day-by-day presence ledger with a Day/Hour summary strip —
// Zoho's Presence Hours Break-up is a drilldown, not an all-employees table.
export default function PresenceHoursBreakup() {
  const [employee, setEmployee] = useState(null);
  const [periodKey, setPeriodKey] = useState('thisWeek');
  const [dateRange, setDateRange] = useState(PERIOD_OPTIONS.find(o => o.key === 'thisWeek').value);
  const [unit, setUnit] = useState('day');
  const [hours, setHours] = useState({ mode: 'all', amount: '' });
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    if (!employee) { setData(null); return; }
    setLoading(true);
    const params = new URLSearchParams({
      employeeId: employee._id, startDate: dateRange.start, endDate: dateRange.end,
      ...(hours.mode !== 'all' && hours.amount ? { totalHours: hours.mode, totalHoursValue: hours.amount } : {}),
    });
    api.get(`/reports/attendance/hours-breakup?${params}`)
      .then(r => setData(r.data))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  }, [employee, dateRange, hours]);

  const reset = () => {
    setEmployee(null); setPeriodKey('thisWeek');
    setDateRange(PERIOD_OPTIONS.find(o => o.key === 'thisWeek').value);
    setHours({ mode: 'all', amount: '' });
  };

  const summary = unit === 'hour' ? data?.summaryHours : data?.summaryDays;
  const unitSuffix = unit === 'hour' ? 'Hrs' : 'Day(s)';

  // Export, Print and PDF belong beside the funnel, not inside the filter
  // panel — they are not filter actions and were unreachable until you opened
  // filters. Same menu the Leave Tracker reports use.
  const menuItems = [
    // This report is a per-employee drilldown, so there is nothing to export
    // until someone has been picked.
    { key: 'export', label: 'Export', onClick: () => (data ? setExportOpen(true) : toast.error('Pick an employee first')) },
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
      <EmployeeFilter value={employee} onChange={setEmployee} multiple={false} />
      <PeriodFilter options={PERIOD_OPTIONS} selectedKey={periodKey} onSubmit={(v, k) => { setPeriodKey(k); setDateRange(v); }} />
      {filtersOpen && <HoursComparatorFilter value={hours} onChange={setHours} />}
      <div className="flex items-center gap-2 ml-auto">
        <button onClick={reset} className="flex items-center gap-2 border border-slate-200 text-slate-600 hover:bg-slate-50 px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
          <RotateCcw size={14} /> Reset
        </button>
      </div>
    </>
  );

  return (
    <ReportShell menuItems={menuItems} title="Presence Hours Break-up" subtitle="Day-by-day presence and payable hours for one employee" actions={actions} filters={filters} loading={loading} switcherCategory="Attendance">
      {!employee ? (
        <div className="text-center py-16 text-slate-400">Search for an employee to view their presence break-up</div>
      ) : !data || data.data.length === 0 ? (
        <div className="text-center py-16 text-slate-400">No data for this period</div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead className="bg-slate-50 text-[12px] font-bold text-slate-500 uppercase">
                <tr>
                  <th className="text-left px-4 py-2.5">Date</th>
                  <th className="text-left px-4 py-2.5">First In</th>
                  <th className="text-left px-4 py-2.5">Last Out</th>
                  <th className="text-right px-4 py-2.5">Total Hours</th>
                  <th className="text-right px-4 py-2.5">Payable Hours</th>
                  <th className="text-left px-4 py-2.5">Status</th>
                  <th className="text-left px-4 py-2.5">Shift(s)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {data.data.map(row => (
                  <tr key={row.date}>
                    <td className="px-4 py-2.5 text-slate-700">
                      {new Date(row.date).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })}
                    </td>
                    <td className="px-4 py-2.5">{fmtTime(row.firstIn)}</td>
                    <td className="px-4 py-2.5">{fmtTime(row.lastOut)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{fmtHrs(row.totalHours)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{fmtHrs(row.payableHours)}</td>
                    <td className={`px-4 py-2.5 font-medium ${STATUS_COLOR[row.statusKey] || 'text-slate-600'}`}>{row.status || '—'}</td>
                    <td className="px-4 py-2.5 text-slate-500">{row.shiftName || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {summary && (
            <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3 flex flex-wrap gap-x-6 gap-y-2">
              {SUMMARY_KEYS.map(([key, label]) => (
                <div key={key} className="border-l-2 border-slate-300 pl-2">
                  <p className="text-[11px] text-slate-500">{label}</p>
                  <p className={`text-[13px] font-bold tabular-nums ${STATUS_COLOR[key] || 'text-slate-700'}`}>
                    {summary[key] ?? 0} {unitSuffix}
                  </p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      <LeaveExportModal
        open={exportOpen} onClose={() => setExportOpen(false)} rows={data?.data || []}
        columns={presenceColumns(data?.employee, false)}
        hourColumns={presenceColumns(data?.employee, true)}
        groups={PRESENCE_GROUPS}
        sheetName="Presence hours"
        formats={['XLS', 'XLSX', 'CSV']}
        fileStub={`Presence hours break-up_${data?.employee?.employeeCode || ''}`}
      />
    </ReportShell>
  );
}
