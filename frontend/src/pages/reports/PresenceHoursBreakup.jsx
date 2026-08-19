import React, { useState, useEffect } from 'react';
import { RotateCcw, X, MoreHorizontal, Filter, ChevronLeft, ChevronRight } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';
import FilterToggleButton from './FilterToggleButton';
import EmployeeFilter from './EmployeeFilter';
import PeriodFilter from './PeriodFilter';
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

// The two tabs show different things, not the same figures in another unit.
// Hour mode leads with Total Hours — what was actually clocked — and drops
// Absent, which has no hours behind it. Day mode has no Total row at all.
const SUMMARY_KEYS = {
  day: [
    ['payableDays', 'Payable Days'], ['present', 'Present'], ['onDuty', 'On Duty'], ['paidLeave', 'PaidLeave'],
    ['holiday', 'Holidays'], ['weekend', 'Weekend'], ['absent', 'Absent'], ['unpaidLeave', 'UnpaidLeave'],
  ],
  hour: [
    ['totalHours', 'Total Hours'], ['payableDays', 'Payable Hours'], ['present', 'Present Hours'],
    ['onDuty', 'On Duty'], ['paidLeave', 'PaidLeave'], ['holiday', 'Holidays'],
    ['weekend', 'Weekend'], ['unpaidLeave', 'UnpaidLeave'],
  ],
};
const STATUS_COLOR = {
  present: 'text-emerald-600', paidLeave: 'text-amber-600', holiday: 'text-sky-600',
  weekend: 'text-yellow-600', absent: 'text-red-600', unpaidLeave: 'text-rose-600', onDuty: 'text-violet-600',
};
// The Status cell is a coloured dot beside plain text, not coloured text —
// with a full holiday name in the cell, tinting the whole string turns the
// column into a block of colour.
const STATUS_DOT = {
  present: '#22c55e', paidLeave: '#f59e0b', holiday: '#38bdf8', weekend: '#eab308',
  absent: '#ef4444', unpaidLeave: '#e11d48', onDuty: '#8b5cf6',
};

const fmtDay = d => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
const addDays = (ymd, n) => { const d = new Date(ymd); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };

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
  { key: 'lateNightHours', header: 'Late-night Hours', value: r => (decimal ? (Number(r.lateNightHours) || 0).toFixed(2) : fmtHrs(r.lateNightHours)) },
  { key: 'status', header: 'Status' },
  { key: 'coreExpected', header: 'Expected', value: () => '-' },
  { key: 'coreWorked', header: 'Worked  ', value: () => '-' },
  { key: 'coreDeviation', header: 'Deviation', value: () => '-' },
  { key: 'shiftName', header: 'Shift(s)' },
  { key: 'shiftAllowance', header: 'Shift Allowance', value: () => '' },
  { key: 'totalShiftAllowance', header: 'Total Shift Allowance', value: () => '' },
  { key: 'timeZone', header: 'Time zone', value: () => '' },
];

// "Core Hours" takes the header row itself and straddles Expected / Worked /
// Deviation, whose own labels sit on a second row beneath it. Every other
// column keeps its header on the top row, merged down through both.
const PRESENCE_GROUPS = [
  // 25, not 24: Late-night Hours joins the block before Core Hours.
  { label: null, span: 25 },
  { label: 'Core Hours', span: 3 },
  { label: null, span: 4 },
];

