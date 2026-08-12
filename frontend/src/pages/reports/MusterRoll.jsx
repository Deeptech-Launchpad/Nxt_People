import React, { useState, useEffect } from 'react';
import { Download, RotateCcw } from 'lucide-react';
import api from '../../utils/api';
import { appendDimensionFilters } from '../../utils/reportParams';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';
import FilterToggleButton from './FilterToggleButton';
import StandardFilterRows from './StandardFilterRows';
import PeriodFilter from './PeriodFilter';
import LeaveExportModal from './LeaveExportModal';
import useReportFilters from '../../hooks/useReportFilters';
import { CODE_STYLE, LEGEND, codeStyle } from './attendanceCodes';

const now = new Date();
const y = now.getFullYear(), m = now.getMonth();
const range = (s, e) => ({ start: s.toLocaleDateString('en-CA'), end: e.toLocaleDateString('en-CA') });
const startOfWeek = d => { const r = new Date(d); r.setDate(r.getDate() - r.getDay()); return r; };

const PERIOD_OPTIONS = [
  { key: 'thisWeek', label: 'This Week', value: range(startOfWeek(now), new Date(startOfWeek(now).getTime() + 6 * 86400000)) },
  { key: 'lastMonth', label: 'Last Month', value: range(new Date(y, m - 1, 1), new Date(y, m, 0)) },
  { key: 'thisMonth', label: 'This Month', value: range(new Date(y, m, 1), new Date(y, m + 1, 0)) },
];

// The reference's Muster Roll is a Shift/Status pair per day under a merged
// day banner, then six roll-up columns. Codes are counted client-side because
// the grid the page already renders carries everything needed.
const dayHeader = d => {
  const dt = new Date(d);
  return `${dt.getDate()} - ${dt.toLocaleDateString('en-US', { month: 'short' })}`;
};
const isPaidOff = c => ['H', 'W'].includes(c) || ['CL', 'CO', 'PM'].includes(String(c).replace(/^[\d.]+/, '').split('/')[0]);

const musterColumns = (dayLabels) => {
  const cols = [];
  dayLabels.forEach((d, i) => {
    cols.push({ key: `shift_${i}`, header: 'Shift', value: r => r.days[i]?.shift || '' });
    cols.push({ key: `status_${i}`, header: 'Status', value: r => r.days[i]?.code || '' });
  });
  const count = (r, pred) => r.days.filter(x => x.code && x.code !== '-' && pred(x.code)).length;
  cols.push({ key: 'workedDays', header: 'Worked Days', value: r => count(r, c => c === 'P' || c === 'HD') });
  cols.push({ key: 'weekend', header: 'Weekend', value: r => count(r, c => c === 'W') });
  cols.push({ key: 'holidays', header: 'Holidays', value: r => count(r, c => c === 'H') });
  cols.push({ key: 'paidOff', header: 'Paid Off ', value: r => count(r, isPaidOff) });
  cols.push({ key: 'unpayable', header: 'Unpayable Days', value: r => count(r, c => c === 'A' || String(c).startsWith('LWP')) });
  cols.push({ key: 'payable', header: 'Payable Days', value: r => count(r, c => c === 'P' || c === 'HD' || isPaidOff(c)) });
  return cols;
};

// Each day's banner straddles its Shift+Status pair; the six roll-ups sit
// under a blank span, as does the identity block.
const musterGroups = (dayLabels, identityWidth) => [
  { label: null, span: identityWidth },
  ...dayLabels.map(d => ({ label: dayHeader(d), span: 2 })),
  { label: null, span: 6 },
];

const MUSTER_LEGEND = [[
  ['P', 'Present'], ['A', 'Absent'], ['H', 'Holidays'], ['W', 'Weekend'],
  ['CL', 'Casual Leave'], ['CO', 'Compensatory Off'], ['PM', 'Permission'], ['LWP', 'Leave Without Pay'],
]];

