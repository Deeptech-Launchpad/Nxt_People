import React, { useState, useEffect } from 'react';
import { Download, RotateCcw } from 'lucide-react';
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

const EXPORT_COLUMNS = [
  { key: 'date', header: 'Date' },
  { key: 'firstIn', header: 'First In', value: r => fmtTime(r.firstIn) },
  { key: 'lastOut', header: 'Last Out', value: r => fmtTime(r.lastOut) },
  { key: 'totalHours', header: 'Total Hours', value: r => fmtHrs(r.totalHours) },
  { key: 'payableHours', header: 'Payable Hours', value: r => fmtHrs(r.payableHours) },
  { key: 'status', header: 'Status' }, { key: 'shiftName', header: 'Shift' },
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

  const actions = (
    <div className="flex items-center gap-2">
      <UnitToggle value={unit} onChange={setUnit} />
      <FilterToggleButton open={filtersOpen} onClick={() => setFiltersOpen(o => !o)} />
    </div>
  );

  const filters = (
    <>
      <EmployeeFilter value={employee} onChange={setEmployee} />
      <PeriodFilter options={PERIOD_OPTIONS} selectedKey={periodKey} onSubmit={(v, k) => { setPeriodKey(k); setDateRange(v); }} />
      {filtersOpen && <HoursComparatorFilter value={hours} onChange={setHours} />}
      <div className="flex items-center gap-2 ml-auto">
        <button onClick={() => setExportOpen(true)} disabled={!data} className="flex items-center gap-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 px-4 py-2 rounded-lg text-[14px] font-medium transition-colors disabled:opacity-50">
          <Download size={14} /> Export
        </button>
        <button onClick={reset} className="flex items-center gap-2 border border-slate-200 text-slate-600 hover:bg-slate-50 px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
          <RotateCcw size={14} /> Reset
        </button>
      </div>
    </>
  );

  return (
    <ReportShell title="Presence Hours Break-up" subtitle="Day-by-day presence and payable hours for one employee" actions={actions} filters={filters} loading={loading} switcherCategory="Attendance">
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
      <LeaveExportModal open={exportOpen} onClose={() => setExportOpen(false)} rows={data?.data || []} baseColumns={EXPORT_COLUMNS} fileStub={`presence-hours_${employee?.employeeId}_${dateRange.start}`} />
    </ReportShell>
  );
}