// The strip's "..." opens the same figures stacked, which is the only way to
// read them all when the window is too narrow for eight side by side.
function SummaryPanel({ unit, setUnit, rows, valueOf, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-900/20" />
      <div onClick={e => e.stopPropagation()} className="relative bg-white w-full max-w-[340px] h-full shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h3 className="text-[15px] font-semibold text-slate-800">Attendance Report</h3>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>
        <div className="flex border-b border-slate-200">
          {[['day', 'Day(s)'], ['hour', 'Hour(s)']].map(([k, l]) => (
            <button
              key={k} onClick={() => setUnit(k)}
              className={`flex-1 py-2.5 text-[13.5px] transition-colors ${unit === k ? 'text-blue-600 font-semibold border-b-2 border-blue-600' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {rows.map(([key, label]) => (
            <div key={key} className="px-5 py-2.5 border-l-2 border-slate-300 ml-3 my-1">
              <p className="text-[12px] text-slate-500">{label}</p>
              <p className={`text-[14px] font-semibold tabular-nums ${STATUS_COLOR[key] || 'text-slate-700'}`}>{valueOf(key)}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

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
  const [summaryOpen, setSummaryOpen] = useState(false);

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
  const summaryRows = SUMMARY_KEYS[unit === 'hour' ? 'hour' : 'day'];
  // Hours read as HH:MM with an Hrs/Hr suffix; days as a plain count. The
  // singular matters — the reference writes "0 Day" and "00:00 Hr".
  const summaryValue = key => {
    const v = summary?.[key] ?? 0;
    if (unit !== 'hour') return `${v} ${Math.abs(v) === 1 ? 'Day' : 'Days'}`;
    return `${fmtHrs(v)} ${Math.abs(v) === 1 ? 'Hr' : 'Hrs'}`;
  };

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

  // Day/Hour lives in the summary strip at the foot, where the reference puts
  // it — it switches those figures, not the table, so a copy up in the header
  // only implied it changed the grid too.
  const actions = <FilterToggleButton open={filtersOpen} onClick={() => setFiltersOpen(o => !o)} />;

  const step = n => {
    const span = Math.round((new Date(dateRange.end) - new Date(dateRange.start)) / 86400000) + 1;
    const next = { start: addDays(dateRange.start, n * span), end: addDays(dateRange.end, n * span) };
    setDateRange(next);
    setPeriodKey(PERIOD_OPTIONS.find(o => o.value.start === next.start && o.value.end === next.end)?.key || 'custom');
  };

  const periodNav = (
    <div className="flex items-center gap-2">
      <button onClick={() => step(-1)} aria-label="Previous period" className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"><ChevronLeft size={16} /></button>
      <span className="text-[14px] text-slate-700 whitespace-nowrap tabular-nums">
        {dateRange.start === dateRange.end ? fmtDay(dateRange.start) : `${fmtDay(dateRange.start)} - ${fmtDay(dateRange.end)}`}
      </span>
      <button onClick={() => step(1)} aria-label="Next period" className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"><ChevronRight size={16} /></button>
    </div>
  );

  // Who the report is about belongs in the breadcrumb, as in the reference —
  // it is the subject of the page, not a way of narrowing it. It also has to
  // stay reachable while the filter panel is shut, which is how the page now
  // opens; buried in the panel there was no way to pick anyone at all.
  const breadcrumbChip = <EmployeeFilter value={employee} onChange={setEmployee} multiple={false} compact />;

  const filters = filtersOpen ? (
    <>
      <PeriodFilter options={PERIOD_OPTIONS} selectedKey={periodKey} onSubmit={(v, k) => { setPeriodKey(k); setDateRange(v); }} />
      <HoursComparatorFilter value={hours} onChange={setHours} />
      <div className="flex items-center gap-2 ml-auto">
        <button onClick={() => setHours(h => ({ ...h }))} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
          <Filter size={14} /> Submit
        </button>
        <button onClick={reset} className="flex items-center gap-2 border border-slate-200 text-slate-600 hover:bg-slate-50 px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
          <RotateCcw size={14} /> Reset
        </button>
      </div>
    </>
  ) : null;

  return (
    <ReportShell menuItems={menuItems} title="Presence Hours Break-up" periodNav={periodNav} breadcrumbChip={breadcrumbChip} subtitle="Day-by-day presence and payable hours for one employee" actions={actions} filters={filters} loading={loading} switcherCategory="Attendance">
      {!employee ? (
        <div className="text-center py-16 text-slate-400">Pick an employee above to view their presence break-up</div>
      ) : !data || data.data.length === 0 ? (
        <div className="text-center py-16 text-slate-400">No data for this period</div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead className="bg-slate-50 text-[13px] font-medium text-slate-600">
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
                    <td className="px-4 py-2.5">
                      {row.status ? (
                        <span className="flex items-center gap-2 text-slate-700">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: STATUS_DOT[row.statusKey] || '#94a3b8' }} />
                          <span className="truncate" title={row.status}>{row.status}</span>
                        </span>
                      ) : ''}
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">{row.shiftName || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {summary && (
            <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3 flex items-start gap-5">
              {/* The tabs live in the strip, not only in the header toggle —
                  the reference switches the summary independently of the
                  table, so you can read hours without changing the grid. */}
              <div className="flex-shrink-0 flex flex-col border-r border-slate-200 pr-4">
                {[['day', 'Day(s)'], ['hour', 'Hour(s)']].map(([k, l]) => (
                  <button
                    key={k} onClick={() => setUnit(k)}
                    className={`text-left text-[12.5px] px-2.5 py-1 rounded transition-colors ${unit === k ? 'bg-white font-semibold text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <div className="flex-1 min-w-0 flex flex-wrap gap-x-6 gap-y-2">
                {summaryRows.map(([key, label]) => (
                  <div key={key} className="border-l-2 border-slate-300 pl-2">
                    <p className="text-[11px] text-slate-500">{label}</p>
                    <p className={`text-[13px] font-bold tabular-nums ${STATUS_COLOR[key] || 'text-slate-700'}`}>
                      {summaryValue(key)}
                    </p>
                  </div>
                ))}
              </div>
              <button
                onClick={() => setSummaryOpen(true)}
                aria-label="Open the full attendance report"
                className="flex-shrink-0 text-slate-400 hover:text-slate-700 px-1"
              >
                <MoreHorizontal size={18} />
              </button>
            </div>
          )}
        </>
      )}
      {summaryOpen && (
        <SummaryPanel unit={unit} setUnit={setUnit} rows={summaryRows} valueOf={summaryValue} onClose={() => setSummaryOpen(false)} />
      )}
      <LeaveExportModal
        open={exportOpen} onClose={() => setExportOpen(false)} rows={data?.data || []}
        columns={presenceColumns(data?.employee, false)}
        hourColumns={presenceColumns(data?.employee, true)}
        stackedHeader={PRESENCE_GROUPS}
        sheetName="Presence hours"
        formats={['XLS', 'XLSX', 'CSV']}
        fileStub={`Presence hours break-up_${data?.employee?.employeeCode || ''}`}
      />
    </ReportShell>
  );
}
