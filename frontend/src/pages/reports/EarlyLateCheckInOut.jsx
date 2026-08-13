import React, { useState, useEffect, useRef } from 'react';
import { Filter, RotateCcw, ChevronDown } from 'lucide-react';
import api from '../../utils/api';
import { appendDimensionFilters } from '../../utils/reportParams';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';
import FilterToggleButton from './FilterToggleButton';
import StandardFilterRows from './StandardFilterRows';
import HoursComparatorFilter from './HoursComparatorFilter';
import PeriodFilter from './PeriodFilter';
import LeaveExportModal from './LeaveExportModal';
import useReportFilters from '../../hooks/useReportFilters';
import { EmployeeCell } from './TableReportPage';

const now = new Date();
const y = now.getFullYear(), m = now.getMonth();
const range = (s, e) => ({ start: s.toLocaleDateString('en-CA'), end: e.toLocaleDateString('en-CA') });
const startOfWeek = d => { const r = new Date(d); r.setDate(r.getDate() - r.getDay()); return r; };

const PERIOD_OPTIONS = [
  { key: 'today', label: 'Today', value: range(now, now) },
  { key: 'yesterday', label: 'Yesterday', value: range(new Date(y, m, now.getDate() - 1), new Date(y, m, now.getDate() - 1)) },
  { key: 'thisWeek', label: 'This Week', value: range(startOfWeek(now), now) },
  { key: 'lastWeek', label: 'Last Week', value: range(new Date(startOfWeek(now).getTime() - 7 * 86400000), new Date(startOfWeek(now).getTime() - 86400000)) },
  { key: 'thisMonth', label: 'This Month', value: range(new Date(y, m, 1), new Date(y, m + 1, 0)) },
  { key: 'lastMonth', label: 'Last Month', value: range(new Date(y, m - 1, 1), new Date(y, m, 0)) },
];

// Two of these take a value: the "by" modes take minutes relative to the
// shift, and Before/After take a clock time. The rest take nothing, so the
// input only appears when the chosen mode actually uses one.
const PUNCH_OPTIONS = [
  ['', 'All', null],
  ['before_shift_by', 'Before shift by', 'mins'],
  ['after_shift_by', 'After shift by', 'mins'],
  ['before', 'Before', 'time'],
  ['after', 'After', 'time'],
  ['not_recorded', 'Not recorded', null],
];

