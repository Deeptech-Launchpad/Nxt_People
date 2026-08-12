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

const EXPORT_COLUMNS = [
  { key: 'firstName', header: 'First Name' }, { key: 'lastName', header: 'Last Name' },
  { key: 'employeeCode', header: 'Employee ID' }, { key: 'codes', header: 'Daily Codes' },
];
const EXPORT_EXTRA = [{ key: 'department', header: 'Department' }];

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

  const exportRows = (data?.data || []).map(e => ({ ...e, codes: e.days.join(' ') }));
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
    <ReportShell title="Employee Present/Absent Status" subtitle="Day-by-day attendance grid for the selected period" actions={actions} filters={filters} loading={loading} switcherCategory="Attendance">
      {!data || data.data.length === 0 ? (
        <div className="text-center py-16 text-slate-400">No data for this period</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-[13px] border-collapse">
            <thead className="bg-slate-50 text-[11px] font-bold text-slate-500 uppercase">
              <tr>
                <th className="text-left px-3 py-2.5 sticky left-0 bg-slate-50 z-10 whitespace-nowrap">Employee</th>
                {data.dayLabels.map(d => {
                  const dd = new Date(d);
                  return (
                    <th key={d} className="px-1.5 py-2.5 text-center w-14 leading-tight">
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
                    <td key={i} className="px-1 py-2 text-center">
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
      <LeaveExportModal open={exportOpen} onClose={() => setExportOpen(false)} rows={exportRows} baseColumns={EXPORT_COLUMNS} extraColumns={EXPORT_EXTRA} fileStub={`present-absent_${dateRange.start}_to_${dateRange.end}`} />
    </ReportShell>
  );
}
