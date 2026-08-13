import React, { useState, useEffect, useRef } from 'react';
import { Filter, RotateCcw, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
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
const fmtDate = d => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
const dayCount = r => Math.round((new Date(r.end) - new Date(r.start)) / 86400000) + 1;
const addDays = (ymd, n) => { const d = new Date(ymd); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };

// Zoho rules this table as a full grid, so every column reads as its own
// cell — with eight numeric columns and a two-level header, rows without
// vertical rules are very easy to read across by mistake.
const CELL = 'px-4 py-2.5 whitespace-nowrap border-r border-slate-200 last:border-r-0';
const HEAD = 'px-4 py-2.5 whitespace-nowrap border-r border-slate-200 last:border-r-0 font-medium';
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

// A delta cell. Green and red mean "ahead" and "behind", so a missing value
// must not be tinted — an employee with no shift to be measured against was
// rendering a green dash, which reads as good news rather than as no news.
function Delta({ value, sign, tone, bold = false }) {
  const has = value !== null && value !== undefined;
  return (
    <td className={`text-center tabular-nums ${has ? tone : 'text-slate-400'} ${bold && has ? 'font-semibold' : ''} ${CELL}`}>
      {fmtDelta(value, sign)}
    </td>
  );
}

// Entry/Exit earliness and lateness measured against each employee's shift.
// An employee with no shift assigned has nothing to be early or late against,
// so every delta on their row — Net hours included — reads "-".
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

  const multiDay = dateRange.start !== dateRange.end;

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

  // Step by the width of the window you are looking at: a day at a time on the
  // single-day default, a month at a time on a month. The chip re-labels itself
  // to whichever preset the new range matches, or "Custom" when it matches none,
  // so it can never claim "Today" while showing last Tuesday.
  const shiftPeriod = n => {
    const span = dayCount(dateRange);
    const next = { start: addDays(dateRange.start, n * span), end: addDays(dateRange.end, n * span) };
    setDateRange(next);
    setPeriodKey(PERIOD_OPTIONS.find(o => o.value.start === next.start && o.value.end === next.end)?.key || 'custom');
  };

  // The period is what the report is *of*, so it stays visible in the header
  // whether or not the filter panel is open.
  const periodNav = (
    <div className="flex items-center gap-2">
      <button onClick={() => shiftPeriod(-1)} aria-label="Previous period" className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"><ChevronLeft size={16} /></button>
      <span className="text-[14px] text-slate-700 whitespace-nowrap tabular-nums">
        {dateRange.start === dateRange.end ? fmtDate(dateRange.start) : `${fmtDate(dateRange.start)} - ${fmtDate(dateRange.end)}`}
      </span>
      <button onClick={() => shiftPeriod(1)} aria-label="Next period" className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"><ChevronRight size={16} /></button>
    </div>
  );

  // Nothing shows until the funnel is opened, as in the reference — a filter
  // bar that is always on screen reads as controls you must set before the
  // report means anything.
  const filters = filtersOpen ? (
    <>
      <PeriodFilter options={PERIOD_OPTIONS} selectedKey={periodKey} onSubmit={(v, k) => { setPeriodKey(k); setDateRange(v); }} />
      <PunchFilter label="First Check-In" value={firstCheckIn} onChange={setFirstCheckIn} />
      <PunchFilter label="Last Check-Out" value={lastCheckOut} onChange={setLastCheckOut} />
      <HoursComparatorFilter value={hours} onChange={setHours} />
      <div className="flex items-center gap-2 ml-auto">
        <button onClick={load} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
          <Filter size={14} /> Submit
        </button>
        <button onClick={reset} className="flex items-center gap-2 border border-slate-200 text-slate-600 hover:bg-slate-50 px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
          <RotateCcw size={14} /> Reset
        </button>
      </div>
      <StandardFilterRows f={f} />
    </>
  ) : null;

  return (
    <ReportShell menuItems={menuItems} title="Early/Late Check-in and Check-out" periodNav={periodNav} subtitle="Entry and exit deltas against each employee's shift" actions={actions} filters={filters} loading={loading} switcherCategory="Attendance">
      {rows.length === 0 ? (
        <div className="text-center py-16 text-slate-400">No records for this period</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[14px] border-collapse">
            <thead className="bg-slate-50 text-[13px] text-slate-600">
              <tr className="border-b border-slate-200">
                <th rowSpan={2} className={`text-left align-bottom ${HEAD}`}>Employee</th>
                {/* The date only earns a column when the period is more than one
                    day — on the single-day default the header already says it. */}
                {multiDay && <th rowSpan={2} className={`text-left align-bottom ${HEAD}`}>Date</th>}
                <th rowSpan={2} className={`text-left align-bottom ${HEAD}`}>First In</th>
                <th rowSpan={2} className={`text-left align-bottom ${HEAD}`}>Last Out</th>
                <th rowSpan={2} className={`text-center align-bottom ${HEAD}`}>Total Hours</th>
                <th colSpan={2} className={`text-center ${HEAD} border-b border-slate-200`}>Entry</th>
                <th colSpan={2} className={`text-center ${HEAD} border-b border-slate-200`}>Exit</th>
                <th rowSpan={2} className={`text-center align-bottom ${HEAD}`}>Net hours</th>
                <th rowSpan={2} className={`text-left align-bottom ${HEAD}`}>Shift(s)</th>
              </tr>
              <tr className="border-b border-slate-200">
                <th className={`text-center ${HEAD}`}>Early</th>
                <th className={`text-center ${HEAD}`}>Late</th>
                <th className={`text-center ${HEAD}`}>Early</th>
                <th className={`text-center ${HEAD}`}>Late</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row._id} className="border-b border-slate-200">
                  <td className={CELL}><EmployeeCell row={row} /></td>
                  {multiDay && <td className={`text-slate-600 tabular-nums ${CELL}`}>{fmtDate(row.date)}</td>}
                  <td className={CELL}>{fmtTime(row.firstIn)}</td>
                  <td className={CELL}>{fmtTime(row.lastOut)}</td>
                  <td className={`text-center tabular-nums ${CELL}`}>{fmtHrs(row.totalHours)}</td>
                  <Delta value={row.entryEarly} sign="+" tone="text-emerald-600" />
                  <Delta value={row.entryLate} sign="-" tone="text-red-600" />
                  <Delta value={row.exitEarly} sign="-" tone="text-red-600" />
                  <Delta value={row.exitLate} sign="+" tone="text-emerald-600" />
                  <Delta value={row.netMinutes} sign={row.netMinutes >= 0 ? '+' : '-'} tone={row.netMinutes >= 0 ? 'text-emerald-600' : 'text-red-600'} bold />
                  <td className={`text-slate-500 ${CELL}`}>{row.shiftName || '—'}</td>
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