// `value` is {mode, amount}. Older callers passed a bare mode string, so that
// shape is still read — a stale bundle mid-deploy keeps filtering rather than
// silently ignoring the chip.
function PunchFilter({ label, value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const onClick = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);
  const mode = typeof value === 'string' ? value : (value?.mode || '');
  const amount = typeof value === 'string' ? '' : (value?.amount ?? '');
  const opt = PUNCH_OPTIONS.find(([k]) => k === mode);
  const needs = opt?.[2] || null;
  const summary = !mode ? 'All' : `${opt?.[1] || mode}${amount ? ` ${amount}` : ''}`;

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)} className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12.5px] font-medium border transition-colors whitespace-nowrap ${mode ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'}`}>
        <span className="max-w-[190px] truncate">{label}: {summary}</span> <ChevronDown size={12} className="flex-shrink-0" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-52 bg-white border border-slate-200 rounded-lg shadow-lg py-1">
          {PUNCH_OPTIONS.map(([k, l, kind]) => (
            <button
              key={k || 'all'}
              onClick={() => { onChange({ mode: k, amount: '' }); if (!kind) setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-[12.5px] transition-colors ${mode === k ? 'text-blue-600 font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}
            >
              {l}
            </button>
          ))}
          {needs && (
            <div className="px-3 py-2 border-t border-slate-100 mt-1">
              <input
                type={needs === 'time' ? 'time' : 'number'}
                min={needs === 'mins' ? 0 : undefined}
                value={amount}
                autoFocus
                onChange={e => onChange({ mode, amount: e.target.value })}
                placeholder={needs === 'mins' ? 'minutes' : ''}
                className="w-full border border-slate-200 rounded px-2 py-1 text-[12.5px] focus:outline-none focus:border-blue-400"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const fmtTime = t => (t ? new Date(t).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '-');
const fmtHrs = h => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
// Signed HH:MM for a minute delta, matching Zoho's -01:05 / +00:04 display.
const fmtDelta = (min, sign) => {
  if (min === null || min === undefined) return '-';
  const h = Math.floor(Math.abs(min) / 60), mm = Math.abs(min) % 60;
  return `${sign}${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};

// Column order follows the reference export exactly. The (Hours) sheet
// renders durations as HH:MM and the (Decimal) sheet as fractional hours —
// same rows, same columns, two representations.
const hoursCols = (decimal) => [
  { key: 'firstIn', header: 'First In', value: r => fmtTime(r.firstIn) },
  { key: 'lastOut', header: 'Last Out', value: r => fmtTime(r.lastOut) },
  { key: 'totalHours', header: 'Total Hours', value: r => (decimal ? (Number(r.totalHours) || 0).toFixed(2) : fmtHrs(r.totalHours)) },
  { key: 'entryEarly', header: 'Early Entry', value: r => (decimal ? decMin(r.entryEarly) : fmtDelta(r.entryEarly, '')) },
  { key: 'entryLate', header: 'Late Entry', value: r => (decimal ? decMin(r.entryLate, true) : fmtDelta(r.entryLate, '-')) },
  { key: 'exitEarly', header: 'Early Exit', value: r => (decimal ? decMin(r.exitEarly, true) : fmtDelta(r.exitEarly, '-')) },
  { key: 'exitLate', header: 'Late Exit', value: r => (decimal ? decMin(r.exitLate) : fmtDelta(r.exitLate, '')) },
  { key: 'netMinutes', header: 'Net hours', value: r => (decimal ? decMin(r.netMinutes) : fmtDelta(r.netMinutes, r.netMinutes >= 0 ? '+' : '-')) },
  { key: 'shiftName', header: 'Shift name' },
];
const decMin = (min, negative = false) => {
  if (min === null || min === undefined) return '-';
  const v = (Math.abs(min) / 60).toFixed(2);
  return negative ? `-${v}` : v;
};

// Entry/Exit earliness and lateness measured against each employee's shift.
// Employees with no shift assigned fall back to a standard 8h day on the
// backend, so their deltas are relative to that rather than blank.
export default function EarlyLateCheckInOut() {
  const f = useReportFilters();
  const [periodKey, setPeriodKey] = useState('today');
  const [dateRange, setDateRange] = useState(PERIOD_OPTIONS[0].value);
  const [firstCheckIn, setFirstCheckIn] = useState({ mode: '', amount: '' });
  const [lastCheckOut, setLastCheckOut] = useState({ mode: '', amount: '' });
  const [hours, setHours] = useState({ mode: 'all', amount: '' });
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({
      startDate: dateRange.start, endDate: dateRange.end, ...f.params(),
      ...(firstCheckIn.mode ? { firstCheckIn: firstCheckIn.mode, firstCheckInValue: firstCheckIn.amount } : {}),
      ...(lastCheckOut.mode ? { lastCheckOut: lastCheckOut.mode, lastCheckOutValue: lastCheckOut.amount } : {}),
      ...(hours.mode !== 'all' && hours.amount ? { totalHours: hours.mode, totalHoursValue: hours.amount } : {}),
    });
    appendDimensionFilters(params, f.dimFilters);
    api.get(`/reports/attendance/early-late?${params}`)
      .then(r => setRows(Array.isArray(r.data.data) ? r.data.data : []))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [dateRange, firstCheckIn, lastCheckOut, hours, ...f.deps]);

  const reset = () => {
    setPeriodKey('today'); setDateRange(PERIOD_OPTIONS[0].value);
    setFirstCheckIn({ mode: '', amount: '' }); setLastCheckOut({ mode: '', amount: '' }); setHours({ mode: 'all', amount: '' }); f.reset();
  };

  // Export, Print and PDF belong beside the funnel, not inside the filter
  // panel — they are not filter actions and were unreachable until you opened
  // filters. Same menu the Leave Tracker reports use.
  const menuItems = [
    { key: 'export', label: 'Export', onClick: () => setExportOpen(true) },
    { key: 'print', label: 'Print', onClick: () => window.print() },
    { key: 'pdf', label: 'Download as PDF', hint: 'Opens the print dialog — choose "Save as PDF"', onClick: () => window.print() },
  ];

  const actions = <FilterToggleButton open={filtersOpen} onClick={() => setFiltersOpen(o => !o)} />;

  const filters = (
    <>
      <PeriodFilter options={PERIOD_OPTIONS} selectedKey={periodKey} onSubmit={(v, k) => { setPeriodKey(k); setDateRange(v); }} />
      <PunchFilter label="First Check-In" value={firstCheckIn} onChange={setFirstCheckIn} />
      <PunchFilter label="Last Check-Out" value={lastCheckOut} onChange={setLastCheckOut} />
      <HoursComparatorFilter value={hours} onChange={setHours} />
      <div className="flex items-center gap-2 ml-auto">
        <button onClick={load} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
          <Filter size={14} /> Apply
        </button>
        <button onClick={reset} className="flex items-center gap-2 border border-slate-200 text-slate-600 hover:bg-slate-50 px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
          <RotateCcw size={14} /> Reset
        </button>
      </div>
      {filtersOpen && <StandardFilterRows f={f} />}
    </>
  );

  return (
    <ReportShell menuItems={menuItems} title="Early/Late Check-in and Check-out" subtitle="Entry and exit deltas against each employee's shift" actions={actions} filters={filters} loading={loading} switcherCategory="Attendance">
      {rows.length === 0 ? (
        <div className="text-center py-16 text-slate-400">No records for this period</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead className="bg-slate-50 text-[11px] font-bold text-slate-500 uppercase">
              <tr>
                <th rowSpan={2} className="text-left px-4 py-2.5 align-bottom">Employee</th>
                <th rowSpan={2} className="text-left px-4 py-2.5 align-bottom">Date</th>
                <th rowSpan={2} className="text-left px-4 py-2.5 align-bottom">First In</th>
                <th rowSpan={2} className="text-left px-4 py-2.5 align-bottom">Last Out</th>
                <th rowSpan={2} className="text-right px-4 py-2.5 align-bottom">Total Hours</th>
                <th colSpan={2} className="text-center px-4 py-1.5 border-l border-slate-200">Entry</th>
                <th colSpan={2} className="text-center px-4 py-1.5 border-l border-slate-200">Exit</th>
                <th rowSpan={2} className="text-right px-4 py-2.5 align-bottom border-l border-slate-200">Net Hours</th>
                <th rowSpan={2} className="text-left px-4 py-2.5 align-bottom">Shift(s)</th>
              </tr>
              <tr>
                <th className="text-right px-4 py-2 border-l border-slate-200">Early</th>
                <th className="text-right px-4 py-2">Late</th>
                <th className="text-right px-4 py-2 border-l border-slate-200">Early</th>
                <th className="text-right px-4 py-2">Late</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map(row => (
                <tr key={row._id}>
                  <td className="px-4 py-2.5"><EmployeeCell row={row} /></td>
                  <td className="px-4 py-2.5 text-slate-600">{new Date(row.date).toLocaleDateString('en-IN')}</td>
                  <td className="px-4 py-2.5">{fmtTime(row.firstIn)}</td>
                  <td className="px-4 py-2.5">{fmtTime(row.lastOut)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmtHrs(row.totalHours)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-emerald-600 border-l border-slate-100">{fmtDelta(row.entryEarly, '+')}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-red-600">{fmtDelta(row.entryLate, '-')}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-red-600 border-l border-slate-100">{fmtDelta(row.exitEarly, '-')}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-emerald-600">{fmtDelta(row.exitLate, '+')}</td>
                  <td className={`px-4 py-2.5 text-right tabular-nums font-semibold border-l border-slate-100 ${row.netMinutes >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {fmtDelta(row.netMinutes, row.netMinutes >= 0 ? '+' : '-')}
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">{row.shiftName || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <LeaveExportModal
        open={exportOpen} onClose={() => setExportOpen(false)} rows={rows}
        withIdentity
        columns={hoursCols(false)}
        hourColumns={hoursCols(true)}
        sheetName="Early_Late Report"
        meta={[['Date', dateRange.start === dateRange.end ? dateRange.start : `${dateRange.start} - ${dateRange.end}`]]}
        formats={['XLS', 'XLSX', 'CSV']}
        fileStub={`Early_late check-in and check-out`}
      />
    </ReportShell>
  );
}
