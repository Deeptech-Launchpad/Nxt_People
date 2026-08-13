import React, { useState, useEffect } from 'react';
import { RotateCcw, X } from 'lucide-react';
import api from '../../utils/api';
import { appendDimensionFilters } from '../../utils/reportParams';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';
import FilterToggleButton from './FilterToggleButton';
import StandardFilterRows from './StandardFilterRows';
import PeriodFilter from './PeriodFilter';
import LeaveExportModal from './LeaveExportModal';
import useReportFilters from '../../hooks/useReportFilters';
import { CODE_STYLE, LEGEND, codeStyle, weekendColumns, WEEKEND_HATCH } from './attendanceCodes';

const now = new Date();
const y = now.getFullYear(), m = now.getMonth();
const range = (s, e) => ({ start: s.toLocaleDateString('en-CA'), end: e.toLocaleDateString('en-CA') });
const startOfWeek = d => { const r = new Date(d); r.setDate(r.getDate() - r.getDay()); return r; };

const PERIOD_OPTIONS = [
  { key: 'thisWeek', label: 'This Week', value: range(startOfWeek(now), new Date(startOfWeek(now).getTime() + 6 * 86400000)) },
  { key: 'lastMonth', label: 'Last Month', value: range(new Date(y, m - 1, 1), new Date(y, m, 0)) },
  { key: 'thisMonth', label: 'This Month', value: range(new Date(y, m, 1), new Date(y, m + 1, 0)) },
];

// One column per day, headed "1 - Aug". Note this differs from Resource
// Availability's "01 Aug (Sat)" — the reference uses two different date
// header conventions and they aren't interchangeable.
const dayColumns = dayLabels => dayLabels.map((d, i) => {
  const dt = new Date(d);
  return {
    key: `d${i}`,
    header: `${dt.getDate()} - ${dt.toLocaleDateString('en-US', { month: 'short' })}`,
    value: r => (r.days[i] && r.days[i] !== '-' ? r.days[i] : ''),
  };
});

const GRID_LEGEND = [[
  ['P', 'Present'], ['A', 'Absent'], ['H', 'Holidays'], ['W', 'Weekend'],
  ['CL', 'Casual Leave'], ['CO', 'Compensatory Off'], ['PM', 'Permission'], ['LWP', 'Leave Without Pay'],
]];

// The full code list, as a slide-over. The footer legend only has room for the
// common codes, so the reference puts the complete set behind a "Status" chip
// rather than wrapping the legend over three lines.
//
// Colours come from the same CODE_STYLE map the cells use, so a bar here can
// never disagree with the pill it explains.
const BAR_COLOR = {
  P: '#059669', HD: '#0d9488', A: '#dc2626', W: '#d97706', H: '#0284c7',
  CL: '#2563eb', CO: '#9333ea', LWP: '#e11d48', PM: '#0891b2', L: '#7c3aed',
};

function StatusPanel({ onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-900/20" />
      <div onClick={e => e.stopPropagation()} className="relative bg-white w-full max-w-[320px] h-full shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h3 className="text-[15px] font-semibold text-slate-800">Status</h3>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {LEGEND.map(([code, label]) => (
            <div key={code} className="flex items-center gap-3 px-5 py-2.5">
              <span className="w-1 h-5 rounded-sm flex-shrink-0" style={{ background: BAR_COLOR[code] || '#94a3b8' }} />
              <span className="text-[13.5px] text-slate-700">
                <span className="font-medium">{code}</span> - {label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Employee × date grid of attendance codes — the report Zoho calls Employee
// Present/Absent Status. Our previous "summary" tab was an aggregate table,
// which is a different report entirely.
export default function PresentAbsentStatus() {
  const f = useReportFilters();
  const [periodKey, setPeriodKey] = useState('thisMonth');
  const [dateRange, setDateRange] = useState(PERIOD_OPTIONS.find(o => o.key === 'thisMonth').value);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({ startDate: dateRange.start, endDate: dateRange.end, ...f.params() });
    appendDimensionFilters(params, f.dimFilters);
    api.get(`/reports/attendance/present-absent?${params}`)
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

  // Export, Print and PDF belong beside the funnel, not inside the filter
  // panel — they are not filter actions and were unreachable until you opened
  // filters. Same menu the Leave Tracker reports use.
  const menuItems = [
    { key: 'export', label: 'Export', onClick: () => setExportOpen(true) },
    { key: 'print', label: 'Print', onClick: () => window.print() },
    { key: 'pdf', label: 'Download as PDF', hint: 'Opens the print dialog — choose "Save as PDF"', onClick: () => window.print() },
  ];

  const weekendCols = weekendColumns(data?.data);

  const actions = <FilterToggleButton open={filtersOpen} onClick={() => setFiltersOpen(o => !o)} />;

  const filters = (
    <>
      <PeriodFilter options={PERIOD_OPTIONS} selectedKey={periodKey} onSubmit={(v, k) => { setPeriodKey(k); setDateRange(v); }} />
      <button
        onClick={() => setStatusOpen(true)}
        className="px-3 py-1.5 rounded text-[13px] border border-slate-300 bg-white text-slate-600 hover:border-slate-400 transition-colors whitespace-nowrap"
      >
        Status
      </button>
      <div className="flex items-center gap-2 ml-auto">
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
    <ReportShell menuItems={menuItems} title="Employee Present/Absent Status" subtitle="Day-by-day attendance grid for the selected period" actions={actions} filters={filters} loading={loading} switcherCategory="Attendance">
      {!data || data.data.length === 0 ? (
        <div className="text-center py-16 text-slate-400">No data for this period</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-[13px] border-collapse">
            <thead className="bg-slate-50 text-[13px] font-medium text-slate-600">
              <tr>
                <th className="text-left px-3 py-2.5 sticky left-0 bg-slate-50 z-10 whitespace-nowrap">Employee</th>
                {data.dayLabels.map((d, i) => {
                  const dd = new Date(d);
                  return (
                    <th key={d} style={weekendCols.has(i) ? WEEKEND_HATCH : undefined}
                      className="px-1.5 py-2.5 text-center w-14 leading-tight">
                      <div>{dd.getDate()} {dd.toLocaleDateString('en-US', { month: 'short' })}</div>
                      <div className="text-slate-400 font-normal normal-case">{dd.toLocaleDateString('en-US', { weekday: 'short' })}</div>
                    </th>
                  );
                })}
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
                  {emp.days.map((code, i) => (
                    <td key={i} style={weekendCols.has(i) ? WEEKEND_HATCH : undefined}
                      className="px-1 py-2 text-center">
                      {code && code !== '-'
                        ? <span className={`inline-block min-w-8 px-1 rounded text-[10px] font-semibold py-0.5 ${codeStyle(code)}`}>{code}</span>
                        : <span className="text-slate-300">-</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {statusOpen && <StatusPanel onClose={() => setStatusOpen(false)} />}
      <LeaveExportModal
        open={exportOpen} onClose={() => setExportOpen(false)} rows={data?.data || []}
        withIdentity columns={dayColumns(data?.dayLabels || [])}
        legend={GRID_LEGEND}
        sheetName="Present status"
        meta={[['Start Date', dateRange.start], ['End Date', dateRange.end]]}
        formats={['XLS', 'XLSX', 'CSV']}
        fileStub="Employee present_absent status"
      />
    </ReportShell>
  );
}