// Muster Roll pairs the rostered Shift with the resulting Status under each
// date — that pairing is what distinguishes it from Present/Absent Status,
// which shows status alone.
export default function MusterRoll() {
  const f = useReportFilters();
  const [periodKey, setPeriodKey] = useState('thisMonth');
  const [dateRange, setDateRange] = useState(PERIOD_OPTIONS.find(o => o.key === 'thisMonth').value);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({ startDate: dateRange.start, endDate: dateRange.end, ...f.params() });
    appendDimensionFilters(params, f.dimFilters);
    api.get(`/reports/attendance/muster-roll?${params}`)
      .then(r => setData(r.data))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [dateRange, ...f.deps]);

  const reset = () => {
    setPeriodKey('thisMonth');
    setDateRange(PERIOD_OPTIONS.find(o => o.key === 'thisMonth').value);
    f.reset();
  };

  const actions = <FilterToggleButton open={filtersOpen} onClick={() => setFiltersOpen(o => !o)} />;

  const filters = (
    <>
      <PeriodFilter options={PERIOD_OPTIONS} selectedKey={periodKey} onSubmit={(v, k) => { setPeriodKey(k); setDateRange(v); }} />
      <div className="flex items-center gap-2 ml-auto">
        <button onClick={() => setExportOpen(true)} className="flex items-center gap-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
          <Download size={14} /> Export
        </button>
        <button onClick={reset} className="flex items-center gap-2 border border-slate-200 text-slate-600 hover:bg-slate-50 px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
          <RotateCcw size={14} /> Reset
        </button>
      </div>
      {filtersOpen && <StandardFilterRows f={f} />}
      <div className="flex items-center gap-3 text-[12px] text-slate-500 flex-wrap w-full pt-1">
        {LEGEND.map(([code, label]) => (
          <span key={code} className="flex items-center gap-1">
            <span className={`px-1.5 py-0.5 rounded font-semibold ${CODE_STYLE[code]}`}>{code}</span>{label}
          </span>
        ))}
      </div>
    </>
  );

  return (
    <ReportShell title="Muster Roll" subtitle="Rostered shift and resulting status, day by day" actions={actions} filters={filters} loading={loading} switcherCategory="Attendance">
      {!data || data.data.length === 0 ? (
        <div className="text-center py-16 text-slate-400">No data for this period</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-[13px] border-collapse">
            <thead className="bg-slate-50 text-[11px] font-bold text-slate-500 uppercase">
              <tr>
                <th rowSpan={2} className="text-left px-3 py-2.5 sticky left-0 bg-slate-50 z-10 whitespace-nowrap align-bottom">Employee</th>
                {data.dayLabels.map(d => {
                  const dd = new Date(d);
                  return (
                    <th key={d} colSpan={2} className="px-1.5 py-1.5 text-center border-l border-slate-200 leading-tight">
                      <div>{dd.getDate()} {dd.toLocaleDateString('en-US', { month: 'short' })}</div>
                      <div className="text-slate-400 font-normal normal-case">{dd.toLocaleDateString('en-US', { weekday: 'short' })}</div>
                    </th>
                  );
                })}
              </tr>
              <tr>
                {data.dayLabels.map(d => (
                  <React.Fragment key={d}>
                    <th className="px-1.5 py-1.5 text-center font-medium text-slate-400 border-l border-slate-200">Shift</th>
                    <th className="px-1.5 py-1.5 text-center font-medium text-slate-400">Status</th>
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {data.data.map(emp => (
                <tr key={emp._id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 sticky left-0 bg-white whitespace-nowrap">
                    <p className="font-medium text-slate-700">
                      {emp.employeeCode && <span className="text-[11px] font-normal text-slate-400 mr-1">{emp.employeeCode}</span>}
                      {emp.firstName} {emp.lastName}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {emp.department || '—'}
                      {emp.exitDate && <span className="ml-1.5 text-red-500 font-medium">Exited {new Date(emp.exitDate).toLocaleDateString('en-IN')}</span>}
                    </p>
                  </td>
                  {emp.days.map((cell, i) => (
                    <React.Fragment key={i}>
                      <td className="px-1.5 py-2 text-center text-[10px] text-slate-500 border-l border-slate-100 max-w-[70px] truncate" title={cell.shift || ''}>
                        {cell.shift || '—'}
                      </td>
                      <td className="px-1 py-2 text-center">
                        {cell.code && cell.code !== '-'
                          ? <span className={`inline-block min-w-8 px-1 rounded text-[10px] font-semibold py-0.5 ${codeStyle(cell.code)}`}>{cell.code}</span>
                          : <span className="text-slate-300">-</span>}
                      </td>
                    </React.Fragment>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <LeaveExportModal
        open={exportOpen} onClose={() => setExportOpen(false)} rows={data?.data || []}
        withIdentity
        columns={musterColumns(data?.dayLabels || [])}
        groups={w => musterGroups(data?.dayLabels || [], w)}
        legend={MUSTER_LEGEND}
        sheetName="Muster roll"
        meta={[['Start Date', dateRange.start], ['End Date', dateRange.end]]}
        formats={['XLS', 'XLSX', 'CSV']}
        fileStub="Attendance_Musterroll_Report"
      />
    </ReportShell>
  );
}
