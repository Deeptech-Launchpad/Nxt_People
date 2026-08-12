import React, { useState, useEffect, useRef } from 'react';
import { Filter, Download, RotateCcw, ChevronDown } from 'lucide-react';
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

const PUNCH_OPTIONS = [
  ['', 'All'], ['before_shift', 'Before shift'], ['after_shift', 'After shift'], ['not_recorded', 'Not recorded'],
];

function PunchFilter({ label, value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const onClick = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);
  const current = PUNCH_OPTIONS.find(([k]) => k === value)?.[1] || 'All';
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)} className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12.5px] font-medium border transition-colors whitespace-nowrap ${value ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'}`}>
        {label}: {current} <ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-44 bg-white border border-slate-200 rounded-lg shadow-lg py-1">
          {PUNCH_OPTIONS.map(([k, l]) => (
            <button key={k || 'all'} onClick={() => { onChange(k); setOpen(false); }} className={`w-full text-left px-3 py-1.5 text-[12.5px] transition-colors ${value === k ? 'text-blue-600 font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}>{l}</button>
          ))}
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

const EXPORT_COLUMNS = [
  { key: 'firstName', header: 'First Name' }, { key: 'lastName', header: 'Last Name' }, { key: 'employeeCode', header: 'Employee ID' },
  { key: 'date', header: 'Date' },
  { key: 'firstIn', header: 'First In', value: r => fmtTime(r.firstIn) }, { key: 'lastOut', header: 'Last Out', value: r => fmtTime(r.lastOut) },
  { key: 'totalHours', header: 'Total Hours', value: r => fmtHrs(r.totalHours) },
  { key: 'entryEarly', header: 'Entry Early', value: r => fmtDelta(r.entryEarly, '+') },
  { key: 'entryLate', header: 'Entry Late', value: r => fmtDelta(r.entryLate, '-') },
  { key: 'exitEarly', header: 'Exit Early', value: r => fmtDelta(r.exitEarly, '-') },
  { key: 'exitLate', header: 'Exit Late', value: r => fmtDelta(r.exitLate, '+') },
  { key: 'netMinutes', header: 'Net Hours', value: r => fmtDelta(r.netMinutes, r.netMinutes >= 0 ? '+' : '-') },
  { key: 'shiftName', header: 'Shift' },
];
const EXPORT_EXTRA = [{ key: 'department', header: 'Department' }];

// Entry/Exit earliness and lateness measured against each employee's shift.
// Employees with no shift assigned fall back to a standard 8h day on the
// backend, so their deltas are relative to that rather than blank.
export default function EarlyLateCheckInOut() {
  const f = useReportFilters();
  const [periodKey, setPeriodKey] = useState('today');
  const [dateRange, setDateRange] = useState(PERIOD_OPTIONS[0].value);
  const [firstCheckIn, setFirstCheckIn] = useState('');
  const [lastCheckOut, setLastCheckOut] = useState('');
  const [hours, setHours] = useState({ mode: 'all', amount: '' });
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({
      startDate: dateRange.start, endDate: dateRange.end, ...f.params(),
      ...(firstCheckIn ? { firstCheckIn } : {}), ...(lastCheckOut ? { lastCheckOut } : {}),
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
    setFirstCheckIn(''); setLastCheckOut(''); setHours({ mode: 'all', amount: '' }); f.reset();
  };

  const actions = <FilterToggleButton open={filtersOpen} onClick={() => setFiltersOpen(o => !o)} />;

  const filters = (
    <>
      <PeriodFilter options={PERIOD_OPTIONS} selectedKey={periodKey} onSubmit={(v, k) => { setPeriodKey(k); setDateRange(v); }} />
      <PunchFilter label="First Check-In" value={firstCheckIn} onChange={setFirstCheckIn} />
      <PunchFilter label="Last Check-Out" value={lastCheckOut} onChange={setLastCheckOut} />
      <HoursComparatorFilter value={hours} onChange={setHours} />
      <div className="flex items-center gap-2 ml-auto">
        <button onClick={() => setExportOpen(true)} className="flex items-center gap-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
          <Download size={14} /> Export
        </button>
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
    <ReportShell title="Early/Late Check-in and Check-out" subtitle="Entry and exit deltas against each employee's shift" actions={actions} filters={filters} loading={loading} switcherCategory="Attendance">
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
      <LeaveExportModal open={exportOpen} onClose={() => setExportOpen(false)} rows={rows} baseColumns={EXPORT_COLUMNS} extraColumns={EXPORT_EXTRA} fileStub={`early-late_${dateRange.start}_to_${dateRange.end}`} />
    </ReportShell>
  );
}
