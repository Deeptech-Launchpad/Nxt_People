import React, { useState, useEffect } from 'react';
import { Download, RotateCcw } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';
import EmployeeStatusFilter from './EmployeeStatusFilter';
import FilterRow from './FilterRow';
import FilterToggleButton from './FilterToggleButton';
import LeaveTypeFilter from './LeaveTypeFilter';
import PeriodFilter from './PeriodFilter';
import LeaveExportModal from './LeaveExportModal';

const LEGEND = { CL: 'Casual Leave', CO: 'Comp-Off', LWP: 'Leave Without Pay', PM: 'Permission', A: 'Absent', H: 'Holiday', WO: 'Weekly Off' };
const CODE_STYLE = {
  CL: 'bg-blue-100 text-blue-700', CO: 'bg-purple-100 text-purple-700',
  LWP: 'bg-red-100 text-red-700', PM: 'bg-cyan-100 text-cyan-700',
  A: 'bg-rose-100 text-rose-700', H: 'bg-amber-100 text-amber-700', WO: 'bg-slate-100 text-slate-500',
};
const codeStyle = code => CODE_STYLE[code?.replace('½', '')] || '';

const now = new Date();
const y = now.getFullYear(), m = now.getMonth();
const range = (s, e) => ({ start: s.toLocaleDateString('en-CA'), end: e.toLocaleDateString('en-CA') });
const startOfWeek = d => { const r = new Date(d); r.setDate(r.getDate() - r.getDay()); return r; };
const endOfWeek = d => { const r = startOfWeek(d); r.setDate(r.getDate() + 6); return r; };

const PERIOD_OPTIONS = [
  { key: 'thisWeek', label: 'This Week', value: range(startOfWeek(now), endOfWeek(now)) },
  { key: 'lastMonth', label: 'Last Month', value: range(new Date(y, m - 1, 1), new Date(y, m, 0)) },
  { key: 'thisMonth', label: 'This Month', value: range(new Date(y, m, 1), new Date(y, m + 1, 0)) },
];

const EXPORT_COLUMNS = [
  { key: 'firstName', header: 'First Name' }, { key: 'lastName', header: 'Last Name' }, { key: 'employeeCode', header: 'Employee ID' },
];
const EXPORT_EXTRA = [{ key: 'department', header: 'Department' }];

// Day-by-day leave calendar grid (employee rows × date columns) — same
// walk pattern as Attendance's Muster Roll, but cells carry a leave-type
// code instead of a present/absent code.
export default function ResourceAvailability() {
  const [periodKey, setPeriodKey] = useState('thisMonth');
  const [range_, setRange] = useState(PERIOD_OPTIONS.find(o => o.key === 'thisMonth').value);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [employeeStatus, setEmployeeStatus] = useState('all');
  const [leaveType, setLeaveType] = useState('');
  const [dimFilters, setDimFilters] = useState({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({
      startDate: range_.start, endDate: range_.end, employeeStatus, ...(leaveType ? { leaveType } : {}),
      ...Object.fromEntries(Object.entries(dimFilters).filter(([, v]) => v)),
    });
    api.get(`/reports/leave/resource-availability?${params}`)
      .then(r => setData(r.data))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [range_, employeeStatus, leaveType, dimFilters]);

  const exportRows = data ? data.data.map(emp => ({ ...emp, cells: emp.days.filter(Boolean).join(', ') })) : [];

  const reset = () => {
    setPeriodKey('thisMonth'); setRange(PERIOD_OPTIONS.find(o => o.key === 'thisMonth').value);
    setEmployeeStatus('all'); setLeaveType(''); setDimFilters({});
  };

  const actions = <FilterToggleButton open={filtersOpen} onClick={() => setFiltersOpen(o => !o)} />;

  const filters = (
    <>
      <PeriodFilter options={PERIOD_OPTIONS} selectedKey={periodKey} onSubmit={(value, key) => { setPeriodKey(key); setRange(value); }} />
      <div className="flex items-center gap-2 ml-auto">
        <button onClick={() => setExportOpen(true)} className="flex items-center gap-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
          <Download size={14} /> Export
        </button>
        <button onClick={reset} className="flex items-center gap-2 border border-slate-200 text-slate-600 hover:bg-slate-50 px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
          <RotateCcw size={14} /> Reset
        </button>
      </div>
      {filtersOpen && (
        <>
          <div className="w-full flex flex-wrap items-center gap-1.5 pt-1">
            <LeaveTypeFilter value={leaveType} onChange={setLeaveType} />
            <FilterRow value={dimFilters} onChange={(k, v) => setDimFilters(f => ({ ...f, [k]: v }))} />
          </div>
          <div className="w-full flex flex-wrap items-center gap-1.5">
            <EmployeeStatusFilter value={employeeStatus} onChange={setEmployeeStatus} />
          </div>
        </>
      )}
      <div className="flex items-center gap-3 text-[12px] text-slate-500 flex-wrap w-full pt-1">
        {Object.entries(LEGEND).map(([code, label]) => (
          <span key={code} className="flex items-center gap-1"><span className={`px-1.5 py-0.5 rounded font-semibold ${CODE_STYLE[code]}`}>{code}</span>{label}</span>
        ))}
      </div>
    </>
  );

  return (
    <ReportShell title="Resource Availability" subtitle="Leave calendar for the selected period" actions={actions} filters={filters} loading={loading} switcherCategory="Leave Tracker">
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
                    <th key={d} className="px-1.5 py-2.5 text-center w-11 leading-tight">
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
                    <p className="font-medium text-slate-700">{emp.firstName} {emp.lastName} {emp.employeeCode && <span className="text-[11px] font-normal text-slate-400">({emp.employeeCode})</span>}</p>
                    <p className="text-[11px] text-slate-400">
                      {emp.department || '—'}
                      {emp.exitDate && <span className="ml-1.5 text-red-500 font-medium">Exited {new Date(emp.exitDate).toLocaleDateString('en-IN')}</span>}
                    </p>
                  </td>
                  {emp.days.map((code, i) => (
                    <td key={i} className="px-1 py-2 text-center">
                      {code && <span className={`inline-block min-w-7 px-1 rounded text-[10px] font-semibold py-0.5 ${codeStyle(code)}`}>{code}</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <LeaveExportModal open={exportOpen} onClose={() => setExportOpen(false)} rows={exportRows} baseColumns={EXPORT_COLUMNS} extraColumns={EXPORT_EXTRA} fileStub={`resource-availability_${range_.start}_to_${range_.end}`} />
    </ReportShell>
  );
}
