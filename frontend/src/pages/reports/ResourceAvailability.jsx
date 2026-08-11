import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Download, RotateCcw } from 'lucide-react';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import ReportShell from './ReportShell';
import EmployeeStatusFilter from './EmployeeStatusFilter';
import FilterRow from './FilterRow';
import LeaveTypeFilter from './LeaveTypeFilter';
import DirectReportsToggle from './DirectReportsToggle';
import PeriodPresetChip from './PeriodPresetChip';
import FilterToggleButton from './FilterToggleButton';
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
const monthStartCA = () => new Date(y, m, 1).toLocaleDateString('en-CA');
const monthEndCA = () => new Date(y, m + 1, 0).toLocaleDateString('en-CA');
const formatRange = (s, e) => `${new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })} - ${new Date(e).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;

const EXPORT_COLUMNS = [
  { key: 'firstName', header: 'First Name' }, { key: 'lastName', header: 'Last Name' }, { key: 'employeeCode', header: 'Employee ID' },
];
const EXPORT_EXTRA = [{ key: 'department', header: 'Department' }];

export default function ResourceAvailability() {
  const [startDate, setStartDate] = useState(monthStartCA());
  const [endDate, setEndDate] = useState(monthEndCA());
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [employeeStatus, setEmployeeStatus] = useState('all');
  const [leaveType, setLeaveType] = useState('');
  const [directReportsOnly, setDirectReportsOnly] = useState(false);
  const [dimFilters, setDimFilters] = useState({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [showExEmployees, setShowExEmployees] = useState(true);

  const shiftMonth = delta => {
    const d = new Date(startDate);
    d.setMonth(d.getMonth() + delta);
    const s = new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString('en-CA');
    const e = new Date(d.getFullYear(), d.getMonth() + 1, 0).toLocaleDateString('en-CA');
    setStartDate(s); setEndDate(e);
  };

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({
      startDate, endDate, employeeStatus, directReportsOnly: String(directReportsOnly),
      ...(leaveType ? { leaveType } : {}),
      ...Object.fromEntries(Object.entries(dimFilters).filter(([, v]) => v)),
    });
    api.get(`/reports/leave/resource-availability?${params}`)
      .then(r => setData(r.data))
      .catch(err => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [startDate, endDate, employeeStatus, leaveType, directReportsOnly, dimFilters]);

  const exportRows = data ? data.data.map(emp => ({ ...emp, cells: emp.days.filter(Boolean).join(', ') })) : [];

  const reset = () => {
    setStartDate(monthStartCA()); setEndDate(monthEndCA());
    setEmployeeStatus('all'); setLeaveType(''); setDirectReportsOnly(false); setDimFilters({});
  };

  const actions = (
    <div className="flex items-center gap-2">
      <button onClick={() => shiftMonth(-1)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"><ChevronLeft size={16} /></button>
      <span className="text-[14px] font-medium text-slate-700">{formatRange(startDate, endDate)}</span>
      <button onClick={() => shiftMonth(1)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"><ChevronRight size={16} /></button>
      <FilterToggleButton open={filtersOpen} onClick={() => setFiltersOpen(o => !o)} />
    </div>
  );

  const filters = filtersOpen ? (
    <>
      <PeriodPresetChip defaultKey="thisMonth" onSelect={({ start, end }) => { setStartDate(start); setEndDate(end); }} />
      <LeaveTypeFilter value={leaveType} onChange={setLeaveType} />
      <DirectReportsToggle value={directReportsOnly} onChange={setDirectReportsOnly} />
      <FilterRow value={dimFilters} onChange={(k, v) => setDimFilters(f => ({ ...f, [k]: v }))} />
      <div className="flex items-center gap-2 ml-auto">
        <button onClick={() => setExportOpen(true)} className="flex items-center gap-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
          <Download size={14} /> Export
        </button>
        <button onClick={load} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
          Submit
        </button>
        <button onClick={reset} className="flex items-center gap-2 border border-slate-200 text-slate-600 hover:bg-slate-50 px-4 py-2 rounded-lg text-[14px] font-medium transition-colors">
          <RotateCcw size={14} /> Reset
        </button>
      </div>
      <div className="w-full flex flex-wrap items-center gap-2">
        <EmployeeStatusFilter value={employeeStatus} onChange={setEmployeeStatus} />
        <label className="flex items-center gap-1.5 px-1 py-1.5 text-[12.5px] text-slate-600 cursor-pointer select-none whitespace-nowrap">
          <input type="checkbox" checked={showExEmployees} onChange={e => setShowExEmployees(e.target.checked)} className="rounded border-slate-300 text-blue-600" />
          Show selective ex-employees
        </label>
      </div>
      <div className="flex items-center gap-3 text-[12px] text-slate-500 flex-wrap w-full pt-1">
        {Object.entries(LEGEND).map(([code, label]) => (
          <span key={code} className="flex items-center gap-1"><span className={`px-1.5 py-0.5 rounded font-semibold ${CODE_STYLE[code]}`}>{code}</span>{label}</span>
        ))}
      </div>
    </>
  ) : null;

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
      <LeaveExportModal open={exportOpen} onClose={() => setExportOpen(false)} rows={exportRows} baseColumns={EXPORT_COLUMNS} extraColumns={EXPORT_EXTRA} fileStub={`resource-availability_${startDate}_to_${endDate}`} />
    </ReportShell>
  );
}
